from datetime import timedelta
from typing import Any

from django.db import transaction
from django.utils import timezone

from apps.billing.models import Subscription
from apps.billing.services.access import (
    get_free_plan,
    set_free_access,
    sync_portal_access_from_subscription,
)
from apps.bitrix.models import BitrixAuthToken, BitrixPortal
from apps.common.services.sanitizers import sanitize_payload


class BitrixInstallError(Exception):
    pass


def normalize_bitrix_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Приводит разные форматы данных Bitrix24 к одному виду.

    Bitrix24 может прислать данные:
    - плоско: DOMAIN, AUTH_ID, REFRESH_ID, member_id;
    - во вложенном auth: auth.domain, auth.access_token;
    - в bracket-формате: auth[domain], auth[access_token];
    - как JSON с auth/data.
    """

    auth = payload.get("auth") if isinstance(payload.get("auth"), dict) else {}
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}

    def get_value(*keys, default=""):
        for key in keys:
            if key in payload and payload.get(key) not in (None, ""):
                return payload.get(key)

            if key in auth and auth.get(key) not in (None, ""):
                return auth.get(key)

            if key in data and data.get(key) not in (None, ""):
                return data.get(key)

            bracket_auth_key = f"auth[{key}]"
            if bracket_auth_key in payload and payload.get(bracket_auth_key) not in (None, ""):
                return payload.get(bracket_auth_key)

            bracket_data_key = f"data[{key}]"
            if bracket_data_key in payload and payload.get(bracket_data_key) not in (None, ""):
                return payload.get(bracket_data_key)

        return default

    domain = _normalize_domain(get_value("DOMAIN", "domain"))
    member_id = str(get_value("member_id", "MEMBER_ID", default="") or "").strip()
    protocol_value = get_value("PROTOCOL", "protocol", default="1")

    if not domain:
        raise BitrixInstallError("Bitrix24 domain is missing.")

    if not member_id:
        raise BitrixInstallError("Bitrix24 member_id is missing.")

    if str(protocol_value) == "0":
        protocol = BitrixPortal.Protocol.HTTP
        scheme = "http"
    else:
        protocol = BitrixPortal.Protocol.HTTPS
        scheme = "https"

    default_endpoint = f"{scheme}://{domain}/rest/"

    expires_in = get_value(
        "AUTH_EXPIRES",
        "expires_in",
        "expires",
        default="3600",
    )

    try:
        expires_seconds = int(expires_in)
    except (TypeError, ValueError):
        expires_seconds = 3600

    if expires_seconds <= 0:
        expires_seconds = 3600

    return {
        "domain": domain,
        "member_id": member_id,
        "protocol": protocol,
        "language": str(get_value("LANG", "LANGUAGE_ID", "language", default="") or "").strip(),
        "app_sid": str(get_value("APP_SID", "app_sid", default="") or "").strip(),
        "status": str(get_value("status", default="") or "").strip(),
        "event_name": str(get_value("event", default="") or "").strip(),
        "access_token": str(get_value("AUTH_ID", "access_token", default="") or "").strip(),
        "refresh_token": str(get_value("REFRESH_ID", "refresh_token", default="") or "").strip(),
        "expires_at": timezone.now() + timedelta(seconds=expires_seconds),
        "application_token": str(
            get_value("application_token", "APPLICATION_TOKEN", default="") or ""
        ).strip(),
        "client_endpoint": str(
            get_value("client_endpoint", default=default_endpoint) or default_endpoint
        ).strip(),
        "server_endpoint": str(
            get_value("server_endpoint", default=default_endpoint) or default_endpoint
        ).strip(),
        "auth_user_id": str(get_value("user_id", "USER_ID", default="") or "").strip(),
        "auth_user_name": str(get_value("user_name", "USER_NAME", default="") or "").strip(),
        "scope": str(get_value("scope", "SCOPE", default="") or "").strip(),
        "raw_payload": sanitize_payload(payload),
    }


@transaction.atomic
def create_or_update_portal_from_bitrix_payload(
    payload: dict[str, Any],
    mark_installed: bool = True,
) -> BitrixPortal:
    """
    Создает или обновляет портал при установке/открытии приложения.
    """

    normalized = normalize_bitrix_payload(payload)
    now = timezone.now()

    portal, _ = BitrixPortal.objects.get_or_create(
        member_id=normalized["member_id"],
        defaults={
            "domain": normalized["domain"],
            "protocol": normalized["protocol"],
            "client_endpoint": normalized["client_endpoint"],
            "server_endpoint": normalized["server_endpoint"],
            "status": BitrixPortal.Status.INSTALLED,
            "installed_at": now if mark_installed else None,
            "last_opened_at": now,
            "installed_by_user_id": normalized["auth_user_id"],
            "installed_by_user_name": normalized["auth_user_name"],
            "language": normalized["language"],
            "raw_install_payload": normalized["raw_payload"],
            "is_active": True,
        },
    )

    portal.domain = normalized["domain"]
    portal.protocol = normalized["protocol"]
    portal.client_endpoint = normalized["client_endpoint"] or portal.client_endpoint
    portal.server_endpoint = normalized["server_endpoint"] or portal.server_endpoint
    portal.last_opened_at = now
    portal.language = normalized["language"] or portal.language
    portal.raw_install_payload = normalized["raw_payload"]
    portal.is_active = True
    portal.uninstalled_at = None

    if mark_installed:
        portal.status = BitrixPortal.Status.INSTALLED
        portal.installed_at = portal.installed_at or now

    if normalized["auth_user_id"]:
        portal.installed_by_user_id = normalized["auth_user_id"]

    if normalized["auth_user_name"]:
        portal.installed_by_user_name = normalized["auth_user_name"]

    if normalized["application_token"]:
        portal.set_application_token(normalized["application_token"], save=False)

    portal.save()

    if normalized["access_token"] or normalized["refresh_token"]:
        save_auth_token(
            portal=portal,
            normalized=normalized,
        )

    ensure_free_subscription_and_access(portal=portal)

    return portal


@transaction.atomic
def save_auth_token(
    portal: BitrixPortal,
    normalized: dict[str, Any],
) -> BitrixAuthToken:
    """
    Создает или обновляет OAuth-токены портала.

    Важно: если Bitrix при повторном открытии приложения не прислал refresh_token,
    мы не затираем старый refresh_token пустой строкой.
    """

    auth_token, _ = BitrixAuthToken.objects.get_or_create(
        portal=portal,
        defaults={
            "expires_at": normalized["expires_at"],
        },
    )

    old_access_token = auth_token.get_access_token() if auth_token.has_access_token else ""
    old_refresh_token = auth_token.get_refresh_token() if auth_token.has_refresh_token else ""

    access_token = normalized["access_token"] or old_access_token
    refresh_token = normalized["refresh_token"] or old_refresh_token

    auth_token.expires_at = normalized["expires_at"]
    auth_token.scope = normalized["scope"] or auth_token.scope
    auth_token.auth_user_id = normalized["auth_user_id"] or auth_token.auth_user_id
    auth_token.auth_user_name = normalized["auth_user_name"] or auth_token.auth_user_name
    auth_token.raw_auth_payload = normalized["raw_payload"]

    auth_token.set_tokens(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=normalized["expires_at"],
        save=False,
    )

    auth_token.save()

    return auth_token


@transaction.atomic
def ensure_free_subscription_and_access(portal: BitrixPortal) -> Subscription:
    """
    Создает Free-подписку и PortalAccess при первой установке.

    Если подписка уже есть, не сбрасывает ее в Free,
    чтобы случайно не выключить Pro при повторном открытии приложения.
    """

    existing_subscription = (
        Subscription.objects
        .filter(portal=portal)
        .order_by("-created_at")
        .first()
    )

    if existing_subscription:
        sync_portal_access_from_subscription(existing_subscription)
        return existing_subscription

    free_plan = get_free_plan()

    if not free_plan:
        raise BitrixInstallError(
            "Free plan not found. Run: python manage.py seed_plans"
        )

    subscription = Subscription.objects.create(
        portal=portal,
        plan=free_plan,
        status=Subscription.Status.FREE,
        provider=Subscription.Provider.NONE,
        started_at=timezone.now(),
        metadata={
            "source": "bitrix_install",
        },
    )

    set_free_access(
        portal=portal,
        subscription=subscription,
    )

    return subscription


def _normalize_domain(value: Any) -> str:
    domain = str(value or "").strip()
    domain = domain.removeprefix("https://")
    domain = domain.removeprefix("http://")
    domain = domain.strip("/")

    return domain