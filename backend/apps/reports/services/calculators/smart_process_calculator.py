from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from apps.bitrix.services.rest_client import BitrixRestError


def load_smart_process_rows(
    *,
    client,
    source: dict,
    date_from: datetime,
    date_to: datetime,
    bitrix_datetime,
) -> list[dict]:
    entity_type_id = source.get("entityTypeId")

    if entity_type_id is None:
        return []

    filter_payload: dict[str, Any] = {
        ">=createdTime": bitrix_datetime(date_from),
        "<=createdTime": bitrix_datetime(date_to),
    }

    if source.get("categoryId") is not None:
        filter_payload["categoryId"] = source["categoryId"]

    try:
        rows = client.call_list(
            "crm.item.list",
            {
                "entityTypeId": int(entity_type_id),
                "order": {"createdTime": "ASC"},
                "filter": filter_payload,
                "select": [
                    "id",
                    "title",
                    "createdTime",
                    "stageId",
                    "stageSemanticId",
                    "opportunity",
                    "currencyId",
                    "assignedById",
                    "categoryId",
                ],
            },
        )
    except BitrixRestError:
        return []

    return [_normalize_smart_process_row(row, source=source) for row in rows]


def apply_smart_process_metrics(values: dict[str, int | float], smart_process_rows: list[dict]) -> None:
    successful_rows = [row for row in smart_process_rows if is_success_smart_process(row)]
    failed_rows = [row for row in smart_process_rows if is_failed_smart_process(row)]

    values["smart_process_created"] = len(smart_process_rows)
    values["smart_process_success"] = len(successful_rows)
    values["smart_process_failed"] = len(failed_rows)
    values["smart_process_success_sum"] = _sum_opportunity(successful_rows)
    values["smart_process_failed_sum"] = _sum_opportunity(failed_rows)
    values["smart_process_conversion"] = _conversion(
        values["smart_process_success"],
        values["smart_process_created"],
    )

    values["production_accepted"] = len(
        [row for row in smart_process_rows if is_production_accepted(row)]
    )
    values["production_work"] = len(
        [row for row in smart_process_rows if is_production_work(row)]
    )
    values["production_check"] = len(
        [row for row in smart_process_rows if is_production_check(row)]
    )
    values["production_ready"] = len(
        [row for row in smart_process_rows if is_production_ready(row)]
    )
    values["production_closed"] = len(successful_rows)


def is_success_smart_process(row: dict) -> bool:
    semantic = str(row.get("STAGE_SEMANTIC_ID") or "").upper()

    if semantic == "S":
        return True

    stage = _stage_suffix(row.get("STAGE_ID"))

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
        }
        or "SUCCESS" in stage
        or "DONE" in stage
        or "READY" in stage
        or "CLOSED" in stage
    )


def is_failed_smart_process(row: dict) -> bool:
    semantic = str(row.get("STAGE_SEMANTIC_ID") or "").upper()

    if semantic == "F":
        return True

    stage = _stage_suffix(row.get("STAGE_ID"))

    return (
        stage in {
            "FAIL",
            "FAILED",
            "LOSE",
            "LOST",
            "CANCEL",
            "CANCELED",
            "DECLINED",
            "REJECTED",
        }
        or "FAIL" in stage
        or "LOSE" in stage
        or "LOST" in stage
        or "CANCEL" in stage
        or "REJECT" in stage
    )


def is_production_accepted(row: dict) -> bool:
    stage = _stage_suffix(row.get("STAGE_ID"))

    return stage in {
        "NEW",
        "START",
        "INCOMING",
        "ACCEPTED",
        "ACCEPT",
        "PREPARATION",
    }


def is_production_work(row: dict) -> bool:
    stage = _stage_suffix(row.get("STAGE_ID"))

    return (
        stage in {
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
    )


def is_production_check(row: dict) -> bool:
    stage = _stage_suffix(row.get("STAGE_ID"))

    return (
        stage in {
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


def is_production_ready(row: dict) -> bool:
    stage = _stage_suffix(row.get("STAGE_ID"))

    return (
        stage in {
            "READY",
            "DONE",
            "FINISH",
            "FINAL",
        }
        or "READY" in stage
        or "DONE" in stage
        or "FINISH" in stage
    )


def _normalize_smart_process_row(row: dict, *, source: dict) -> dict:
    return {
        "ID": row.get("id") or row.get("ID"),
        "TITLE": row.get("title") or row.get("TITLE") or "",
        "DATE_CREATE": row.get("createdTime") or row.get("CREATED_TIME"),
        "STAGE_ID": row.get("stageId") or row.get("STAGE_ID"),
        "STAGE_SEMANTIC_ID": row.get("stageSemanticId") or row.get("STAGE_SEMANTIC_ID"),
        "OPPORTUNITY": row.get("opportunity") or row.get("OPPORTUNITY") or 0,
        "CURRENCY_ID": row.get("currencyId") or row.get("CURRENCY_ID"),
        "ASSIGNED_BY_ID": row.get("assignedById") or row.get("ASSIGNED_BY_ID"),
        "CATEGORY_ID": row.get("categoryId") or row.get("CATEGORY_ID") or source.get("categoryId"),
        "ENTITY_TYPE_ID": source.get("entityTypeId"),
        "SOURCE_KIND": "smart_process",
    }


def _stage_suffix(value: Any) -> str:
    return str(value or "").split(":")[-1].upper()


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