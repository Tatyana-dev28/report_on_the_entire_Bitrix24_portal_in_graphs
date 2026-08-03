"""Probe Bitrix access for report catalog sources.

Scopes (app) and user permissions are checked separately by Bitrix24.
We mark sources unavailable when the app scope is missing or a lightweight
REST probe returns ACCESS_DENIED / insufficient_scope / forbidden.
"""

from __future__ import annotations

import logging
from typing import Any

from apps.bitrix.services.rest_client import BitrixRestError, BitrixRestResponseError

logger = logging.getLogger(__name__)

UNAVAILABLE_LABEL = "Недоступно"

# App OAuth scopes required before probing user-level permissions.
_SCOPE_BY_SOURCE_TYPE: dict[str, tuple[str, ...]] = {
    "telephony": ("telephony", "call"),
    "task": ("task",),
    "lead": ("crm",),
    "deal": ("crm",),
    "smartProcess": ("crm",),
    "invoice": ("crm",),
    "activity": ("crm",),
    "company": ("crm",),
    "contact": ("crm",),
    "quote": ("crm",),
    "crm_form": ("crm",),
}

# Lightweight probes: empty/impossible filter so success ≈ «method allowed».
_PROBE_BY_SOURCE_ID: dict[str, tuple[str, dict[str, Any]]] = {
    "telephony-default": (
        "voximplant.statistic.get",
        {"FILTER": {"ID": 0}, "SORT": "ID", "ORDER": "ASC"},
    ),
    "lead-default": (
        "crm.lead.list",
        {"select": ["ID"], "filter": {"ID": 0}, "start": 0},
    ),
    "deal-default": (
        "crm.deal.list",
        {"select": ["ID"], "filter": {"ID": 0}, "start": 0},
    ),
    "invoice-default": (
        "crm.item.list",
        {"entityTypeId": 31, "select": ["id"], "filter": {"id": 0}, "start": 0},
    ),
    "activity-default": (
        "crm.activity.list",
        {"select": ["ID"], "filter": {"ID": 0}, "start": 0},
    ),
    "quote-default": (
        "crm.quote.list",
        {"select": ["ID"], "filter": {"ID": 0}, "start": 0},
    ),
    "company-default": (
        "crm.company.list",
        {"select": ["ID"], "filter": {"ID": 0}, "start": 0},
    ),
    "contact-default": (
        "crm.contact.list",
        {"select": ["ID"], "filter": {"ID": 0}, "start": 0},
    ),
    "task-default": (
        "tasks.task.list",
        {"select": ["ID"], "filter": {"ID": 0}, "start": 0},
    ),
    "crm-form-default": (
        "crm.webform.list",
        {"select": ["ID"], "filter": {"ID": 0}, "start": 0},
    ),
}


def annotate_sources_availability(
    *,
    portal: Any,
    client: Any,
    sources: list[dict],
) -> list[dict]:
    scopes = _portal_scopes(portal)
    probe_cache: dict[str, tuple[bool, str | None]] = {}

    for source in sources:
        if not isinstance(source, dict):
            continue

        if _is_live_pipeline_source(source):
            if source.get("isAvailable", True):
                source["isAvailable"] = True
                source["unavailableReason"] = None
            else:
                source["isAvailable"] = False
                source["unavailableReason"] = source.get("unavailableReason") or UNAVAILABLE_LABEL
            continue

        source_id = str(source.get("id") or "")
        source_type = str(source.get("type") or "")

        if source_id not in probe_cache:
            probe_cache[source_id] = _check_source_access(
                client=client,
                scopes=scopes,
                source_id=source_id,
                source_type=source_type,
            )

        is_available, reason = probe_cache[source_id]
        source["isAvailable"] = is_available
        source["unavailableReason"] = None if is_available else (reason or UNAVAILABLE_LABEL)

    return sources


def _is_live_pipeline_source(source: dict) -> bool:
    """Deal/smart funnels returned by Bitrix category/type lists."""
    source_id = str(source.get("id") or "")
    source_type = str(source.get("type") or "")

    if source_id in {"deal-default", "lead-default"}:
        return False

    if source_type == "deal" and source_id.startswith("deal-"):
        return True

    if source_type == "smartProcess" and source_id.startswith("smart-"):
        return True

    return False


def _portal_scopes(portal: Any) -> set[str]:
    try:
        raw = str(getattr(getattr(portal, "auth_token", None), "scope", "") or "")
    except Exception:
        return set()

    parts = raw.replace(",", " ").split()
    return {part.strip().lower() for part in parts if part.strip()}


def _check_source_access(
    *,
    client: Any,
    scopes: set[str],
    source_id: str,
    source_type: str,
) -> tuple[bool, str | None]:
    required_scopes = _SCOPE_BY_SOURCE_TYPE.get(source_type)
    if required_scopes and scopes and not scopes.intersection(required_scopes):
        return False, UNAVAILABLE_LABEL

    probe = _PROBE_BY_SOURCE_ID.get(source_id)
    if probe is None:
        return True, None

    method, params = probe
    try:
        client.call_method(method, params, retry_on_auth_error=True)
        return True, None
    except BitrixRestResponseError as error:
        if _is_access_error(error):
            return False, UNAVAILABLE_LABEL
        logger.debug(
            "Source access probe non-access error for %s via %s: %s",
            source_id,
            method,
            error,
            exc_info=True,
        )
        # Method exists but filter/shape failed — do not hide the source.
        return True, None
    except BitrixRestError as error:
        if _is_access_error(error):
            return False, UNAVAILABLE_LABEL
        logger.warning(
            "Source access probe failed for %s via %s; keeping source available.",
            source_id,
            method,
            exc_info=True,
        )
        return True, None


def _is_access_error(error: Exception) -> bool:
    text = str(error).lower()
    error_code = str(getattr(error, "error_code", "") or "").lower()
    markers = (
        "access_denied",
        "access denied",
        "insufficient_scope",
        "permission",
        "forbidden",
        "user_access_error",
        "invalid_credentials",
    )
    return any(marker in error_code or marker in text for marker in markers)
