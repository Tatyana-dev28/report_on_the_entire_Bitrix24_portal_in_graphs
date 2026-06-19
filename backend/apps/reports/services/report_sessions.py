from __future__ import annotations

import hashlib
import json
from datetime import datetime, time, timedelta
from typing import Any

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.bitrix.models import BitrixPortal, PortalUser
from apps.reports.models import PeriodKey, ReportBuild, ReportSession


class ReportPreviewSessionError(Exception):
    def __init__(self, message: str, status: int = 400, details: dict | None = None):
        super().__init__(message)
        self.status = status
        self.details = details or {}


def _stable_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _make_filters_hash(filters: dict) -> str:
    return hashlib.sha256(_stable_json(filters).encode("utf-8")).hexdigest()


def _result_size_bytes(payload: dict) -> int:
    return len(_stable_json(payload).encode("utf-8"))


def _normalize_string_list(value: Any, field_name: str) -> list[str]:
    if value is None:
        return []

    if not isinstance(value, list):
        raise ReportPreviewSessionError(f"Поле {field_name} должно быть массивом.")

    result: list[str] = []

    for item in value:
        if isinstance(item, str):
            if item:
                result.append(item)
            continue

        if isinstance(item, dict):
            raw_id = item.get("id") or item.get("externalKey") or item.get("code")

            if raw_id:
                result.append(str(raw_id))

            continue

        raise ReportPreviewSessionError(
            f"Поле {field_name} должно содержать строки или объекты с id.",
            details={"item": str(item)},
        )

    return result


def _normalize_period(value: Any) -> str:
    period = str(value or PeriodKey.MONTHS)

    allowed_periods = {choice[0] for choice in PeriodKey.choices}

    if period not in allowed_periods:
        raise ReportPreviewSessionError(
            "Некорректный период отчета.",
            details={
                "period": period,
                "allowedPeriods": sorted(allowed_periods),
            },
        )

    return period


def _normalize_date_range(value: Any) -> dict:
    if value is None:
        return {}

    if not isinstance(value, dict):
        raise ReportPreviewSessionError("Поле dateRange должно быть JSON-объектом.")

    return {
        "from": value.get("from") or value.get("start") or value.get("startDate"),
        "to": value.get("to") or value.get("end") or value.get("endDate"),
    }


def normalize_report_filters(payload: dict) -> dict:
    selected_sources = _normalize_string_list(
        payload.get("selectedSources"),
        "selectedSources",
    )

    selected_metric_ids = _normalize_string_list(
        payload.get("selectedMetricIds") or payload.get("metrics"),
        "selectedMetricIds",
    )

    return {
        "period": _normalize_period(payload.get("period")),
        "dateRange": _normalize_date_range(payload.get("dateRange")),
        "selectedSources": selected_sources,
        "selectedMetricIds": selected_metric_ids,
        "metricMode": payload.get("metricMode"),
        "chartDisplayMode": payload.get("chartDisplayMode"),
    }


def _parse_report_datetime(value: Any, end_of_day: bool = False):
    if not value or not isinstance(value, str):
        return None

    parsed_datetime = parse_datetime(value)

    if parsed_datetime is not None:
        if timezone.is_naive(parsed_datetime):
            return timezone.make_aware(parsed_datetime, timezone.get_current_timezone())

        return parsed_datetime

    parsed_date = parse_date(value)

    if parsed_date is None:
        return None

    parsed_time = time.max if end_of_day else time.min
    naive_datetime = datetime.combine(parsed_date, parsed_time)

    return timezone.make_aware(naive_datetime, timezone.get_current_timezone())


def _resolve_portal(request, payload: dict) -> BitrixPortal:
    member_id = (
        payload.get("memberId")
        or payload.get("member_id")
        or request.headers.get("X-Bitrix-Member-Id")
    )

    domain = (
        payload.get("domain")
        or payload.get("DOMAIN")
        or request.headers.get("X-Bitrix-Domain")
    )

    if member_id:
        portal = BitrixPortal.objects.filter(member_id=str(member_id)).first()

        if portal:
            return portal

    if domain:
        portal = BitrixPortal.objects.filter(domain=str(domain)).first()

        if portal:
            return portal

    portal = BitrixPortal.objects.order_by("id").first()

    if portal:
        return portal

    if settings.DEBUG:
        portal, _created = BitrixPortal.objects.get_or_create(
            member_id="local-dev",
            defaults={
                "domain": "local-dev.bitrix24.local",
                "protocol": BitrixPortal.Protocol.HTTPS,
                "status": BitrixPortal.Status.ACTIVE,
            },
        )

        return portal

    raise ReportPreviewSessionError(
        "Не удалось определить портал Битрикс24 для построения отчета.",
        status=400,
    )


