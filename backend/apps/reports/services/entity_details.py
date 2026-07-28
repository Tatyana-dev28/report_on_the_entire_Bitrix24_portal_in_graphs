from __future__ import annotations

from datetime import datetime, time
from decimal import Decimal, InvalidOperation
from typing import Any

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.reports.services.calculators.activity_calculator import (
    is_email_activity,
    is_message_activity,
    is_completed_activity,
    is_meeting_activity,
)
from apps.reports.services.calculators.contract_calculator import (
    is_failed_row as is_failed_contract_row,
    is_sent_row as is_sent_contract_row,
    is_signed_contract,
)
from apps.reports.services.calculators.quote_calculator import (
    is_accepted_quote,
    is_declined_quote,
    is_sent_quote,
)
from apps.reports.services.calculators.smart_process_calculator import (
    is_failed_smart_process,
    is_production_accepted,
    is_production_check,
    is_production_ready,
    is_production_work,
    is_success_smart_process,
)
from apps.reports.services.calculators.telephony_calculator import (
    is_incoming_call,
    is_missed_call,
    is_outgoing_call,
    is_successful_outgoing_call,
)


def build_entity_details(
    *,
    buckets: list[Any],
    rows_by_source: dict[str, list[dict]],
    metric_catalog: list[dict],
) -> list[dict]:
    metric_ids = {metric["id"] for metric in metric_catalog}
    metric_by_id = {metric["id"]: metric for metric in metric_catalog}
    details = []

    if not metric_ids:
        return details

    for bucket in buckets:
        for source_id, rows in rows_by_source.items():
            for row in rows:
                if not _row_in_bucket(row, bucket):
                    continue

                for metric_id in _row_metric_ids(source_id, row, metric_ids):
                    metric = metric_by_id.get(metric_id, {})
                    details.append(
                        _build_entity_detail(
                            row=row,
                            source_id=source_id,
                            metric_id=metric_id,
                            metric=metric,
                            period_key=bucket.key,
                        )
                    )

    return details


def _row_metric_ids(source_id: str, row: dict, metric_ids: set[str]) -> list[str]:
    candidates: list[str] = []

    if source_id.startswith("deal-"):
        candidates.extend(_deal_metric_ids(row))
    elif source_id.startswith("lead-"):
        candidates.extend(_lead_metric_ids(row))
    elif source_id.startswith("invoice-"):
        candidates.extend(_invoice_metric_ids(row))
    elif source_id.startswith("smart-"):
        role = row.get("REPORT_SOURCE_ROLE")

        if role == "quote":
            candidates.extend(_quote_metric_ids(row))
        elif role == "contract":
            candidates.extend(_contract_metric_ids(row))
        elif role == "meeting":
            candidates.append("meetings_created")
        else:
            candidates.extend(_smart_process_metric_ids(row))
    elif source_id.startswith("telephony-"):
        candidates.extend(_call_metric_ids(row))
    elif source_id.startswith("activity-"):
        candidates.extend(_activity_metric_ids(row))
    elif source_id.startswith("quote-"):
        candidates.extend(_quote_metric_ids(row))
    elif source_id.startswith("company-"):
        candidates.append("companies_new")
    elif source_id.startswith("contact-"):
        candidates.append("contacts_new")
    elif source_id.startswith("task-"):
        candidates.extend(_task_metric_ids(row))
    elif source_id.startswith("crm-form-"):
        candidates.append("crm_forms")

    seen = set()
    result = []

    for metric_id in candidates:
        if metric_id in metric_ids and metric_id not in seen:
            result.append(metric_id)
            seen.add(metric_id)

    return result


def _deal_metric_ids(row: dict) -> list[str]:
    metric_ids = ["deals_created"]
    stage = _stage_suffix(row.get("STAGE_ID"))

    if _is_won_stage(row.get("STAGE_ID")):
        metric_ids.extend(["deals_won", "deals_won_sum", "deals_conversion", "sales_won"])

    if _is_lost_stage(row.get("STAGE_ID")):
        metric_ids.extend(["deals_lost", "deals_lost_sum", "sales_lost"])

    if stage in {"NEW", "PREPARATION"}:
        metric_ids.append("sales_new")

    if stage in {"PREPAYMENT_INVOICE", "EXECUTING"}:
        metric_ids.append("sales_talk")

    if "INVOICE" in stage:
        metric_ids.append("sales_invoice")

    return metric_ids


