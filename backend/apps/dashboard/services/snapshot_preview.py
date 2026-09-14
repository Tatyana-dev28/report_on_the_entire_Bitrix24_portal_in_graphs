from __future__ import annotations

import json
import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.billing.models import PortalAccess
from apps.dashboard.models import DashboardPreparedSnapshot
from apps.dashboard.services.retention import prune_dashboard_history
from apps.reports.services.exceptions import ReportPreviewSessionError
from apps.reports.services.filters import make_filters_hash, normalize_report_filters

logger = logging.getLogger(__name__)


def portal_has_pro(portal) -> bool:
    access = PortalAccess.objects.filter(portal=portal).first()
    return bool(access and access.is_pro_valid)


def preview_filters_from_settings(settings) -> dict | None:
    if not isinstance(settings, dict):
        return None

    from apps.dashboard.services.refresh import _flatten_settings

    raw_filters = settings.get("filters") if isinstance(settings.get("filters"), dict) else {}
    flat = _flatten_settings(settings)
    metric_ids = raw_filters.get("selectedMetricIds")
    if not metric_ids:
        enabled = (
            settings.get("enabledMetricIdsBySection")
            or flat.get("enabledMetricIdsBySection")
            or {}
        )
        collected: list[str] = []
        if isinstance(enabled, dict):
            for values in enabled.values():
                if isinstance(values, (list, tuple, set)):
                    collected.extend(str(item) for item in values if str(item).strip())
        metric_ids = collected or None

    payload = {
        "period": raw_filters.get("period") or flat.get("period"),
        "dateRange": raw_filters.get("dateRange") or flat.get("dateRange"),
        "selectedSources": (
            raw_filters.get("selectedSources")
            or flat.get("tableSelectedSources")
            or flat.get("selectedSources")
            or []
        ),
        "chartSelectedSources": (
            raw_filters.get("chartSelectedSources")
            or flat.get("chartSelectedSources")
            or raw_filters.get("selectedSources")
            or flat.get("selectedSources")
            or []
        ),
        "selectedMetricIds": metric_ids,
        "metricMode": raw_filters.get("metricMode") or flat.get("metricMode"),
        "chartDisplayMode": raw_filters.get("chartDisplayMode") or flat.get("chartDisplayMode"),
        "schedule": raw_filters.get("schedule") or flat.get("schedule"),
    }
    if not payload["period"]:
        return None

    try:
        return normalize_report_filters(payload)
    except ReportPreviewSessionError:
        return None


def snapshot_filters_hash(snapshot: DashboardPreparedSnapshot | None) -> str:
    if snapshot is None:
        return ""
    metadata = snapshot.metadata if isinstance(snapshot.metadata, dict) else {}
    stored = str(metadata.get("filtersHash") or "").strip()
    if stored:
        return stored
    preview_filters = preview_filters_from_settings(snapshot.settings_snapshot)
    return make_filters_hash(preview_filters) if preview_filters else ""


def stamp_filters_hash(metadata: dict | None, settings: dict | None, filters: dict | None = None) -> dict:
    stamped = dict(metadata or {})
    preview_filters = filters if isinstance(filters, dict) else preview_filters_from_settings(settings or {})
    if preview_filters:
        stamped["filtersHash"] = make_filters_hash(preview_filters)
    return stamped


