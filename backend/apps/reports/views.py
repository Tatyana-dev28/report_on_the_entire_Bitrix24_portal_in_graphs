import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from apps.reports.services.exceptions import ReportPreviewSessionError
from apps.reports.services.report_catalog import build_report_catalog
from apps.reports.services.report_context import resolve_portal
from apps.reports.services.report_sessions import create_report_preview_session


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
def report_catalog_view(request):
    try:
        portal = resolve_portal(request, request.GET.dict())
    except ReportPreviewSessionError:
        portal = None

    return JsonResponse(
        {
            "ok": True,
            **build_report_catalog(portal),
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_POST
def report_preview_view(request):
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    try:
        preview = create_report_preview_session(request, payload)
    except ReportPreviewSessionError as error:
        return _json_error(
            str(error),
            status=error.status,
            details=error.details,
        )

    return JsonResponse(
        {
            "ok": True,
            **preview,
        },
        json_dumps_params={"ensure_ascii": False},
    )
