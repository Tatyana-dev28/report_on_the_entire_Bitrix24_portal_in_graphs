from __future__ import annotations

import logging
import re
from typing import Any

from apps.bitrix.models import BitrixPortal
from apps.bitrix.services.rest_client import BitrixRestClient, BitrixRestError, build_batch_command

logger = logging.getLogger(__name__)

_ROBOT_EXTERNAL_AUTH_IDS = {
    "bot",
    "imbot",
    "replica",
    "__controller",
}

_TECHNICAL_EXTERNAL_AUTH_IDS = {
    "email",
    "network",
    "sale",
    "shop",
    "call",
}


def load_portal_employees(portal: BitrixPortal) -> list[dict[str, Any]]:
    """Загружает сотрудников портала (активных и неактивных) через user.get."""
    try:
        client = BitrixRestClient(portal)
        # Without ACTIVE filter so the UI can optionally show dismissed users.
        # ADMIN_MODE helps return UF_DEPARTMENT for department grouping.
        users = client.call_list(
            "user.get",
            {
                "ADMIN_MODE": True,
            },
        )
    except BitrixRestError:
        logger.warning("Failed to load portal employees via user.get.", exc_info=True)
        return []

    needed_department_ids: set[str] = set()
    for user in users:
        if isinstance(user, dict):
            needed_department_ids.update(_department_ids(user.get("UF_DEPARTMENT")))

    department_names = _load_department_names(portal, needed_ids=needed_department_ids)

    employees: list[dict[str, Any]] = []

    for user in users:
        if not isinstance(user, dict):
            continue
        normalized = _normalize_portal_user(user, department_names)
        if normalized:
            employees.append(normalized)

    return employees


def resolve_user_names_by_ids(
    portal: BitrixPortal,
    user_ids: list[str] | set[str],
) -> dict[str, dict[str, str]]:
    """Resolve display names for concrete user ids (fills gaps like «Сотрудник 7597»)."""
    unique_ids = sorted({
        str(user_id).strip()
        for user_id in user_ids
        if str(user_id).strip() and str(user_id).strip() not in {"unknown", "__unavailable__"}
    })

    if not unique_ids:
        return {}

    resolved: dict[str, dict[str, str]] = {}

    try:
        client = BitrixRestClient(portal)
        # Prefer a single filtered list call; fall back to per-id get.
        try:
            users = client.call_list(
                "user.get",
                {
                    "FILTER": {"ID": unique_ids},
                    "ADMIN_MODE": True,
                },
            )
        except BitrixRestError:
            users = []

        for user in users:
            if not isinstance(user, dict):
                continue
            user_id = str(user.get("ID") or "").strip()
            if not user_id:
                continue
            first_name, last_name, full_name = _split_user_name(user)
            if full_name:
                resolved[user_id] = {
                    "name": full_name,
                    "firstName": first_name or full_name,
                    "lastName": last_name,
                }

        missing_ids = [user_id for user_id in unique_ids if user_id not in resolved]
        for user_id in missing_ids:
            try:
                response = client.call_method("user.get", {"ID": user_id, "ADMIN_MODE": True})
            except BitrixRestError:
                continue

            result = response.result
            user = None
            if isinstance(result, list) and result:
                user = result[0] if isinstance(result[0], dict) else None
            elif isinstance(result, dict):
                user = result

            if not isinstance(user, dict):
                continue

            first_name, last_name, full_name = _split_user_name(user)
            if full_name:
                resolved[user_id] = {
                    "name": full_name,
                    "firstName": first_name or full_name,
                    "lastName": last_name,
                }
    except BitrixRestError:
        logger.warning("Failed to resolve employee names by ids.", exc_info=True)
        return resolved

    return resolved


def enrich_employee_payloads_with_names(
    employees: list[dict[str, Any]],
    portal: BitrixPortal,
) -> list[dict[str, Any]]:
    """Replace generic «Сотрудник {id}» labels with real names from user.get."""
    generic_ids = [
        str(employee.get("id") or "").strip()
        for employee in employees
        if _is_generic_employee_payload_name(employee)
    ]

    if not generic_ids:
        return employees

    resolved = resolve_user_names_by_ids(portal, generic_ids)
    if not resolved:
        return employees

    enriched: list[dict[str, Any]] = []
    for employee in employees:
        employee_id = str(employee.get("id") or "").strip()
        meta = resolved.get(employee_id)
        if not meta:
            enriched.append(employee)
            continue

        next_employee = dict(employee)
        next_employee["name"] = meta["name"]
        next_employee["firstName"] = meta["firstName"]
        next_employee["lastName"] = meta["lastName"]
        enriched.append(next_employee)

    return enriched


