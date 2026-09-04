from __future__ import annotations

import json
import threading
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import close_old_connections, transaction
from django.utils import timezone

from apps.billing.models import PortalAccess
from apps.bitrix.models import BitrixPortal
from apps.dashboard.constants import (
    ALLOWED_REFRESH_INTERVAL_MINUTES,
    DEFAULT_REFRESH_INTERVAL_MINUTES,
)
from apps.dashboard.models import DashboardPreparedSnapshot, DashboardRefreshRun
from apps.dashboard.services.retention import prune_dashboard_history
from apps.reports.catalog import METRICS
from apps.reports.models import PortalReportSettings
from apps.reports.services.data_providers import ReportDataProviderContext, get_report_data_provider
from apps.reports.services.exceptions import ReportPreviewSessionError
from apps.reports.services.filters import normalize_report_filters
from apps.reports.services.report_catalog import build_report_catalog


ACTIVE_REFRESH_STATUSES = {
    DashboardRefreshRun.Status.PENDING,
    DashboardRefreshRun.Status.RUNNING,
}


class DashboardRefreshError(Exception):
    def __init__(self, message: str, *, status: int = 400):
        super().__init__(message)
        self.status = status


def build_refresh_status(portal: BitrixPortal | None) -> dict | None:
    if portal is None:
        return None

    latest_run = DashboardRefreshRun.objects.filter(portal=portal).order_by("-created_at").first()
    latest_success = (
        DashboardRefreshRun.objects.filter(
            portal=portal,
            status=DashboardRefreshRun.Status.SUCCESS,
            finished_at__isnull=False,
        )
        .order_by("-finished_at")
        .first()
    )

    if not latest_run and not latest_success:
        return None

    return {
        "lastSuccessfulUpdateAt": latest_success.finished_at.isoformat() if latest_success else None,
        "nextUpdateAt": (
            latest_run.next_planned_at.isoformat()
            if latest_run
            and latest_run.status == DashboardRefreshRun.Status.FAILED
            and latest_run.next_planned_at
            else (
                latest_success.next_planned_at.isoformat()
                if latest_success and latest_success.next_planned_at
                else None
            )
        ),
        "isRefreshing": bool(latest_run and latest_run.status in ACTIVE_REFRESH_STATUSES),
        "lastAttemptFailedAt": (
            latest_run.finished_at.isoformat()
            if latest_run
            and latest_run.status == DashboardRefreshRun.Status.FAILED
            and latest_run.finished_at
            else None
        ),
        "lastErrorMessage": (
            latest_run.error_message
            if latest_run and latest_run.status == DashboardRefreshRun.Status.FAILED
            else ""
        ),
    }


def get_current_snapshot(portal: BitrixPortal) -> DashboardPreparedSnapshot | None:
    return (
        DashboardPreparedSnapshot.objects.filter(portal=portal, is_current=True)
        .order_by("-prepared_at")
        .first()
        or DashboardPreparedSnapshot.objects.filter(portal=portal)
        .order_by("-prepared_at")
        .first()
    )


def request_portal_refresh(
    *,
    portal: BitrixPortal,
    trigger_type: str = DashboardRefreshRun.TriggerType.MANUAL,
    bitrix_user_id: str = "",
    enqueue: bool = True,
) -> tuple[DashboardRefreshRun, bool]:
    has_pro, error_message = _check_pro_access(portal)
    if not has_pro:
        raise DashboardRefreshError(error_message or "PRO-доступ не найден.", status=403)

    snapshot = get_current_snapshot(portal)
    if snapshot is None:
        raise DashboardRefreshError(
            "Нет подготовленного снимка. Сначала постройте отчёт в приложении Битрикс24.",
            status=400,
        )

    interval = resolve_portal_refresh_interval(portal, snapshot)

    with transaction.atomic():
        locked_portal = BitrixPortal.objects.select_for_update().get(pk=portal.pk)
        active_run = (
            DashboardRefreshRun.objects.select_for_update()
            .filter(portal=locked_portal, status__in=ACTIVE_REFRESH_STATUSES)
            .order_by("-created_at")
            .first()
        )
        if active_run:
            return active_run, False

        run = DashboardRefreshRun.objects.create(
            portal=locked_portal,
            trigger_type=trigger_type,
            status=DashboardRefreshRun.Status.PENDING,
            refresh_interval_minutes=interval,
            requested_by_bitrix_user_id=str(bitrix_user_id or ""),
            next_planned_at=timezone.now() + timedelta(minutes=interval),
            metadata={"source": "dashboard_refresh"},
        )

    if enqueue:
        job_id = enqueue_dashboard_refresh(run.id)
        run.metadata = {**run.metadata, "jobId": job_id}
        run.save(update_fields=["metadata", "updated_at"])

    return run, True


