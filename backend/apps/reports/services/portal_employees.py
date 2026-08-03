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
        department_label = _department_label(user.get("UF_DEPARTMENT"))

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
        })

    return employees


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


def _department_label(raw_departments: Any) -> str | None:
    if raw_departments is None:
        return None

    if isinstance(raw_departments, list):
        ids = [str(item).strip() for item in raw_departments if str(item).strip()]
    else:
        text = str(raw_departments).strip()
        ids = [text] if text else []

    if not ids:
        return None

    if len(ids) == 1:
        return f"Подразделение {ids[0]}"

    return f"Подразделения {', '.join(ids[:3])}"
