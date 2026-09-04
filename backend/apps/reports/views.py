import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from apps.billing.models import PortalAccess
from apps.reports.models import PortalReportSettings
from apps.reports.services.exceptions import ReportPreviewSessionError
from apps.reports.services.portal_employees import load_portal_employees
from apps.reports.services.report_catalog import build_report_catalog
from apps.reports.services.report_context import resolve_portal
from apps.reports.services.report_sessions import (
    create_report_preview_session,
    get_report_preview_session_status,
)


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


def _check_pro_access(portal) -> tuple[bool, str | None]:
    """
    Проверяет, имеет ли портал PRO-доступ.

    Возвращает (has_pro, error_message).
    Если has_pro=False, error_message содержит причину.
    """
    try:
        access = PortalAccess.objects.get(portal=portal)
    except PortalAccess.DoesNotExist:
        return False, "Портал не имеет PRO-доступа."

    if not access.is_pro_valid:
        return False, "PRO-доступ портала истёк или недоступен."

    return True, None


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


@require_GET
def report_employees_view(request):
    try:
        portal = resolve_portal(request, request.GET.dict())
    except ReportPreviewSessionError:
        return _json_error("Не удалось подтвердить доступ к порталу.", status=403)

    employees = load_portal_employees(portal)

    return JsonResponse(
        {
            "ok": True,
            "employees": employees,
        },
        json_dumps_params={"ensure_ascii": False},
    )


@require_GET
def report_preview_status_view(request, session_key: str):
    try:
        preview = get_report_preview_session_status(request, session_key)
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


@require_GET
def report_settings_load_view(request):
    """
    GET /api/reports/settings/

    Загружает сохранённые настройки отчёта для портала.

    Работает только для PRO-порталов.
    Для FREE возвращает 403.
    Если настройки ещё не сохранены, возвращает пустой объект.
    """
    try:
        portal = resolve_portal(request, request.GET.dict())
    except ReportPreviewSessionError as error:
        return _json_error(str(error), status=403)

    has_pro, error_message = _check_pro_access(portal)

    if not has_pro:
        return _json_error(error_message or "PRO-доступ не найден.", status=403)

    try:
        settings_record = PortalReportSettings.objects.get(portal=portal)
    except PortalReportSettings.DoesNotExist:
        return JsonResponse(
            {
                "ok": True,
                "settings": {},
                "savedViews": [],
                "appSettings": {},
                "detailColumnWidths": {},
            },
            json_dumps_params={"ensure_ascii": False},
        )

    return JsonResponse(
        {
            "ok": True,
            "settings": settings_record.settings,
            "savedViews": settings_record.saved_views,
            "appSettings": settings_record.app_settings,
            "detailColumnWidths": settings_record.detail_column_widths,
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_POST
def report_settings_save_view(request):
    """
    POST /api/reports/settings/

    Сохраняет настройки отчёта для портала.

    Работает только для PRO-порталов.
    Для FREE возвращает 403.
    """
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    try:
        portal = resolve_portal(request, payload)
    except ReportPreviewSessionError as error:
        return _json_error(str(error), status=403)

    has_pro, error_message = _check_pro_access(portal)

    if not has_pro:
        return _json_error(error_message or "PRO-доступ не найден.", status=403)

    settings = payload.get("settings", {})
    saved_views = payload.get("savedViews", [])
    app_settings = payload.get("appSettings", {})
    detail_column_widths = payload.get("detailColumnWidths", {})

    if not isinstance(settings, dict):
        return _json_error("Поле 'settings' должно быть объектом JSON.")

    if not isinstance(saved_views, list):
        return _json_error("Поле 'savedViews' должно быть списком.")

    if not isinstance(app_settings, dict):
        return _json_error("Поле 'appSettings' должно быть объектом JSON.")

    if not isinstance(detail_column_widths, dict):
        return _json_error("Поле 'detailColumnWidths' должно быть объектом JSON.")

    from django.utils import timezone

    settings_record, created = PortalReportSettings.objects.update_or_create(
        portal=portal,
        defaults={
            "settings": settings,
            "saved_views": saved_views,
            "app_settings": app_settings,
            "detail_column_widths": detail_column_widths,
            "last_saved_at": timezone.now(),
        },
    )

    from apps.dashboard.services.refresh import sync_portal_refresh_interval

    interval_value = app_settings.get("dashboardRefreshIntervalMinutes")
    if interval_value not in (None, ""):
        sync_portal_refresh_interval(portal, interval_value)

    return JsonResponse(
        {
            "ok": True,
            "created": created,
            "lastSavedAt": settings_record.last_saved_at.isoformat(),
        },
        json_dumps_params={"ensure_ascii": False},
    )
