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
from apps.reports.services.calculators.activity_calculator import (
    apply_activity_metrics,
    is_completed_activity,
    is_meeting_activity,
    load_activity_rows,
)
from apps.reports.services.calculators.contract_calculator import (
    apply_contract_metrics,
    apply_mapped_quote_metrics,
    get_smart_source_report_role,
    is_failed_row as is_failed_contract_row,
    is_sent_row as is_sent_contract_row,
    is_signed_contract,
)
from apps.reports.services.calculators.quote_calculator import (
    apply_quote_metrics,
    is_accepted_quote,
    is_declined_quote,
    is_sent_quote,
    load_quote_rows,
)
from apps.reports.services.calculators.smart_process_calculator import (
    apply_smart_process_metrics,
    is_production_accepted,
    is_production_check,
    is_production_ready,
    is_production_work,
    is_success_smart_process,
    load_smart_process_rows,
)
from apps.reports.services.calculators.telephony_calculator import (
    apply_call_metrics,
    is_incoming_call,
    is_missed_call,
    is_outgoing_call,
    is_successful_outgoing_call,
    load_call_rows,
)
from apps.reports.services.data_providers import (
    ReportDataProviderContext,
    ReportDataResult,
)
from apps.reports.services.employee_breakdown import build_employee_breakdown
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

        data = build_report_points(
            buckets=buckets,
            rows_by_source=rows_by_source,
            metric_catalog=metric_catalog,
        )

        employees, _employee_summary_details = build_employee_breakdown(
            rows_by_source=rows_by_source,
            metric_catalog=metric_catalog,
            date_from=date_from,
            date_to=date_to,
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
                "indicator": (
                    values.get("deals_won_sum", 0)
                    + values.get("invoices_won_sum", 0)
                    + values.get("smart_process_success_sum", 0)
                    + values.get("quotes_accepted_sum", 0)
                    + values.get("contracts_signed_sum", 0)
                ),
                "values": values,
            }
        )

    return points


def build_entity_details(
    *,
    buckets: list[PeriodBucket],
    rows_by_source: dict[str, list[dict]],
    metric_catalog: list[dict],
) -> list[dict]:
    metric_ids = {metric["id"] for metric in metric_catalog}
    metric_by_id = {metric["id"]: metric for metric in metric_catalog}
    details = []

    if not metric_ids:
        return details

    for bucket in buckets:
        for source_id, rows in rows_by_source.items():
            for row in rows:
                if not _row_in_bucket(row, bucket):
                    continue

                for metric_id in _row_metric_ids(source_id, row, metric_ids):
                    metric = metric_by_id.get(metric_id, {})
                    details.append(
                        _build_entity_detail(
                            row=row,
                            source_id=source_id,
                            metric_id=metric_id,
                            metric=metric,
                            period_key=bucket.key,
                        )
                    )

    return details


def _row_metric_ids(source_id: str, row: dict, metric_ids: set[str]) -> list[str]:
    candidates: list[str] = []

    if source_id.startswith("deal-"):
        candidates.extend(_deal_metric_ids(row))
    elif source_id.startswith("lead-"):
        candidates.extend(_lead_metric_ids(row))
    elif source_id.startswith("invoice-"):
        candidates.extend(_invoice_metric_ids(row))
    elif source_id.startswith("smart-"):
        role = row.get("REPORT_SOURCE_ROLE")

        if role == "quote":
            candidates.extend(_quote_metric_ids(row))
        elif role == "contract":
            candidates.extend(_contract_metric_ids(row))
        else:
            candidates.extend(_smart_process_metric_ids(row))
    elif source_id.startswith("telephony-"):
        candidates.extend(_call_metric_ids(row))
    elif source_id.startswith("activity-"):
        candidates.extend(_activity_metric_ids(row))
    elif source_id.startswith("quote-"):
        candidates.extend(_quote_metric_ids(row))

    seen = set()
    result = []

    for metric_id in candidates:
        if metric_id in metric_ids and metric_id not in seen:
            result.append(metric_id)
            seen.add(metric_id)

    return result


