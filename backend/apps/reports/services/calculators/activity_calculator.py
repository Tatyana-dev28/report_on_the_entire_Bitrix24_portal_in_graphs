from __future__ import annotations

from datetime import datetime
from typing import Any

from apps.bitrix.services.rest_client import BitrixRestError


MEETING_TYPE_IDS = {"2", "MEETING", "CRM_MEETING"}


def load_activity_rows(
    *,
    client,
    date_from: datetime,
    date_to: datetime,
    bitrix_datetime,
) -> list[dict]:
    try:
        rows = client.call_list(
            "crm.activity.list",
            {
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
                ],
            },
        )
    except BitrixRestError:
        return []

    return [_normalize_activity_row(row) for row in rows]


def apply_activity_metrics(values: dict[str, int | float], activity_rows: list[dict]) -> None:
    meeting_rows = [row for row in activity_rows if is_meeting_activity(row)]
    completed_rows = [row for row in activity_rows if is_completed_activity(row)]
    undone_rows = [row for row in activity_rows if not is_completed_activity(row)]

    values["meetings_created"] = len(meeting_rows)
    values["activities_created"] = len(activity_rows)
    values["activities_done"] = len(completed_rows)
    values["activities_undone"] = len(undone_rows)


def is_meeting_activity(row: dict) -> bool:
    type_id = str(row.get("TYPE_ID") or "").upper()
    subject = str(row.get("SUBJECT") or "").lower()

    return type_id in MEETING_TYPE_IDS or "встреч" in subject or "meeting" in subject


def is_completed_activity(row: dict) -> bool:
    completed = str(row.get("COMPLETED") or "").upper()
    status = str(row.get("STATUS") or "").upper()

    return completed == "Y" or status in {"2", "COMPLETED", "DONE"}


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
        "SOURCE_KIND": "crm_activity",
    }