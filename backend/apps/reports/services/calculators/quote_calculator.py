from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
import logging
from typing import Any

from apps.bitrix.services.rest_client import BitrixRestError


logger = logging.getLogger(__name__)
QUOTE_TYPE_KEYWORDS = {
    "кп",
    "коммерческое предложение",
    "коммерческие предложения",
    "quote",
    "quotes",
    "estimate",
    "estimates",
}


def load_quote_rows(
    *,
    client,
    date_from: datetime,
    date_to: datetime,
    bitrix_datetime,
) -> list[dict]:
    rows = []

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
        logger.warning("Bitrix legacy quote loading failed; trying smart-process quote fallback.", exc_info=True)
        rows = []

    if rows:
        return [_normalize_quote_row(row) for row in rows]

    return _load_smart_quote_rows(
        client=client,
        date_from=date_from,
        date_to=date_to,
        bitrix_datetime=bitrix_datetime,
    )


def _load_smart_quote_rows(
    *,
    client,
    date_from: datetime,
    date_to: datetime,
    bitrix_datetime,
) -> list[dict]:
    try:
        response = client.call_method("crm.type.list", {})
    except AttributeError:
        logger.warning("Bitrix REST client does not support crm.type.list; quote smart-process fallback skipped.", exc_info=True)
        return []
    except BitrixRestError:
        logger.warning("Bitrix smart-process type loading failed; quote smart-process fallback skipped.", exc_info=True)
        return []

    quote_type_ids = [
        entity_type_id
        for smart_type in _extract_items(response.result, keys=("types", "items"))
        if (entity_type_id := _smart_quote_entity_type_id(smart_type)) is not None
    ]
    rows = []

    for entity_type_id in quote_type_ids:
        try:
            rows.extend(
                client.call_list(
                    "crm.item.list",
                    {
                        "entityTypeId": entity_type_id,
                        "order": {"createdTime": "ASC"},
                        "filter": {
                            ">=createdTime": bitrix_datetime(date_from),
                            "<=createdTime": bitrix_datetime(date_to),
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
            )
        except BitrixRestError:
            logger.warning(
                "Bitrix smart quote loading failed for entityTypeId=%s.",
                entity_type_id,
                exc_info=True,
            )
            continue

    return [_normalize_smart_quote_row(row) for row in rows]


def _smart_quote_entity_type_id(smart_type: dict) -> int | None:
    text = " ".join(
        str(value or "")
        for value in [
            smart_type.get("title"),
            smart_type.get("TITLE"),
            smart_type.get("name"),
            smart_type.get("NAME"),
        ]
    ).lower()

    if not any(keyword in text for keyword in QUOTE_TYPE_KEYWORDS):
        return None

    try:
        return int(smart_type.get("entityTypeId") or smart_type.get("ENTITY_TYPE_ID"))
    except (TypeError, ValueError):
        return None


def _extract_items(value: Any, *, keys: tuple[str, ...]) -> list[dict]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]

    if isinstance(value, dict):
        for key in keys:
            nested = value.get(key)

            if isinstance(nested, list):
                return [item for item in nested if isinstance(item, dict)]

    return []


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

    if quote_rows and not any([sent_rows, accepted_rows, declined_rows]):
        logger.warning(
            "Quotes exist but none were classified. STATUS_ID/STAGE_SEMANTIC_ID pairs: %s",
            _sample_status_pairs(quote_rows),
        )


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


def _normalize_smart_quote_row(row: dict) -> dict:
    return {
        "ID": row.get("id") or row.get("ID"),
        "TITLE": row.get("title") or row.get("TITLE") or "",
        "DATE_CREATE": row.get("createdTime") or row.get("CREATED_TIME"),
        "STATUS_ID": row.get("stageId") or row.get("STAGE_ID"),
        "STAGE_SEMANTIC_ID": row.get("stageSemanticId") or row.get("STAGE_SEMANTIC_ID"),
        "OPPORTUNITY": row.get("opportunity") or row.get("OPPORTUNITY") or 0,
        "CURRENCY_ID": row.get("currencyId") or row.get("CURRENCY_ID"),
        "ASSIGNED_BY_ID": row.get("assignedById") or row.get("ASSIGNED_BY_ID"),
        "SOURCE_KIND": "smart_quote",
    }


def _status(row: dict) -> str:
    semantic = str(row.get("STAGE_SEMANTIC_ID") or "").upper()

    if semantic == "S":
        return "SUCCESS"

    if semantic == "F":
        return "FAILED"

    return str(row.get("STATUS_ID") or "").split(":")[-1].upper()


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


def _sample_status_pairs(rows: list[dict], *, limit: int = 25) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    seen = set()

    for row in rows:
        pair = (
            str(row.get("STATUS_ID") or "").strip(),
            str(row.get("STAGE_SEMANTIC_ID") or "").strip(),
        )

        if pair in seen:
            continue

        seen.add(pair)
        result.append(pair)

        if len(result) >= limit:
            break

    return result