def _lead_metric_ids(row: dict) -> list[str]:
    metric_ids = ["leads_created"]
    status = str(row.get("STATUS_ID") or "").upper()

    if _is_quality_lead(row.get("STATUS_ID")):
        metric_ids.extend(["leads_quality", "leads_quality_sum", "leads_conversion", "lead_qualified"])

    if _is_bad_lead(row.get("STATUS_ID")):
        metric_ids.extend(["leads_bad", "leads_bad_sum", "lead_bad_stage"])

    if status in {"NEW", ""}:
        metric_ids.append("lead_new")

    if status not in {"NEW", ""} and not _is_quality_lead(status) and not _is_bad_lead(status):
        metric_ids.append("lead_work")

    return metric_ids


def _invoice_metric_ids(row: dict) -> list[str]:
    metric_ids = ["invoices_created"]

    if _is_won_invoice(row):
        metric_ids.extend(["invoices_won", "invoices_won_sum", "invoices_conversion"])

    if _is_lost_invoice(row):
        metric_ids.extend(["invoices_lost", "invoices_lost_sum"])

    return metric_ids


def _smart_process_metric_ids(row: dict) -> list[str]:
    metric_ids = ["smart_process_total"]

    if is_production_accepted(row):
        metric_ids.append("production_accepted")

    if is_production_work(row):
        metric_ids.append("production_work")

    if is_production_check(row):
        metric_ids.append("production_check")

    if is_production_ready(row):
        metric_ids.append("production_ready")

    if is_success_smart_process(row):
        metric_ids.append("production_closed")
        metric_ids.append("smart_process_success")
        metric_ids.append("smart_process_success_sum")

    if is_failed_smart_process(row):
        metric_ids.append("smart_process_failed")

    # Add smart_process_working for rows that are neither success nor failed
    if not is_success_smart_process(row) and not is_failed_smart_process(row):
        metric_ids.append("smart_process_working")

    return metric_ids


def _call_metric_ids(row: dict) -> list[str]:
    metric_ids = ["calls_total"]

    if is_incoming_call(row):
        metric_ids.append("calls_in")

    if is_outgoing_call(row):
        metric_ids.append("calls_out")

    if is_successful_outgoing_call(row):
        metric_ids.append("calls_out_success")

    if is_missed_call(row):
        metric_ids.append("calls_missed")

    return metric_ids


def _activity_metric_ids(row: dict) -> list[str]:
    metric_ids = ["activities_created"]

    if is_meeting_activity(row):
        metric_ids.append("meetings_created")

    if is_email_activity(row):
        if str(row.get("DIRECTION") or "") == "1":
            metric_ids.append("email_in")
        elif str(row.get("DIRECTION") or "") == "2":
            metric_ids.append("email_out")

    if is_message_activity(row):
        metric_ids.extend(["messages_new", "messages_total"])

    if is_completed_activity(row):
        metric_ids.append("activities_done")
    else:
        metric_ids.append("activities_undone")

    return metric_ids


def _quote_metric_ids(row: dict) -> list[str]:
    metric_ids = ["quotes_created"]

    if is_sent_quote(row):
        metric_ids.append("quotes_sent")

    if is_accepted_quote(row):
        metric_ids.extend(["quotes_accepted", "quotes_accepted_sum", "quotes_conversion"])

    if is_declined_quote(row):
        metric_ids.extend(["quotes_declined", "quotes_declined_sum"])

    return metric_ids


def _contract_metric_ids(row: dict) -> list[str]:
    metric_ids = ["contracts_created"]

    if is_sent_contract_row(row):
        metric_ids.append("contracts_sent")

    if is_signed_contract(row):
        metric_ids.extend(["contracts_signed", "contracts_signed_sum", "contracts_conversion"])

    if is_failed_contract_row(row):
        metric_ids.append("contracts_failed")

    return metric_ids