def _resolve_user(portal: BitrixPortal, request, payload: dict) -> tuple[PortalUser | None, str, str]:
    bitrix_user_id = (
        payload.get("bitrixUserId")
        or payload.get("bitrix_user_id")
        or payload.get("userId")
        or request.headers.get("X-Bitrix-User-Id")
        or "local-dev"
    )

    bitrix_user_id = str(bitrix_user_id)

    user = PortalUser.objects.filter(
        portal=portal,
        bitrix_user_id=bitrix_user_id,
    ).first()

    user_name = (
        payload.get("bitrixUserName")
        or payload.get("userName")
        or ""
    )

    if user and not user_name:
        user_name = user.full_name or str(user)

    return user, bitrix_user_id, str(user_name or "")


def create_report_preview_session(request, payload: dict) -> dict:
    filters = normalize_report_filters(payload)
    filters_hash = _make_filters_hash(filters)

    portal = _resolve_portal(request, payload)
    user, bitrix_user_id, user_name = _resolve_user(portal, request, payload)

    ttl_seconds = int(getattr(settings, "REPORT_SESSION_CACHE_TTL_SECONDS", 7200))
    now = timezone.now()
    expires_at = now + timedelta(seconds=ttl_seconds)

    session = ReportSession.objects.create(
        portal=portal,
        user=user,
        bitrix_user_id=bitrix_user_id,
        user_name=user_name,
        status=ReportSession.Status.ACTIVE,
        period_key=filters["period"],
        state_snapshot=filters,
        filters_hash=filters_hash,
        cache_ttl_seconds=ttl_seconds,
        opened_at=now,
        last_activity_at=now,
        last_calculated_at=now,
        expires_at=expires_at,
        metadata={
            "source": "api.reports.preview",
            "calculation": "empty_until_bitrix_rest_is_connected",
        },
    )

    cache_key = f"reports:preview:{portal.id}:{session.session_key}:{filters_hash}"

    result_payload = {
        "data": [],
        "employees": [],
        "details": [],
        "meta": {
            "status": "empty",
            "message": "Сессия отчета создана. Расчет через Bitrix REST будет подключен следующим этапом.",
            "sessionKey": str(session.session_key),
            "filtersHash": filters_hash,
        },
    }

    cache.set(cache_key, result_payload, timeout=ttl_seconds)

    result_size = _result_size_bytes(result_payload)

    session.cache_key = cache_key
    session.result_size_bytes = result_size
    session.save(
        update_fields=[
            "cache_key",
            "result_size_bytes",
            "updated_at",
        ],
    )

    date_range = filters.get("dateRange") or {}
    date_from = _parse_report_datetime(date_range.get("from"))
    date_to = _parse_report_datetime(date_range.get("to"), end_of_day=True)

    ReportBuild.objects.create(
        portal=portal,
        session=session,
        requested_by=user,
        requested_by_bitrix_user_id=bitrix_user_id,
        period_key=filters["period"],
        date_from=date_from,
        date_to=date_to,
        sources=filters["selectedSources"],
        metrics=filters["selectedMetricIds"],
        options={
            "metricMode": filters.get("metricMode"),
            "chartDisplayMode": filters.get("chartDisplayMode"),
        },
        filters_hash=filters_hash,
        cache_key=cache_key,
        status=ReportBuild.Status.SUCCESS,
        started_at=now,
        finished_at=timezone.now(),
    )

    return {
        "status": "ready",
        "sessionKey": str(session.session_key),
        "filtersHash": filters_hash,
        "cacheTtlSeconds": ttl_seconds,
        "expiresAt": session.expires_at.isoformat() if session.expires_at else None,
        "filters": filters,
        "data": result_payload["data"],
        "employees": result_payload["employees"],
        "details": result_payload["details"],
        "message": result_payload["meta"]["message"],
    }