def _deal_metric_ids(row: dict) -> list[str]:
    metric_ids = ["deals_created"]
    stage = _stage_suffix(row.get("STAGE_ID"))

    if _is_won_stage(row.get("STAGE_ID")):
        metric_ids.extend(["deals_won", "deals_won_sum", "deals_conversion", "sales_won"])

    if _is_lost_stage(row.get("STAGE_ID")):
        metric_ids.extend(["deals_lost", "deals_lost_sum", "sales_lost"])

    if stage in {"NEW", "PREPARATION"}:
        metric_ids.append("sales_new")

    if stage in {"PREPAYMENT_INVOICE", "EXECUTING"}:
        metric_ids.append("sales_talk")

    if "INVOICE" in stage:
        metric_ids.append("sales_invoice")

    return metric_ids


def _lead_metric_ids(row: dict) -> list[str]:
    metric_ids = ["leads_created"]
    status = str(row.get("STATUS_ID") or "").upper()

    if _is_quality_lead(row.get("STATUS_ID")):
        metric_ids.extend(["leads_quality", "leads_quality_sum", "leads_conversion", "lead_qualified"])

    if _is_bad_lead(row.get("STATUS_ID")):
        metric_ids.extend(["leads_bad", "leads_bad_sum", "lead_bad_stage"])

    if status in {"NEW", ""}:
        metric_ids.append("lead_new")

    if status not in {"NEW", ""} and not _is_quality_lead(status) and not _is_bad_lead(status):
        metric_ids.append("lead_work")

    return metric_ids


def _invoice_metric_ids(row: dict) -> list[str]:
    metric_ids = ["invoices_created"]

    if _is_won_invoice(row):
        metric_ids.extend(["invoices_won", "invoices_won_sum", "invoices_conversion"])

    if _is_lost_invoice(row):
        metric_ids.extend(["invoices_lost", "invoices_lost_sum"])

    return metric_ids


def _smart_process_metric_ids(row: dict) -> list[str]:
    metric_ids = []

    if is_production_accepted(row):
        metric_ids.append("production_accepted")

    if is_production_work(row):
        metric_ids.append("production_work")

    if is_production_check(row):
        metric_ids.append("production_check")

    if is_production_ready(row):
        metric_ids.append("production_ready")

    if is_success_smart_process(row):
        metric_ids.append("production_closed")

    return metric_ids


def _call_metric_ids(row: dict) -> list[str]:
    metric_ids = ["calls_total"]

    if is_incoming_call(row):
        metric_ids.append("calls_in")

    if is_outgoing_call(row):
        metric_ids.append("calls_out")

    if is_successful_outgoing_call(row):
        metric_ids.append("calls_out_success")

    if is_missed_call(row):
        metric_ids.append("calls_missed")

    return metric_ids


def _activity_metric_ids(row: dict) -> list[str]:
    metric_ids = ["activities_created"]

    if is_meeting_activity(row):
        metric_ids.append("meetings_created")

    if is_completed_activity(row):
        metric_ids.append("activities_done")
    else:
        metric_ids.append("activities_undone")

    return metric_ids


def _quote_metric_ids(row: dict) -> list[str]:
    metric_ids = ["quotes_created"]

    if is_sent_quote(row):
        metric_ids.append("quotes_sent")

    if is_accepted_quote(row):
        metric_ids.extend(["quotes_accepted", "quotes_accepted_sum", "quotes_conversion"])

    if is_declined_quote(row):
        metric_ids.extend(["quotes_declined", "quotes_declined_sum"])

    return metric_ids


def _contract_metric_ids(row: dict) -> list[str]:
    metric_ids = ["contracts_created"]

    if is_sent_contract_row(row):
        metric_ids.append("contracts_sent")

    if is_signed_contract(row):
        metric_ids.extend(["contracts_signed", "contracts_signed_sum", "contracts_conversion"])

    if is_failed_contract_row(row):
        metric_ids.append("contracts_failed")

    return metric_ids


def _build_entity_detail(
    *,
    row: dict,
    source_id: str,
    metric_id: str,
    metric: dict,
    period_key: str,
) -> dict:
    employee_id = _extract_employee_id(row)
    entity_id = str(row.get("CRM_ACTIVITY_ID") or row.get("CALL_ID") or row.get("ID") or "")
    title = _extract_entity_title(row, source_id)
    created_at = _parse_datetime_or_date(str(row.get("DATE_CREATE") or ""), end_of_day=False)

    return {
        "id": entity_id or f"{source_id}:{metric_id}:{period_key}:{len(title)}",
        "entityId": entity_id,
        "sourceId": source_id,
        "periodKey": period_key,
        "employeeId": employee_id,
        "employeeName": _extract_employee_name(row, employee_id),
        "responsibleName": _extract_employee_name(row, employee_id),
        "metricId": metric_id,
        "metricLabel": metric.get("label", metric_id),
        "metricType": metric.get("type", "number"),
        "value": _detail_value(row, metric_id),
        "title": title,
        "createdAt": created_at.isoformat() if created_at else None,
    }


