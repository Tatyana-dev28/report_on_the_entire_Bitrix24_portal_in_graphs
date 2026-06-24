from __future__ import annotations

from apps.reports.models import ReportBuild, ReportSession
from apps.reports.services.builders import ReportBuildContext, ReportBuilder
from apps.reports.services.cache_repository import ReportCacheRepository
from apps.reports.services.exceptions import ReportPreviewSessionError
from apps.reports.services.filters import normalize_report_filters
from apps.reports.services.report_context import resolve_portal, resolve_user


def create_report_preview_session(request, payload: dict) -> dict:
    filters = normalize_report_filters(payload)
    portal = resolve_portal(request, payload)
    user, bitrix_user_id, user_name = resolve_user(portal, request, payload)

    return ReportBuilder().build_preview(
        filters=filters,
        context=ReportBuildContext(
            portal=portal,
            user=user,
            bitrix_user_id=bitrix_user_id,
            user_name=user_name,
        ),
    )


def get_report_preview_session_status(request, session_key: str) -> dict:
    portal = resolve_portal(request, request.GET.dict())

    try:
        session = ReportSession.objects.get(
            portal=portal,
            session_key=session_key,
        )
    except ReportSession.DoesNotExist as error:
        raise ReportPreviewSessionError(
            "Сессия отчета не найдена.",
            status=404,
            details={"sessionKey": session_key},
        ) from error

    build = session.builds.order_by("-created_at").first()

    if session.cache_key:
        cached_payload = ReportCacheRepository().get_result(session.cache_key)

        if cached_payload:
            return {
                "status": "ready",
                "sessionKey": str(session.session_key),
                "filtersHash": session.filters_hash,
                "cacheTtlSeconds": session.cache_ttl_seconds,
                "expiresAt": session.expires_at.isoformat() if session.expires_at else None,
                "filters": session.state_snapshot,
                "data": cached_payload.get("data", []),
                "employees": cached_payload.get("employees", []),
                "details": cached_payload.get("details", []),
                "metadata": cached_payload.get("metadata", {}),
                "message": (cached_payload.get("meta") or {}).get("message", ""),
            }

    if session.status == ReportSession.Status.ERROR or (
        build and build.status == ReportBuild.Status.FAILED
    ):
        return {
            "status": "failed",
            "sessionKey": str(session.session_key),
            "filtersHash": session.filters_hash,
            "cacheTtlSeconds": session.cache_ttl_seconds,
            "expiresAt": session.expires_at.isoformat() if session.expires_at else None,
            "filters": session.state_snapshot,
            "data": [],
            "employees": [],
            "details": [],
            "metadata": session.metadata or {},
            "message": session.error_message or (build.error_message if build else "") or "Не удалось построить отчет.",
        }

    build_status = build.status if build else ReportBuild.Status.PENDING
    status = "running" if build_status == ReportBuild.Status.RUNNING else "queued"

    return {
        "status": status,
        "sessionKey": str(session.session_key),
        "filtersHash": session.filters_hash,
        "cacheTtlSeconds": session.cache_ttl_seconds,
        "expiresAt": session.expires_at.isoformat() if session.expires_at else None,
        "filters": session.state_snapshot,
        "data": [],
        "employees": [],
        "details": [],
        "metadata": session.metadata or {},
        "message": "Отчет строится. Данные появятся автоматически после завершения.",
    }