def run_portal_refresh(run_id: int) -> DashboardRefreshRun:
    run = DashboardRefreshRun.objects.select_related("portal").filter(id=run_id).first()
    if run is None:
        raise DashboardRefreshError("Запуск обновления не найден.", status=404)

    if run.status not in ACTIVE_REFRESH_STATUSES:
        return run

    portal = run.portal
    snapshot = get_current_snapshot(portal)
    started_at = timezone.now()
    run.status = DashboardRefreshRun.Status.RUNNING
    run.started_at = started_at
    run.save(update_fields=["status", "started_at", "updated_at"])

    if snapshot is None:
        return _fail_run(run, "Нет подготовленного снимка для обновления.")

    try:
        filters = build_refresh_filters(snapshot)
        provider_result = get_report_data_provider().build_preview(
            filters=filters,
            context=ReportDataProviderContext(
                portal=portal,
                user=None,
                bitrix_user_id=run.requested_by_bitrix_user_id or "",
                user_name="",
            ),
        )
        catalog = build_report_catalog(portal)
        settings, saved_views = _settings_for_new_snapshot(portal, snapshot)
        payload = {
            "catalog": {
                "periods": catalog.get("periods") or [],
                "sources": catalog.get("sources") or [],
                "metricSections": catalog.get("metricSections") or [],
                "metrics": catalog.get("metrics") or [],
            },
            "preview": {
                "data": provider_result.data,
                "chart_data": provider_result.chart_data or provider_result.data,
                "employees": provider_result.employees,
                "details": provider_result.details,
                "source_metrics": provider_result.source_metrics,
                "chart_source_metrics": provider_result.chart_source_metrics or provider_result.source_metrics,
                "metadata": {
                    "valueStates": (provider_result.metadata or {}).get("valueStates") or {},
                },
            },
        }
        payload_size = len(json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8"))
        finished_at = timezone.now()
        interval = _safe_refresh_interval(run.refresh_interval_minutes)

        with transaction.atomic():
            DashboardPreparedSnapshot.objects.filter(portal=portal, is_current=True).update(is_current=False)
            new_snapshot = DashboardPreparedSnapshot.objects.create(
                portal=portal,
                prepared_at=finished_at,
                is_current=True,
                refresh_interval_minutes=interval,
                settings_snapshot=settings,
                saved_views_snapshot=saved_views,
                data=payload,
                metadata={
                    "source": "dashboard_refresh",
                    "triggerType": run.trigger_type,
                    "runId": run.id,
                },
                payload_size_bytes=payload_size,
            )
            run.snapshot = new_snapshot
            run.status = DashboardRefreshRun.Status.SUCCESS
            run.error_message = ""
            run.finished_at = finished_at
            run.next_planned_at = finished_at + timedelta(minutes=interval)
            run.save(
                update_fields=[
                    "snapshot",
                    "status",
                    "error_message",
                    "finished_at",
                    "next_planned_at",
                    "updated_at",
                ]
            )

        prune_dashboard_history(portal=portal)
    except Exception as error:
        return _fail_run(run, str(error) or "Не удалось обновить данные Битрикс24.")

    return run


def refresh_due_portals() -> dict:
    now = timezone.now()
    portal_ids = (
        DashboardPreparedSnapshot.objects.filter(is_current=True)
        .values_list("portal_id", flat=True)
        .distinct()
    )
    started = 0
    skipped = 0

    for portal in BitrixPortal.objects.filter(id__in=portal_ids, status=BitrixPortal.Status.ACTIVE):
        last_run = DashboardRefreshRun.objects.filter(portal=portal).order_by("-created_at").first()
        if last_run and last_run.status in ACTIVE_REFRESH_STATUSES:
            skipped += 1
            continue
        if not last_run or not last_run.next_planned_at or last_run.next_planned_at > now:
            skipped += 1
            continue

        try:
            _run, accepted = request_portal_refresh(
                portal=portal,
                trigger_type=DashboardRefreshRun.TriggerType.SCHEDULED,
            )
        except DashboardRefreshError:
            skipped += 1
            continue

        if accepted:
            started += 1
        else:
            skipped += 1

    return {"started": started, "skipped": skipped}


def enqueue_dashboard_refresh(run_id: int) -> str:
    backend = getattr(settings, "REPORT_BACKGROUND_BACKEND", "thread").lower()

    if backend == "celery":
        try:
            from apps.dashboard.tasks import run_dashboard_refresh_task
        except ImportError as error:
            raise ImproperlyConfigured(
                "Celery is not installed. Install backend requirements or use REPORT_BACKGROUND_BACKEND=thread."
            ) from error

        async_result = run_dashboard_refresh_task.delay(run_id)
        return f"celery:{async_result.id}"

    if backend != "thread":
        raise ImproperlyConfigured("REPORT_BACKGROUND_BACKEND must be one of: thread, celery.")

    job_id = f"local-thread:dashboard-refresh:{run_id}"
    thread = threading.Thread(
        target=_run_refresh_in_thread,
        args=(run_id,),
        name=f"dashboard-refresh-{run_id}",
        daemon=True,
    )
    thread.start()
    return job_id


def build_refresh_filters(snapshot: DashboardPreparedSnapshot) -> dict:
    known_metric_ids = {str(metric.get("id")) for metric in METRICS if metric.get("id")}
    sources: list[str] = []
    chart_sources: list[str] = []
    metric_ids: list[str] = []
    starts: list[str] = []
    ends: list[str] = []
    period = ""
    metric_mode = "money"
    chart_display_mode = "sum"
    schedule = {}

    candidates = [_flatten_settings(snapshot.settings_snapshot)]
    if isinstance(snapshot.saved_views_snapshot, list):
        for view in snapshot.saved_views_snapshot:
            if not isinstance(view, dict):
                continue
            state = view.get("state") if isinstance(view.get("state"), dict) else {}
            candidates.append(_flatten_settings(state))

    for settings in candidates:
        period = period or str(settings.get("period") or "")
        metric_mode = str(settings.get("metricMode") or metric_mode)
        chart_display_mode = str(settings.get("chartDisplayMode") or chart_display_mode)
        if isinstance(settings.get("schedule"), dict) and not schedule:
            schedule = settings["schedule"]

        _extend_unique(sources, settings.get("selectedSources"))
        _extend_unique(sources, settings.get("tableSelectedSources"))
        _extend_unique(chart_sources, settings.get("chartSelectedSources") or settings.get("selectedSources"))

        enabled = settings.get("enabledMetricIdsBySection")
        if isinstance(enabled, dict):
            for values in enabled.values():
                _extend_unique(metric_ids, values)

        date_range = settings.get("dateRange") if isinstance(settings.get("dateRange"), dict) else {}
        start = str(date_range.get("start") or date_range.get("from") or "")
        end = str(date_range.get("end") or date_range.get("to") or "")
        if start:
            starts.append(start)
        if end:
            ends.append(end)

    metric_ids = [metric_id for metric_id in metric_ids if metric_id in known_metric_ids]

    payload = {
        "period": period or "days",
        "dateRange": {
            "from": min(starts) if starts else None,
            "to": max(ends) if ends else None,
        },
        "selectedSources": sources,
        "chartSelectedSources": chart_sources or sources,
        "selectedMetricIds": metric_ids or None,
        "metricMode": metric_mode,
        "chartDisplayMode": chart_display_mode,
        "schedule": schedule or None,
    }
    return normalize_report_filters(payload)


def _run_refresh_in_thread(run_id: int) -> None:
    close_old_connections()
    try:
        run_portal_refresh(run_id)
    finally:
        close_old_connections()


def _fail_run(run: DashboardRefreshRun, message: str) -> DashboardRefreshRun:
    finished_at = timezone.now()
    interval = _safe_refresh_interval(run.refresh_interval_minutes)
    run.status = DashboardRefreshRun.Status.FAILED
    run.error_message = message[:4000]
    run.finished_at = finished_at
    run.next_planned_at = finished_at + timedelta(minutes=interval)
    run.save(update_fields=["status", "error_message", "finished_at", "next_planned_at", "updated_at"])
    return run


def _check_pro_access(portal: BitrixPortal) -> tuple[bool, str | None]:
    try:
        access = PortalAccess.objects.get(portal=portal)
    except PortalAccess.DoesNotExist:
        return False, "Портал не имеет PRO-доступа."

    if not access.is_pro_valid:
        return False, "PRO-доступ портала истёк или недоступен."

    return True, None


def _safe_refresh_interval(value) -> int:
    parsed = _interval_from_value(value)
    return parsed if parsed is not None else DEFAULT_REFRESH_INTERVAL_MINUTES


def _interval_from_value(value) -> int | None:
    if value in (None, ""):
        return None

    try:
        interval = int(value)
    except (TypeError, ValueError):
        return None

    if interval in ALLOWED_REFRESH_INTERVAL_MINUTES:
        return interval

    return None


def resolve_portal_refresh_interval(portal: BitrixPortal, snapshot: DashboardPreparedSnapshot | None = None) -> int:
    report_settings = PortalReportSettings.objects.filter(portal=portal).first()
    from_app_settings = _interval_from_value(
        report_settings.app_settings.get("dashboardRefreshIntervalMinutes")
        if report_settings and isinstance(report_settings.app_settings, dict)
        else None
    )
    if from_app_settings is not None:
        return from_app_settings

    if snapshot is not None:
        return _safe_refresh_interval(snapshot.refresh_interval_minutes)

    return DEFAULT_REFRESH_INTERVAL_MINUTES


def sync_portal_refresh_interval(portal: BitrixPortal, minutes) -> int:
    interval = _safe_refresh_interval(minutes)
    snapshot = get_current_snapshot(portal)

    if snapshot and snapshot.refresh_interval_minutes != interval:
        snapshot.refresh_interval_minutes = interval
        snapshot.save(update_fields=["refresh_interval_minutes", "updated_at"])

    report_settings = PortalReportSettings.objects.filter(portal=portal).first()
    if report_settings:
        app_settings = dict(report_settings.app_settings or {})
        if app_settings.get("dashboardRefreshIntervalMinutes") != interval:
            app_settings["dashboardRefreshIntervalMinutes"] = interval
            report_settings.app_settings = app_settings
            report_settings.save(update_fields=["app_settings", "updated_at"])

    latest_run = DashboardRefreshRun.objects.filter(portal=portal).order_by("-created_at").first()
    if latest_run:
        latest_run.refresh_interval_minutes = interval
        update_fields = ["refresh_interval_minutes", "updated_at"]
        if latest_run.status not in ACTIVE_REFRESH_STATUSES:
            base_time = latest_run.finished_at or latest_run.started_at or timezone.now()
            latest_run.next_planned_at = base_time + timedelta(minutes=interval)
            update_fields.append("next_planned_at")
        latest_run.save(update_fields=update_fields)

    return interval


def _settings_for_new_snapshot(portal: BitrixPortal, snapshot: DashboardPreparedSnapshot) -> tuple[dict, list]:
    settings = snapshot.settings_snapshot if isinstance(snapshot.settings_snapshot, dict) else {}
    saved_views = snapshot.saved_views_snapshot if isinstance(snapshot.saved_views_snapshot, list) else []

    report_settings = PortalReportSettings.objects.filter(portal=portal).first()
    if report_settings:
        if isinstance(report_settings.settings, dict) and report_settings.settings:
            settings = report_settings.settings
        if isinstance(report_settings.saved_views, list) and report_settings.saved_views:
            saved_views = report_settings.saved_views

    return settings, saved_views


def _flatten_settings(settings) -> dict:
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

    for key in ("tableSelectedSources", "enabledMetricIdsBySection", "selectedSources", "chartSelectedSources"):
        if key in settings and settings.get(key) is not None:
            flattened[key] = settings.get(key)

    return flattened


def _extend_unique(target: list[str], values) -> None:
    if not isinstance(values, list):
        return

    seen = set(target)
    for item in values:
        value = str(item or "").strip()
        if value and value not in seen:
            target.append(value)
            seen.add(value)
