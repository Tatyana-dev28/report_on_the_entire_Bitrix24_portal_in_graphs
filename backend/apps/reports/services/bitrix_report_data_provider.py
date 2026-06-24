from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.bitrix.models import PortalUser
from apps.bitrix.services.rest_client import BitrixRestClient, BitrixRestError
from apps.reports.catalog import METRICS, REPORT_SOURCES
from apps.reports.models import CrmSource
from apps.reports.services.calculators.activity_calculator import (
    apply_activity_metrics,
    load_activity_rows,
)
from apps.reports.services.calculators.contract_calculator import (
    apply_contract_metrics,
    apply_mapped_quote_metrics,
    get_smart_source_report_role,
)
from apps.reports.services.calculators.quote_calculator import (
    apply_quote_metrics,
    load_quote_rows,
)
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
from apps.reports.services.employee_breakdown import build_employee_breakdown
from apps.reports.services.entity_details import build_entity_details
from apps.reports.services.exceptions import ReportPreviewSessionError


SUPPORTED_SOURCE_TYPES = {
    "deal",
    "lead",
    "invoice",
    "smartProcess",
    "telephony",
    "activity",
    "quote",
}
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
        metric_catalog = resolve_metric_catalog(filters.get("selectedMetricIds"))

        client = self.rest_client_factory(context.portal)

        rows_by_source = self._load_source_rows(
            client=client,
            selected_sources=selected_sources,
            date_from=date_from,
            date_to=date_to,
        )
        _enrich_rows_with_user_names(
            client=client,
            portal=context.portal,
            rows_by_source=rows_by_source,
        )

        data = build_report_points(
            buckets=buckets,
            rows_by_source=rows_by_source,
            metric_catalog=metric_catalog,
            metric_mode=filters.get("metricMode") or "money",
        )

        employees, _employee_summary_details = build_employee_breakdown(
            rows_by_source=rows_by_source,
            metric_catalog=metric_catalog,
            date_from=date_from,
            date_to=date_to,
            buckets=buckets,
            build_bucket_values=_build_bucket_values,
        )
        details = build_entity_details(
            buckets=buckets,
            rows_by_source=rows_by_source,
            metric_catalog=metric_catalog,
        )

        unsupported_sources = [
            source["sourceLabel"]
            for source in selected_sources
            if source.get("type") not in SUPPORTED_SOURCE_TYPES
        ]
        source_row_counts = {
            source_id: len(rows)
            for source_id, rows in rows_by_source.items()
        }
        matched_source_row_counts = {
            source_id: sum(1 for row in rows if any(_row_in_bucket(row, bucket) for bucket in buckets))
            for source_id, rows in rows_by_source.items()
        }

        return ReportDataResult(
            data=data,
            employees=employees,
            details=details,
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
                "sourceRowCounts": source_row_counts,
                "matchedSourceRowCounts": matched_source_row_counts,
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
            elif source_type == "activity":
                rows_by_source[source["id"]] = self._load_activities(
                    client=client,
                    date_from=date_from,
                    date_to=date_to,
                )
            elif source_type == "quote":
                rows_by_source[source["id"]] = self._load_quotes(
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
        source_role = get_smart_source_report_role(source)

        rows = load_smart_process_rows(
            client=client,
            source=source,
            date_from=date_from,
            date_to=date_to,
            bitrix_datetime=_bitrix_datetime,
        )

        return [
            {
                **row,
                "REPORT_SOURCE_ID": source.get("id"),
                "REPORT_SOURCE_LABEL": source.get("sourceLabel") or source.get("title"),
                "REPORT_SOURCE_ROLE": source_role,
            }
            for row in rows
        ]

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

    def _load_activities(
        self,
        *,
        client,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        return load_activity_rows(
            client=client,
            date_from=date_from,
            date_to=date_to,
            bitrix_datetime=_bitrix_datetime,
        )

    def _load_quotes(
        self,
        *,
        client,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        return load_quote_rows(
            client=client,
            date_from=date_from,
            date_to=date_to,
            bitrix_datetime=_bitrix_datetime,
        )


def build_report_points(
    *,
    buckets: list[PeriodBucket],
    rows_by_source: dict[str, list[dict]],
    metric_catalog: list[dict],
    metric_mode: str = "money",
) -> list[dict]:
    metric_ids = [metric["id"] for metric in metric_catalog]
    points = []

    for bucket in buckets:
        values = _build_bucket_values(bucket, rows_by_source, metric_ids)

        points.append(
            {
                "key": bucket.key,
                "label": bucket.label,
                "tooltipLabel": bucket.tooltip_label,
                "indicator": _build_indicator_value(values, metric_catalog, metric_mode),
                "values": values,
            }
        )

    return points


def _build_indicator_value(
    values: dict[str, int | float],
    metric_catalog: list[dict],
    metric_mode: str,
) -> int | float:
    if metric_mode == "count":
        metric_ids = [
            metric["id"]
            for metric in metric_catalog
            if metric.get("type") not in {"money", "percent"}
        ]
    else:
        metric_ids = [
            metric["id"]
            for metric in metric_catalog
            if metric.get("type") == "money"
        ]

    return sum(values.get(metric_id, 0) for metric_id in metric_ids)


def resolve_metric_catalog(selected_metric_ids: list[str] | None) -> list[dict]:
    if selected_metric_ids is None:
        return [dict(metric) for metric in METRICS]

    if not selected_metric_ids:
        return []

    normalized_values = {str(value).strip() for value in selected_metric_ids if str(value).strip()}

    catalog_ids = {str(metric.get("id")) for metric in METRICS}
    unknown_values = sorted(normalized_values - catalog_ids)

    if unknown_values:
        raise ReportPreviewSessionError(
            "Выбранные метрики не найдены в каталоге отчета.",
            status=400,
            details={"selectedMetricIds": selected_metric_ids, "unknownMetricIds": unknown_values},
        )

    result = [dict(metric) for metric in METRICS if str(metric.get("id")) in normalized_values]

    if result:
        return result

    raise ReportPreviewSessionError(
        "Выбранные метрики не найдены в каталоге отчета.",
        status=400,
        details={"selectedMetricIds": selected_metric_ids},
    )


def resolve_selected_sources(selected_sources: list[str]) -> list[dict]:
    if not selected_sources:
        return [dict(source) for source in REPORT_SOURCES]

    normalized_values = {str(value).strip() for value in selected_sources if str(value).strip()}

    result = [
        dict(source)
        for source in REPORT_SOURCES
        if str(source.get("id")) in normalized_values
    ]

    if result:
        return result

    result = [
        dict(source)
        for source in REPORT_SOURCES
        if str(source.get("title")) in normalized_values
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

    result = []
    seen_ids = set()

    portal_sources = CrmSource.objects.filter(
        portal=portal,
        is_active=True,
        is_available=True,
    )

    for source in portal_sources:
        if source.external_key not in normalized_values:
            continue

        result.append(_crm_source_to_report_source(source))
        seen_ids.add(source.external_key)

    portal_source_types = {source["type"] for source in result}

    for source in REPORT_SOURCES:
        if str(source.get("id") or "") not in normalized_values:
            continue

        if source["id"] in seen_ids:
            continue

        if source["type"] in portal_source_types:
            continue

        result.append(dict(source))
        seen_ids.add(source["id"])

    if result:
        return result

    for source in portal_sources:
        candidates = {
            source.title,
            source.source_label,
        }

        if candidates & normalized_values:
            result.append(_crm_source_to_report_source(source))
            seen_ids.add(source.external_key)

    portal_source_types = {source["type"] for source in result}

    for source in REPORT_SOURCES:
        candidates = {
            str(source.get("title") or ""),
            str(source.get("sourceLabel") or ""),
        }

        if not candidates & normalized_values:
            continue

        if source["id"] in seen_ids:
            continue

        if source["type"] in portal_source_types:
            continue

        result.append(dict(source))
        seen_ids.add(source["id"])

    if result:
        return result

    return resolve_selected_sources(selected_sources)


def _crm_source_to_report_source(source: CrmSource) -> dict:
    source_type = (
        "smartProcess"
        if source.source_type == CrmSource.SourceType.SMART_PROCESS
        else source.source_type
    )

    if source.external_key.startswith("telephony-"):
        source_type = "telephony"
    elif source.external_key.startswith("activity-"):
        source_type = "activity"
    elif source.external_key.startswith("quote-"):
        source_type = "quote"

    return {
        "id": source.external_key,
        "type": source_type,
        "entityTypeId": source.entity_type_id,
        "categoryId": source.category_id,
        "title": source.title,
        "sourceLabel": source.source_label or source.title,
        "isAvailable": source.is_available,
        "rawData": source.raw_data or {},
    }


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
    values: dict[str, int | float] = {metric["id"]: 0 for metric in METRICS}

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

    activity_rows = [
        row
        for source_id, rows in rows_by_source.items()
        if source_id.startswith("activity-")
        for row in rows
        if _row_in_bucket(row, bucket)
    ]

    quote_rows = [
        row
        for source_id, rows in rows_by_source.items()
        if source_id.startswith("quote-")
        for row in rows
        if _row_in_bucket(row, bucket)
    ]

    mapped_quote_rows = [
        row
        for row in smart_process_rows
        if row.get("REPORT_SOURCE_ROLE") == "quote"
    ]

    contract_rows = [
        row
        for row in smart_process_rows
        if row.get("REPORT_SOURCE_ROLE") == "contract"
    ]

    meeting_rows = [
        row
        for row in smart_process_rows
        if row.get("REPORT_SOURCE_ROLE") == "meeting"
    ]

    regular_smart_process_rows = [
        row
        for row in smart_process_rows
        if row.get("REPORT_SOURCE_ROLE") not in {"quote", "contract", "meeting"}
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

    apply_smart_process_metrics(values, regular_smart_process_rows)
    apply_call_metrics(values, call_rows)
    apply_activity_metrics(values, activity_rows)
    values["meetings_created"] += len(meeting_rows)
    apply_quote_metrics(values, quote_rows)
    apply_mapped_quote_metrics(values, mapped_quote_rows)
    apply_contract_metrics(values, contract_rows)

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

    return {metric_id: values.get(metric_id, 0) for metric_id in metric_ids}


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
    created_at = _extract_row_datetime(row)

    return bool(created_at and bucket.start <= created_at <= bucket.end)


ROW_DATE_FIELDS = [
    "DATE_CREATE",
    "createdTime",
    "CREATED_TIME",
    "DATE_INSERT",
    "DATE_BILL",
    "CALL_START_DATE",
    "START_TIME",
    "CREATED",
    "DEADLINE",
]


def _extract_row_datetime(row: dict) -> datetime | None:
    for field in ROW_DATE_FIELDS:
        value = row.get(field)

        if value:
            parsed = _parse_datetime_or_date(str(value), end_of_day=False)

            if parsed is not None:
                return parsed

    return None


EMPLOYEE_ID_FIELDS = [
    "ASSIGNED_BY_ID",
    "RESPONSIBLE_ID",
    "PORTAL_USER_ID",
    "assignedById",
    "responsibleId",
    "AUTHOR_ID",
]


def _enrich_rows_with_user_names(
    *,
    client,
    portal,
    rows_by_source: dict[str, list[dict]],
) -> None:
    user_ids = sorted(
        {
            employee_id
            for rows in rows_by_source.values()
            for row in rows
            if (employee_id := _extract_employee_id(row)) not in {"", "unknown"}
        }
    )

    if not user_ids:
        return

    profiles = _load_cached_user_profiles(portal, user_ids)
    missing_user_ids = [user_id for user_id in user_ids if user_id not in profiles]
    profiles.update(_load_bitrix_user_profiles(client, portal, missing_user_ids))

    for rows in rows_by_source.values():
        for row in rows:
            profile = profiles.get(_extract_employee_id(row))

            if profile:
                _apply_user_profile_to_row(row, profile)


def _extract_employee_id(row: dict) -> str:
    for field in EMPLOYEE_ID_FIELDS:
        value = row.get(field)

        if value is None:
            continue

        normalized_value = str(value).strip()

        if normalized_value:
            return normalized_value

    return "unknown"


def _load_cached_user_profiles(portal, user_ids: list[str]) -> dict[str, dict[str, str]]:
    users = PortalUser.objects.filter(
        portal=portal,
        bitrix_user_id__in=user_ids,
        is_active=True,
    )
    profiles = {}

    for user in users:
        profile = _make_user_profile(
            user_id=user.bitrix_user_id,
            first_name=user.name,
            last_name=user.last_name,
            second_name=user.second_name,
            full_name=user.full_name,
        )

        if profile["fullName"]:
            profiles[user.bitrix_user_id] = profile

    return profiles


def _load_bitrix_user_profiles(client, portal, user_ids: list[str]) -> dict[str, dict[str, str]]:
    profiles: dict[str, dict[str, str]] = {}

    for user_id_chunk in _chunks(user_ids, 50):
        try:
            rows = client.call_list(
                "user.get",
                {
                    "FILTER": {
                        "ID": user_id_chunk,
                    },
                },
            )
        except BitrixRestError:
            continue

        for row in rows:
            user_id = str(row.get("ID") or "").strip()

            if not user_id:
                continue

            profile = _make_user_profile(
                user_id=user_id,
                first_name=row.get("NAME"),
                last_name=row.get("LAST_NAME"),
                second_name=row.get("SECOND_NAME"),
                full_name=row.get("FULL_NAME"),
            )

            if not profile["fullName"]:
                continue

            profiles[user_id] = profile
            PortalUser.objects.update_or_create(
                portal=portal,
                bitrix_user_id=user_id,
                defaults={
                    "name": profile["firstName"],
                    "last_name": profile["lastName"],
                    "second_name": profile["secondName"],
                    "full_name": profile["fullName"],
                    "email": str(row.get("EMAIL") or ""),
                    "avatar_url": str(row.get("PERSONAL_PHOTO") or ""),
                    "is_active": str(row.get("ACTIVE") or "Y").upper() != "N",
                    "last_synced_at": timezone.now(),
                },
            )

    return profiles


def _make_user_profile(
    *,
    user_id: str,
    first_name: Any,
    last_name: Any,
    second_name: Any,
    full_name: Any,
) -> dict[str, str]:
    first_name_value = str(first_name or "").strip()
    last_name_value = str(last_name or "").strip()
    second_name_value = str(second_name or "").strip()
    full_name_value = str(full_name or "").strip()

    if not full_name_value:
        full_name_value = " ".join(
            part for part in [first_name_value, last_name_value] if part
        ).strip()

    return {
        "id": user_id,
        "firstName": first_name_value or full_name_value,
        "lastName": last_name_value,
        "secondName": second_name_value,
        "fullName": full_name_value,
    }


def _apply_user_profile_to_row(row: dict, profile: dict[str, str]) -> None:
    first_name = profile["firstName"] or profile["fullName"]
    last_name = profile["lastName"]
    full_name = profile["fullName"]

    if first_name and not row.get("ASSIGNED_BY_NAME"):
        row["ASSIGNED_BY_NAME"] = first_name

    if last_name and not row.get("ASSIGNED_BY_LAST_NAME"):
        row["ASSIGNED_BY_LAST_NAME"] = last_name

    if full_name and not row.get("RESPONSIBLE_NAME"):
        row["RESPONSIBLE_NAME"] = full_name

    if last_name and not row.get("RESPONSIBLE_LAST_NAME"):
        row["RESPONSIBLE_LAST_NAME"] = last_name


def _chunks(values: list[str], size: int):
    for index in range(0, len(values), size):
        yield values[index:index + size]


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
