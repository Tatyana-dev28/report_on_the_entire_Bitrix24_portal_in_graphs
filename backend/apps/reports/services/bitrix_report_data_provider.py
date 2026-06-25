from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from decimal import Decimal, InvalidOperation
import logging
from typing import Any, Callable

from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.bitrix.models import PortalUser
from apps.bitrix.services.rest_client import BitrixRestAuthError, BitrixRestClient, BitrixRestError
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
    "company",
    "contact",
    "task",
    "crm_form",
}
DEFAULT_REPORT_MESSAGE = "Отчет построен по данным Bitrix24."
logger = logging.getLogger(__name__)
DEFAULT_SOURCE_LOAD_WORKERS = 4
DEFAULT_TASK_MONTH_LOAD_WORKERS = 3
ESSENTIAL_STATIC_SOURCE_IDS = {
    "lead-default",
    "invoice-default",
    "telephony-default",
    "activity-default",
    "quote-default",
    "company-default",
    "contact-default",
    "task-default",
    "crm-form-default",
}
SALES_NEW_STAGES = {"NEW", "PREPARATION"}
SALES_TALK_STAGES = {"PREPAYMENT_INVOICE", "EXECUTING"}
SALES_NUMERIC_STAGE_BUCKETS = {
    "new": {"1", "2", "3", "4"},
    "talk": {"5", "6", "7"},
    "invoice": {"8"},
}


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

        if not selected_sources:
            return rows_by_source

        max_workers = min(_source_load_workers(), len(selected_sources))

        if max_workers <= 1:
            for source in selected_sources:
                rows_by_source[source["id"]] = self._load_single_source_rows(
                    client=client,
                    source=source,
                    date_from=date_from,
                    date_to=date_to,
                )

            return rows_by_source

        portal = getattr(client, "portal", None)

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_source = {
                executor.submit(
                    self._load_single_source_rows,
                    client=self.rest_client_factory(portal) if portal is not None else client,
                    source=source,
                    date_from=date_from,
                    date_to=date_to,
                ): source
                for source in selected_sources
            }

            for future in as_completed(future_to_source):
                source = future_to_source[future]

                try:
                    rows_by_source[source["id"]] = future.result()
                except BitrixRestAuthError:
                    raise
                except BitrixRestError:
                    logger.warning(
                        "Bitrix source loading failed for source=%s; metrics for this source will be zero.",
                        source.get("id"),
                        exc_info=True,
                    )
                    rows_by_source[source["id"]] = []

        return rows_by_source

    def _load_single_source_rows(
        self,
        *,
        client,
        source: dict,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        source_type = source.get("type")

        if source_type == "deal":
            return self._load_deals(
                client=client,
                source=source,
                date_from=date_from,
                date_to=date_to,
            )

        if source_type == "lead":
            return self._load_leads(
                client=client,
                source=source,
                date_from=date_from,
                date_to=date_to,
            )

        if source_type == "invoice":
            return self._load_invoices(
                client=client,
                source=source,
                date_from=date_from,
                date_to=date_to,
            )

        if source_type == "smartProcess":
            return self._load_smart_processes(
                client=client,
                source=source,
                date_from=date_from,
                date_to=date_to,
            )

        if source_type == "telephony":
            return self._load_calls(
                client=client,
                date_from=date_from,
                date_to=date_to,
            )

        if source_type == "activity":
            return self._load_activities(
                client=client,
                date_from=date_from,
                date_to=date_to,
            )

        if source_type == "quote":
            return self._load_quotes(
                client=client,
                date_from=date_from,
                date_to=date_to,
            )

        if source_type == "company":
            return self._load_companies(
                client=client,
                date_from=date_from,
                date_to=date_to,
            )

        if source_type == "contact":
            return self._load_contacts(
                client=client,
                date_from=date_from,
                date_to=date_to,
            )

        if source_type == "task":
            return self._load_tasks(
                client=client,
                date_from=date_from,
                date_to=date_to,
            )

        if source_type == "crm_form":
            return self._load_crm_forms(
                client=client,
                date_from=date_from,
                date_to=date_to,
            )

        return []

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
            logger.warning("Bitrix smart invoice loading failed; falling back to legacy invoices.", exc_info=True)

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

    def _load_companies(
        self,
        *,
        client,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        try:
            rows = client.call_list(
                "crm.company.list",
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
                        "ASSIGNED_BY_ID",
                        "ASSIGNED_BY_NAME",
                        "ASSIGNED_BY_LAST_NAME",
                    ],
                },
            )
        except BitrixRestError:
            logger.warning("Bitrix company loading failed; companies_new will be zero.", exc_info=True)
            return []

        return [_normalize_company_row(row) for row in rows]

    def _load_contacts(
        self,
        *,
        client,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        try:
            rows = client.call_list(
                "crm.contact.list",
                {
                    "order": {"DATE_CREATE": "ASC"},
                    "filter": {
                        ">=DATE_CREATE": _bitrix_datetime(date_from),
                        "<=DATE_CREATE": _bitrix_datetime(date_to),
                    },
                    "select": [
                        "ID",
                        "NAME",
                        "LAST_NAME",
                        "SECOND_NAME",
                        "DATE_CREATE",
                        "ASSIGNED_BY_ID",
                        "ASSIGNED_BY_NAME",
                        "ASSIGNED_BY_LAST_NAME",
                    ],
                },
            )
        except BitrixRestError:
            logger.warning("Bitrix contact loading failed; contacts_new will be zero.", exc_info=True)
            return []

        return [_normalize_contact_row(row) for row in rows]

    def _load_tasks(
        self,
        *,
        client,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        all_rows: list[dict] = []
        periods = list(_iter_month_ranges(date_from, date_to))

        if not periods:
            return []

        max_workers = min(_task_month_load_workers(), len(periods))

        if max_workers <= 1:
            for period_start, period_end in periods:
                all_rows.extend(
                    self._load_task_period(
                        client=client,
                        period_start=period_start,
                        period_end=period_end,
                    )
                )

            return [_normalize_task_row(row) for row in _deduplicate_rows_by_id(all_rows)]

        portal = getattr(client, "portal", None)

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_period = {
                executor.submit(
                    self._load_task_period,
                    client=self.rest_client_factory(portal) if portal is not None else client,
                    period_start=period_start,
                    period_end=period_end,
                ): (period_start, period_end)
                for period_start, period_end in periods
            }

            for future in as_completed(future_to_period):
                period_start, period_end = future_to_period[future]

                try:
                    all_rows.extend(future.result())
                except BitrixRestAuthError:
                    raise
                except BitrixRestError:
                    logger.warning(
                        "Bitrix task loading failed for period %s - %s; skipping this period.",
                        period_start.date(),
                        period_end.date(),
                        exc_info=True,
                    )

        return [_normalize_task_row(row) for row in _deduplicate_rows_by_id(all_rows)]

    def _load_task_period(
        self,
        *,
        client,
        period_start: datetime,
        period_end: datetime,
    ) -> list[dict]:
        try:
            return client.call_list(
                "tasks.task.list",
                {
                    "order": {"CREATED_DATE": "ASC"},
                    "filter": {
                        ">=CREATED_DATE": _bitrix_datetime(period_start),
                        "<=CREATED_DATE": _bitrix_datetime(period_end),
                    },
                    "select": [
                        "ID",
                        "TITLE",
                        "CREATED_DATE",
                        "CLOSED_DATE",
                        "DEADLINE",
                        "STATUS",
                        "REAL_STATUS",
                        "RESPONSIBLE_ID",
                        "RESPONSIBLE_NAME",
                        "RESPONSIBLE_LAST_NAME",
                    ],
                },
            )
        except BitrixRestAuthError:
            raise
        except BitrixRestError:
            logger.warning(
                "Bitrix task loading failed for period %s - %s; skipping this period.",
                period_start.date(),
                period_end.date(),
                exc_info=True,
            )
            return []

    def _load_crm_forms(
        self,
        *,
        client,
        date_from: datetime,
        date_to: datetime,
    ) -> list[dict]:
        # Пытаемся загрузить через crm.webform.result.list (требует скоуп crm.webform)
        try:
            rows = client.call_list(
                "crm.webform.result.list",
                {
                    "order": {"DATE_CREATE": "ASC"},
                    "filter": {
                        ">=DATE_CREATE": _bitrix_datetime(date_from),
                        "<=DATE_CREATE": _bitrix_datetime(date_to),
                    },
                },
            )
            if rows:
                return [_normalize_crm_form_row(row) for row in rows]
        except BitrixRestError:
            logger.warning(
                "crm.webform.result.list failed; falling back to leads/deals with SOURCE_ID=WEBFORM.",
                exc_info=True,
            )

        # Fallback: загружаем лиды и сделки с SOURCE_ID=WEBFORM
        logger.info("Loading CRM forms fallback via leads and deals with SOURCE_ID=WEBFORM.")
        form_rows: list[dict] = []

        try:
            lead_rows = client.call_list(
                "crm.lead.list",
                {
                    "order": {"DATE_CREATE": "ASC"},
                    "filter": {
                        ">=DATE_CREATE": _bitrix_datetime(date_from),
                        "<=DATE_CREATE": _bitrix_datetime(date_to),
                        "SOURCE_ID": "WEBFORM",
                    },
                    "select": [
                        "ID",
                        "TITLE",
                        "DATE_CREATE",
                        "SOURCE_ID",
                    ],
                },
            )
            for row in lead_rows:
                form_rows.append({
                    "ID": f"lead-form-{row.get('ID')}",
                    "DATE_CREATE": row.get("DATE_CREATE"),
                    "FORM_NAME": f"WEBFORM (lead #{row.get('ID')})",
                    "CRM_ENTITY_ID": row.get("ID"),
                    "CRM_ENTITY_TYPE": "LEAD",
                })
        except BitrixRestError:
            logger.warning("Failed to load leads with SOURCE_ID=WEBFORM for CRM forms fallback.", exc_info=True)

        try:
            deal_rows = client.call_list(
                "crm.deal.list",
                {
                    "order": {"DATE_CREATE": "ASC"},
                    "filter": {
                        ">=DATE_CREATE": _bitrix_datetime(date_from),
                        "<=DATE_CREATE": _bitrix_datetime(date_to),
                        "SOURCE_ID": "WEBFORM",
                    },
                    "select": [
                        "ID",
                        "TITLE",
                        "DATE_CREATE",
                        "SOURCE_ID",
                    ],
                },
            )
            for row in deal_rows:
                form_rows.append({
                    "ID": f"deal-form-{row.get('ID')}",
                    "DATE_CREATE": row.get("DATE_CREATE"),
                    "FORM_NAME": f"WEBFORM (deal #{row.get('ID')})",
                    "CRM_ENTITY_ID": row.get("ID"),
                    "CRM_ENTITY_TYPE": "DEAL",
                })
        except BitrixRestError:
            logger.warning("Failed to load deals with SOURCE_ID=WEBFORM for CRM forms fallback.", exc_info=True)

        if form_rows:
            logger.info("CRM forms fallback loaded %d rows from leads/deals with SOURCE_ID=WEBFORM.", len(form_rows))
        else:
            logger.warning(
                "CRM forms fallback also returned no results. "
                "Portal may not have SOURCE_ID=WEBFORM data in this period."
            )

        return form_rows


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


def _default_portal_sources(portal: Any) -> list[dict]:
    """Возвращает разумный набор источников по умолчанию для портала.

    Когда пользователь не выбрал источники явно, подставляются:
    - Все статические/виртуальные источники (lead, invoice, telephony, activity, quote, company, contact, task, crm-form)
    - Один основной источник сделок (первый доступный deal)
    - Один смарт-процесс (приоритет: entityTypeId=140 или 128, иначе первый попавшийся)

    Это гарантирует, что при пустом selectedSources отчёт включает
    все основные метрики, но не перегружает портал лишними источниками.
    """
    result = [dict(source) for source in REPORT_SOURCES]
    seen_types = {s["type"] for s in result}

    portal_sources = CrmSource.objects.filter(
        portal=portal,
        is_active=True,
        is_available=True,
    ).order_by("source_type", "category_id")

    for source in portal_sources:
        source_type = source.source_type

        if source_type == CrmSource.SourceType.DEAL and "deal" not in seen_types:
            result.append(_crm_source_to_report_source(source))
            seen_types.add("deal")

        elif source_type == CrmSource.SourceType.SMART_PROCESS and "smartProcess" not in seen_types:
            if source.entity_type_id in (140, 128):
                result.append(_crm_source_to_report_source(source))
                seen_types.add("smartProcess")

    if "smartProcess" not in seen_types:
        for source in portal_sources:
            if source.source_type == CrmSource.SourceType.SMART_PROCESS:
                result.append(_crm_source_to_report_source(source))
                seen_types.add("smartProcess")
                break

    return result


def _ensure_essential_source_types(
    result: list[dict],
    portal_sources: list[CrmSource],
) -> None:
    """Дополняет список источников необходимыми типами, если их нет.

    Если не выбраны базовые виртуальные источники из REPORT_SOURCES —
    добавляет их, чтобы включенные метрики не считались по пустому набору.
    Если в result нет ни одного deal — добавляет первый доступный.
    Если в result нет ни одного smartProcess — добавляет первый (приоритет: 140, 128).
    """
    seen_ids = {str(source.get("id") or "") for source in result}
    seen_types = {s["type"] for s in result}

    logger.info(
        "_ensure_essential_source_types: before=%d sources, types=%s, portal_sources=%d",
        len(result),
        sorted(seen_types),
        len(portal_sources),
    )

    for source in REPORT_SOURCES:
        source_id = str(source.get("id") or "")

        if source_id not in ESSENTIAL_STATIC_SOURCE_IDS:
            continue

        if source_id in seen_ids or source["type"] in seen_types:
            continue

        result.append(dict(source))
        seen_ids.add(source_id)
        seen_types.add(source["type"])
        logger.info("_ensure_essential_source_types: added static source %s", source_id)

    if "deal" not in seen_types:
        for source in portal_sources:
            if source.source_type == CrmSource.SourceType.DEAL:
                result.append(_crm_source_to_report_source(source))
                seen_types.add("deal")
                logger.info(
                    "_ensure_essential_source_types: added deal source %s (entityTypeId=%s)",
                    source.external_key,
                    source.entity_type_id,
                )
                break
        else:
            logger.warning(
                "_ensure_essential_source_types: no DEAL source found in %d portal sources",
                len(portal_sources),
            )

    if "smartProcess" not in seen_types:
        for source in portal_sources:
            if source.source_type == CrmSource.SourceType.SMART_PROCESS:
                if source.entity_type_id in (140, 128):
                    result.append(_crm_source_to_report_source(source))
                    seen_types.add("smartProcess")
                    logger.info(
                        "_ensure_essential_source_types: added smartProcess source %s (entityTypeId=%s)",
                        source.external_key,
                        source.entity_type_id,
                    )
                    break
        if "smartProcess" not in seen_types:
            for source in portal_sources:
                if source.source_type == CrmSource.SourceType.SMART_PROCESS:
                    result.append(_crm_source_to_report_source(source))
                    seen_types.add("smartProcess")
                    logger.info(
                        "_ensure_essential_source_types: added smartProcess source %s (entityTypeId=%s, fallback)",
                        source.external_key,
                        source.entity_type_id,
                    )
                    break
            else:
                logger.warning(
                    "_ensure_essential_source_types: no SMART_PROCESS source found in %d portal sources",
                    len(portal_sources),
                )

    logger.info(
        "_ensure_essential_source_types: after=%d sources, types=%s",
        len(result),
        sorted(seen_types),
    )


def resolve_selected_sources_for_portal(portal: Any, selected_sources: list[str]) -> list[dict]:
    if not selected_sources:
        return _default_portal_sources(portal)

    normalized_values = {str(value).strip() for value in selected_sources if str(value).strip()}

    result = []
    seen_ids = set()

    portal_sources = list(CrmSource.objects.filter(
        portal=portal,
        is_active=True,
        is_available=True,
    ))

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
        # Дополняем необходимыми типами (deal, smartProcess), если их нет
        _ensure_essential_source_types(result, portal_sources)
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
        _ensure_essential_source_types(result, portal_sources)
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

    company_rows = [
        row
        for source_id, rows in rows_by_source.items()
        if source_id.startswith("company-")
        for row in rows
        if _row_in_bucket(row, bucket)
    ]

    contact_rows = [
        row
        for source_id, rows in rows_by_source.items()
        if source_id.startswith("contact-")
        for row in rows
        if _row_in_bucket(row, bucket)
    ]

    task_rows = [
        row
        for source_id, rows in rows_by_source.items()
        if source_id.startswith("task-")
        for row in rows
    ]

    crm_form_rows = [
        row
        for source_id, rows in rows_by_source.items()
        if source_id.startswith("crm-form-")
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

    values["companies_new"] = len(company_rows)
    values["contacts_new"] = len(contact_rows)
    values["crm_forms"] = len(crm_form_rows)
    values["tasks_created"] = len(
        [row for row in task_rows if _row_field_in_bucket(row, "DATE_CREATE", bucket)]
    )
    values["tasks_done"] = len(
        [
            row
            for row in task_rows
            if _is_completed_task(row) and _row_field_in_bucket(row, "CLOSED_DATE", bucket)
        ]
    )
    values["tasks_overdue"] = len(
        [
            row
            for row in task_rows
            if not _is_completed_task(row) and _row_field_in_bucket(row, "DEADLINE", bucket)
        ]
    )

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

    sales_new_rows = [row for row in deal_rows if _is_sales_new_stage(row.get("STAGE_ID"))]
    sales_talk_rows = [
        row
        for row in deal_rows
        if _is_sales_talk_stage(row.get("STAGE_ID"))
    ]
    sales_invoice_rows = [row for row in deal_rows if _is_sales_invoice_stage(row.get("STAGE_ID"))]

    values["sales_new"] = len(sales_new_rows)
    values["sales_talk"] = len(sales_talk_rows)
    values["sales_invoice"] = len(sales_invoice_rows)

    if deal_rows and not any([sales_new_rows, sales_talk_rows, sales_invoice_rows, won_deals, lost_deals]):
        logger.warning(
            "Deals exist but sales funnel stages were not classified for bucket %s. "
            "Available STAGE_ID values: %s",
            bucket.tooltip_label,
            _sample_unique_values(row.get("STAGE_ID") for row in deal_rows),
        )

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


def _iter_month_ranges(date_from: datetime, date_to: datetime):
    cursor = date_from

    while cursor <= date_to:
        next_month_start = _add_month(cursor.replace(day=1, hour=0, minute=0, second=0, microsecond=0))
        period_end = min(next_month_start - timedelta(microseconds=1), date_to)

        yield cursor, period_end

        cursor = next_month_start


def _sample_unique_values(values, *, limit: int = 25) -> list[str]:
    result: list[str] = []
    seen = set()

    for value in values:
        text = str(value or "").strip()

        if not text or text in seen:
            continue

        seen.add(text)
        result.append(text)

        if len(result) >= limit:
            break

    return result


def _source_load_workers() -> int:
    return _positive_int_setting(
        "BITRIX_REPORT_SOURCE_LOAD_WORKERS",
        DEFAULT_SOURCE_LOAD_WORKERS,
    )


def _task_month_load_workers() -> int:
    return _positive_int_setting(
        "BITRIX_REPORT_TASK_MONTH_LOAD_WORKERS",
        DEFAULT_TASK_MONTH_LOAD_WORKERS,
    )


def _positive_int_setting(name: str, default: int) -> int:
    try:
        value = int(getattr(settings, name, default))
    except (TypeError, ValueError):
        return default

    return max(1, value)


def _row_in_bucket(row: dict, bucket: PeriodBucket) -> bool:
    created_at = _extract_row_datetime(row)

    return bool(created_at and bucket.start <= created_at <= bucket.end)


def _row_field_in_bucket(row: dict, field: str, bucket: PeriodBucket) -> bool:
    value = row.get(field)

    if not value:
        return False

    parsed = _parse_datetime_or_date(str(value), end_of_day=False)

    return bool(parsed and bucket.start <= parsed <= bucket.end)


ROW_DATE_FIELDS = [
    "DATE_CREATE",
    "createdTime",
    "CREATED_TIME",
    "DATE_INSERT",
    "DATE_BILL",
    "CALL_START_DATE",
    "START_TIME",
    "CREATED",
    "CREATED_DATE",
    "CLOSED_DATE",
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
            logger.warning("Bitrix user profile loading failed for report employee names.", exc_info=True)
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


def _stage_category(value: Any) -> str:
    text = str(value or "")

    if ":" not in text:
        return ""

    return text.split(":", 1)[0].upper()


def _is_sales_new_stage(value: Any) -> bool:
    suffix = _stage_suffix(value)
    category = _stage_category(value)

    if suffix in SALES_NEW_STAGES:
        return True

    if category == "C31" and suffix in SALES_NUMERIC_STAGE_BUCKETS["new"]:
        return True

    return False


def _is_sales_talk_stage(value: Any) -> bool:
    suffix = _stage_suffix(value)
    category = _stage_category(value)

    if suffix in SALES_TALK_STAGES:
        return True

    if category == "C31" and suffix in SALES_NUMERIC_STAGE_BUCKETS["talk"]:
        return True

    # C57: кастомные стадии переговоров (например, UC_H85HN8 = "3 письмо отправлено")
    if category == "C57":
        return True

    return False


def _is_sales_invoice_stage(value: Any) -> bool:
    suffix = _stage_suffix(value)
    category = _stage_category(value)

    if "INVOICE" in suffix:
        return True

    if category == "C31" and suffix in SALES_NUMERIC_STAGE_BUCKETS["invoice"]:
        return True

    return False


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


def _normalize_task_row(row: dict) -> dict:
    task = row.get("task") if isinstance(row.get("task"), dict) else row

    return {
        "ID": task.get("ID") or task.get("id"),
        "TITLE": task.get("TITLE") or task.get("title") or "",
        "DATE_CREATE": task.get("CREATED_DATE") or task.get("createdDate"),
        "CREATED_DATE": task.get("CREATED_DATE") or task.get("createdDate"),
        "CLOSED_DATE": task.get("CLOSED_DATE") or task.get("closedDate"),
        "DEADLINE": task.get("DEADLINE") or task.get("deadline"),
        "STATUS": task.get("STATUS") or task.get("status"),
        "REAL_STATUS": task.get("REAL_STATUS") or task.get("realStatus"),
        "RESPONSIBLE_ID": task.get("RESPONSIBLE_ID") or task.get("responsibleId"),
        "RESPONSIBLE_NAME": task.get("RESPONSIBLE_NAME") or task.get("responsibleName"),
        "RESPONSIBLE_LAST_NAME": task.get("RESPONSIBLE_LAST_NAME") or task.get("responsibleLastName"),
        "SOURCE_KIND": "task",
    }


def _normalize_company_row(row: dict) -> dict:
    return {
        "ID": row.get("ID") or row.get("id"),
        "TITLE": row.get("TITLE") or row.get("title") or "",
        "DATE_CREATE": row.get("DATE_CREATE") or row.get("dateCreate"),
        "ASSIGNED_BY_ID": row.get("ASSIGNED_BY_ID") or row.get("assignedById"),
        "ASSIGNED_BY_NAME": row.get("ASSIGNED_BY_NAME"),
        "ASSIGNED_BY_LAST_NAME": row.get("ASSIGNED_BY_LAST_NAME"),
        "SOURCE_KIND": "company",
    }


def _normalize_contact_row(row: dict) -> dict:
    title = " ".join(
        str(value or "").strip()
        for value in [
            row.get("NAME") or row.get("name"),
            row.get("LAST_NAME") or row.get("lastName"),
        ]
        if str(value or "").strip()
    )

    return {
        "ID": row.get("ID") or row.get("id"),
        "TITLE": title,
        "DATE_CREATE": row.get("DATE_CREATE") or row.get("dateCreate"),
        "ASSIGNED_BY_ID": row.get("ASSIGNED_BY_ID") or row.get("assignedById"),
        "ASSIGNED_BY_NAME": row.get("ASSIGNED_BY_NAME"),
        "ASSIGNED_BY_LAST_NAME": row.get("ASSIGNED_BY_LAST_NAME"),
        "SOURCE_KIND": "contact",
    }


def _normalize_crm_form_row(row: dict) -> dict:
    return {
        "ID": row.get("ID") or row.get("id"),
        "TITLE": row.get("FORM_NAME") or row.get("formName") or row.get("NAME") or row.get("name") or "CRM form",
        "DATE_CREATE": row.get("DATE_CREATE") or row.get("dateCreate"),
        "CRM_ENTITY_ID": row.get("CRM_ENTITY_ID") or row.get("crmEntityId"),
        "CRM_ENTITY_TYPE": row.get("CRM_ENTITY_TYPE") or row.get("crmEntityType"),
        "SOURCE_KIND": "crm_form",
    }


def _deduplicate_rows_by_id(rows: list[dict]) -> list[dict]:
    result = []
    seen_ids = set()

    for row in rows:
        row_id = str(row.get("ID") or "").strip()

        if row_id and row_id in seen_ids:
            continue

        if row_id:
            seen_ids.add(row_id)

        result.append(row)

    return result


def _is_completed_task(row: dict) -> bool:
    status = str(row.get("STATUS") or row.get("REAL_STATUS") or "").upper()
    real_status = str(row.get("REAL_STATUS") or "").upper()

    return status in {"5", "COMPLETED", "DONE"} or real_status in {"5", "COMPLETED", "DONE"}


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
