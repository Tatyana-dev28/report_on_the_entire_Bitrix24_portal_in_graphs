"""
Service for computing per-source metrics by period for CRM sources (deal pipelines, smart processes).
This extends the report to include source-specific metrics for the table.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
import logging
from typing import Any, TYPE_CHECKING

from apps.reports.services.report_periods import PeriodBucket
from apps.reports.services.calculators.smart_process_calculator import (
    is_success_smart_process,
    is_failed_smart_process,
    _sum_opportunity as smart_sum_opportunity,
)

if TYPE_CHECKING:
    from apps.reports.services.bitrix_report_data_provider import (
        _sum_opportunity,
        _conversion,
        _row_in_bucket,
        _is_won_stage,
        _is_lost_stage,
    )

logger = logging.getLogger(__name__)


def _import_bitrix_helpers():
    """Lazy-import runtime helpers from bitrix_report_data_provider to avoid circular imports."""
    from apps.reports.services.bitrix_report_data_provider import (  # noqa: F811
        _sum_opportunity,
        _conversion,
        _row_in_bucket,
        _is_won_stage,
        _is_lost_stage,
    )
    return _sum_opportunity, _conversion, _row_in_bucket, _is_won_stage, _is_lost_stage


def build_source_metrics_by_period(
    *,
    buckets: list[PeriodBucket],
    rows_by_source: dict[str, list[dict]],
    selected_sources: list[dict],
    date_from: datetime,
    date_to: datetime,
    client,
) -> dict[str, dict]:
    """
    Build per-source metrics organized by period for deal pipelines and smart processes.

    Returns structure:
    {
        "source_deal_category_0": {
            "id": "source_deal_category_0",
            "label": "Общее (Сделки)",
            "entityTypeId": 2,
            "categoryId": 0,
            "type": "deal_pipeline",
            "sourceId": "deal-sales",
            "detailSourceIds": ["deal-2-0"],
            "metrics": {
                "created": {
                    "label": "Создано",
                    "valueType": "count",
                    "valuesByPeriod": {...},
                    "detailMetricIds": ["deals_created"],
                },
                ...
            }
        }
    }
    """
    result = {}

    for source in selected_sources:
        source_type = source.get("type") or source.get("entityType") or ""
        source_id = source.get("id", "")

        # Skip non-pipeline sources - only deal pipelines and smart processes.
        # Sources from the catalog have type "deal" for deal pipelines and "smartProcess" for smart processes.
        normalized_type = _normalize_source_type(source_type)
        if normalized_type not in ("deal_pipeline", "smart_process"):
            continue

        source_key = f"source_{source_id}"

        # Determine which source IDs in rows_by_source correspond to this source
        matched_source_keys = _find_matching_source_keys(source, rows_by_source)

        if not matched_source_keys:
            continue

        if normalized_type == "deal_pipeline":
            metrics = _compute_deal_pipeline_metrics(
                buckets=buckets,
                source=source,
                source_keys=matched_source_keys,
                rows_by_source=rows_by_source,
            )
        elif normalized_type == "smart_process":
            metrics = _compute_smart_process_metrics(
                buckets=buckets,
                source=source,
                source_keys=matched_source_keys,
                rows_by_source=rows_by_source,
            )
        else:
            continue

        label = (
            source.get("sourceLabel")
            or source.get("title")
            or source.get("name")
            or source_id
        )

        result[source_key] = {
            "id": source_key,
            "label": label,
            "entityTypeId": source.get("entityTypeId") or 0,
            "categoryId": source.get("categoryId"),
            "type": normalized_type,
            "sourceId": source_id,
            "detailSourceIds": matched_source_keys,
            "metrics": metrics,
        }

    return result


def _normalize_source_type(source_type: str) -> str:
    """Normalize source type from catalog to internal type."""
    if source_type in ("deal", "deal_pipeline", "deal_category"):
        return "deal_pipeline"
    if source_type in ("smartProcess", "smart_process"):
        return "smart_process"
    return source_type


def _find_matching_source_keys(
    source: dict,
    rows_by_source: dict[str, list[dict]],
) -> list[str]:
    """
    Find which keys in rows_by_source correspond to this source.
    For deal pipelines: match by entityTypeId and categoryId.
    For smart processes: match by entityTypeId.
    """
    source_type = _normalize_source_type(source.get("type") or "")
    source_id = str(source.get("id", ""))
    entity_type_id = source.get("entityTypeId") or source.get("entity_type_id")
    category_id = source.get("categoryId") or source.get("category_id")

    matched = []

    for key in rows_by_source:
        if source_type == "deal_pipeline" and "deal-" in key:
            if entity_type_id and category_id is not None:
                expected_prefix = f"deal-{entity_type_id}-{category_id}"
                if key.startswith(expected_prefix):
                    matched.append(key)
            elif source_id:
                if source_id in key:
                    matched.append(key)
        elif source_type == "smart_process" and "smart-" in key:
            if entity_type_id:
                expected_prefix = f"smart-{entity_type_id}"
                if key.startswith(expected_prefix) or source_id in key:
                    matched.append(key)
            elif source_id:
                if source_id in key:
                    matched.append(key)

    return matched or ([source_id] if source_id in rows_by_source else [])


def _compute_deal_pipeline_metrics(
    *,
    buckets: list[PeriodBucket],
    source: dict,
    source_keys: list[str],
    rows_by_source: dict[str, list[dict]],
) -> dict[str, dict]:
    """Compute deal pipeline metrics by period."""
    # Lazy import to avoid circular imports
    _sum_opportunity, _conversion, _row_in_bucket, _is_won_stage, _is_lost_stage = _import_bitrix_helpers()

    # Collect all rows from matching source keys
    all_rows = []
    for key in source_keys:
        all_rows.extend(rows_by_source.get(key, []))

    # Deduplicate by ID
    seen_ids = set()
    unique_rows = []
    for row in all_rows:
        row_id = row.get("ID")
        if row_id and row_id not in seen_ids:
            seen_ids.add(row_id)
            unique_rows.append(row)
        elif not row_id:
            unique_rows.append(row)

    # Count by period
    created_values = {}
    won_values = {}
    lost_values = {}
    won_sum_values = {}
    lost_sum_values = {}

    for bucket in buckets:
        period_key = bucket.key

        created_rows = [r for r in unique_rows if _row_in_bucket(r, bucket)]
        created_values[period_key] = len(created_rows)

        # Won deals
        won_deals = [r for r in created_rows if _is_won_stage(r.get("STAGE_ID")) or r.get("SEMANTIC_ID") == "S"]
        won_values[period_key] = len(won_deals)

        # Lost deals
        lost_deals = [r for r in created_rows if _is_lost_stage(r.get("STAGE_ID")) or r.get("SEMANTIC_ID") == "F"]
        lost_values[period_key] = len(lost_deals)

        # Won sum
        won_sum_values[period_key] = _sum_opportunity(won_deals)

        # Lost sum
        lost_sum_values[period_key] = _sum_opportunity(lost_deals)

    metrics = {
        "created": {
            "label": "Создано",
            "valueType": "count",
            "valuesByPeriod": created_values,
            "detailMetricIds": ["deals_created"],
        },
        "won": {
            "label": "Успешных",
            "valueType": "count",
            "valuesByPeriod": won_values,
            "detailMetricIds": ["deals_won"],
        },
        "lost": {
            "label": "Проигранных",
            "valueType": "count",
            "valuesByPeriod": lost_values,
            "detailMetricIds": ["deals_lost"],
        },
        "won_sum": {
            "label": "Сумма успешных",
            "valueType": "money",
            "valuesByPeriod": won_sum_values,
            "detailMetricIds": ["deals_won_sum"],
        },
        "lost_sum": {
            "label": "Сумма проигранных",
            "valueType": "money",
            "valuesByPeriod": lost_sum_values,
            "detailMetricIds": ["deals_lost_sum"],
        },
    }

    # Conversion metric
    conversion_values = {}
    for bucket in buckets:
        period_key = bucket.key
        created_count = created_values.get(period_key, 0)
        won_count = won_values.get(period_key, 0)
        conversion_values[period_key] = _conversion(won_count, created_count)

    metrics["conversion"] = {
        "label": "Конверсия",
        "valueType": "percent",
        "valuesByPeriod": conversion_values,
        "detailMetricIds": ["deals_won", "deals_created"],
    }

    return metrics


def _compute_smart_process_metrics(
    *,
    buckets: list[PeriodBucket],
    source: dict,
    source_keys: list[str],
    rows_by_source: dict[str, list[dict]],
) -> dict[str, dict]:
    """Compute smart process metrics by period."""
    # Lazy import to avoid circular imports
    _sum_opportunity, _conversion, _row_in_bucket, _is_won_stage, _is_lost_stage = _import_bitrix_helpers()

    # Collect all rows from matching source keys
    all_rows = []
    for key in source_keys:
        all_rows.extend(rows_by_source.get(key, []))

    # Deduplicate by ID
    seen_ids = set()
    unique_rows = []
    for row in all_rows:
        row_id = row.get("ID")
        if row_id and row_id not in seen_ids:
            seen_ids.add(row_id)
            unique_rows.append(row)
        elif not row_id:
            unique_rows.append(row)

    has_opportunity = any(
        float(row.get("OPPORTUNITY") or 0) > 0 for row in unique_rows
    )

    # Count by period
    created_values = {}
    success_values = {}
    failed_values = {}
    working_values = {}
    success_sum_values = {}

    for bucket in buckets:
        period_key = bucket.key

        created_rows = [r for r in unique_rows if _row_in_bucket(r, bucket)]
        created_values[period_key] = len(created_rows)

        success_rows = [r for r in created_rows if is_success_smart_process(r)]
        success_values[period_key] = len(success_rows)

        failed_rows = [r for r in created_rows if is_failed_smart_process(r)]
        failed_values[period_key] = len(failed_rows)

        working_rows = [
            r for r in created_rows
            if not is_success_smart_process(r) and not is_failed_smart_process(r)
        ]
        working_values[period_key] = len(working_rows)

        if has_opportunity:
            success_sum_values[period_key] = smart_sum_opportunity(success_rows)

    metrics = {
        "created": {
            "label": "Создано",
            "valueType": "count",
            "valuesByPeriod": created_values,
            "detailMetricIds": ["smart_process_total"],
        },
        "working": {
            "label": "В работе",
            "valueType": "count",
            "valuesByPeriod": working_values,
            "detailMetricIds": ["smart_process_working"],
        },
        "success": {
            "label": "Завершено",
            "valueType": "count",
            "valuesByPeriod": success_values,
            "detailMetricIds": ["smart_process_success"],
        },
        "failed": {
            "label": "Проиграно",
            "valueType": "count",
            "valuesByPeriod": failed_values,
            "detailMetricIds": ["smart_process_failed"],
        },
    }

    if has_opportunity:
        metrics["success_sum"] = {
            "label": "Сумма",
            "valueType": "money",
            "valuesByPeriod": success_sum_values,
            "detailMetricIds": ["smart_process_success_sum"],
        }

    # Conversion if we have meaningful data
    conversion_values = {}
    has_any_conversion = False
    for bucket in buckets:
        period_key = bucket.key
        created_count = created_values.get(period_key, 0)
        success_count = success_values.get(period_key, 0)
        if created_count > 0 and success_count > 0:
            has_any_conversion = True
        conversion_values[period_key] = _conversion(success_count, created_count)

    if has_any_conversion or any(conversion_values.values()):
        metrics["conversion"] = {
            "label": "Конверсия",
            "valueType": "percent",
            "valuesByPeriod": conversion_values,
            "detailMetricIds": ["smart_process_success", "smart_process_total"],
        }

    return metrics