"""Resolve Bitrix24 portal timezone for report period bucketing.

Uses portal.timezone when set; otherwise Django TIME_ZONE.
Optionally refreshes portal.timezone from Bitrix profile / server.time.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone as dj_timezone

logger = logging.getLogger(__name__)

_OFFSET_RE = re.compile(r"^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$")


def get_portal_tzinfo(portal: Any | None = None):
    raw = str(getattr(portal, "timezone", "") or "").strip()
    if raw:
        resolved = _parse_timezone_name(raw)
        if resolved is not None:
            return resolved

    return dj_timezone.get_current_timezone()


def localtime_for_portal(value: datetime, portal: Any | None = None) -> datetime:
    if dj_timezone.is_naive(value):
        value = dj_timezone.make_aware(value, get_portal_tzinfo(portal))
    return dj_timezone.localtime(value, get_portal_tzinfo(portal))


def make_aware_for_portal(value: datetime, portal: Any | None = None) -> datetime:
    if dj_timezone.is_aware(value):
        return value
    return dj_timezone.make_aware(value, get_portal_tzinfo(portal))


def ensure_portal_timezone(portal: Any | None, client: Any | None = None) -> None:
    """Best-effort fill of portal.timezone from Bitrix. Never raises."""
    if portal is None:
        return

    current = str(getattr(portal, "timezone", "") or "").strip()
    if current and _parse_timezone_name(current) is not None:
        return

    if client is None:
        return

    resolved = _fetch_timezone_from_bitrix(client)
    if not resolved:
        return

    try:
        portal.timezone = resolved
        update_fields = ["timezone"]
        if hasattr(portal, "updated_at"):
            update_fields.append("updated_at")
        portal.save(update_fields=update_fields)
    except Exception:
        logger.debug("Failed to persist portal timezone %s", resolved, exc_info=True)


def _parse_timezone_name(raw: str):
    try:
        return ZoneInfo(raw)
    except ZoneInfoNotFoundError:
        pass

    match = _OFFSET_RE.match(raw.replace(" ", ""))
    if not match:
        return None

    sign = 1 if match.group(1) == "+" else -1
    hours = int(match.group(2))
    minutes = int(match.group(3) or "0")
    offset = dt_timezone(sign * timedelta(hours=hours, minutes=minutes))
    return offset


def _fetch_timezone_from_bitrix(client: Any) -> str | None:
    try:
        profile = client.call_method("profile")
        result = getattr(profile, "result", None)
        if result is None and isinstance(profile, dict):
            result = profile.get("result")
        if isinstance(result, dict):
            tz_name = str(result.get("TIME_ZONE") or "").strip()
            if tz_name and _parse_timezone_name(tz_name) is not None:
                return tz_name
    except Exception:
        logger.debug("Bitrix profile timezone lookup failed", exc_info=True)

    try:
        response = client.call_method("server.time")
        raw_time = getattr(response, "result", None)
        if raw_time is None and isinstance(response, dict):
            raw_time = response.get("result")
        if isinstance(raw_time, str) and len(raw_time) >= 6:
            # Example: 2024-08-05T08:56:22+03:00
            offset = raw_time[-6:]
            if offset[0] in "+-" and _parse_timezone_name(offset) is not None:
                return offset
    except Exception:
        logger.debug("Bitrix server.time timezone lookup failed", exc_info=True)

    return None
