from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Callable


EMPLOYEE_ID_FIELDS = [
    "ASSIGNED_BY_ID",
    "RESPONSIBLE_ID",
    "PORTAL_USER_ID",
    "assignedById",
    "responsibleId",
    "AUTHOR_ID",
]


EMPLOYEE_FIRST_NAME_FIELDS = [
    "ASSIGNED_BY_NAME",
    "RESPONSIBLE_NAME",
    "NAME",
    "name",
]


EMPLOYEE_LAST_NAME_FIELDS = [
    "ASSIGNED_BY_LAST_NAME",
    "RESPONSIBLE_LAST_NAME",
    "LAST_NAME",
    "lastName",
]


def build_employee_breakdown(
    *,
    rows_by_source: dict[str, list[dict]],
    metric_catalog: list[dict],
    date_from,
    date_to,
    build_bucket_values: Callable[..., dict[str, int | float]],
) -> tuple[list[dict], list[dict]]:
    metric_ids = [metric["id"] for metric in metric_catalog]
    metric_by_id = {metric["id"]: metric for metric in metric_catalog}

    employee_rows: dict[str, dict[str, list[dict]]] = {}
    employee_names: dict[str, str] = {}

    for source_id, rows in rows_by_source.items():
        for row in rows:
            employee_id = _extract_employee_id(row)
            employee_name = _extract_employee_name(row, employee_id)

            employee_rows.setdefault(employee_id, {}).setdefault(source_id, []).append(row)

            current_name = employee_names.get(employee_id)

            if not current_name or _is_generic_employee_name(current_name, employee_id):
                employee_names[employee_id] = employee_name

    total_bucket = SimpleNamespace(
        key="total",
        label="Итого",
        tooltip_label="Итого",
        start=date_from,
        end=date_to,
    )

    employees = []
    details = []

    for employee_id in sorted(employee_rows.keys(), key=_employee_sort_key):
        employee_name = employee_names.get(employee_id) or _fallback_employee_name(employee_id)

        values = build_bucket_values(
            bucket=total_bucket,
            rows_by_source=employee_rows[employee_id],
            metric_ids=metric_ids,
        )

        employees.append(
            {
                "id": employee_id,
                "name": employee_name,
                "values": values,
            }
        )

        for metric_id in metric_ids:
            value = values.get(metric_id, 0)

            if value == 0:
                continue

            metric = metric_by_id.get(metric_id, {})

            details.append(
                {
                    "id": f"{employee_id}:{metric_id}",
                    "employeeId": employee_id,
                    "employeeName": employee_name,
                    "metricId": metric_id,
                    "metricLabel": metric.get("label", metric_id),
                    "metricType": metric.get("type", "number"),
                    "value": value,
                }
            )

    return employees, details


def _extract_employee_id(row: dict) -> str:
    for field in EMPLOYEE_ID_FIELDS:
        value = row.get(field)

        if value is None:
            continue

        normalized_value = str(value).strip()

        if normalized_value:
            return normalized_value

    return "unknown"


def _extract_employee_name(row: dict, employee_id: str) -> str:
    first_name = _first_non_empty_value(row, EMPLOYEE_FIRST_NAME_FIELDS)
    last_name = _first_non_empty_value(row, EMPLOYEE_LAST_NAME_FIELDS)

    full_name = " ".join([part for part in [first_name, last_name] if part]).strip()

    if full_name:
        return full_name

    return _fallback_employee_name(employee_id)


def _first_non_empty_value(row: dict, fields: list[str]) -> str:
    for field in fields:
        value = str(row.get(field) or "").strip()

        if value:
            return value

    return ""


def _fallback_employee_name(employee_id: str) -> str:
    if employee_id == "unknown":
        return "Без ответственного"

    return f"Сотрудник {employee_id}"


def _is_generic_employee_name(name: str, employee_id: str) -> bool:
    return name in {
        "Без ответственного",
        f"Сотрудник {employee_id}",
    }


def _employee_sort_key(employee_id: str) -> tuple[int, str]:
    if employee_id == "unknown":
        return 1, employee_id

    return 0, employee_id