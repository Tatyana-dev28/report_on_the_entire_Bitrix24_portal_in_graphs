from __future__ import annotations

from apps.reports.services.builders import ReportBuildContext, ReportBuilder
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
