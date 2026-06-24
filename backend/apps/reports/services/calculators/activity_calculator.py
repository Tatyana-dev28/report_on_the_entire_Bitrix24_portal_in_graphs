from __future__ import annotations

from datetime import datetime
from typing import Any

from apps.bitrix.services.rest_client import BitrixRestError, build_batch_command

MEETING_TYPE_IDS = {"2", "MEETING", "CRM_MEETING"}
ACTIVITY_MAX_LIST_PAGES = 1000
ACTIVITY_BATCH_PAGE_SIZE = 25
BITRIX_LIST_PAGE_SIZE = 50


def load_activity_rows(
    *,
    client,
    date_from: datetime,
    date_to: datetime,
    bitrix_datetime,
) -> list[dict]:
    params = {
        "order": {"START_TIME": "ASC"},
        "filter": {
            ">=START_TIME": bitrix_datetime(date_from),
            "<=START_TIME": bitrix_datetime(date_to),
        },
        "select": [
            "ID",
            "OWNER_ID",
            "OWNER_TYPE_ID",
            "TYPE_ID",
            "SUBJECT",
            "CREATED",
            "START_TIME",
            "END_TIME",
            "DEADLINE",
            "COMPLETED",
            "STATUS",
            "RESPONSIBLE_ID",
            "AUTHOR_ID",
            "PROVIDER_ID",
            "PROVIDER_TYPE_ID",
            "DIRECTION",
        ],
    }
    rows = _load_activity_rows_batched(client, params)

    return [_normalize_activity_row(row) for row in rows]


def _load_activity_rows_batched(client, params: dict) -> list[dict]:
    if not hasattr(client, "call_method") or not hasattr(client, "call_batch"):
        return client.call_list(
            "crm.activity.list",
            params,
            max_pages=ACTIVITY_MAX_LIST_PAGES,
        )

    first_response = client.call_method(
        "crm.activity.list",
        {
            **params,
            "start": 0,
        },
    )
    rows = _extract_list_items(first_response.result)
    total = _safe_int(first_response.total)

    if not total and first_response.next is not None:
        return _load_activity_rows_sequentially(
            client=client,
            params=params,
            rows=rows,
            next_start=first_response.next,
        )

    if not total or total <= BITRIX_LIST_PAGE_SIZE:
        return rows

    max_rows = ACTIVITY_MAX_LIST_PAGES * BITRIX_LIST_PAGE_SIZE

    if total > max_rows:
        raise BitrixRestError(
            f"crm.activity.list returned {total} rows, limit is {max_rows} rows."
        )

    starts = list(range(BITRIX_LIST_PAGE_SIZE, total, BITRIX_LIST_PAGE_SIZE))

    for index in range(0, len(starts), ACTIVITY_BATCH_PAGE_SIZE):
        chunk = starts[index : index + ACTIVITY_BATCH_PAGE_SIZE]
        commands = {
            f"page_{start}": build_batch_command(
                "crm.activity.list",
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


def _load_activity_rows_sequentially(
    *,
    client,
    params: dict,
    rows: list[dict],
    next_start,
) -> list[dict]:
    page_count = 1

    while next_start is not None:
        page_count += 1

        if page_count > ACTIVITY_MAX_LIST_PAGES:
            raise BitrixRestError(
                f"crm.activity.list pagination exceeded {ACTIVITY_MAX_LIST_PAGES} pages."
            )

        response = client.call_method(
            "crm.activity.list",
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

    return []


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def apply_activity_metrics(values: dict[str, int | float], activity_rows: list[dict]) -> None:
    meeting_rows = [row for row in activity_rows if is_meeting_activity(row)]
    completed_rows = [row for row in activity_rows if is_completed_activity(row)]
    undone_rows = [row for row in activity_rows if not is_completed_activity(row)]
    email_rows = [row for row in activity_rows if is_email_activity(row)]
    message_rows = [row for row in activity_rows if is_message_activity(row)]

    values["meetings_created"] = len(meeting_rows)
    values["activities_created"] = len(activity_rows)
    values["activities_done"] = len(completed_rows)
    values["activities_undone"] = len(undone_rows)
    values["email_in"] = len([row for row in email_rows if str(row.get("DIRECTION") or "") == "1"])
    values["email_out"] = len([row for row in email_rows if str(row.get("DIRECTION") or "") == "2"])
    values["messages_new"] = len(message_rows)
    values["messages_total"] = len(message_rows)


def is_meeting_activity(row: dict) -> bool:
    type_id = str(row.get("TYPE_ID") or "").upper()
    subject = str(row.get("SUBJECT") or "").lower()

    return type_id in MEETING_TYPE_IDS or "встреч" in subject or "meeting" in subject


def is_completed_activity(row: dict) -> bool:
    completed = str(row.get("COMPLETED") or "").upper()
    status = str(row.get("STATUS") or "").upper()

    return completed == "Y" or status in {"2", "COMPLETED", "DONE"}


def is_email_activity(row: dict) -> bool:
    provider_id = str(row.get("PROVIDER_ID") or "").upper()
    provider_type_id = str(row.get("PROVIDER_TYPE_ID") or "").upper()
    type_id = str(row.get("TYPE_ID") or "").upper()

    return (
        provider_id in {"CRM_EMAIL", "BITRIX24_EMAIL"}
        or provider_type_id in {"EMAIL", "CRM_EMAIL", "BITRIX24_EMAIL"}
        or type_id == "4"
    )


def is_message_activity(row: dict) -> bool:
    provider_id = str(row.get("PROVIDER_ID") or "").upper()
    provider_type_id = str(row.get("PROVIDER_TYPE_ID") or "").upper()

    return provider_id in {"IM", "LINES", "OPENLINES", "CRM_IM"} or provider_type_id in {
        "IM",
        "LINES",
        "OPENLINES",
        "CRM_IM",
    }


def _normalize_activity_row(row: dict) -> dict:
    return {
        "ID": row.get("ID"),
        "OWNER_ID": row.get("OWNER_ID"),
        "OWNER_TYPE_ID": row.get("OWNER_TYPE_ID"),
        "TYPE_ID": row.get("TYPE_ID"),
        "SUBJECT": row.get("SUBJECT") or "",
        "DATE_CREATE": row.get("START_TIME") or row.get("CREATED") or row.get("DEADLINE"),
        "CREATED": row.get("CREATED"),
        "START_TIME": row.get("START_TIME"),
        "END_TIME": row.get("END_TIME"),
        "DEADLINE": row.get("DEADLINE"),
        "COMPLETED": row.get("COMPLETED"),
        "STATUS": row.get("STATUS"),
        "RESPONSIBLE_ID": row.get("RESPONSIBLE_ID"),
        "AUTHOR_ID": row.get("AUTHOR_ID"),
        "PROVIDER_ID": row.get("PROVIDER_ID"),
        "PROVIDER_TYPE_ID": row.get("PROVIDER_TYPE_ID"),
        "DIRECTION": row.get("DIRECTION"),
        "SOURCE_KIND": "crm_activity",
    }
