import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from apps.dashboard.constants import (
    ALLOWED_REFRESH_INTERVAL_MINUTES,
    DASHBOARD_ACCESS_COOKIE_NAME,
    DASHBOARD_TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS,
    DEFAULT_REFRESH_INTERVAL_MINUTES,
    REFRESH_RUN_RETENTION_DAYS,
    SUCCESSFUL_SNAPSHOT_LIMIT,
)
from apps.dashboard.services.access_sessions import (
    create_dashboard_access_session,
    end_dashboard_access_session,
    get_dashboard_access_session,
    revoke_portal_dashboard_access_sessions,
)
from apps.dashboard.models import DashboardAccessSession, DashboardPreparedSnapshot
from apps.reports.services.exceptions import ReportPreviewSessionError
from apps.reports.services.report_catalog import build_report_catalog
from apps.reports.services.report_context import resolve_portal, resolve_user


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


def _client_ip(request) -> str | None:
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip() or None

    return request.META.get("REMOTE_ADDR") or None


def _resolve_owner_context(request, payload: dict):
    try:
        portal = resolve_portal(request, payload)
        user, bitrix_user_id, user_name = resolve_user(portal, request, payload)
    except ReportPreviewSessionError as error:
        raise ReportPreviewSessionError(
            "Не удалось подтвердить владельца WEB-дашборда. Откройте дашборд по личной ссылке владельца.",
            status=403,
            details=error.details,
        ) from error

    return portal, user, bitrix_user_id, user_name


def _resolve_access_session(request) -> tuple[DashboardAccessSession | None, JsonResponse | None]:
    session = get_dashboard_access_session(request.COOKIES.get(DASHBOARD_ACCESS_COOKIE_NAME, ""))

    if not session:
        return None, _json_error("Вход в WEB-дашборд не подтверждён.", status=401)

    return session, None


def _get_current_snapshot(portal):
    return (
        DashboardPreparedSnapshot.objects.filter(portal=portal, is_current=True)
        .order_by("-prepared_at")
        .first()
        or DashboardPreparedSnapshot.objects.filter(portal=portal)
        .order_by("-prepared_at")
        .first()
    )


def _saved_reports_from_snapshot(snapshot: DashboardPreparedSnapshot | None) -> list[dict]:
    saved_views = snapshot.saved_views_snapshot if snapshot else []

    if not isinstance(saved_views, list):
        return []

    reports = []

    for index, view in enumerate(saved_views):
        if not isinstance(view, dict):
            continue

        report_id = str(view.get("value") or view.get("id") or view.get("stateKey") or "")
        name = str(view.get("label") or view.get("name") or "").strip()

        if not report_id or not name:
            continue

        reports.append(
            {
                "id": report_id,
                "name": name,
                "isDefault": bool(view.get("isDefault") or view.get("isSystem") or index == 0),
            }
        )

    return reports


def _snapshot_catalog(snapshot: DashboardPreparedSnapshot | None, portal) -> dict:
    data = snapshot.data if snapshot and isinstance(snapshot.data, dict) else {}
    catalog = data.get("catalog")

    if isinstance(catalog, dict):
        return {
            "periods": catalog.get("periods") if isinstance(catalog.get("periods"), list) else [],
            "sources": catalog.get("sources") if isinstance(catalog.get("sources"), list) else [],
            "metricSections": catalog.get("metricSections") if isinstance(catalog.get("metricSections"), list) else [],
            "metrics": catalog.get("metrics") if isinstance(catalog.get("metrics"), list) else [],
        }

    return build_report_catalog(portal)


def _snapshot_preview(snapshot: DashboardPreparedSnapshot | None) -> dict:
    data = snapshot.data if snapshot and isinstance(snapshot.data, dict) else {}
    preview = data.get("preview") if isinstance(data.get("preview"), dict) else data
    data_points = preview.get("data") if isinstance(preview.get("data"), list) else []
    source_metrics = preview.get("source_metrics") if isinstance(preview.get("source_metrics"), dict) else {}

    return {
        "status": "ready" if snapshot else "empty",
        "data": data_points,
        "chart_data": preview.get("chart_data") if isinstance(preview.get("chart_data"), list) else data_points,
        "employees": preview.get("employees") if isinstance(preview.get("employees"), list) else [],
        "details": preview.get("details") if isinstance(preview.get("details"), list) else [],
        "source_metrics": source_metrics,
        "chart_source_metrics": (
            preview.get("chart_source_metrics")
            if isinstance(preview.get("chart_source_metrics"), dict)
            else source_metrics
        ),
        "metadata": preview.get("metadata") if isinstance(preview.get("metadata"), dict) else {},
    }


