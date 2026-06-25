from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any


SmartProcessRow = dict[str, Any]
ReportSource = dict[str, Any]


SMART_PROCESS_SELECT_FIELDS = [
    "id",
    "title",
    "createdTime",
    "updatedTime",
    "stageId",
    "stageSemanticId",
    "opportunity",
    "currencyId",
    "assignedById",
    "createdBy",
    "updatedBy",
    "categoryId",
]


def load_smart_process_rows(
    *,
    client,
    source: ReportSource,
    date_from: datetime,
    date_to: datetime,
    bitrix_datetime: Callable[[datetime], str],
) -> list[SmartProcessRow]:
    entity_type_id = source.get("entityTypeId") or source.get("entity_type_id")
    if not entity_type_id:
        return []

    filter_payload: dict[str, Any] = {
        ">=createdTime": bitrix_datetime(date_from),
        "<=createdTime": bitrix_datetime(date_to),
    }

    category_id = source.get("categoryId")
    if category_id is None:
        category_id = source.get("category_id")

    if category_id is not None:
        filter_payload["categoryId"] = category_id

    rows = client.call_list(
        "crm.item.list",
        {
            "entityTypeId": entity_type_id,
            "filter": filter_payload,
            "select": SMART_PROCESS_SELECT_FIELDS,
        },
    )

    rows = _extract_items(rows)

    return [
        _normalize_smart_process_row(row, source=source)
        for row in rows
        if isinstance(row, dict)
    ]


def apply_smart_process_metrics(
    values: dict[str, Any],
    smart_process_rows: list[SmartProcessRow] | None = None,
    *args,
    **kwargs,
) -> dict[str, Any]:
    rows = smart_process_rows
    if rows is None:
        rows = kwargs.get("rows") or kwargs.get("smart_process_rows") or []

    successful_rows = [row for row in rows if is_success_smart_process(row)]
    failed_rows = [row for row in rows if is_failed_smart_process(row)]

    values["production_accepted"] = len(
        [row for row in rows if is_production_accepted(row)]
    )
    values["production_work"] = len(
        [row for row in rows if is_production_work(row)]
    )
    values["production_check"] = len(
        [row for row in rows if is_production_check(row)]
    )
    values["production_ready"] = len(
        [row for row in rows if is_production_ready(row)]
    )
    values["production_closed"] = len(successful_rows)

    values["smart_process_total"] = len(rows)
    values["smart_process_success"] = len(successful_rows)
    values["smart_process_failed"] = len(failed_rows)
    values["smart_process_success_sum"] = _sum_opportunity(successful_rows)

    return values


def is_success_smart_process(row: SmartProcessRow) -> bool:
    stage = _stage_suffix(row.get("STAGE_ID") or row.get("stageId"))
    semantic = _semantic(row)

    if semantic == "S":
        return True

    return (
        stage in {
            "SUCCESS",
            "SUCCESSFUL",
            "WON",
            "DONE",
            "READY",
            "CLOSED",
            "FINAL",
            "FINISH",
            "STAGE4",
            "STAGE5",
        }
        or "SUCCESS" in stage
        or "DONE" in stage
        or "READY" in stage
        or "CLOSED" in stage
        or "FINISH" in stage
    )


def is_failed_smart_process(row: SmartProcessRow) -> bool:
    stage = _stage_suffix(row.get("STAGE_ID") or row.get("stageId"))
    semantic = _semantic(row)

    if semantic == "F":
        return True

    return (
        stage in {
            "FAIL",
            "FAILED",
            "LOSE",
            "LOST",
            "CANCEL",
            "CANCELLED",
            "REJECT",
            "REJECTED",
            "APOLOGY",
            "JUNK",
        }
        or "FAIL" in stage
        or "LOSE" in stage
        or "LOST" in stage
        or "CANCEL" in stage
        or "REJECT" in stage
    )


def is_production_accepted(row: SmartProcessRow) -> bool:
    stage = _stage_suffix(row.get("STAGE_ID") or row.get("stageId"))

    return stage in {
        "STAGE1",
        "NEW",
        "START",
        "INCOMING",
        "ACCEPTED",
        "ACCEPT",
        "PREPARATION",
    }