def _normalize_portal_user(user: dict[str, Any], department_names: dict[str, str]) -> dict[str, Any] | None:
    user_id = str(user.get("ID") or "").strip()

    if not user_id:
        return None

    first_name, last_name, full_name = _split_user_name(user)

    if not full_name:
        full_name = f"Сотрудник {user_id}"

    is_robot = _is_robot_user(user, full_name)
    is_technical = is_robot or _is_technical_user(user)
    work_position = str(user.get("WORK_POSITION") or "").strip()
    department_ids = _department_ids(user.get("UF_DEPARTMENT"))
    departments = [
        {
            "id": department_id,
            "name": department_names.get(department_id) or f"Отдел {department_id}",
        }
        for department_id in department_ids
    ]
    department_label = ", ".join(item["name"] for item in departments) or None

    return {
        "id": user_id,
        "name": full_name,
        "firstName": first_name or full_name,
        "lastName": last_name,
        "avatarUrl": str(user.get("PERSONAL_PHOTO") or "").strip() or None,
        "isActive": str(user.get("ACTIVE") or "Y").upper() != "N",
        "isRobot": is_robot,
        "isTechnical": is_technical,
        "workPosition": work_position or None,
        "department": department_label,
        "departmentIds": department_ids,
        "departments": departments,
    }


def _split_user_name(user: dict[str, Any]) -> tuple[str, str, str]:
    first_name = str(user.get("NAME") or "").strip()
    last_name = str(user.get("LAST_NAME") or "").strip()
    full_name = str(user.get("FULL_NAME") or "").strip()

    if not full_name:
        full_name = " ".join(part for part in [first_name, last_name] if part).strip()

    return first_name, last_name, full_name


def _is_generic_employee_payload_name(employee: dict[str, Any]) -> bool:
    employee_id = str(employee.get("id") or "").strip()
    name = str(employee.get("name") or "").strip()

    if not employee_id or employee_id in {"unknown", "__unavailable__"}:
        return False

    return not name or name == f"Сотрудник {employee_id}"


def _load_department_names(
    portal: BitrixPortal,
    *,
    needed_ids: set[str] | None = None,
) -> dict[str, str]:
    """Load department NAME by ID via department.get; fill gaps via batch/ID lookup."""
    names: dict[str, str] = {}
    needed_ids = {department_id for department_id in (needed_ids or set()) if department_id}

    try:
        client = BitrixRestClient(portal)
    except Exception:
        logger.warning("Could not create Bitrix REST client for departments.", exc_info=True)
        return names

    token_scope = ""
    try:
        token_scope = str(getattr(client.auth_token, "scope", "") or "")
    except Exception:
        token_scope = ""

    if token_scope and "department" not in {
        part.strip().lower() for part in token_scope.replace(";", ",").split(",") if part.strip()
    }:
        logger.warning(
            "Portal %s OAuth scope has no `department` (%s). "
            "Add «Структура компании» in the Bitrix app and reinstall to load department names.",
            portal.domain,
            token_scope,
        )

    try:
        departments = client.call_list(
            "department.get",
            {
                "sort": "NAME",
                "order": "ASC",
            },
        )
        names.update(_department_names_from_rows(departments))
    except BitrixRestError as error:
        error_code = str(getattr(error, "error_code", "") or "").lower()
        logger.warning(
            "Failed to load portal departments via department.get (%s): %s",
            error_code or "unknown",
            error,
            exc_info=True,
        )
    except Exception:
        logger.warning("Unexpected error while loading portal departments.", exc_info=True)

    missing_ids = sorted(needed_ids - set(names.keys()))
    if missing_ids:
        logger.info(
            "Resolving %s missing department names for portal %s",
            len(missing_ids),
            portal.domain,
        )
        names.update(_resolve_department_names_by_ids(client, missing_ids))

    if needed_ids and not names:
        logger.warning(
            "No department names resolved for portal %s (needed=%s). "
            "Check that the app has the `department` scope and reinstall if needed.",
            portal.domain,
            len(needed_ids),
        )
    elif needed_ids:
        still_missing = needed_ids - set(names.keys())
        if still_missing:
            logger.warning(
                "Department names still missing for portal %s: %s",
                portal.domain,
                ", ".join(sorted(still_missing)[:20]),
            )

    return names