def _extract_entity_title(row: dict, source_id: str) -> str:
    title = str(row.get("TITLE") or row.get("SUBJECT") or "").strip()

    if title:
        return title

    if source_id.startswith("telephony-"):
        phone = str(row.get("PHONE_NUMBER") or "").strip()
        return f"Звонок {phone}".strip()

    return str(row.get("ID") or row.get("CALL_ID") or "CRM-сущность")


def _detail_value(row: dict, metric_id: str) -> int | float:
    if metric_id.endswith("_sum"):
        return _to_number(row.get("OPPORTUNITY"))

    if metric_id.endswith("_conversion"):
        return 1

    return 1


def _to_number(value: Any) -> int | float:
    try:
        decimal_value = Decimal(str(value or 0))
    except (InvalidOperation, ValueError):
        return 0

    if decimal_value == decimal_value.to_integral_value():
        return int(decimal_value)

    return float(decimal_value)


def _extract_employee_id(row: dict) -> str:
    for field in [
        "ASSIGNED_BY_ID",
        "RESPONSIBLE_ID",
        "PORTAL_USER_ID",
        "assignedById",
        "responsibleId",
        "AUTHOR_ID",
    ]:
        value = row.get(field)

        if value is None:
            continue

        normalized_value = str(value).strip()

        if normalized_value:
            return normalized_value

    return "unknown"


def _extract_employee_name(row: dict, employee_id: str) -> str:
    first_name = _first_non_empty_value(
        row,
        ["ASSIGNED_BY_NAME", "RESPONSIBLE_NAME", "NAME", "name"],
    )
    last_name = _first_non_empty_value(
        row,
        ["ASSIGNED_BY_LAST_NAME", "RESPONSIBLE_LAST_NAME", "LAST_NAME", "lastName"],
    )
    full_name = " ".join([part for part in [first_name, last_name] if part]).strip()

    if full_name:
        return full_name

    if employee_id == "unknown":
        return "Без ответственного"

    return f"Сотрудник {employee_id}"


def _first_non_empty_value(row: dict, fields: list[str]) -> str:
    for field in fields:
        value = str(row.get(field) or "").strip()

        if value:
            return value

    return ""


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
            "Р’С‹Р±СЂР°РЅРЅС‹Рµ РјРµС‚СЂРёРєРё РЅРµ РЅР°Р№РґРµРЅС‹ РІ РєР°С‚Р°Р»РѕРіРµ РѕС‚С‡РµС‚Р°.",
            status=400,
            details={"selectedMetricIds": selected_metric_ids, "unknownMetricIds": unknown_values},
        )

    result = [dict(metric) for metric in METRICS if str(metric.get("id")) in normalized_values]

    if result:
        return result

    raise ReportPreviewSessionError(
        "Р’С‹Р±СЂР°РЅРЅС‹Рµ РјРµС‚СЂРёРєРё РЅРµ РЅР°Р№РґРµРЅС‹ РІ РєР°С‚Р°Р»РѕРіРµ РѕС‚С‡РµС‚Р°.",
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

    result = []
    seen_ids = set()

    portal_sources = CrmSource.objects.filter(
        portal=portal,
        is_active=True,
        is_available=True,
    )

    for source in portal_sources:
        candidates = {
            source.external_key,
            source.title,
            source.source_label,
        }

        if candidates & normalized_values:
            source_type = (
                "smartProcess"
                if source.source_type == CrmSource.SourceType.SMART_PROCESS
                else source.source_type
            )

            result.append(
                {
                    "id": source.external_key,
                    "type": source_type,
                    "entityTypeId": source.entity_type_id,
                    "categoryId": source.category_id,
                    "title": source.title,
                    "sourceLabel": source.source_label or source.title,
                    "isAvailable": source.is_available,
                }
            )
            seen_ids.add(source.external_key)

    portal_source_types = {source["type"] for source in result}

    for source in REPORT_SOURCES:
        candidates = {
            str(source.get("id") or ""),
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

    regular_smart_process_rows = [
        row
        for row in smart_process_rows
        if row.get("REPORT_SOURCE_ROLE") not in {"quote", "contract"}
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
