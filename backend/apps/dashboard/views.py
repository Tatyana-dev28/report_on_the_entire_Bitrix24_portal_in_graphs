import json
import logging
import math
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

from django.http import JsonResponse
from django.db import transaction
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from apps.billing.models import PortalAccess
from urllib.parse import urlparse

from apps.dashboard.constants import (
    ALLOWED_REFRESH_INTERVAL_MINUTES,
    DASHBOARD_ACCESS_COOKIE_NAME,
    DASHBOARD_LAUNCH_TOKEN_MAX_AGE_SECONDS,
    DASHBOARD_SHARE_COOKIE_NAME,
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
from apps.dashboard.services.launch_tokens import (
    consume_dashboard_launch_token,
    create_dashboard_launch_token,
)
from apps.dashboard.models import DashboardAccessSession, DashboardPreparedSnapshot, DashboardShareLink
from apps.dashboard.models import DashboardRefreshRun
from apps.dashboard.services.share_links import (
    DashboardShareError,
    create_dashboard_share_link,
    disable_dashboard_share_link,
    get_dashboard_share_link,
    serialize_share_link,
)
from apps.reports.services.exceptions import ReportPreviewSessionError
from apps.reports.services.report_catalog import build_report_catalog
from apps.reports.services.report_context import resolve_portal, resolve_user
from apps.dashboard.services.refresh import (
    DashboardRefreshError,
    build_refresh_status,
    get_current_snapshot,
    request_portal_refresh,
    sync_portal_refresh_interval,
)
from apps.dashboard.services.retention import prune_dashboard_history


logger = logging.getLogger(__name__)


def _json_ready(value):
    if value is None or isinstance(value, bool):
        return value

    if isinstance(value, str):
        return value.encode("utf-8", "replace").decode("utf-8")

    if isinstance(value, int) and not isinstance(value, bool):
        return value

    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value

    if isinstance(value, Decimal):
        return float(value)

    if isinstance(value, (datetime, date, time)):
        return value.isoformat()

    if isinstance(value, UUID):
        return str(value)

    if isinstance(value, dict):
        return {str(key): _json_ready(item) for key, item in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [_json_ready(item) for item in value]

    return str(value).encode("utf-8", "replace").decode("utf-8")


def _empty_bootstrap_payload(*, access: str, portal=None) -> dict:
    return {
        "ok": True,
        "access": access,
        "portal": (
            {
                "domain": portal.domain,
                "memberId": portal.member_id,
            }
            if portal
            else None
        ),
        "reports": [],
        "selectedReportId": None,
        "savedViews": [],
        "settings": {},
        "appSettings": {
            "dashboardRefreshIntervalMinutes": DEFAULT_REFRESH_INTERVAL_MINUTES,
        },
        "refreshStatus": None,
        "hasPreparedData": False,
        "refreshPolicy": {
            "defaultIntervalMinutes": DEFAULT_REFRESH_INTERVAL_MINUTES,
            "allowedIntervalMinutes": list(ALLOWED_REFRESH_INTERVAL_MINUTES),
            "refreshRunRetentionDays": REFRESH_RUN_RETENTION_DAYS,
            "successfulSnapshotLimit": SUCCESSFUL_SNAPSHOT_LIMIT,
            "shareLinksMode": "view_only",
        },
        "confirmationMethod": "bitrix_launch_link",
        "viewerMode": "owner" if access == "authorized" else "none",
    }


def _dashboard_json_response(payload: dict, status: int = 200) -> JsonResponse:
    return JsonResponse(
        _json_ready(payload),
        status=status,
        json_dumps_params={"ensure_ascii": False},
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


def _client_ip(request) -> str | None:
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip() or None

    return request.META.get("REMOTE_ADDR") or None


def _access_cookie_kwargs(request, is_trusted_device: bool) -> dict:
    origin = request.headers.get("Origin", "")
    request_host = (request.get_host() or "").split(":", 1)[0]
    origin_host = urlparse(origin).hostname if origin else None
    cross_site = bool(origin_host and origin_host != request_host)
    same_site = "None" if cross_site and request.is_secure() else "Lax"
    cookie_kwargs = {
        "httponly": True,
        "secure": request.is_secure() or same_site == "None",
        "samesite": same_site,
        "path": "/api/dashboard/",
    }

    if is_trusted_device:
        cookie_kwargs["max_age"] = DASHBOARD_TRUSTED_DEVICE_COOKIE_MAX_AGE_SECONDS

    return cookie_kwargs


def _flatten_settings_snapshot(settings) -> dict:
    if not isinstance(settings, dict):
        return {}

    if isinstance(settings.get("period"), str):
        return settings

    applied = settings.get("appliedFilters") if isinstance(settings.get("appliedFilters"), dict) else {}
    draft = settings.get("draftFilters") if isinstance(settings.get("draftFilters"), dict) else {}
    filters = settings.get("filters") if isinstance(settings.get("filters"), dict) else {}
    flattened = {
        **draft,
        **applied,
        **filters,
    }

    if isinstance(applied.get("selectedSources"), list):
        flattened["selectedSources"] = applied["selectedSources"]
    if isinstance(filters.get("chartSelectedSources"), list):
        flattened["chartSelectedSources"] = filters["chartSelectedSources"]
    elif isinstance(applied.get("selectedSources"), list):
        flattened["chartSelectedSources"] = applied["selectedSources"]

    for key in (
        "tableSelectedSources",
        "enabledMetricIdsBySection",
        "sectionOrder",
        "metricOrderBySection",
        "sourceSectionOrder",
        "sourceMetricOrderBySource",
        "enabledMetricKeysBySource",
        "expandedSections",
        "mainThreshold",
        "rowThresholds",
        "employeeThresholdsByMetricId",
        "metricDirectionsById",
    ):
        if key in settings and settings.get(key) is not None:
            flattened[key] = settings.get(key)

    return flattened


def _bootstrap_payload(*, access: str, portal=None, snapshot: DashboardPreparedSnapshot | None = None) -> dict:
    reports = _saved_reports_from_snapshot(snapshot)
    selected_report_id = None

    if snapshot and isinstance(snapshot.saved_views_snapshot, list):
        for view in snapshot.saved_views_snapshot:
            if isinstance(view, dict) and view.get("isDefault"):
                selected_report_id = str(view.get("value") or view.get("id") or "")
                break

    if not selected_report_id and reports:
        selected_report_id = reports[0]["id"]

    try:
        refresh_status = build_refresh_status(portal) if portal else None
    except Exception:
        logger.exception("Dashboard refresh status failed")
        refresh_status = None

    try:
        has_prepared = bool(snapshot and int(snapshot.payload_size_bytes or 0) > 0)
    except Exception:
        has_prepared = False

    return {
        "ok": True,
        "access": access,
        "portal": (
            {
                "domain": portal.domain,
                "memberId": portal.member_id,
            }
            if portal
            else None
        ),
        "reports": reports,
        "selectedReportId": selected_report_id,
        "savedViews": snapshot.saved_views_snapshot if snapshot and isinstance(snapshot.saved_views_snapshot, list) else [],
        "settings": _flatten_settings_snapshot(snapshot.settings_snapshot if snapshot else {}),
        "appSettings": {
            "dashboardRefreshIntervalMinutes": (
                snapshot.refresh_interval_minutes
                if snapshot
                else DEFAULT_REFRESH_INTERVAL_MINUTES
            ),
        },
        "refreshStatus": refresh_status,
        "hasPreparedData": has_prepared,
        "refreshPolicy": {
            "defaultIntervalMinutes": DEFAULT_REFRESH_INTERVAL_MINUTES,
            "allowedIntervalMinutes": list(ALLOWED_REFRESH_INTERVAL_MINUTES),
            "refreshRunRetentionDays": REFRESH_RUN_RETENTION_DAYS,
            "successfulSnapshotLimit": SUCCESSFUL_SNAPSHOT_LIMIT,
            "shareLinksMode": "view_only",
        },
        "confirmationMethod": "bitrix_launch_link",
        "viewerMode": "owner" if access == "authorized" else "none",
    }


def _saved_view_by_id(snapshot: DashboardPreparedSnapshot | None, report_id: str) -> dict | None:
    if not snapshot or not isinstance(snapshot.saved_views_snapshot, list):
        return None

    for view in snapshot.saved_views_snapshot:
        if not isinstance(view, dict):
            continue

        view_id = str(view.get("value") or view.get("id") or view.get("stateKey") or "")
        if view_id == str(report_id):
            return view

    return None


def _share_bootstrap_payload(link: DashboardShareLink, snapshot: DashboardPreparedSnapshot | None) -> dict:
    view = _saved_view_by_id(snapshot, link.report_id)

    if not view:
        raise DashboardShareError(
            "Сохранённый отчёт по этой ссылке больше недоступен.",
            status=404,
        )

    view_state = view.get("state") if isinstance(view.get("state"), dict) else {}
    settings = _flatten_settings_snapshot(view_state) or _flatten_settings_snapshot(
        snapshot.settings_snapshot if snapshot else {},
    )
    report_name = str(view.get("label") or view.get("name") or link.report_name)

    return {
        "ok": True,
        "access": "share",
        "viewerMode": "share",
        "portal": {
            "domain": link.portal.domain,
            "memberId": link.portal.member_id,
        },
        "reports": [
            {
                "id": link.report_id,
                "name": report_name,
                "isDefault": True,
            }
        ],
        "selectedReportId": link.report_id,
        "savedViews": [view],
        "settings": settings,
        "appSettings": {
            "dashboardRefreshIntervalMinutes": (
                snapshot.refresh_interval_minutes
                if snapshot
                else DEFAULT_REFRESH_INTERVAL_MINUTES
            ),
        },
        "refreshStatus": build_refresh_status(link.portal),
        "refreshPolicy": {
            "defaultIntervalMinutes": DEFAULT_REFRESH_INTERVAL_MINUTES,
            "allowedIntervalMinutes": list(ALLOWED_REFRESH_INTERVAL_MINUTES),
            "refreshRunRetentionDays": REFRESH_RUN_RETENTION_DAYS,
            "successfulSnapshotLimit": SUCCESSFUL_SNAPSHOT_LIMIT,
            "shareLinksMode": "view_only",
        },
        "share": serialize_share_link(link),
        "confirmationMethod": "share_link",
    }


def _resolve_owner_actor(request, payload: dict | None = None):
    session = get_dashboard_access_session(request.COOKIES.get(DASHBOARD_ACCESS_COOKIE_NAME, ""))

    if session:
        return session.portal, session.user, session.bitrix_user_id, session.user_name

    return _resolve_owner_context(request, payload or {})


def _resolve_share_link(request, payload: dict | None = None) -> tuple[DashboardShareLink | None, JsonResponse | None]:
    raw_token = str(
        (payload or {}).get("shareToken")
        or (payload or {}).get("share_token")
        or request.GET.get("shareToken")
        or request.COOKIES.get(DASHBOARD_SHARE_COOKIE_NAME)
        or ""
    ).strip()

    try:
        return get_dashboard_share_link(raw_token), None
    except DashboardShareError as error:
        return None, _json_error(str(error), status=error.status)


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


def _check_pro_access(portal) -> tuple[bool, str | None]:
    try:
        access = PortalAccess.objects.get(portal=portal)
    except PortalAccess.DoesNotExist:
        return False, "Портал не имеет PRO-доступа."

    if not access.is_pro_valid:
        return False, "PRO-доступ портала истёк или недоступен."

    return True, None


def _resolve_access_session(request) -> tuple[DashboardAccessSession | None, JsonResponse | None]:
    session = get_dashboard_access_session(request.COOKIES.get(DASHBOARD_ACCESS_COOKIE_NAME, ""))

    if not session:
        return None, _json_error("Вход в WEB-дашборд не подтверждён.", status=401)

    return session, None


def _get_current_snapshot(portal, *, load_data: bool = True):
    return get_current_snapshot(portal, load_data=load_data)


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


def _snapshot_has_prepared_data(snapshot: DashboardPreparedSnapshot | None) -> bool:
    preview = _snapshot_preview(snapshot)
    return bool(preview["data"] or preview["source_metrics"] or preview["employees"])


def _safe_has_prepared_data(snapshot: DashboardPreparedSnapshot | None) -> bool:
    try:
        return _snapshot_has_prepared_data(snapshot)
    except Exception:
        logger.exception("Failed to detect prepared dashboard data")
        return False


def _safe_refresh_interval(value) -> int:
    try:
        interval = int(value)
    except (TypeError, ValueError):
        return DEFAULT_REFRESH_INTERVAL_MINUTES

    if interval in ALLOWED_REFRESH_INTERVAL_MINUTES:
        return interval

    return DEFAULT_REFRESH_INTERVAL_MINUTES


@require_GET
def owner_dashboard_bootstrap_view(request):
    session = None
    try:
        session = get_dashboard_access_session(request.COOKIES.get(DASHBOARD_ACCESS_COOKIE_NAME, ""))
    except Exception:
        logger.exception("Dashboard access session lookup failed")

    if session:
        try:
            snapshot = _get_current_snapshot(session.portal, load_data=False)
            return _dashboard_json_response(
                _bootstrap_payload(access="authorized", portal=session.portal, snapshot=snapshot),
            )
        except Exception:
            logger.exception("Dashboard authorized bootstrap failed; returning a slim payload")
            try:
                return _dashboard_json_response(
                    _empty_bootstrap_payload(access="authorized", portal=session.portal),
                )
            except Exception:
                logger.exception("Dashboard slim authorized bootstrap failed")

    try:
        return _dashboard_json_response(_bootstrap_payload(access="needs_confirmation"))
    except Exception:
        logger.exception("Dashboard confirmation bootstrap failed")
        return JsonResponse(_empty_bootstrap_payload(access="needs_confirmation"))


@csrf_exempt
@require_POST
def owner_launch_link_view(request):
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    try:
        portal, user, bitrix_user_id, user_name = _resolve_owner_context(request, payload)
    except ReportPreviewSessionError as error:
        return _json_error(str(error), status=error.status, details=error.details)

    has_pro, error_message = _check_pro_access(portal)

    if not has_pro:
        return _json_error(error_message or "PRO-доступ не найден.", status=403)

    _token, raw_token = create_dashboard_launch_token(
        portal=portal,
        user=user,
        bitrix_user_id=bitrix_user_id,
        user_name=user_name,
    )

    return JsonResponse(
        {
            "ok": True,
            "launchToken": raw_token,
            "expiresInSeconds": DASHBOARD_LAUNCH_TOKEN_MAX_AGE_SECONDS,
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_POST
def owner_access_confirm_view(request):
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    launch_token = str(payload.get("launchToken") or payload.get("launch_token") or "").strip()

    try:
        if launch_token:
            token = consume_dashboard_launch_token(launch_token)
            portal, user, bitrix_user_id, user_name = (
                token.portal,
                token.user,
                token.bitrix_user_id,
                token.user_name,
            )
        else:
            portal, user, bitrix_user_id, user_name = _resolve_owner_context(request, payload)

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
    except ReportPreviewSessionError as error:
        return _json_error(str(error), status=error.status, details=error.details)
    except Exception:
        logger.exception("Dashboard access confirm failed")
        return _json_error(
            "Не удалось подтвердить вход в WEB-дашборд. Откройте его заново из приложения Битрикс24.",
            status=503,
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
    response.set_cookie(
        DASHBOARD_ACCESS_COOKIE_NAME,
        raw_token,
        **_access_cookie_kwargs(request, is_trusted_device),
    )

    return response


@require_GET
def owner_catalog_view(request):
    session, error_response = _resolve_access_session(request)

    if error_response:
        return error_response

    snapshot = _get_current_snapshot(session.portal)

    try:
        catalog = _snapshot_catalog(snapshot, session.portal)
    except Exception:
        logger.exception("Dashboard catalog failed for portal %s", session.portal_id)
        catalog = _snapshot_catalog(snapshot, None)

    return JsonResponse(
        {
            "ok": True,
            **catalog,
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

    try:
        preview = _snapshot_preview(snapshot)
    except Exception:
        logger.exception("Dashboard preview failed for portal %s", session.portal_id)
        preview = {
            "status": "empty",
            "data": [],
            "chart_data": [],
            "employees": [],
            "details": [],
            "source_metrics": {},
            "chart_source_metrics": {},
            "metadata": {},
        }

    return JsonResponse(
        {
            "ok": True,
            **preview,
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_POST
def owner_snapshot_save_view(request):
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    try:
        portal, user, bitrix_user_id, _user_name = _resolve_owner_context(request, payload)
    except ReportPreviewSessionError as error:
        return _json_error(str(error), status=error.status, details=error.details)

    has_pro, error_message = _check_pro_access(portal)

    if not has_pro:
        return _json_error(error_message or "PRO-доступ не найден.", status=403)

    settings = payload.get("settings", {})
    saved_views = payload.get("savedViews", [])
    data = payload.get("data", {})
    metadata = payload.get("metadata", {})

    if not isinstance(settings, dict):
        return _json_error("Поле 'settings' должно быть объектом JSON.")

    if not isinstance(saved_views, list):
        return _json_error("Поле 'savedViews' должно быть списком.")

    if not isinstance(data, dict):
        return _json_error("Поле 'data' должно быть объектом JSON.")

    if not isinstance(metadata, dict):
        return _json_error("Поле 'metadata' должно быть объектом JSON.")

    refresh_interval = _safe_refresh_interval(payload.get("refreshIntervalMinutes"))
    payload_size = len(json.dumps(data, ensure_ascii=False, default=str).encode("utf-8"))

    with transaction.atomic():
        DashboardPreparedSnapshot.objects.filter(
            portal=portal,
            is_current=True,
        ).update(is_current=False)
        snapshot = DashboardPreparedSnapshot.objects.create(
            portal=portal,
            prepared_at=timezone.now(),
            is_current=True,
            refresh_interval_minutes=refresh_interval,
            settings_snapshot=settings,
            saved_views_snapshot=saved_views,
            data=data,
            metadata=metadata,
            payload_size_bytes=payload_size,
        )
        DashboardRefreshRun.objects.create(
            portal=portal,
            snapshot=snapshot,
            trigger_type=DashboardRefreshRun.TriggerType.MANUAL,
            status=DashboardRefreshRun.Status.SUCCESS,
            refresh_interval_minutes=refresh_interval,
            requested_by_bitrix_user_id=str(bitrix_user_id),
            started_at=snapshot.prepared_at,
            finished_at=snapshot.prepared_at,
            next_planned_at=snapshot.prepared_at + timedelta(minutes=refresh_interval),
            metadata={
                "source": "bitrix_app_report_build",
                "snapshotPublicId": str(snapshot.public_id),
                "requestedByUserId": str(user.public_id) if user else "",
            },
        )

    prune_dashboard_history(portal=portal)

    return JsonResponse(
        {
            "ok": True,
            "snapshot": {
                "id": str(snapshot.public_id),
                "preparedAt": snapshot.prepared_at.isoformat(),
                "refreshIntervalMinutes": snapshot.refresh_interval_minutes,
                "payloadSizeBytes": snapshot.payload_size_bytes,
            },
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
def owner_refresh_view(request):
    session, error_response = _resolve_access_session(request)

    if error_response:
        return error_response

    payload, payload_error = _parse_json_body(request)

    if payload_error:
        return payload_error

    settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else None
    saved_views = payload.get("savedViews") if isinstance(payload.get("savedViews"), list) else None

    try:
        run, accepted = request_portal_refresh(
            portal=session.portal,
            trigger_type=DashboardRefreshRun.TriggerType.MANUAL,
            bitrix_user_id=session.bitrix_user_id,
            settings=settings,
            saved_views=saved_views,
        )
    except DashboardRefreshError as error:
        return _json_error(str(error), status=error.status)
    except Exception:
        logger.exception("Dashboard owner refresh failed for portal %s", session.portal_id)
        return _json_error("Не удалось запустить обновление данных.", status=503)

    return JsonResponse(
        {
            "ok": True,
            "accepted": accepted,
            "refreshStatus": build_refresh_status(session.portal),
            "run": {
                "id": run.id,
                "status": run.status,
                "triggerType": run.trigger_type,
            },
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_POST
def owner_refresh_interval_view(request):
    session, error_response = _resolve_access_session(request)
    payload, payload_error = _parse_json_body(request)

    if error_response:
        return error_response

    if payload_error:
        return payload_error

    interval = sync_portal_refresh_interval(
        session.portal,
        payload.get("refreshIntervalMinutes") or payload.get("refresh_interval_minutes"),
    )

    return JsonResponse(
        {
            "ok": True,
            "refreshIntervalMinutes": interval,
            "refreshStatus": build_refresh_status(session.portal),
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


def _owner_share_links_list(request):
    try:
        portal, _user, _bitrix_user_id, _user_name = _resolve_owner_actor(request)
    except ReportPreviewSessionError as error:
        return _json_error(str(error), status=error.status, details=error.details)

    links = DashboardShareLink.objects.filter(portal=portal).order_by("-created_at")[:50]

    return JsonResponse(
        {
            "ok": True,
            "shareLinks": [serialize_share_link(link) for link in links],
        },
        json_dumps_params={"ensure_ascii": False},
    )


def _owner_share_links_create(request):
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    try:
        portal, _user, bitrix_user_id, _user_name = _resolve_owner_actor(request, payload)
    except ReportPreviewSessionError as error:
        return _json_error(str(error), status=error.status, details=error.details)

    has_pro, error_message = _check_pro_access(portal)

    if not has_pro:
        return _json_error(error_message or "PRO-доступ не найден.", status=403)

    snapshot = _get_current_snapshot(portal)
    report_id = str(payload.get("reportId") or payload.get("report_id") or "").strip()
    view = _saved_view_by_id(snapshot, report_id)
    report_name = str(
        (view or {}).get("label")
        or (view or {}).get("name")
        or payload.get("reportName")
        or payload.get("report_name")
        or ""
    ).strip()

    if not view:
        return _json_error("Сохранённый отчёт не найден. Сначала сохраните отображение отчёта.")

    try:
        link, raw_token = create_dashboard_share_link(
            portal=portal,
            report_id=report_id,
            report_name=report_name,
            expires_in_days=payload.get("expiresInDays", payload.get("expires_in_days")),
            created_by_bitrix_user_id=str(bitrix_user_id),
        )
    except DashboardShareError as error:
        return _json_error(str(error), status=error.status)

    return JsonResponse(
        {
            "ok": True,
            "shareLink": serialize_share_link(link, raw_token=raw_token),
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
def owner_share_links_view(request):
    if request.method == "GET":
        return _owner_share_links_list(request)

    if request.method == "POST":
        return _owner_share_links_create(request)

    return _json_error("Метод не поддерживается.", status=405)


@csrf_exempt
@require_POST
def owner_share_links_list_view(request):
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    try:
        portal, _user, _bitrix_user_id, _user_name = _resolve_owner_actor(request, payload)
    except ReportPreviewSessionError as error:
        return _json_error(str(error), status=error.status, details=error.details)

    links = DashboardShareLink.objects.filter(portal=portal).order_by("-created_at")[:50]

    return JsonResponse(
        {
            "ok": True,
            "shareLinks": [serialize_share_link(link) for link in links],
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_POST
def owner_share_link_disable_view(request):
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    try:
        portal, _user, _bitrix_user_id, _user_name = _resolve_owner_actor(request, payload)
    except ReportPreviewSessionError as error:
        return _json_error(str(error), status=error.status, details=error.details)

    try:
        link = disable_dashboard_share_link(
            portal=portal,
            public_id=str(payload.get("id") or payload.get("shareLinkId") or "").strip(),
        )
    except DashboardShareError as error:
        return _json_error(str(error), status=error.status)

    return JsonResponse(
        {
            "ok": True,
            "shareLink": serialize_share_link(link),
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_POST
def share_open_view(request):
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    raw_token = str(payload.get("shareToken") or payload.get("share_token") or "").strip()

    try:
        link = get_dashboard_share_link(raw_token)
        snapshot = _get_current_snapshot(link.portal)
        body = _share_bootstrap_payload(link, snapshot)
    except DashboardShareError as error:
        return _json_error(str(error), status=error.status)

    response = JsonResponse(body, json_dumps_params={"ensure_ascii": False})
    response.set_cookie(
        DASHBOARD_SHARE_COOKIE_NAME,
        raw_token,
        **_access_cookie_kwargs(request, False),
    )
    return response


@require_GET
def share_bootstrap_view(request):
    link, error_response = _resolve_share_link(request)

    if error_response:
        return error_response

    try:
        snapshot = _get_current_snapshot(link.portal)
        body = _share_bootstrap_payload(link, snapshot)
    except DashboardShareError as error:
        return _json_error(str(error), status=error.status)

    return JsonResponse(body, json_dumps_params={"ensure_ascii": False})


@require_GET
def share_catalog_view(request):
    link, error_response = _resolve_share_link(request)

    if error_response:
        return error_response

    snapshot = _get_current_snapshot(link.portal)

    return JsonResponse(
        {
            "ok": True,
            **_snapshot_catalog(snapshot, link.portal),
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_POST
def share_preview_view(request):
    link, error_response = _resolve_share_link(request)

    if error_response:
        return error_response

    snapshot = _get_current_snapshot(link.portal)

    return JsonResponse(
        {
            "ok": True,
            **_snapshot_preview(snapshot),
        },
        json_dumps_params={"ensure_ascii": False},
    )


@require_GET
def share_employees_view(request):
    link, error_response = _resolve_share_link(request)

    if error_response:
        return error_response

    snapshot = _get_current_snapshot(link.portal)
    preview = _snapshot_preview(snapshot)

    return JsonResponse(
        {
            "ok": True,
            "employees": preview["employees"],
        },
        json_dumps_params={"ensure_ascii": False},
    )
