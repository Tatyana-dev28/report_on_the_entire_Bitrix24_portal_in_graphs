from __future__ import annotations

import logging
from typing import Any

from apps.bitrix.models import BitrixPortal
from apps.bitrix.services.rest_client import BitrixRestClient, BitrixRestError

logger = logging.getLogger(__name__)


def load_portal_employees(portal: BitrixPortal) -> list[dict[str, Any]]:
    """Загружает список всех активных сотрудников портала через REST API user.get."""
    try:
        client = BitrixRestClient(portal)
        users = client.call_list("user.get", {"ACTIVE": True})
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

        employees.append({
            "id": user_id,
            "name": full_name,
            "firstName": first_name or full_name,
            "lastName": last_name,
            "avatarUrl": str(user.get("PERSONAL_PHOTO") or "").strip() or None,
        })

    return employees