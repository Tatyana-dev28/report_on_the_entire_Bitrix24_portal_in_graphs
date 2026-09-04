from __future__ import annotations

import json
import logging
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
    STALE_ACTIVE_REFRESH_MINUTES,
    STALE_PENDING_REFRESH_MINUTES,
)
from apps.dashboard.models import DashboardPreparedSnapshot, DashboardRefreshRun
from apps.dashboard.services.retention import prune_dashboard_history
from apps.reports.catalog import METRICS
from apps.reports.models import PortalReportSettings
from apps.reports.services.data_providers import ReportDataProviderContext, get_report_data_provider
from apps.reports.services.exceptions import ReportPreviewSessionError
from apps.reports.services.filters import normalize_report_filters
from apps.reports.services.report_catalog import build_report_catalog


logger = logging.getLogger(__name__)

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

    latest_run = _latest_refresh_run(portal)
    latest_success = _latest_refresh_run(
        portal,
        extra_filters={
            "status": DashboardRefreshRun.Status.SUCCESS,
            "finished_at__isnull": False,
        },
        order_by="-finished_at",
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


def _latest_row_id(queryset, order_by: str) -> int | None:
    return queryset.order_by(order_by).values_list("pk", flat=True).first()


def _latest_refresh_run(
    portal: BitrixPortal,
    *,
    extra_filters: dict | None = None,
    order_by: str = "-created_at",
) -> DashboardRefreshRun | None:
    queryset = DashboardRefreshRun.objects.filter(portal=portal)
    if extra_filters:
        queryset = queryset.filter(**extra_filters)
    run_id = _latest_row_id(queryset, order_by)
    if run_id is None:
        return None
    return DashboardRefreshRun.objects.defer("metadata").filter(pk=run_id).first()


def get_current_snapshot(portal: BitrixPortal, *, load_data: bool = True) -> DashboardPreparedSnapshot | None:
    snapshot_id = _latest_row_id(
        DashboardPreparedSnapshot.objects.filter(portal=portal, is_current=True),
        "-prepared_at",
    ) or _latest_row_id(
        DashboardPreparedSnapshot.objects.filter(portal=portal),
        "-prepared_at",
    )
    if snapshot_id is None:
        return None
    queryset = DashboardPreparedSnapshot.objects.filter(pk=snapshot_id)
    if not load_data:
        queryset = queryset.defer("data")
    return queryset.first()


def persist_refresh_settings(
    portal: BitrixPortal,
    *,
    settings: dict | None = None,
    saved_views: list | None = None,
) -> DashboardPreparedSnapshot:
    snapshot = get_current_snapshot(portal)
    interval = resolve_portal_refresh_interval(portal, snapshot)
    settings_payload = settings if isinstance(settings, dict) else {}
    views_payload = saved_views if isinstance(saved_views, list) else []

    if snapshot is None:
        return DashboardPreparedSnapshot.objects.create(
            portal=portal,
            prepared_at=timezone.now(),
            is_current=True,
            refresh_interval_minutes=interval,
            settings_snapshot=settings_payload,
            saved_views_snapshot=views_payload,
            data={},
            metadata={"source": "dashboard_settings_seed"},
        )

    if settings is not None:
        snapshot.settings_snapshot = settings_payload
    if saved_views is not None:
        snapshot.saved_views_snapshot = views_payload
    snapshot.save()
    return snapshot


def request_portal_refresh(
    *,
    portal: BitrixPortal,
    trigger_type: str = DashboardRefreshRun.TriggerType.MANUAL,
    bitrix_user_id: str = "",
    enqueue: bool = True,
    settings: dict | None = None,
    saved_views: list | None = None,
) -> tuple[DashboardRefreshRun, bool]:
    has_pro, error_message = _check_pro_access(portal)
    if not has_pro:
        raise DashboardRefreshError(error_message or "PRO-доступ не найден.", status=403)

    if settings is not None or saved_views is not None:
        persist_refresh_settings(portal, settings=settings, saved_views=saved_views)

    snapshot = get_current_snapshot(portal)
    if snapshot is None:
        raise DashboardRefreshError(
            "Нет настроек отчёта. Выберите показатели и нажмите «Построить».",
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
        try:
            job_id = enqueue_dashboard_refresh(
                run.id,
                prefer_thread=True,
            )
        except Exception as error:
            logger.exception("Failed to enqueue dashboard refresh %s", run.id)
            _fail_run(run, "Не удалось запустить обновление. Попробуйте ещё раз.")
            raise DashboardRefreshError(
                "Не удалось запустить обновление данных.",
                status=503,
            ) from error

        run.metadata = {**(run.metadata or {}), "jobId": job_id}
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
        logger.exception("Dashboard refresh run %s failed", run.id)
        return _fail_run(run, _friendly_refresh_error(error))

    return run


def refresh_due_portals() -> dict:
    recovered = recover_stale_refresh_runs()
    now = timezone.now()
    snapshots = {
        snapshot.portal_id: snapshot
        for snapshot in DashboardPreparedSnapshot.objects.filter(is_current=True).defer("data")
    }
    started = 0
    skipped = 0

    for portal in BitrixPortal.objects.filter(id__in=snapshots.keys(), status=BitrixPortal.Status.ACTIVE):
        last_run = _latest_refresh_run(portal)
        if last_run and last_run.status in ACTIVE_REFRESH_STATUSES:
            skipped += 1
            continue
        if not _portal_refresh_is_due(portal, last_run, snapshots.get(portal.id), now):
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

    return {"started": started, "skipped": skipped, "recovered": recovered}


def _portal_refresh_is_due(
    portal: BitrixPortal,
    last_run: DashboardRefreshRun | None,
    snapshot: DashboardPreparedSnapshot | None,
    now,
) -> bool:
    if last_run and last_run.next_planned_at:
        return last_run.next_planned_at <= now

    if snapshot is None:
        return False

    interval = resolve_portal_refresh_interval(portal, snapshot)
    prepared_at = snapshot.prepared_at or now
    return prepared_at + timedelta(minutes=interval) <= now


def recover_stale_refresh_runs() -> int:
    now = timezone.now()
    pending_cutoff = now - timedelta(minutes=STALE_PENDING_REFRESH_MINUTES)
    running_cutoff = now - timedelta(minutes=STALE_ACTIVE_REFRESH_MINUTES)
    stale_ids = list(
        DashboardRefreshRun.objects.filter(
            status=DashboardRefreshRun.Status.PENDING,
            started_at__isnull=True,
            created_at__lt=pending_cutoff,
        ).values_list("pk", flat=True)
    ) + list(
        DashboardRefreshRun.objects.filter(
            status__in=ACTIVE_REFRESH_STATUSES,
            created_at__lt=running_cutoff,
        ).values_list("pk", flat=True)
    )
    stale_runs = list(
        DashboardRefreshRun.objects.filter(pk__in=set(stale_ids)).select_related("portal")
    )
    for run in stale_runs:
        _fail_run(run, "Обновление зависло и было остановлено. Следующее запустится по расписанию.")
        run.next_planned_at = now
        run.save(update_fields=["next_planned_at", "updated_at"])
    return len(stale_runs)


def enqueue_dashboard_refresh(run_id: int, *, prefer_thread: bool = False) -> str:
    backend = getattr(settings, "REPORT_BACKGROUND_BACKEND", "thread").lower()

    if not prefer_thread and backend == "celery":
        try:
            from apps.dashboard.tasks import run_dashboard_refresh_task

            async_result = run_dashboard_refresh_task.delay(run_id)
            return f"celery:{async_result.id}"
        except Exception:
            logger.exception(
                "Celery enqueue failed for dashboard refresh %s, falling back to a local thread",
                run_id,
            )

    if backend not in {"thread", "celery"}:
        raise ImproperlyConfigured("REPORT_BACKGROUND_BACKEND must be one of: thread, celery.")

    return _start_refresh_thread(run_id)


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


def _start_refresh_thread(run_id: int) -> str:
    job_id = f"local-thread:dashboard-refresh:{run_id}"
    thread = threading.Thread(
        target=_run_refresh_in_thread,
        args=(run_id,),
        name=f"dashboard-refresh-{run_id}",
        daemon=True,
    )
    thread.start()
    return job_id


def _run_refresh_in_thread(run_id: int) -> None:
    close_old_connections()
    try:
        run_portal_refresh(run_id)
    finally:
        close_old_connections()


def _friendly_refresh_error(error: BaseException) -> str:
    if isinstance(error, ReportPreviewSessionError):
        return str(error)[:4000]

    try:
        from apps.bitrix.services.rest_client import BitrixRestError
    except ImportError:
        BitrixRestError = tuple()  # type: ignore[assignment]

    if BitrixRestError and isinstance(error, BitrixRestError):
        return "Битрикс24 не отдал данные для обновления. Попробуйте ещё раз через минуту."

    text = str(error or "").strip()
    lowered = text.lower()
    if any(token in lowered for token in ("500", "502", "503", "timeout", "timed out")):
        return (
            "Битрикс24 временно не ответил. Предыдущий отчёт сохранён, попробуйте обновить ещё раз."
        )

    return (text or "Не удалось обновить данные Битрикс24.")[:4000]


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

    latest_run = _latest_refresh_run(portal)
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
        if not settings and isinstance(report_settings.settings, dict) and report_settings.settings:
            settings = report_settings.settings
        if not saved_views and isinstance(report_settings.saved_views, list) and report_settings.saved_views:
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

    # ReportLoadFilters.selectedSources is the table; chart sources live in appliedFilters.
    if isinstance(applied.get("selectedSources"), list):
        flattened["selectedSources"] = applied["selectedSources"]
    if isinstance(filters.get("chartSelectedSources"), list):
        flattened["chartSelectedSources"] = filters["chartSelectedSources"]
    elif isinstance(applied.get("selectedSources"), list):
        flattened["chartSelectedSources"] = applied["selectedSources"]

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