def _task_metric_ids(row: dict) -> list[str]:
    metric_ids = ["tasks_created"]

    if str(row.get("STATUS") or row.get("REAL_STATUS") or "").upper() in {"5", "COMPLETED", "DONE"}:
        metric_ids.append("tasks_done")
    elif row.get("DEADLINE"):
        metric_ids.append("tasks_overdue")

    return metric_ids


def _build_entity_detail(
    *,
    row: dict,
    source_id: str,
    metric_id: str,
    metric: dict,
    period_key: str,
) -> dict:
    employee_id = _extract_employee_id(row)
    entity_id = str(row.get("CRM_ACTIVITY_ID") or row.get("CALL_ID") or row.get("ID") or "")
    title = _extract_entity_title(row, source_id)
    created_at = _extract_row_datetime(row)
    navigation_entity = _extract_navigation_entity(row, source_id)

    detail = {
        "id": entity_id or f"{source_id}:{metric_id}:{period_key}:{len(title)}",
        "entityId": entity_id,
        "sourceId": source_id,
        "periodKey": period_key,
        "employeeId": employee_id,
        "employeeName": _extract_employee_name(row, employee_id),
        "responsibleName": _extract_employee_name(row, employee_id),
        "metricId": metric_id,
        "metricLabel": metric.get("label", metric_id),
        "metricType": metric.get("type", "number"),
        "value": _detail_value(row, metric_id),
        "title": title,
        "createdAt": created_at.isoformat() if created_at else None,
    }

    if navigation_entity:
        detail.update(navigation_entity)

    return detail


def _extract_navigation_entity(row: dict, source_id: str) -> dict[str, str] | None:
    if source_id.startswith("crm-form-"):
        entity_id = str(row.get("CRM_ENTITY_ID") or "").strip()
        entity_type = _normalize_crm_entity_type(row.get("CRM_ENTITY_TYPE"))

        if entity_id and entity_type:
            return {
                "navigationEntityId": entity_id,
                "navigationEntityType": entity_type,
            }

    if source_id.startswith("activity-"):
        owner_id = str(row.get("OWNER_ID") or "").strip()
        owner_type = _owner_type_id_to_entity_type(row.get("OWNER_TYPE_ID"))

        if owner_id and owner_type:
            return {
                "navigationEntityId": owner_id,
                "navigationEntityType": owner_type,
            }

    return None


def _normalize_crm_entity_type(value: object) -> str | None:
    normalized = str(value or "").strip().lower()
    mapping = {
        "lead": "lead",
        "deal": "deal",
        "company": "company",
        "contact": "contact",
        "quote": "quote",
        "invoice": "invoice",
    }

    return mapping.get(normalized)


def _owner_type_id_to_entity_type(value: object) -> str | None:
    normalized = str(value or "").strip()
    mapping = {
        "1": "lead",
        "2": "deal",
        "3": "contact",
        "4": "company",
        "7": "quote",
        "31": "invoice",
    }

    return mapping.get(normalized)


def _extract_entity_title(row: dict, source_id: str) -> str:
    title = str(row.get("TITLE") or row.get("SUBJECT") or "").strip()

    if title:
        return title

    if source_id.startswith("telephony-"):
        phone = str(row.get("PHONE_NUMBER") or "").strip()
        return f"Звонок {phone}".strip()

    return str(row.get("ID") or row.get("CALL_ID") or "CRM-сущность")


def _detail_value(row: dict, metric_id: str) -> int | float:
    if metric_id.endswith("_sum"):
        return _to_number(row.get("OPPORTUNITY"))

    if metric_id.endswith("_conversion"):
        return 1

    return 1


def _to_number(value: Any) -> int | float:
    try:
        decimal_value = Decimal(str(value or 0))
    except (InvalidOperation, ValueError):
        return 0

    if decimal_value == decimal_value.to_integral_value():
        return int(decimal_value)

    return float(decimal_value)


def _extract_employee_id(row: dict) -> str:
    for field in [
        "ASSIGNED_BY_ID",
        "RESPONSIBLE_ID",
        "PORTAL_USER_ID",
        "assignedById",
        "responsibleId",
        "AUTHOR_ID",
    ]:
        value = row.get(field)

        if value is None:
            continue

        normalized_value = str(value).strip()

        if normalized_value:
            return normalized_value

    return "unknown"


