from __future__ import annotations

from datetime import datetime
from typing import Any

from apps.bitrix.services.rest_client import BitrixRestError


OUTGOING_CALL_TYPE = 1
INCOMING_CALL_TYPES = {2, 3}
MISSED_CALL_CODE = "304"
SUCCESS_CALL_CODE = "200"
SUCCESS_OUTGOING_MIN_DURATION_SECONDS = 10


def load_call_rows(
    *,
    client,
    date_from: datetime,
    date_to: datetime,
    bitrix_datetime,
) -> list[dict]:
    try:
        rows = client.call_list(
            "voximplant.statistic.get",
            {
                "FILTER": {
                    ">=CALL_START_DATE": bitrix_datetime(date_from),
                    "<=CALL_START_DATE": bitrix_datetime(date_to),
                },
                "SORT": "CALL_START_DATE",
                "ORDER": "ASC",
            },
        )
    except BitrixRestError:
        return []

    return [_normalize_call_row(row) for row in rows]


def apply_call_metrics(values: dict[str, int | float], call_rows: list[dict]) -> None:
    outgoing_calls = [row for row in call_rows if is_outgoing_call(row)]
    incoming_calls = [row for row in call_rows if is_incoming_call(row)]
    missed_calls = [row for row in call_rows if is_missed_call(row)]
    successful_outgoing_calls = [row for row in outgoing_calls if is_successful_outgoing_call(row)]

    values["calls_total"] = len(call_rows)
    values["calls_in"] = len(incoming_calls)
    values["calls_out"] = len(outgoing_calls)
    values["calls_missed"] = len(missed_calls)
    values["calls_out_success"] = len(successful_outgoing_calls)


def is_outgoing_call(row: dict) -> bool:
    return _to_int(row.get("CALL_TYPE")) == OUTGOING_CALL_TYPE


def is_incoming_call(row: dict) -> bool:
    return _to_int(row.get("CALL_TYPE")) in INCOMING_CALL_TYPES


def is_missed_call(row: dict) -> bool:
    return str(row.get("CALL_FAILED_CODE") or "").upper() == MISSED_CALL_CODE


def is_successful_outgoing_call(row: dict) -> bool:
    if not is_outgoing_call(row):
        return False

    if str(row.get("CALL_FAILED_CODE") or "").upper() != SUCCESS_CALL_CODE:
        return False

    return _to_int(row.get("CALL_DURATION")) > SUCCESS_OUTGOING_MIN_DURATION_SECONDS


def _normalize_call_row(row: dict) -> dict:
    return {
        "ID": row.get("ID"),
        "CALL_ID": row.get("CALL_ID"),
        "DATE_CREATE": row.get("CALL_START_DATE"),
        "CALL_START_DATE": row.get("CALL_START_DATE"),
        "CALL_TYPE": _to_int(row.get("CALL_TYPE")),
        "CALL_DURATION": _to_int(row.get("CALL_DURATION")),
        "CALL_FAILED_CODE": str(row.get("CALL_FAILED_CODE") or "").upper(),
        "PORTAL_USER_ID": row.get("PORTAL_USER_ID"),
        "PHONE_NUMBER": row.get("PHONE_NUMBER"),
        "CRM_ENTITY_TYPE": row.get("CRM_ENTITY_TYPE"),
        "CRM_ENTITY_ID": row.get("CRM_ENTITY_ID"),
        "CRM_ACTIVITY_ID": row.get("CRM_ACTIVITY_ID"),
        "SOURCE_KIND": "telephony_call",
    }


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0