def _resolve_department_names_by_ids(
    client: BitrixRestClient,
    department_ids: list[str],
) -> dict[str, str]:
    names: dict[str, str] = {}

    for offset in range(0, len(department_ids), 50):
        chunk = department_ids[offset : offset + 50]
        commands: dict[str, str] = {}
        for index, department_id in enumerate(chunk):
            try:
                bitrix_id: Any = int(department_id) if department_id.isdigit() else department_id
            except (TypeError, ValueError):
                bitrix_id = department_id
            commands[f"d{index}"] = build_batch_command("department.get", {"ID": bitrix_id})

        try:
            response = client.call_batch(commands, halt=False)
        except BitrixRestError:
            for department_id in chunk:
                names.update(_fetch_one_department_name(client, department_id))
            continue

        result = response.result if isinstance(response.result, dict) else {}
        result_map = result.get("result") if isinstance(result.get("result"), dict) else None

        if not isinstance(result_map, dict):
            for department_id in chunk:
                names.update(_fetch_one_department_name(client, department_id))
            continue

        for command_key in commands:
            names.update(_department_names_from_rows(_coerce_department_result(result_map.get(command_key))))

    still_missing = [department_id for department_id in department_ids if department_id not in names]
    for department_id in still_missing:
        names.update(_fetch_one_department_name(client, department_id))

    return names


def _fetch_one_department_name(client: BitrixRestClient, department_id: str) -> dict[str, str]:
    try:
        bitrix_id: Any = int(department_id) if department_id.isdigit() else department_id
        response = client.call_method("department.get", {"ID": bitrix_id})
    except (BitrixRestError, TypeError, ValueError):
        return {}

    return _department_names_from_rows(_coerce_department_result(response.result))


def _coerce_department_result(result: Any) -> list[Any]:
    if result is None:
        return []
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        if isinstance(result.get("items"), list):
            return result["items"]
        # Single department row.
        if "ID" in result or "NAME" in result or "id" in result or "name" in result:
            return [result]
        # id → row map
        return [value for value in result.values() if isinstance(value, dict)]
    return []


def _department_names_from_rows(rows: list[Any]) -> dict[str, str]:
    names: dict[str, str] = {}

    for row in _coerce_department_result(rows):
        if not isinstance(row, dict):
            continue

        department_id = _normalize_department_id(row.get("ID") if "ID" in row else row.get("id"))
        name = str(row.get("NAME") or row.get("name") or row.get("TITLE") or "").strip()

        if department_id and name:
            names[department_id] = name

    return names


def _is_robot_user(user: dict[str, Any], full_name: str) -> bool:
    external_auth = str(user.get("EXTERNAL_AUTH_ID") or "").strip().lower()

    if external_auth in _ROBOT_EXTERNAL_AUTH_IDS:
        return True

    normalized_name = full_name.casefold()

    if "робот" in normalized_name or normalized_name.startswith("bot ") or " bot" in normalized_name:
        return True

    return False


def _is_technical_user(user: dict[str, Any]) -> bool:
    external_auth = str(user.get("EXTERNAL_AUTH_ID") or "").strip().lower()

    if external_auth in _TECHNICAL_EXTERNAL_AUTH_IDS:
        return True

    user_type = str(user.get("USER_TYPE") or user.get("USER_TYPE_ID") or "").strip().lower()

    return user_type in {"email", "extranet"} and external_auth != ""


def _normalize_department_id(value: Any) -> str:
    if value is None or value is False:
        return ""

    if isinstance(value, float) and value.is_integer():
        return str(int(value))

    if isinstance(value, int):
        return str(value)

    text = str(value).strip()
    if not text:
        return ""

    # JSON/PHP quirks: "101.0"
    if re.fullmatch(r"\d+\.0+", text):
        return text.split(".", 1)[0]

    return text


def _department_ids(raw_departments: Any) -> list[str]:
    if raw_departments is None or raw_departments is False:
        return []

    if isinstance(raw_departments, (list, tuple, set)):
        collected: list[str] = []
        for item in raw_departments:
            if isinstance(item, (list, tuple, set)):
                collected.extend(_department_ids(item))
                continue
            department_id = _normalize_department_id(item)
            if department_id and department_id not in collected:
                collected.append(department_id)
        return collected

    if isinstance(raw_departments, dict):
        return _department_ids(list(raw_departments.values()))

    text = _normalize_department_id(raw_departments)
    return [text] if text else []