def _extract_employee_name(row: dict, employee_id: str) -> str:
    first_name = _first_non_empty_value(
        row,
        ["ASSIGNED_BY_NAME", "RESPONSIBLE_NAME", "NAME", "name"],
    )
    last_name = _first_non_empty_value(
        row,
        ["ASSIGNED_BY_LAST_NAME", "RESPONSIBLE_LAST_NAME", "LAST_NAME", "lastName"],
    )
    full_name = " ".join([part for part in [first_name, last_name] if part]).strip()

    if full_name:
        return full_name

    if employee_id == "unknown":
        return "Без ответственного"

    return f"Сотрудник {employee_id}"


def _first_non_empty_value(row: dict, fields: list[str]) -> str:
    for field in fields:
        value = str(row.get(field) or "").strip()

        if value:
            return value

    return ""


def _row_in_bucket(row: dict, bucket: Any) -> bool:
    created_at = _extract_row_datetime(row)

    return bool(created_at and bucket.start <= created_at <= bucket.end)


ROW_DATE_FIELDS = [
    "DATE_CREATE",
    "createdTime",
    "CREATED_TIME",
    "DATE_INSERT",
    "DATE_BILL",
    "CALL_START_DATE",
    "START_TIME",
    "CREATED",
    "DEADLINE",
]


def _extract_row_datetime(row: dict) -> datetime | None:
    for field in ROW_DATE_FIELDS:
        value = row.get(field)

        if value:
            parsed = _parse_datetime_or_date(str(value), end_of_day=False)

            if parsed is not None:
                return parsed

    return None


def _parse_datetime_or_date(value: str, *, end_of_day: bool) -> datetime | None:
    if not value:
        return None

    if len(value) == 10:
        parsed_date = parse_date(value)

        if parsed_date is not None:
            parsed_time = time.max if end_of_day else time.min

            return timezone.make_aware(
                datetime.combine(parsed_date, parsed_time),
                timezone.get_current_timezone(),
            )

    parsed_datetime = parse_datetime(value)

    if parsed_datetime is not None:
        if timezone.is_naive(parsed_datetime):
            return timezone.make_aware(parsed_datetime, timezone.get_current_timezone())

        return parsed_datetime

    parsed_date = parse_date(value)

    if parsed_date is None:
        return None

    parsed_time = time.max if end_of_day else time.min

    return timezone.make_aware(
        datetime.combine(parsed_date, parsed_time),
        timezone.get_current_timezone(),
    )


def _stage_suffix(value: Any) -> str:
    return str(value or "").split(":")[-1].upper()


def _is_won_stage(value: Any) -> bool:
    return _stage_suffix(value) in {"WON", "SUCCESS", "CONVERTED"}


def _is_lost_stage(value: Any) -> bool:
    suffix = _stage_suffix(value)

    return suffix in {"LOSE", "LOST", "APOLOGY", "JUNK"} or "LOSE" in suffix or "LOST" in suffix


def _is_quality_lead(value: Any) -> bool:
    return str(value or "").upper() in {"CONVERTED", "WON", "SUCCESS"}


def _is_bad_lead(value: Any) -> bool:
    return str(value or "").upper() in {"JUNK", "LOSE", "LOST", "BAD"}


def _is_won_invoice(row: dict) -> bool:
    semantic = str(row.get("STAGE_SEMANTIC_ID") or "").upper()

    if semantic == "S":
        return True

    stage = _stage_suffix(row.get("STAGE_ID"))

    return stage in {
        "P",
        "PAID",
        "PAYMENT_PAID",
        "WON",
        "SUCCESS",
        "SUCCESSFUL",
        "FINAL_INVOICE",
    }


def _is_lost_invoice(row: dict) -> bool:
    semantic = str(row.get("STAGE_SEMANTIC_ID") or "").upper()

    if semantic == "F":
        return True

    stage = _stage_suffix(row.get("STAGE_ID"))

    return (
        stage in {
            "D",
            "CANCEL",
            "CANCELED",
            "DECLINED",
            "LOSE",
            "LOST",
        }
        or "CANCEL" in stage
        or "LOSE" in stage
        or "LOST" in stage
    )
