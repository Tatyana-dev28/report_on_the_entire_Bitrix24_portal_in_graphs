from __future__ import annotations

import logging
from typing import Any

from apps.bitrix.models import BitrixPortal
from apps.bitrix.services.rest_client import BitrixRestClient, BitrixRestError

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
        users = client.call_list("user.get", {})
    except BitrixRestError:
        logger.warning("Failed to load portal employees via user.get.", exc_info=True)
        return []

    department_names = _load_department_names(portal)

    employees: list[dict[str, Any]] = []

    for user in users:
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
                response = client.call_method("user.get", {"ID": user_id})
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
            "name": department_names.get(department_id) or f"Подразделение {department_id}",
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


def _load_department_names(portal: BitrixPortal) -> dict[str, str]:
    try:
        client = BitrixRestClient(portal)
        departments = client.call_list("department.get", {})
    except BitrixRestError:
        logger.warning("Failed to load portal departments via department.get.", exc_info=True)
        return {}
    except Exception:
        logger.warning("Unexpected error while loading portal departments.", exc_info=True)
        return {}

    names: dict[str, str] = {}

    for department in departments:
        if not isinstance(department, dict):
            continue

        department_id = str(department.get("ID") or "").strip()
        name = str(department.get("NAME") or "").strip()

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


def _department_ids(raw_departments: Any) -> list[str]:
    if raw_departments is None:
        return []

    if isinstance(raw_departments, list):
        return [str(item).strip() for item in raw_departments if str(item).strip()]

    text = str(raw_departments).strip()
    return [text] if text else []
