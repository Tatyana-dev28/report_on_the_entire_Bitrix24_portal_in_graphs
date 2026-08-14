from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import time
from typing import Any
from urllib.parse import urlencode

import requests
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.bitrix.models import BitrixAuthToken, BitrixPortal
from apps.common.services.sanitizers import sanitize_for_log, sanitize_payload


TOKEN_EXPIRED_ERRORS = {
    "expired_token",
    "invalid_token",
    "INVALID_TOKEN",
    "NO_AUTH_FOUND",
    "authorization_error",
}

# Bitrix list methods return ~50 rows per page. Batch can pack up to 50 commands;
# keep a margin like activity/telephony loaders.
BITRIX_LIST_PAGE_SIZE = 50
BITRIX_LIST_BATCH_COMMANDS = 25


class BitrixRestError(Exception):
    """Базовая ошибка REST-клиента Bitrix24."""


class BitrixRestAuthError(BitrixRestError):
    """Ошибка авторизации Bitrix24."""


class BitrixRestTokenRefreshError(BitrixRestAuthError):
    """Не удалось обновить OAuth-токены Bitrix24."""


class BitrixRestResponseError(BitrixRestError):
    """Bitrix24 вернул error/error_description."""

    def __init__(
        self,
        message: str,
        *,
        method: str = "",
        error_code: str = "",
        error_description: str = "",
        response_payload: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.method = method
        self.error_code = error_code
        self.error_description = error_description
        self.response_payload = sanitize_for_log(response_payload or {})


@dataclass(frozen=True)
class BitrixRestResult:
    result: Any
    total: int | None = None
    next: int | str | None = None
    time: dict[str, Any] | None = None
    raw: dict[str, Any] | None = None


class BitrixRestClient:
    """Серверный REST-клиент Bitrix24 для OAuth-приложения.

    Важно:
    - токены читаются только внутри backend;
    - секреты не пишутся в логи;
    - refresh token обновляется и сохраняется в БД;
    - результаты отчетов здесь не хранятся.
    """

    def __init__(self, portal: BitrixPortal):
        self.portal = portal
        self.timeout = int(getattr(settings, "BITRIX_REST_TIMEOUT_SECONDS", 30))
        self.max_list_pages = int(getattr(settings, "BITRIX_REST_MAX_LIST_PAGES", 200))
        self.retry_attempts = max(
            1,
            int(getattr(settings, "BITRIX_REST_RETRY_ATTEMPTS", 3)),
        )
        self.retry_delay_seconds = max(
            0.0,
            float(getattr(settings, "BITRIX_REST_RETRY_DELAY_SECONDS", 1)),
        )

    @property
    def auth_token(self) -> BitrixAuthToken:
        try:
            return self.portal.auth_token
        except BitrixAuthToken.DoesNotExist as error:
            raise BitrixRestAuthError(
                f"Для портала {self.portal.domain} нет OAuth-токенов."
            ) from error

    def call_method(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        *,
        retry_on_auth_error: bool = True,
    ) -> BitrixRestResult:
        """Выполняет один REST-метод Bitrix24."""

        if not method:
            raise BitrixRestError("Bitrix REST method is required.")

        payload = dict(params or {})
        payload["auth"] = self._get_valid_access_token()

        response_payload = self._post_json(method=method, payload=payload)

        if self._has_bitrix_error(response_payload):
            error_code = str(response_payload.get("error", ""))
            error_description = str(response_payload.get("error_description", ""))

            if retry_on_auth_error and self._is_token_error(error_code):
                self.refresh_tokens()
                payload["auth"] = self.auth_token.get_access_token()
                response_payload = self._post_json(method=method, payload=payload)

                if self._has_bitrix_error(response_payload):
                    self._raise_response_error(method, response_payload)

            else:
                self._raise_response_error(method, response_payload)

        return BitrixRestResult(
            result=response_payload.get("result"),
            total=response_payload.get("total"),
            next=response_payload.get("next"),
            time=response_payload.get("time"),
            raw=response_payload,
        )

    def call_list(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        *,
        max_pages: int | None = None,
    ) -> list[Any]:
        """Забирает все страницы list-метода Bitrix24.

        Когда Bitrix отдаёт `total`, остальные страницы читаются через `batch`
        (как у activity/telephony): меньше круглых поездок, тот же набор строк.
        Если `total` нет — прежняя последовательная пагинация по `next`.
        """

        max_pages = max_pages or self.max_list_pages
        base_params = dict(params or {})

        first_response = self.call_method(
            method,
            {
                **base_params,
                "start": 0,
            },
        )
        all_items = list(_extract_list_page_items(first_response.result))
        total = self._safe_int(first_response.total, default=-1)
        total_value = first_response.total
        has_total = total_value is not None and total >= 0

        if not has_total and first_response.next is not None:
            return self._call_list_sequential(
                method,
                base_params,
                all_items=all_items,
                next_start=first_response.next,
                page_count=1,
                max_pages=max_pages,
            )

        if not has_total or total <= BITRIX_LIST_PAGE_SIZE:
            return all_items

        max_rows = max_pages * BITRIX_LIST_PAGE_SIZE
        if total > max_rows:
            raise BitrixRestError(
                f"Остановлена пагинация {method}: превышен лимит {max_pages} страниц."
            )

        starts = list(range(BITRIX_LIST_PAGE_SIZE, total, BITRIX_LIST_PAGE_SIZE))
        if 1 + len(starts) > max_pages:
            raise BitrixRestError(
                f"Остановлена пагинация {method}: превышен лимит {max_pages} страниц."
            )

        try:
            for index in range(0, len(starts), BITRIX_LIST_BATCH_COMMANDS):
                chunk = starts[index : index + BITRIX_LIST_BATCH_COMMANDS]
                commands = {
                    f"page_{start}": build_batch_command(
                        method,
                        {
                            **base_params,
                            "start": start,
                        },
                    )
                    for start in chunk
                }
                batch_response = self.call_batch(commands, halt=False)
                all_items.extend(
                    _extract_batch_list_items(batch_response.result, commands.keys())
                )
            return all_items
        except BitrixRestError:
            # Batch transport/shape issues must not break report builds: finish
            # the remaining pages the old sequential way from the first page.
            return self._call_list_sequential(
                method,
                base_params,
                all_items=[],
                next_start=0,
                page_count=0,
                max_pages=max_pages,
            )

    def _call_list_sequential(
        self,
        method: str,
        params: dict[str, Any],
        *,
        all_items: list[Any],
        next_start: int | str | None,
        page_count: int,
        max_pages: int,
    ) -> list[Any]:
        """Прежняя пагинация page-by-page через start/next."""

        while next_start is not None:
            page_count += 1

            if page_count > max_pages:
                raise BitrixRestError(
                    f"Остановлена пагинация {method}: превышен лимит {max_pages} страниц."
                )

            page_params = dict(params)
            page_params["start"] = next_start

            response = self.call_method(method, page_params)
            all_items.extend(_extract_list_page_items(response.result))
            next_start = response.next

        return all_items

    def call_batch(
        self,
        commands: dict[str, str],
        *,
        halt: bool = False,
    ) -> BitrixRestResult:
        """Выполняет batch-запрос. Bitrix24 поддерживает до 50 команд за один batch."""

        if not commands:
            raise BitrixRestError("Batch commands are required.")

        if len(commands) > 50:
            raise BitrixRestError("Bitrix batch supports no more than 50 commands.")

        return self.call_method(
            "batch",
            {
                "halt": 1 if halt else 0,
                "cmd": commands,
            },
        )

    def refresh_tokens(self) -> BitrixAuthToken:
        """Обновляет OAuth-токены через refresh_token и сохраняет их в БД."""

        client_id = getattr(settings, "BITRIX_CLIENT_ID", "")
        client_secret = getattr(settings, "BITRIX_CLIENT_SECRET", "")

        if not client_id or not client_secret:
            raise BitrixRestTokenRefreshError(
                "BITRIX_CLIENT_ID и BITRIX_CLIENT_SECRET обязательны для обновления токенов."
            )

        token = self.auth_token
        refresh_token = token.get_refresh_token()

        if not refresh_token:
            raise BitrixRestTokenRefreshError(
                f"Для портала {self.portal.domain} нет refresh_token."
            )

        try:
            response = requests.get(
                "https://oauth.bitrix.info/oauth/token/",
                params={
                    "grant_type": "refresh_token",
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh_token,
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except requests.RequestException as error:
            raise BitrixRestTokenRefreshError(
                f"HTTP-ошибка при обновлении токенов Bitrix24: {error}"
            ) from error
        except ValueError as error:
            raise BitrixRestTokenRefreshError(
                "Bitrix24 вернул некорректный JSON при обновлении токенов."
            ) from error

        if self._has_bitrix_error(payload):
            raise BitrixRestTokenRefreshError(
                "Bitrix24 отказал в обновлении токенов: "
                f"{payload.get('error')} — {payload.get('error_description', '')}"
            )

        access_token = str(payload.get("access_token", "") or "")
        new_refresh_token = str(payload.get("refresh_token", "") or "")
        expires_in = self._safe_int(payload.get("expires_in"), default=3600)

        if not access_token:
            raise BitrixRestTokenRefreshError(
                "Bitrix24 не вернул access_token при обновлении токенов."
            )

        expires_at = timezone.now() + timedelta(seconds=expires_in)

        with transaction.atomic():
            locked_token = BitrixAuthToken.objects.select_for_update().get(
                portal=self.portal
            )

            locked_token.scope = str(payload.get("scope", "") or locked_token.scope)
            locked_token.auth_user_id = str(
                payload.get("user_id", "") or locked_token.auth_user_id
            )
            locked_token.raw_auth_payload = sanitize_payload(payload)
            locked_token.last_refresh_at = timezone.now()
            locked_token.set_tokens(
                access_token=access_token,
                refresh_token=new_refresh_token,
                expires_at=expires_at,
                save=False,
            )
            locked_token.save()

            if payload.get("client_endpoint"):
                self.portal.client_endpoint = str(payload["client_endpoint"])
            if payload.get("server_endpoint"):
                self.portal.server_endpoint = str(payload["server_endpoint"])
            if payload.get("member_id"):
                self.portal.member_id = str(payload["member_id"])
            self.portal.save(
                update_fields=[
                    "client_endpoint",
                    "server_endpoint",
                    "member_id",
                    "updated_at",
                ]
            )

        self.portal.refresh_from_db()
        return self.auth_token

    def _get_valid_access_token(self) -> str:
        token = self.auth_token

        if not token.has_access_token:
            raise BitrixRestAuthError(
                f"Для портала {self.portal.domain} нет access_token."
            )

        if token.is_expired:
            self.refresh_tokens()
            token = self.auth_token

        access_token = token.get_access_token()

        if not access_token:
            raise BitrixRestAuthError(
                f"Для портала {self.portal.domain} пустой access_token."
            )

        return access_token

    def _post_json(self, *, method: str, payload: dict[str, Any]) -> dict[str, Any]:
        endpoint = self._method_url(method)
        response_payload: dict[str, Any] | None = None

        for attempt in range(1, self.retry_attempts + 1):
            try:
                response = requests.post(
                    endpoint,
                    json=payload,
                    timeout=self.timeout,
                    headers={
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    },
                )

                if self._should_retry_http_status(response.status_code, attempt):
                    self._sleep_before_retry(attempt)
                    continue

                response.raise_for_status()
                response_payload = response.json()
                break
            except requests.RequestException as error:
                if attempt < self.retry_attempts:
                    self._sleep_before_retry(attempt)
                    continue

                raise BitrixRestError(
                    f"HTTP-ошибка Bitrix24 REST method={method}: {error}"
                ) from error
            except ValueError as error:
                raise BitrixRestError(
                    f"Bitrix24 REST method={method} вернул некорректный JSON."
                ) from error

        if response_payload is None:
            raise BitrixRestError(
                f"Bitrix24 REST method={method} не вернул ответ."
            )

        if not isinstance(response_payload, dict):
            raise BitrixRestError(
                f"Bitrix24 REST method={method} вернул неожиданный формат ответа."
            )

        return response_payload

    def _should_retry_http_status(self, status_code: int, attempt: int) -> bool:
        if attempt >= self.retry_attempts:
            return False

        return status_code == 429 or 500 <= status_code < 600

    def _sleep_before_retry(self, attempt: int) -> None:
        if self.retry_delay_seconds <= 0:
            return

        time.sleep(self.retry_delay_seconds * attempt)

    def _method_url(self, method: str) -> str:
        base = self.portal.client_endpoint or f"{self.portal.base_url}/rest/"
        base = base.rstrip("/")
        clean_method = method.strip().strip("/")
        return f"{base}/{clean_method}.json"

    def _raise_response_error(self, method: str, payload: dict[str, Any]) -> None:
        error_code = str(payload.get("error", "") or "")
        error_description = str(payload.get("error_description", "") or "")

        raise BitrixRestResponseError(
            f"Bitrix24 REST error method={method}: {error_code} — {error_description}",
            method=method,
            error_code=error_code,
            error_description=error_description,
            response_payload=payload,
        )

    @staticmethod
    def _has_bitrix_error(payload: dict[str, Any]) -> bool:
        return bool(payload.get("error"))

    @staticmethod
    def _is_token_error(error_code: str) -> bool:
        normalized = str(error_code or "").strip()
        return normalized in TOKEN_EXPIRED_ERRORS

    @staticmethod
    def _safe_int(value: Any, *, default: int) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default


def build_batch_command(method: str, params: dict[str, Any] | None = None) -> str:
    """Собирает строку команды для Bitrix batch.

    Пример:
    build_batch_command("crm.deal.list", {"select": ["ID", "TITLE"]})
    """

    if not params:
        return method

    query = urlencode(_flatten_query_params(params), doseq=True)
    return f"{method}?{query}"


def _extract_list_page_items(result: Any) -> list[Any]:
    """Нормализует одну страницу list/tasks ответа Bitrix к списку элементов."""

    if isinstance(result, list):
        return list(result)

    if isinstance(result, dict) and "items" in result and isinstance(result["items"], list):
        return list(result["items"])

    if isinstance(result, dict) and "tasks" in result:
        tasks = result["tasks"]
        if isinstance(tasks, list):
            return list(tasks)
        if isinstance(tasks, dict):
            # Bitrix often returns tasks as an id→row map, not an array.
            return [value for value in tasks.values() if isinstance(value, dict)]

    if result is not None:
        return [result]

    return []


def _extract_batch_list_items(result: Any, command_keys) -> list[Any]:
    """Достаёт элементы list-страниц из ответа batch."""

    if not isinstance(result, dict):
        return []

    result_container = result.get("result")
    if not isinstance(result_container, dict):
        return []

    rows: list[Any] = []
    for command_key in command_keys:
        rows.extend(_extract_list_page_items(result_container.get(command_key)))
    return rows


def _flatten_query_params(params: dict[str, Any]) -> list[tuple[str, Any]]:
    result: list[tuple[str, Any]] = []

    def add_value(key: str, value: Any) -> None:
        if isinstance(value, dict):
            for nested_key, nested_value in value.items():
                add_value(f"{key}[{nested_key}]", nested_value)
            return

        if isinstance(value, (list, tuple)):
            for item in value:
                add_value(f"{key}[]", item)
            return

        result.append((key, value))

    for param_key, param_value in params.items():
        add_value(str(param_key), param_value)

    return result
