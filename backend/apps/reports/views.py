import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from apps.reports.catalog import METRIC_SECTIONS, METRICS, PERIOD_OPTIONS, REPORT_SOURCES


def _json_error(message: str, status: int = 400, details: dict | None = None) -> JsonResponse:
    payload: dict = {
        "ok": False,
        "error": message,
    }

    if details:
        payload["details"] = details

    return JsonResponse(payload, status=status, json_dumps_params={"ensure_ascii": False})


def _parse_json_body(request) -> tuple[dict, JsonResponse | None]:
    if not request.body:
        return {}, None

    try:
        payload = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError as error:
        return {}, _json_error(
            "Некорректный JSON в теле запроса.",
            details={"message": str(error)},
        )

    if not isinstance(payload, dict):
        return {}, _json_error("Тело запроса должно быть JSON-объектом.")

    return payload, None


@require_GET
def report_catalog_view(request) -> JsonResponse:
    return JsonResponse(
        {
            "ok": True,
            "periods": PERIOD_OPTIONS,
            "sources": REPORT_SOURCES,
            "metricSections": METRIC_SECTIONS,
            "metrics": METRICS,
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_POST
def report_preview_view(request) -> JsonResponse:
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    period = payload.get("period", "days")
    date_range = payload.get("dateRange") or {}
    selected_sources = payload.get("selectedSources") or []
    selected_metric_ids = payload.get("selectedMetricIds") or []

    if period not in {"hours", "days", "weeks", "months"}:
        return _json_error(
            "Некорректный период отчета.",
            details={"allowed": ["hours", "days", "weeks", "months"]},
        )

    if not isinstance(date_range, dict):
        return _json_error("Поле dateRange должно быть объектом.")

    if not isinstance(selected_sources, list):
        return _json_error("Поле selectedSources должно быть массивом.")

    if not isinstance(selected_metric_ids, list):
        return _json_error("Поле selectedMetricIds должно быть массивом.")

    # Важно: это placeholder API. Здесь пока не считаем реальные значения и не возвращаем mock.
    # Следующим этапом подключим Bitrix REST и временный cache/Redis для результата.
    return JsonResponse(
        {
            "ok": True,
            "status": "not_implemented",
            "message": "Расчет отчета через backend API еще не подключен.",
            "filters": {
                "period": period,
                "dateRange": date_range,
                "selectedSources": selected_sources,
                "selectedMetricIds": selected_metric_ids,
            },
            "data": [],
            "employees": [],
            "details": [],
        },
        json_dumps_params={"ensure_ascii": False},
    )