def is_production_work(row: SmartProcessRow) -> bool:
    stage = _stage_suffix(row.get("STAGE_ID") or row.get("stageId"))

    if not stage:
        return False

    if is_production_accepted(row):
        return False

    if is_production_check(row):
        return False

    if is_production_ready(row):
        return False

    if is_success_smart_process(row):
        return False

    if is_failed_smart_process(row):
        return False

    if (
        stage in {
            "STAGE2",
            "WORK",
            "IN_WORK",
            "EXECUTING",
            "PROCESS",
            "PRODUCTION",
            "IN_PROGRESS",
        }
        or "WORK" in stage
        or "PROCESS" in stage
        or "PRODUCTION" in stage
    ):
        return True

    return True


def is_production_check(row: SmartProcessRow) -> bool:
    stage = _stage_suffix(row.get("STAGE_ID") or row.get("stageId"))

    return (
        stage in {
            "STAGE3",
            "CHECK",
            "REVIEW",
            "CONTROL",
            "APPROVAL",
            "VERIFY",
            "VERIFICATION",
        }
        or "CHECK" in stage
        or "REVIEW" in stage
        or "CONTROL" in stage
        or "APPROVAL" in stage
        or "VERIFY" in stage
    )


def is_production_ready(row: SmartProcessRow) -> bool:
    stage = _stage_suffix(row.get("STAGE_ID") or row.get("stageId"))

    return (
        stage in {
            "STAGE4",
            "READY",
            "DONE",
            "FINISH",
            "FINAL",
        }
        or "READY" in stage
        or "DONE" in stage
        or "FINISH" in stage
    )


def _normalize_smart_process_row(row: SmartProcessRow, *, source: ReportSource) -> SmartProcessRow:
    return {
        "ID": row.get("id") or row.get("ID"),
        "TITLE": row.get("title") or row.get("TITLE") or "",
        "DATE_CREATE": row.get("createdTime") or row.get("CREATED_TIME"),
        "DATE_MODIFY": row.get("updatedTime") or row.get("UPDATED_TIME"),
        "STAGE_ID": row.get("stageId") or row.get("STAGE_ID"),
        "STAGE_SEMANTIC_ID": row.get("stageSemanticId") or row.get("STAGE_SEMANTIC_ID"),
        "OPPORTUNITY": row.get("opportunity") or row.get("OPPORTUNITY") or 0,
        "CURRENCY_ID": row.get("currencyId") or row.get("CURRENCY_ID"),
        "ASSIGNED_BY_ID": row.get("assignedById") or row.get("ASSIGNED_BY_ID"),
        "CREATED_BY_ID": row.get("createdBy") or row.get("CREATED_BY"),
        "UPDATED_BY_ID": row.get("updatedBy") or row.get("UPDATED_BY"),
        "CATEGORY_ID": row.get("categoryId")
        or row.get("CATEGORY_ID")
        or source.get("categoryId")
        or source.get("category_id"),
        "ENTITY_TYPE_ID": source.get("entityTypeId") or source.get("entity_type_id"),
        "REPORT_SOURCE_ID": source.get("id"),
        "REPORT_SOURCE_TYPE": source.get("type") or "smartProcess",
        "REPORT_SOURCE_LABEL": source.get("sourceLabel") or source.get("title") or "",
        "REPORT_SOURCE_ROLE": source.get("reportRole") or source.get("role"),
        "RAW": row,
    }


def _extract_items(rows: Any) -> list[SmartProcessRow]:
    if isinstance(rows, dict):
        items = rows.get("items")
        if isinstance(items, list):
            return items

        result = rows.get("result")
        if isinstance(result, dict) and isinstance(result.get("items"), list):
            return result["items"]

        if isinstance(result, list):
            return result

        return []

    if isinstance(rows, list):
        if len(rows) == 1 and isinstance(rows[0], dict):
            items = rows[0].get("items")
            if isinstance(items, list):
                return items

            result = rows[0].get("result")
            if isinstance(result, dict) and isinstance(result.get("items"), list):
                return result["items"]

            if isinstance(result, list):
                return result

        return rows

    return []


def _stage_suffix(value: Any) -> str:
    return str(value or "").split(":")[-1].strip().upper()


def _semantic(row: SmartProcessRow) -> str:
    return str(
        row.get("STAGE_SEMANTIC_ID")
        or row.get("stageSemanticId")
        or ""
    ).strip().upper()


def _sum_opportunity(rows: list[SmartProcessRow]) -> int:
    total = Decimal("0")

    for row in rows:
        try:
            total += Decimal(str(row.get("OPPORTUNITY") or row.get("opportunity") or 0))
        except (InvalidOperation, ValueError):
            continue

    return int(total)
