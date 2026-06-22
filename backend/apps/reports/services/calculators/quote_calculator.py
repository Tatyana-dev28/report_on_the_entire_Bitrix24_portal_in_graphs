from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from apps.bitrix.services.rest_client import BitrixRestError


def load_quote_rows(
    *,
    client,
    date_from: datetime,
    date_to: datetime,
    bitrix_datetime,
) -> list[dict]:
    try:
        rows = client.call_list(
            "crm.quote.list",
            {
                "order": {"DATE_CREATE": "ASC"},
                "filter": {
                    ">=DATE_CREATE": bitrix_datetime(date_from),
                    "<=DATE_CREATE": bitrix_datetime(date_to),
                },
                "select": [
                    "ID",
                    "TITLE",
                    "DATE_CREATE",
                    "STATUS_ID",
                    "OPPORTUNITY",
                    "CURRENCY_ID",
                    "ASSIGNED_BY_ID",
                ],
            },
        )
    except BitrixRestError:
        return []

    return [_normalize_quote_row(row) for row in rows]


def apply_quote_metrics(values: dict[str, int | float], quote_rows: list[dict]) -> None:
    accepted_rows = [row for row in quote_rows if is_accepted_quote(row)]
    declined_rows = [row for row in quote_rows if is_declined_quote(row)]
    sent_rows = [row for row in quote_rows if is_sent_quote(row)]

    values["quotes_created"] = len(quote_rows)
    values["quotes_sent"] = len(sent_rows)
    values["quotes_accepted"] = len(accepted_rows)
    values["quotes_declined"] = len(declined_rows)
    values["quotes_accepted_sum"] = _sum_opportunity(accepted_rows)
    values["quotes_declined_sum"] = _sum_opportunity(declined_rows)
    values["quotes_conversion"] = _conversion(values["quotes_accepted"], values["quotes_created"])


def is_sent_quote(row: dict) -> bool:
    status = _status(row)

    return (
        status in {"SENT", "SEND", "PRESENTED", "APPROVED", "ACCEPTED", "WON"}
        or "SENT" in status
        or "SEND" in status
        or "PRESENT" in status
        or "ОТПРАВ" in status
    )


def is_accepted_quote(row: dict) -> bool:
    status = _status(row)

    return (
        status in {"APPROVED", "ACCEPTED", "WON", "SUCCESS"}
        or "ACCEPT" in status
        or "APPROV" in status
        or "WON" in status
        or "SUCCESS" in status
        or "ПРИНЯ" in status
        or "СОГЛАС" in status
    )


def is_declined_quote(row: dict) -> bool:
    status = _status(row)

    return (
        status in {"DECLINED", "REJECTED", "LOSE", "LOST", "FAIL", "FAILED"}
        or "DECLIN" in status
        or "REJECT" in status
        or "LOSE" in status
        or "LOST" in status
        or "FAIL" in status
        or "ОТКЛОН" in status
        or "ОТКАЗ" in status
    )


def _normalize_quote_row(row: dict) -> dict:
    return {
        "ID": row.get("ID"),
        "TITLE": row.get("TITLE") or "",
        "DATE_CREATE": row.get("DATE_CREATE"),
        "STATUS_ID": row.get("STATUS_ID"),
        "OPPORTUNITY": row.get("OPPORTUNITY") or 0,
        "CURRENCY_ID": row.get("CURRENCY_ID"),
        "ASSIGNED_BY_ID": row.get("ASSIGNED_BY_ID"),
        "SOURCE_KIND": "crm_quote",
    }


def _status(row: dict) -> str:
    return str(row.get("STATUS_ID") or "").upper()


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