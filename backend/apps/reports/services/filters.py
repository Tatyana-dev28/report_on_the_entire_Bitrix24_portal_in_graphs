from __future__ import annotations

import hashlib
import json
from datetime import datetime, time
from typing import Any

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.reports.models import PeriodKey
from apps.reports.services.exceptions import ReportPreviewSessionError


def stable_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def make_filters_hash(filters: dict) -> str:
    return hashlib.sha256(stable_json(filters).encode("utf-8")).hexdigest()


def result_size_bytes(payload: dict) -> int:
    return len(stable_json(payload).encode("utf-8"))


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


def parse_report_datetime(value: Any, end_of_day: bool = False):
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
