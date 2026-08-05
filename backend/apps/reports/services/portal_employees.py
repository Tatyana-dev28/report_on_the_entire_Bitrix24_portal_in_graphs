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
        user_id = str(user.get("ID") or "").strip()

        if not user_id:
            continue

        first_name = str(user.get("NAME") or "").strip()
        last_name = str(user.get("LAST_NAME") or "").strip()
        full_name = str(user.get("FULL_NAME") or "").strip()

        if not full_name:
            full_name = " ".join(part for part in [first_name, last_name] if part).strip()

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

        employees.append({
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
        })

    return employees


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
