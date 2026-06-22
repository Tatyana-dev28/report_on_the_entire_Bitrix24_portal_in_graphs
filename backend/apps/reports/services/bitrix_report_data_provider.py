from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.bitrix.services.rest_client import BitrixRestClient, BitrixRestError
from apps.reports.catalog import METRICS, REPORT_SOURCES
from apps.reports.models import CrmSource
from apps.reports.services.calculators.smart_process_calculator import (
    apply_smart_process_metrics,
    load_smart_process_rows,
)
from apps.reports.services.calculators.telephony_calculator import (
    apply_call_metrics,
    load_call_rows,
)
from apps.reports.services.data_providers import (
    ReportDataProviderContext,
    ReportDataResult,
)
from apps.reports.services.exceptions import ReportPreviewSessionError


SUPPORTED_SOURCE_TYPES = {"deal", "lead", "invoice", "smartProcess", "telephony"}
DEFAULT_REPORT_MESSAGE = "Отчет построен по данным Bitrix24."


@dataclass(frozen=True)
class PeriodBucket:
    key: str
    label: str
    tooltip_label: str
    start: datetime
    end: datetime


class BitrixReportDataProvider:
    def __init__(self, rest_client_factory: Callable[[Any], BitrixRestClient] | None = None):
        self.rest_client_factory = rest_client_factory or BitrixRestClient

    def build_preview(
        self,
        *,
        filters: dict,
        context: ReportDataProviderContext,
    ) -> ReportDataResult:
        date_from, date_to = _resolve_date_range(filters)
        buckets = build_period_buckets(filters["period"], date_from, date_to)

        selected_sources = resolve_selected_sources_for_portal(
            context.portal,
            filters.get("selectedSources") or [],
        )

        client = self.rest_client_factory(context.portal)

        rows_by_source = self._load_source_rows(
            client=client,
            selected_sources=selected_sources,
            date_from=date_from,
            date_to=date_to,
        )

        data = build_report_points(
            buckets=buckets,
            rows_by_source=rows_by_source,
        )

        unsupported_sources = [
            source["sourceLabel"]
            for source in selected_sources
            if source.get("type") not in SUPPORTED_SOURCE_TYPES
        ]

        return ReportDataResult(
            data=data,
            employees=[],
            details=[],
            status="ready",
            message=DEFAULT_REPORT_MESSAGE,
            metadata={
                "provider": "bitrix",
                "loadedSources": [
                    source["sourceLabel"]
                    for source in selected_sources
                    if source.get("type") in SUPPORTED_SOURCE_TYPES
                ],
                "unsupportedSources": unsupported_sources,
            },
        )

    def _load_source_rows(
        self,
        *,
        client,
        selected_sources: list[dict],
        date_from: datetime,
        date_to: datetime,
    ) -> dict[str, list[dict]]:
        rows_by_source: dict[str, list[dict]] = {}

        for source in selected_sources:
            source_type = source.get("type")

            if source_type == "deal":
                rows_by_source[source["id"]] = self._load_deals(
                    client=client,
                    source=source,
                    date_from=date_from,
                    date_to=date_to,
                )
            elif source_type == "lead":
                rows_by_source[source["id"]] = self._load_leads(
                    client=client,
                    source=source,
                    date_from=date_from,
                    date_to=date_to,
                )
            elif source_type == "invoice":
                rows_by_source[source["id"]] = self._load_invoices(
                    client=client,
                    source=source,
                    date_from=date_from,
                    date_to=date_to,
                )
            elif source_type == "smartProcess":
                rows_by_source[source["id"]] = self._load_smart_processes(
                    client=client,
                    source=source,
                    date_from=date_from,
                    date_to=date_to,
                )
            elif source_type == "telephony":
                rows_by_source[source["id"]] = self._load_calls(
                    client=client,
                    date_from=date_from,
                    date_to=date_to,
                )
            else:
                rows_by_source[source["id"]] = []

        return rows_by_source

    def _load_deals(
        self,
        *,
        client,
        source: dict,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        filter_payload: dict[str, Any] = {
            ">=DATE_CREATE": _bitrix_datetime(date_from),
            "<=DATE_CREATE": _bitrix_datetime(date_to),
        }

        if source.get("categoryId") is not None:
            filter_payload["CATEGORY_ID"] = source["categoryId"]

        return client.call_list(
            "crm.deal.list",
            {
                "order": {"DATE_CREATE": "ASC"},
                "filter": filter_payload,
                "select": [
                    "ID",
                    "TITLE",
                    "DATE_CREATE",
                    "STAGE_ID",
                    "CATEGORY_ID",
                    "OPPORTUNITY",
                    "CURRENCY_ID",
                    "ASSIGNED_BY_ID",
                    "ASSIGNED_BY_NAME",
                    "ASSIGNED_BY_LAST_NAME",
                ],
            },
        )

    def _load_leads(
        self,
        *,
        client,
        source: dict,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        return client.call_list(
            "crm.lead.list",
            {
                "order": {"DATE_CREATE": "ASC"},
                "filter": {
                    ">=DATE_CREATE": _bitrix_datetime(date_from),
                    "<=DATE_CREATE": _bitrix_datetime(date_to),
                },
                "select": [
                    "ID",
                    "TITLE",
                    "DATE_CREATE",
                    "STATUS_ID",
                    "OPPORTUNITY",
                    "CURRENCY_ID",
                    "ASSIGNED_BY_ID",
                    "ASSIGNED_BY_NAME",
                    "ASSIGNED_BY_LAST_NAME",
                ],
            },
        )

    def _load_invoices(
        self,
        *,
        client,
        source: dict,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        try:
            rows = self._load_smart_invoices(
                client=client,
                source=source,
                date_from=date_from,
                date_to=date_to,
            )

            if rows:
                return rows
        except BitrixRestError:
            pass

        return self._load_legacy_invoices(
            client=client,
            date_from=date_from,
            date_to=date_to,
        )

    def _load_smart_invoices(
        self,
        *,
        client,
        source: dict,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        entity_type_id = int(source.get("entityTypeId") or 31)

        rows = client.call_list(
            "crm.item.list",
            {
                "entityTypeId": entity_type_id,
                "order": {"createdTime": "ASC"},
                "filter": {
                    ">=createdTime": _bitrix_datetime(date_from),
                    "<=createdTime": _bitrix_datetime(date_to),
                },
                "select": [
                    "id",
                    "title",
                    "createdTime",
                    "stageId",
                    "stageSemanticId",
                    "opportunity",
                    "currencyId",
                    "assignedById",
                ],
            },
        )

        return [_normalize_smart_invoice_row(row) for row in rows]

    def _load_legacy_invoices(
        self,
        *,
        client,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        rows = client.call_list(
            "crm.invoice.list",
            {
                "order": {"DATE_INSERT": "ASC"},
                "filter": {
                    ">=DATE_INSERT": _bitrix_datetime(date_from),
                    "<=DATE_INSERT": _bitrix_datetime(date_to),
                },
                "select": [
                    "ID",
                    "ACCOUNT_NUMBER",
                    "ORDER_TOPIC",
                    "DATE_INSERT",
                    "DATE_BILL",
                    "STATUS_ID",
                    "PRICE",
                    "OPPORTUNITY",
                    "CURRENCY",
                    "CURRENCY_ID",
                    "RESPONSIBLE_ID",
                ],
            },
        )

        return [_normalize_legacy_invoice_row(row) for row in rows]

    def _load_smart_processes(
        self,
        *,
        client,
        source: dict,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        return load_smart_process_rows(
            client=client,
            source=source,
            date_from=date_from,
            date_to=date_to,
            bitrix_datetime=_bitrix_datetime,
        )

    def _load_calls(
        self,
        *,
        client,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        return load_call_rows(
            client=client,
            date_from=date_from,
            date_to=date_to,
            bitrix_datetime=_bitrix_datetime,
        )


def build_report_points(*, buckets: list[PeriodBucket], rows_by_source: dict[str, list[dict]]) -> list[dict]:
    metric_ids = [metric["id"] for metric in METRICS]
    points = []

    for bucket in buckets:
        values = _build_bucket_values(bucket, rows_by_source, metric_ids)

        points.append(
            {
                "key": bucket.key,
                "label": bucket.label,
                "tooltipLabel": bucket.tooltip_label,
                "indicator": (
                    values.get("deals_won_sum", 0)
                    + values.get("invoices_won_sum", 0)
                    + values.get("smart_process_success_sum", 0)
                ),
                "values": values,
            }
        )

    return points


def resolve_selected_sources(selected_sources: list[str]) -> list[dict]:
    if not selected_sources:
        return [dict(source) for source in REPORT_SOURCES]

    normalized_values = {str(value).strip() for value in selected_sources if str(value).strip()}

    result = [
        dict(source)
        for source in REPORT_SOURCES
        if str(source.get("id")) in normalized_values
        or str(source.get("title")) in normalized_values
        or str(source.get("sourceLabel")) in normalized_values
    ]

    if result:
        return result

    raise ReportPreviewSessionError(
        "Выбранные CRM-источники не найдены в каталоге отчета.",
        details={"selectedSources": selected_sources},
    )


def resolve_selected_sources_for_portal(portal: Any, selected_sources: list[str]) -> list[dict]:
    if not selected_sources:
        return resolve_selected_sources(selected_sources)

    normalized_values = {str(value).strip() for value in selected_sources if str(value).strip()}

    portal_sources = CrmSource.objects.filter(
        portal=portal,
        is_active=True,
        is_available=True,
    )

    result = []

    for source in portal_sources:
        candidates = {
            source.external_key,
            source.title,
            source.source_label,
        }

        if candidates & normalized_values:
            result.append(
                {
                    "id": source.external_key,
                    "type": (
                        "smartProcess"
                        if source.source_type == CrmSource.SourceType.SMART_PROCESS
                        else source.source_type
                    ),
                    "entityTypeId": source.entity_type_id,
                    "categoryId": source.category_id,
                    "title": source.title,
                    "sourceLabel": source.source_label or source.title,
                    "isAvailable": source.is_available,
                }
            )

    return result or resolve_selected_sources(selected_sources)


def build_period_buckets(period: str, date_from: datetime, date_to: datetime) -> list[PeriodBucket]:
    if period == "hours":
        return _build_hour_buckets(date_from, date_to)

    if period == "weeks":
        return _build_week_buckets(date_from, date_to)

    if period == "months":
        return _build_month_buckets(date_from, date_to)

    return _build_day_buckets(date_from, date_to)


def _build_bucket_values(
    bucket: PeriodBucket,
    rows_by_source: dict[str, list[dict]],
    metric_ids: list[str],
) -> dict[str, int | float]:
    values: dict[str, int | float] = {metric_id: 0 for metric_id in metric_ids}

    deal_rows = [
        row
        for source_id, rows in rows_by_source.items()
        if source_id.startswith("deal-")
        for row in rows
        if _row_in_bucket(row, bucket)
    ]

    lead_rows = [
        row
        for source_id, rows in rows_by_source.items()
        if source_id.startswith("lead-")
        for row in rows
        if _row_in_bucket(row, bucket)
    ]

    invoice_rows = [
        row
        for source_id, rows in rows_by_source.items()
        if source_id.startswith("invoice-")
        for row in rows
        if _row_in_bucket(row, bucket)
    ]

    smart_process_rows = [
        row
        for source_id, rows in rows_by_source.items()
        if source_id.startswith("smart-")
        for row in rows
        if _row_in_bucket(row, bucket)
    ]

    call_rows = [
        row
        for source_id, rows in rows_by_source.items()
        if source_id.startswith("telephony-")
        for row in rows
        if _row_in_bucket(row, bucket)
    ]

    won_deals = [row for row in deal_rows if _is_won_stage(row.get("STAGE_ID"))]
    lost_deals = [row for row in deal_rows if _is_lost_stage(row.get("STAGE_ID"))]

    quality_leads = [row for row in lead_rows if _is_quality_lead(row.get("STATUS_ID"))]
    bad_leads = [row for row in lead_rows if _is_bad_lead(row.get("STATUS_ID"))]

    won_invoices = [row for row in invoice_rows if _is_won_invoice(row)]
    lost_invoices = [row for row in invoice_rows if _is_lost_invoice(row)]

    values["deals_created"] = len(deal_rows)
    values["deals_won"] = len(won_deals)
    values["deals_lost"] = len(lost_deals)
    values["deals_won_sum"] = _sum_opportunity(won_deals)
    values["deals_lost_sum"] = _sum_opportunity(lost_deals)
    values["deals_conversion"] = _conversion(values["deals_won"], values["deals_created"])

    values["leads_created"] = len(lead_rows)
    values["leads_quality"] = len(quality_leads)
    values["leads_bad"] = len(bad_leads)
    values["leads_quality_sum"] = _sum_opportunity(quality_leads)
    values["leads_bad_sum"] = _sum_opportunity(bad_leads)
    values["leads_conversion"] = _conversion(values["leads_quality"], values["leads_created"])

    values["invoices_created"] = len(invoice_rows)
    values["invoices_won"] = len(won_invoices)
    values["invoices_lost"] = len(lost_invoices)
    values["invoices_won_sum"] = _sum_opportunity(won_invoices)
    values["invoices_lost_sum"] = _sum_opportunity(lost_invoices)
    values["invoices_conversion"] = _conversion(values["invoices_won"], values["invoices_created"])

    apply_smart_process_metrics(values, smart_process_rows)
    apply_call_metrics(values, call_rows)

    values["sales_won"] = values["deals_won"]
    values["sales_lost"] = values["deals_lost"]

    values["lead_qualified"] = values["leads_quality"]
    values["lead_bad_stage"] = values["leads_bad"]
    values["lead_new"] = len([row for row in lead_rows if str(row.get("STATUS_ID", "")).upper() in {"NEW", ""}])
    values["lead_work"] = max(
        0,
        values["leads_created"] - values["lead_new"] - values["lead_qualified"] - values["lead_bad_stage"],
    )

    values["sales_new"] = len(
        [row for row in deal_rows if _stage_suffix(row.get("STAGE_ID")) in {"NEW", "PREPARATION"}]
    )
    values["sales_talk"] = len(
        [row for row in deal_rows if _stage_suffix(row.get("STAGE_ID")) in {"PREPAYMENT_INVOICE", "EXECUTING"}]
    )
    values["sales_invoice"] = len([row for row in deal_rows if "INVOICE" in _stage_suffix(row.get("STAGE_ID"))])

    return values


def _resolve_date_range(filters: dict) -> tuple[datetime, datetime]:
    date_range = filters.get("dateRange") or {}

    start_value = date_range.get("from") or date_range.get("start")
    end_value = date_range.get("to") or date_range.get("end")

    now = timezone.localtime()

    date_from = _parse_datetime_or_date(start_value, end_of_day=False) or datetime.combine(
        now.date(),
        time.min,
        tzinfo=now.tzinfo,
    )
    date_to = _parse_datetime_or_date(end_value, end_of_day=True) or datetime.combine(
        now.date(),
        time.max,
        tzinfo=now.tzinfo,
    )

    if date_from > date_to:
        return date_to.replace(hour=0, minute=0, second=0, microsecond=0), date_from.replace(
            hour=23,
            minute=59,
            second=59,
            microsecond=999999,
        )

    return date_from, date_to


def _parse_datetime_or_date(value: Any, *, end_of_day: bool) -> datetime | None:
    if not value or not isinstance(value, str):
        return None

    if len(value) == 10:
        parsed_date = parse_date(value)

        if parsed_date is not None:
            parsed_time = time.max if end_of_day else time.min

            return timezone.make_aware(
                datetime.combine(parsed_date, parsed_time),
                timezone.get_current_timezone(),
            )

    parsed_datetime = parse_datetime(value)

    if parsed_datetime is not None:
        if timezone.is_naive(parsed_datetime):
            return timezone.make_aware(parsed_datetime, timezone.get_current_timezone())

        return parsed_datetime

    parsed_date = parse_date(value)

    if parsed_date is None:
        return None

    parsed_time = time.max if end_of_day else time.min

    return timezone.make_aware(
        datetime.combine(parsed_date, parsed_time),
        timezone.get_current_timezone(),
    )


def _build_hour_buckets(date_from: datetime, date_to: datetime) -> list[PeriodBucket]:
    buckets = []
    cursor = date_from.replace(minute=0, second=0, microsecond=0)

    while cursor <= date_to:
        end = min(cursor + timedelta(hours=1) - timedelta(microseconds=1), date_to)

        buckets.append(
            PeriodBucket(
                key=cursor.isoformat(),
                label=timezone.localtime(cursor).strftime("%H:%M"),
                tooltip_label=timezone.localtime(cursor).strftime("%d.%m.%Y, %H:%M"),
                start=cursor,
                end=end,
            )
        )

        cursor += timedelta(hours=1)

    return buckets


def _build_day_buckets(date_from: datetime, date_to: datetime) -> list[PeriodBucket]:
    buckets = []
    cursor = date_from.replace(hour=0, minute=0, second=0, microsecond=0)

    while cursor <= date_to:
        end = min(cursor + timedelta(days=1) - timedelta(microseconds=1), date_to)
        local_cursor = timezone.localtime(cursor)

        buckets.append(
            PeriodBucket(
                key=cursor.isoformat(),
                label=local_cursor.strftime("%d.%m"),
                tooltip_label=local_cursor.strftime("%d.%m.%Y"),
                start=cursor,
                end=end,
            )
        )

        cursor += timedelta(days=1)

    return buckets


def _build_week_buckets(date_from: datetime, date_to: datetime) -> list[PeriodBucket]:
    buckets = []
    cursor = date_from.replace(hour=0, minute=0, second=0, microsecond=0)

    while cursor <= date_to:
        end = min(cursor + timedelta(days=7) - timedelta(microseconds=1), date_to)
        local_start = timezone.localtime(cursor)
        local_end = timezone.localtime(end)

        buckets.append(
            PeriodBucket(
                key=cursor.isoformat(),
                label=f"{local_start:%d.%m}-{local_end:%d.%m}",
                tooltip_label=f"Неделя {local_start:%d.%m.%Y} - {local_end:%d.%m.%Y}",
                start=cursor,
                end=end,
            )
        )

        cursor += timedelta(days=7)

    return buckets


def _build_month_buckets(date_from: datetime, date_to: datetime) -> list[PeriodBucket]:
    buckets = []
    cursor = date_from.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    while cursor <= date_to:
        next_month = _add_month(cursor)
        end = min(next_month - timedelta(microseconds=1), date_to)
        local_cursor = timezone.localtime(cursor)

        buckets.append(
            PeriodBucket(
                key=cursor.isoformat(),
                label=local_cursor.strftime("%m.%Y"),
                tooltip_label=local_cursor.strftime("%m.%Y"),
                start=cursor,
                end=end,
            )
        )

        cursor = next_month

    return buckets


def _add_month(value: datetime) -> datetime:
    if value.month == 12:
        return value.replace(year=value.year + 1, month=1)

    return value.replace(month=value.month + 1)


def _row_in_bucket(row: dict, bucket: PeriodBucket) -> bool:
    created_at = _parse_datetime_or_date(str(row.get("DATE_CREATE") or ""), end_of_day=False)

    return bool(created_at and bucket.start <= created_at <= bucket.end)


def _bitrix_datetime(value: datetime) -> str:
    return timezone.localtime(value).strftime("%Y-%m-%dT%H:%M:%S%z")


def _sum_opportunity(rows: list[dict]) -> int:
    total = Decimal("0")

    for row in rows:
        try:
            total += Decimal(str(row.get("OPPORTUNITY") or 0))
        except (InvalidOperation, ValueError):
            continue

    return int(total)


def _conversion(success: int | float, total: int | float) -> float:
    if total <= 0:
        return 0

    return round((success / total) * 1000) / 10


def _stage_suffix(value: Any) -> str:
    return str(value or "").split(":")[-1].upper()


def _is_won_stage(value: Any) -> bool:
    return _stage_suffix(value) in {"WON", "SUCCESS", "CONVERTED"}


def _is_lost_stage(value: Any) -> bool:
    suffix = _stage_suffix(value)

    return suffix in {"LOSE", "LOST", "APOLOGY", "JUNK"} or "LOSE" in suffix or "LOST" in suffix


def _is_quality_lead(value: Any) -> bool:
    return str(value or "").upper() in {"CONVERTED", "WON", "SUCCESS"}


def _is_bad_lead(value: Any) -> bool:
    return str(value or "").upper() in {"JUNK", "LOSE", "LOST", "BAD"}


def _normalize_smart_invoice_row(row: dict) -> dict:
    return {
        "ID": row.get("id") or row.get("ID"),
        "TITLE": row.get("title") or row.get("TITLE") or "",
        "DATE_CREATE": row.get("createdTime") or row.get("CREATED_TIME"),
        "STAGE_ID": row.get("stageId") or row.get("STAGE_ID"),
        "STAGE_SEMANTIC_ID": row.get("stageSemanticId") or row.get("STAGE_SEMANTIC_ID"),
        "OPPORTUNITY": row.get("opportunity") or row.get("OPPORTUNITY") or 0,
        "CURRENCY_ID": row.get("currencyId") or row.get("CURRENCY_ID"),
        "ASSIGNED_BY_ID": row.get("assignedById") or row.get("ASSIGNED_BY_ID"),
        "SOURCE_KIND": "smart_invoice",
    }


def _normalize_legacy_invoice_row(row: dict) -> dict:
    return {
        "ID": row.get("ID"),
        "TITLE": row.get("ACCOUNT_NUMBER") or row.get("ORDER_TOPIC") or "",
        "DATE_CREATE": row.get("DATE_INSERT") or row.get("DATE_BILL"),
        "STAGE_ID": row.get("STATUS_ID"),
        "STAGE_SEMANTIC_ID": _legacy_invoice_semantic(row.get("STATUS_ID")),
        "OPPORTUNITY": row.get("PRICE") or row.get("OPPORTUNITY") or 0,
        "CURRENCY_ID": row.get("CURRENCY") or row.get("CURRENCY_ID"),
        "ASSIGNED_BY_ID": row.get("RESPONSIBLE_ID"),
        "SOURCE_KIND": "legacy_invoice",
    }


def _legacy_invoice_semantic(status_id: Any) -> str:
    status = str(status_id or "").upper()

    if status == "P":
        return "S"

    if status in {"D", "CANCEL", "CANCELED", "DECLINED"}:
        return "F"

    return "P"


def _is_won_invoice(row: dict) -> bool:
    semantic = str(row.get("STAGE_SEMANTIC_ID") or "").upper()

    if semantic == "S":
        return True

    stage = _stage_suffix(row.get("STAGE_ID"))

    return stage in {
        "P",
        "PAID",
        "PAYMENT_PAID",
        "WON",
        "SUCCESS",
        "SUCCESSFUL",
        "FINAL_INVOICE",
    }


def _is_lost_invoice(row: dict) -> bool:
    semantic = str(row.get("STAGE_SEMANTIC_ID") or "").upper()

    if semantic == "F":
        return True

    stage = _stage_suffix(row.get("STAGE_ID"))

    return (
        stage in {
            "D",
            "CANCEL",
            "CANCELED",
            "DECLINED",
            "LOSE",
            "LOST",
        }
        or "CANCEL" in stage
        or "LOSE" in stage
        or "LOST" in stage
    )