@require_GET
def owner_dashboard_bootstrap_view(request):
    """
    Initial contract for the external owner WEB-dashboard.

    The final owner verification flow is intentionally not implemented here:
    OQ-5 from the PRO dashboard spec must be approved first.
    """

    session = get_dashboard_access_session(request.COOKIES.get(DASHBOARD_ACCESS_COOKIE_NAME, ""))

    if session:
        snapshot = _get_current_snapshot(session.portal)
        reports = _saved_reports_from_snapshot(snapshot)

        return JsonResponse(
            {
                "ok": True,
                "access": "authorized",
                "portal": {
                    "domain": session.portal.domain,
                    "memberId": session.portal.member_id,
                },
                "reports": reports,
                "selectedReportId": reports[0]["id"] if reports else None,
                "refreshStatus": None,
                "refreshPolicy": {
                    "defaultIntervalMinutes": DEFAULT_REFRESH_INTERVAL_MINUTES,
                    "allowedIntervalMinutes": list(ALLOWED_REFRESH_INTERVAL_MINUTES),
                    "refreshRunRetentionDays": REFRESH_RUN_RETENTION_DAYS,
                    "successfulSnapshotLimit": SUCCESSFUL_SNAPSHOT_LIMIT,
                    "shareLinksMode": "view_only",
                },
            },
            json_dumps_params={"ensure_ascii": False},
        )

    return JsonResponse(
        {
            "ok": True,
            "access": "needs_confirmation",
            "portal": None,
            "reports": [],
            "selectedReportId": None,
            "refreshStatus": None,
            "refreshPolicy": {
                "defaultIntervalMinutes": DEFAULT_REFRESH_INTERVAL_MINUTES,
                "allowedIntervalMinutes": list(ALLOWED_REFRESH_INTERVAL_MINUTES),
                "refreshRunRetentionDays": REFRESH_RUN_RETENTION_DAYS,
                "successfulSnapshotLimit": SUCCESSFUL_SNAPSHOT_LIMIT,
                "shareLinksMode": "view_only",
            },
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_POST
def owner_access_confirm_view(request):
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    try:
        portal, user, bitrix_user_id, user_name = _resolve_owner_context(request, payload)
    except ReportPreviewSessionError as error:
        return _json_error(str(error), status=error.status, details=error.details)

    is_trusted_device = bool(payload.get("trusted"))
    session, raw_token = create_dashboard_access_session(
        portal=portal,
        user=user,
        bitrix_user_id=bitrix_user_id,
        user_name=user_name,
        is_trusted_device=is_trusted_device,
        user_agent=request.META.get("HTTP_USER_AGENT", ""),
        ip_address=_client_ip(request),
    )

    response = JsonResponse(
        {
            "ok": True,
            "access": "authorized",
            "session": {
                "id": str(session.public_id),
                "trusted": session.is_trusted_device,
                "fingerprint": session.session_key_fingerprint,
            },
        },
        json_dumps_params={"ensure_ascii": False},
    )
    cookie_kwargs = {
        "httponly": True,
        "secure": request.is_secure(),
        "samesite": "Lax",
        "path": "/api/dashboard/",
    }
    if is_trusted_device:
        cookie_kwargs["max_age"] = DASHBOARD_TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS

    response.set_cookie(DASHBOARD_ACCESS_COOKIE_NAME, raw_token, **cookie_kwargs)

    return response


@require_GET
def owner_catalog_view(request):
    session, error_response = _resolve_access_session(request)

    if error_response:
        return error_response

    snapshot = _get_current_snapshot(session.portal)

    return JsonResponse(
        {
            "ok": True,
            **_snapshot_catalog(snapshot, session.portal),
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_POST
def owner_preview_view(request):
    session, error_response = _resolve_access_session(request)

    if error_response:
        return error_response

    snapshot = _get_current_snapshot(session.portal)

    return JsonResponse(
        {
            "ok": True,
            **_snapshot_preview(snapshot),
        },
        json_dumps_params={"ensure_ascii": False},
    )


@require_GET
def owner_employees_view(request):
    session, error_response = _resolve_access_session(request)

    if error_response:
        return error_response

    snapshot = _get_current_snapshot(session.portal)
    preview = _snapshot_preview(snapshot)

    return JsonResponse(
        {
            "ok": True,
            "employees": preview["employees"],
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_POST
def owner_access_end_view(request):
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    raw_token = str(
        payload.get("sessionToken")
        or payload.get("session_token")
        or request.COOKIES.get(DASHBOARD_ACCESS_COOKIE_NAME)
        or ""
    )
    session = end_dashboard_access_session(raw_token)

    response = JsonResponse(
        {
            "ok": True,
            "ended": bool(session),
        },
        json_dumps_params={"ensure_ascii": False},
    )
    response.delete_cookie(DASHBOARD_ACCESS_COOKIE_NAME, path="/api/dashboard/", samesite="Lax")

    return response


@csrf_exempt
@require_POST
def owner_access_revoke_all_view(request):
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    try:
        portal, _user, bitrix_user_id, _user_name = _resolve_owner_context(request, payload)
    except ReportPreviewSessionError as error:
        return _json_error(str(error), status=error.status, details=error.details)

    revoked_count = revoke_portal_dashboard_access_sessions(
        portal=portal,
        bitrix_user_id=str(payload.get("bitrixUserId") or payload.get("bitrix_user_id") or bitrix_user_id),
    )

    response = JsonResponse(
        {
            "ok": True,
            "revokedCount": revoked_count,
        },
        json_dumps_params={"ensure_ascii": False},
    )
    response.delete_cookie(DASHBOARD_ACCESS_COOKIE_NAME, path="/api/dashboard/", samesite="Lax")

    return response
