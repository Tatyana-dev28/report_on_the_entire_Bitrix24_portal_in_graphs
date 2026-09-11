from __future__ import annotations

from datetime import datetime, timedelta
import logging
from typing import Any

from apps.bitrix.services.rest_client import BitrixRestError, build_batch_command


logger = logging.getLogger(__name__)
OUTGOING_CALL_TYPE = 1
INCOMING_CALL_TYPES = {2, 3}
MISSED_CALL_CODE = "304"
SUCCESS_CALL_CODE = "200"
SUCCESS_OUTGOING_MIN_DURATION_SECONDS = 10
CALL_MAX_LIST_PAGES = 1000
CALL_BATCH_PAGE_SIZE = 25
BITRIX_LIST_PAGE_SIZE = 50
# voximplant.statistic.get on a long range often keeps only the newest ~30 days
# and zeroes the start of the period (e.g. 3–6 Aug inside 3 Aug–6 Sep).
CALL_QUERY_WINDOW_DAYS = 14


def load_call_rows(
    *,
    client,
    date_from: datetime,
    date_to: datetime,
    bitrix_datetime,
) -> list[dict]:
    rows: list[dict] = []
    seen_ids: set[str] = set()

    try:
        for window_from, window_to in iter_call_query_windows(date_from, date_to):
            params = {
                "FILTER": {
                    ">=CALL_START_DATE": bitrix_datetime(window_from),
                    "<=CALL_START_DATE": bitrix_datetime(window_to),
                },
                "SORT": "CALL_START_DATE",
                "ORDER": "ASC",
            }
            for row in _load_call_rows_batched(client, params):
                if not isinstance(row, dict):
                    continue
                row_id = str(row.get("ID") or row.get("CALL_ID") or "")
                if row_id and row_id in seen_ids:
                    continue
                if row_id:
                    seen_ids.add(row_id)
                rows.append(row)
    except BitrixRestError:
        logger.warning("Bitrix telephony loading failed; call metrics will be zero.", exc_info=True)
        return []

    return [_normalize_call_row(row) for row in rows]


def iter_call_query_windows(
    date_from: datetime,
    date_to: datetime,
    *,
    window_days: int = CALL_QUERY_WINDOW_DAYS,
) -> list[tuple[datetime, datetime]]:
    if date_from > date_to:
        date_from, date_to = date_to, date_from

    step = timedelta(days=max(1, int(window_days)))
    windows: list[tuple[datetime, datetime]] = []
    cursor = date_from

    while cursor <= date_to:
        chunk_to = min(cursor + step, date_to)
        windows.append((cursor, chunk_to))
        if chunk_to >= date_to:
            break
        cursor = chunk_to + timedelta(microseconds=1)

    return windows


def _load_call_rows_batched(client, params: dict) -> list[dict]:
    if not hasattr(client, "call_method") or not hasattr(client, "call_batch"):
        return client.call_list(
            "voximplant.statistic.get",
            params,
            max_pages=CALL_MAX_LIST_PAGES,
        )

    first_response = client.call_method(
        "voximplant.statistic.get",
        {
            **params,
            "start": 0,
        },
    )
    rows = _extract_list_items(first_response.result)
    total = _safe_int(first_response.total)

    if not total and first_response.next is not None:
        return _load_call_rows_sequentially(
            client=client,
            params=params,
            rows=rows,
            next_start=first_response.next,
        )

    if not total or total <= BITRIX_LIST_PAGE_SIZE:
        return rows

    max_rows = CALL_MAX_LIST_PAGES * BITRIX_LIST_PAGE_SIZE

    if total > max_rows:
        raise BitrixRestError(
            f"voximplant.statistic.get returned {total} rows, limit is {max_rows} rows."
        )

    starts = list(range(BITRIX_LIST_PAGE_SIZE, total, BITRIX_LIST_PAGE_SIZE))

    for index in range(0, len(starts), CALL_BATCH_PAGE_SIZE):
        chunk = starts[index : index + CALL_BATCH_PAGE_SIZE]
        commands = {
            f"page_{start}": build_batch_command(
                "voximplant.statistic.get",
                {
                    **params,
                    "start": start,
                },
            )
            for start in chunk
        }
        response = client.call_batch(commands)
        rows.extend(_extract_batch_items(response.result, commands.keys()))

    return rows


def _load_call_rows_sequentially(
    *,
    client,
    params: dict,
    rows: list[dict],
    next_start,
) -> list[dict]:
    page_count = 1

    while next_start is not None:
        page_count += 1

        if page_count > CALL_MAX_LIST_PAGES:
            raise BitrixRestError(
                f"voximplant.statistic.get pagination exceeded {CALL_MAX_LIST_PAGES} pages."
            )

        response = client.call_method(
            "voximplant.statistic.get",
            {
                **params,
                "start": next_start,
            },
        )
        rows.extend(_extract_list_items(response.result))
        next_start = response.next

    return rows


def _extract_batch_items(result: Any, command_keys) -> list[dict]:
    if not isinstance(result, dict):
        return []

    result_container = result.get("result")

    if not isinstance(result_container, dict):
        return []

    rows: list[dict] = []

    for command_key in command_keys:
        rows.extend(_extract_list_items(result_container.get(command_key)))

    return rows


def _extract_list_items(value: Any) -> list[dict]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]

    if isinstance(value, dict):
        items = value.get("items")

        if isinstance(items, list):
            return [item for item in items if isinstance(item, dict)]

        result = value.get("result")

        if isinstance(result, list):
            return [item for item in result if isinstance(item, dict)]

    return []


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


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