def _preview_from_snapshot(snapshot: DashboardPreparedSnapshot) -> dict:
    data = snapshot.data if isinstance(snapshot.data, dict) else {}
    preview = data.get("preview") if isinstance(data.get("preview"), dict) else data
    data_points = preview.get("data") if isinstance(preview.get("data"), list) else []
    source_metrics = preview.get("source_metrics") if isinstance(preview.get("source_metrics"), dict) else {}
    return {
        "status": "ready",
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


def try_serve_prepared_snapshot(portal, filters: dict) -> dict | None:
    if not portal_has_pro(portal):
        return None

    from apps.dashboard.services.refresh import (
        DashboardRefreshError,
        get_current_snapshot,
        request_portal_refresh,
        resolve_portal_refresh_interval,
    )

    snapshot = get_current_snapshot(portal)
    if snapshot is None:
        return None

    incoming_hash = make_filters_hash(filters)
    stored_hash = snapshot_filters_hash(snapshot)
    if not stored_hash or stored_hash != incoming_hash:
        return None

    try:
        preview = _preview_from_snapshot(snapshot)
    except Exception:
        logger.exception("Failed to read prepared snapshot preview for portal %s", portal.pk)
        return None

    if preview.get("status") != "ready":
        return None

    _maybe_refresh_stale_snapshot(portal, snapshot, resolve_portal_refresh_interval, request_portal_refresh, DashboardRefreshError)

    return {
        "status": "ready",
        "sessionKey": str(snapshot.public_id),
        "filtersHash": incoming_hash,
        "servedFromSnapshot": True,
        "cacheTtlSeconds": 0,
        "expiresAt": None,
        "filters": filters,
        "data": preview.get("data") or [],
        "chart_data": preview.get("chart_data") or preview.get("data") or [],
        "employees": preview.get("employees") or [],
        "details": preview.get("details") or [],
        "source_metrics": preview.get("source_metrics") or {},
        "chart_source_metrics": preview.get("chart_source_metrics") or preview.get("source_metrics") or {},
        "metadata": {
            **(preview.get("metadata") if isinstance(preview.get("metadata"), dict) else {}),
            "servedFromSnapshot": True,
        },
        "message": "Отчёт загружен с сервера.",
    }


def persist_pro_preview_snapshot(portal, *, filters: dict, preview_payload: dict, settings: dict | None = None) -> None:
    if not portal_has_pro(portal):
        return

    from apps.dashboard.services.refresh import get_current_snapshot, resolve_portal_refresh_interval

    existing = get_current_snapshot(portal)
    existing_data = existing.data if existing and isinstance(existing.data, dict) else {}
    catalog = _snapshot_catalog_payload(
        portal,
        existing_data.get("catalog") if isinstance(existing_data.get("catalog"), dict) else {},
    )
    settings_payload = dict(existing.settings_snapshot) if existing and isinstance(existing.settings_snapshot, dict) else {}
    if isinstance(settings, dict) and settings:
        settings_payload.update(settings)
    settings_payload["filters"] = filters
    if filters.get("period"):
        settings_payload["period"] = filters["period"]
    if filters.get("dateRange"):
        settings_payload["dateRange"] = filters["dateRange"]
    if filters.get("selectedSources") is not None:
        settings_payload["selectedSources"] = filters["selectedSources"]
    if filters.get("chartSelectedSources") is not None:
        settings_payload["chartSelectedSources"] = filters["chartSelectedSources"]
    if filters.get("metricMode") is not None:
        settings_payload["metricMode"] = filters["metricMode"]
    if filters.get("chartDisplayMode") is not None:
        settings_payload["chartDisplayMode"] = filters["chartDisplayMode"]
    if filters.get("schedule") is not None:
        settings_payload["schedule"] = filters["schedule"]
    views = (
        list(existing.saved_views_snapshot)
        if existing and isinstance(existing.saved_views_snapshot, list)
        else []
    )
    data = {
        "catalog": catalog,
        "preview": {
            "data": preview_payload.get("data") or [],
            "chart_data": preview_payload.get("chart_data") or preview_payload.get("data") or [],
            "employees": preview_payload.get("employees") or [],
            "details": preview_payload.get("details") or [],
            "source_metrics": preview_payload.get("source_metrics") or {},
            "chart_source_metrics": preview_payload.get("chart_source_metrics") or preview_payload.get("source_metrics") or {},
            "metadata": preview_payload.get("metadata") if isinstance(preview_payload.get("metadata"), dict) else {},
        },
    }
    metadata = stamp_filters_hash(
        {"source": "bitrix_app_report_build"},
        settings_payload,
        filters,
    )
    payload_size = len(json.dumps(data, ensure_ascii=False, default=str).encode("utf-8"))
    interval = resolve_portal_refresh_interval(portal, existing)

    with transaction.atomic():
        DashboardPreparedSnapshot.objects.filter(portal=portal, is_current=True).update(is_current=False)
        DashboardPreparedSnapshot.objects.create(
            portal=portal,
            prepared_at=timezone.now(),
            is_current=True,
            refresh_interval_minutes=interval,
            settings_snapshot=settings_payload,
            saved_views_snapshot=views,
            data=data,
            metadata=metadata,
            payload_size_bytes=payload_size,
        )

    prune_dashboard_history(portal=portal)


def _snapshot_catalog_payload(portal, existing_catalog) -> dict:
    if isinstance(existing_catalog, dict) and (
        existing_catalog.get("sources") or existing_catalog.get("metrics")
    ):
        return existing_catalog
    try:
        from apps.reports.services.report_catalog import build_report_catalog

        built = build_report_catalog(portal) or {}
        return {
            "periods": built.get("periods") or [],
            "sources": built.get("sources") or [],
            "metricSections": built.get("metricSections") or [],
            "metrics": built.get("metrics") or [],
        }
    except Exception:
        logger.exception("Failed to attach catalog to dashboard snapshot")
        return existing_catalog if isinstance(existing_catalog, dict) else {}


def serve_owner_preview(portal, *, session, payload: dict | None) -> dict:
    """Empty body keeps the last snapshot. Filters rebuild that report and save the snapshot."""

    from apps.dashboard.services.refresh import get_current_snapshot
    from apps.reports.services.filters import make_filters_hash

    snapshot = get_current_snapshot(portal)
    filters = _preview_request_filters(payload)
    if filters is None:
        preview = _preview_from_snapshot(snapshot) if snapshot else _empty_preview()
        preview["status"] = "ready" if snapshot else "empty"
        return preview

    incoming_hash = make_filters_hash(filters)
    stored_hash = snapshot_filters_hash(snapshot)
    if snapshot is not None and stored_hash and stored_hash == incoming_hash:
        preview = _preview_from_snapshot(snapshot)
        preview["status"] = "ready"
        preview["servedFromSnapshot"] = True
        preview["filtersHash"] = incoming_hash
        return preview

    try:
        from apps.reports.services.data_providers import ReportDataProviderContext, get_report_data_provider

        result = get_report_data_provider().build_preview(
            filters=filters,
            context=ReportDataProviderContext(
                portal=portal,
                user=getattr(session, "user", None),
                bitrix_user_id=str(getattr(session, "bitrix_user_id", "") or ""),
                user_name=str(getattr(session, "user_name", "") or ""),
            ),
        )
    except Exception:
        logger.exception("Owner dashboard live preview failed for portal %s", portal.pk)
        preview = _preview_from_snapshot(snapshot) if snapshot else _empty_preview()
        preview["status"] = "ready" if snapshot else "empty"
        preview["message"] = "Не удалось пересчитать отчёт. Показаны сохранённые данные."
        return preview

    preview_payload = {
        "data": result.data,
        "chart_data": result.chart_data or result.data,
        "employees": result.employees,
        "details": result.details,
        "source_metrics": result.source_metrics,
        "chart_source_metrics": result.chart_source_metrics or result.source_metrics,
        "metadata": result.metadata if isinstance(result.metadata, dict) else {},
        "message": result.message,
    }
    try:
        persist_pro_preview_snapshot(portal, filters=filters, preview_payload=preview_payload)
    except Exception:
        logger.exception("Failed to persist owner live preview snapshot for portal %s", portal.pk)

    return {
        "status": result.status or "ready",
        "filtersHash": incoming_hash,
        "servedFromSnapshot": False,
        **preview_payload,
    }


def _preview_request_filters(payload: dict | None) -> dict | None:
    if not isinstance(payload, dict) or not payload:
        return None
    has_report_keys = any(
        key in payload
        for key in (
            "period",
            "dateRange",
            "selectedSources",
            "chartSelectedSources",
            "selectedMetricIds",
            "filters",
        )
    )
    if not has_report_keys:
        return None
    raw = payload.get("filters") if isinstance(payload.get("filters"), dict) else payload
    try:
        return normalize_report_filters(raw)
    except ReportPreviewSessionError:
        return None


def _empty_preview() -> dict:
    return {
        "status": "empty",
        "data": [],
        "chart_data": [],
        "employees": [],
        "details": [],
        "source_metrics": {},
        "chart_source_metrics": {},
        "metadata": {},
    }


def _maybe_refresh_stale_snapshot(portal, snapshot, resolve_interval, request_refresh, refresh_error) -> None:
    prepared_at = snapshot.prepared_at
    if prepared_at is None:
        return
    interval = resolve_interval(portal, snapshot)
    if timezone.now() - prepared_at < timedelta(minutes=max(interval, 1)):
        return
    try:
        request_refresh(portal=portal, enqueue=True)
    except refresh_error:
        return
    except Exception:
        logger.exception("Background snapshot refresh failed for portal %s", portal.pk)
