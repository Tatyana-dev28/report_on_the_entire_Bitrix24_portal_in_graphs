from __future__ import annotations

from decimal import Decimal, InvalidOperation


QUOTE_SOURCE_KEYWORDS = {
    "кп",
    "коммерческое предложение",
    "коммерческие предложения",
    "предложение",
    "quote",
    "quotes",
    "estimate",
    "estimates",
}

CONTRACT_SOURCE_KEYWORDS = {
    "договор",
    "договоры",
    "контракт",
    "контракты",
    "contract",
    "contracts",
}

MEETING_SOURCE_KEYWORDS = {
    "meeting",
    "meetings",
}

CONTRACT_ENTITY_TYPE_IDS = {170}
MEETING_ENTITY_TYPE_IDS = {1070}


def get_smart_source_report_role(source: dict) -> str | None:
    entity_type_id = _safe_int(source.get("entityTypeId"))

    if entity_type_id in CONTRACT_ENTITY_TYPE_IDS:
        return "contract"

    if entity_type_id in MEETING_ENTITY_TYPE_IDS:
        return "meeting"

    text = _smart_source_search_text(source)

    if any(keyword in text for keyword in QUOTE_SOURCE_KEYWORDS):
        return "quote"

    if any(keyword in text for keyword in CONTRACT_SOURCE_KEYWORDS):
        return "contract"

    if any(keyword in text for keyword in MEETING_SOURCE_KEYWORDS):
        return "meeting"

    return None


def _smart_source_search_text(source: dict) -> str:
    raw_data = source.get("rawData") or {}
    raw_type = raw_data.get("type") if isinstance(raw_data, dict) else {}
    raw_category = raw_data.get("category") if isinstance(raw_data, dict) else {}

    parts = [
        source.get("id"),
        source.get("title"),
        source.get("sourceLabel"),
    ]

    if isinstance(raw_type, dict):
        parts.extend(
            [
                raw_type.get("title"),
                raw_type.get("TITLE"),
                raw_type.get("name"),
                raw_type.get("NAME"),
            ]
        )

    if isinstance(raw_category, dict):
        parts.extend(
            [
                raw_category.get("title"),
                raw_category.get("TITLE"),
                raw_category.get("name"),
                raw_category.get("NAME"),
            ]
        )

    return " ".join(str(part or "") for part in parts).lower()


def _safe_int(value: object) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def apply_mapped_quote_metrics(values: dict[str, int | float], quote_rows: list[dict]) -> None:
    accepted_rows = [row for row in quote_rows if is_success_row(row)]
    declined_rows = [row for row in quote_rows if is_failed_row(row)]
    sent_rows = [row for row in quote_rows if is_sent_row(row)]

    values["quotes_created"] = values.get("quotes_created", 0) + len(quote_rows)
    values["quotes_sent"] = values.get("quotes_sent", 0) + len(sent_rows)
    values["quotes_accepted"] = values.get("quotes_accepted", 0) + len(accepted_rows)
    values["quotes_declined"] = values.get("quotes_declined", 0) + len(declined_rows)
    values["quotes_accepted_sum"] = values.get("quotes_accepted_sum", 0) + _sum_opportunity(accepted_rows)
    values["quotes_declined_sum"] = values.get("quotes_declined_sum", 0) + _sum_opportunity(declined_rows)
    values["quotes_conversion"] = _conversion(values["quotes_accepted"], values["quotes_created"])


def apply_contract_metrics(values: dict[str, int | float], contract_rows: list[dict]) -> None:
    sent_rows = [row for row in contract_rows if is_sent_row(row)]
    signed_rows = [row for row in contract_rows if is_signed_contract(row)]
    failed_rows = [row for row in contract_rows if is_failed_row(row)]

    values["contracts_created"] = len(contract_rows)
    values["contracts_sent"] = len(sent_rows)
    values["contracts_signed"] = len(signed_rows)
    values["contracts_failed"] = len(failed_rows)
    values["contracts_signed_sum"] = _sum_opportunity(signed_rows)
    values["contracts_conversion"] = _conversion(values["contracts_signed"], values["contracts_created"])


def is_sent_row(row: dict) -> bool:
    stage = _stage(row)

    return (
        stage in {"SENT", "SEND", "DOCUMENT_SENT", "CONTRACT_SENT"}
        or "SENT" in stage
        or "SEND" in stage
        or "ОТПРАВ" in stage
    )


def is_success_row(row: dict) -> bool:
    semantic = str(row.get("STAGE_SEMANTIC_ID") or "").upper()

    if semantic == "S":
        return True

    stage = _stage(row)

    return (
        stage in {"SUCCESS", "SUCCESSFUL", "WON", "DONE", "READY", "CLOSED", "FINAL", "SIGNED"}
        or "SUCCESS" in stage
        or "DONE" in stage
        or "READY" in stage
        or "CLOSED" in stage
        or "SIGNED" in stage
        or "ПОДПИС" in stage
    )


def is_signed_contract(row: dict) -> bool:
    if is_success_row(row):
        return True

    stage = _stage(row)

    return "SIGNED" in stage or "ПОДПИС" in stage


def is_failed_row(row: dict) -> bool:
    semantic = str(row.get("STAGE_SEMANTIC_ID") or "").upper()

    if semantic == "F":
        return True

    stage = _stage(row)

    return (
        stage in {"FAIL", "FAILED", "LOSE", "LOST", "CANCEL", "CANCELED", "DECLINED", "REJECTED"}
        or "FAIL" in stage
        or "LOSE" in stage
        or "LOST" in stage
        or "CANCEL" in stage
        or "REJECT" in stage
        or "ОТКАЗ" in stage
        or "ОТКЛОН" in stage
    )


def _stage(row: dict) -> str:
    value = row.get("STAGE_ID") or row.get("STATUS_ID") or ""

    return str(value).split(":")[-1].upper()


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
