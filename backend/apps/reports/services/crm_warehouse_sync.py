from __future__ import annotations

import logging
from datetime import timedelta

from django.utils import timezone

from apps.bitrix.models import BitrixPortal
from apps.bitrix.services.rest_client import BitrixRestTokenRefreshError
from apps.reports.models import PortalCrmSyncState
from apps.reports.services.bitrix_report_data_provider import BitrixReportDataProvider
from apps.reports.services.crm_warehouse import (
    DATE_MODIFY_SOURCE_TYPES,
    WAREHOUSE_CHUNK_DAYS,
    WAREHOUSE_WINDOW_DAYS,
    WAREHOUSE_INCREMENTAL_LOOKBACK_DAYS,
    WAREHOUSE_INCREMENTAL_MAX_CATCHUP_DAYS,
    WAREHOUSE_INCREMENTAL_MIN_INTERVAL,
    WAREHOUSE_STALE_RUNNING,
    extend_source_coverage,
    iter_pro_portal_ids,
    portal_has_pro,
    prune_warehouse_rows,
    repair_false_warehouse_coverage,
    try_acquire_sync_lock,
    upsert_source_rows,
    warehouse_sources_for_portal,
    warehouse_window,
)
from apps.reports.services.portal_timezone import ensure_portal_timezone


logger = logging.getLogger(__name__)


def sync_due_crm_warehouses(*, enqueue=None) -> dict:
    queued = 0
    skipped = 0

    for portal_id in iter_pro_portal_ids():
        if _should_skip_portal(portal_id):
            skipped += 1
            continue
        if enqueue is None:
            sync_portal_crm_warehouse(portal_id)
        else:
            enqueue(portal_id)
        queued += 1

    return {"queued": queued, "skipped": skipped}


def _should_skip_portal(portal_id: int) -> bool:
    state = PortalCrmSyncState.objects.filter(portal_id=portal_id).first()
    if state is None:
        return False
    now = timezone.now()
    if state.status == PortalCrmSyncState.Status.RUNNING:
        started = state.last_started_at or state.updated_at
        return bool(started and now - started < WAREHOUSE_STALE_RUNNING)
    if state.last_finished_at and now - state.last_finished_at < WAREHOUSE_INCREMENTAL_MIN_INTERVAL:
        return True
    if state.status == PortalCrmSyncState.Status.READY and state.coverage_to:
        # Calendar lag: keep retrying even if last_incremental_at was bumped recently.
        if now - state.coverage_to >= timedelta(hours=12):
            return False
    if state.status == PortalCrmSyncState.Status.READY and state.last_incremental_at:
        return now - state.last_incremental_at < WAREHOUSE_INCREMENTAL_MIN_INTERVAL
    return False


def sync_portal_crm_warehouse(portal_id: int) -> dict:
    portal = BitrixPortal.objects.filter(pk=portal_id).first()
    if portal is None:
        return {"ok": False, "reason": "missing_portal"}

    if not portal_has_pro(portal):
        return {"ok": True, "reason": "not_pro"}

    if portal.oauth_reauth_required:
        return {"ok": False, "reason": "oauth_reauth_required"}

    state, previous_status = try_acquire_sync_lock(portal)
    if state is None:
        return {"ok": True, "reason": "locked"}

    try:
        return _run_sync_step(portal, state, previous_status or PortalCrmSyncState.Status.IDLE)
    except Exception as error:
        logger.exception("CRM warehouse sync failed for portal_id=%s", portal_id)
        PortalCrmSyncState.objects.filter(pk=state.pk).update(
            status=PortalCrmSyncState.Status.FAILED,
            error_message=str(error)[:2000],
            last_finished_at=timezone.now(),
        )
        return {"ok": False, "reason": "failed", "error": str(error)}


def _run_sync_step(portal, state: PortalCrmSyncState, _previous_status: str) -> dict:
    now = timezone.now()
    window_start, window_end = warehouse_window(now)
    provider = BitrixReportDataProvider()
    client = provider.rest_client_factory(portal)
    ensure_portal_timezone(portal, client)
    sources = warehouse_sources_for_portal(portal)
    repair_false_warehouse_coverage(portal, state, window_start)

    if _backfill_complete(state, window_start):
        return _run_incremental(portal, state, provider, client, sources, window_start, window_end)

    return _run_backfill_chunk(portal, state, provider, client, sources, window_start, window_end)


def _backfill_complete(state: PortalCrmSyncState, window_start) -> bool:
    if state.coverage_from is None or state.coverage_to is None:
        return False
    if state.coverage_from > window_start:
        return False
    if state.next_chunk_to is not None and state.next_chunk_to > window_start:
        return False
    return True


def _run_backfill_chunk(portal, state, provider, client, sources, window_start, window_end) -> dict:
    chunk_end = state.next_chunk_to or window_end
    if chunk_end > window_end:
        chunk_end = window_end
    chunk_start = chunk_end - timedelta(days=WAREHOUSE_CHUNK_DAYS)
    if chunk_start < window_start:
        chunk_start = window_start

    written = _fetch_and_store(
        portal=portal,
        provider=provider,
        client=client,
        sources=sources,
        date_from=chunk_start,
        date_to=chunk_end,
        modified_since=None,
    )

    if state.coverage_from is None:
        state.coverage_from = chunk_start
        state.coverage_to = chunk_end
    else:
        if chunk_start < state.coverage_from:
            state.coverage_from = chunk_start
        if state.coverage_to is None or chunk_end > state.coverage_to:
            state.coverage_to = chunk_end

    state.next_chunk_to = chunk_start
    filled_days = max(0, (window_end - (state.coverage_from or window_start)).days)
    state.progress_percent = min(99, int((filled_days / WAREHOUSE_WINDOW_DAYS) * 100))
    state.progress_message = "Первая заливка склада CRM"
    state.last_finished_at = timezone.now()
    state.error_message = ""

    if chunk_start <= window_start:
        prune_warehouse_rows(portal, now=window_end)
        state.status = PortalCrmSyncState.Status.READY
        state.coverage_from = window_start
        state.coverage_to = window_end
        state.next_chunk_to = window_start
        state.progress_percent = 100
        state.progress_message = "Склад готов"
        state.last_incremental_at = window_end
    else:
        state.status = PortalCrmSyncState.Status.IDLE

    state.save()
    return {
        "ok": True,
        "mode": "backfill",
        "written": written,
        "status": state.status,
        "chunk_from": chunk_start.isoformat(),
        "chunk_to": chunk_end.isoformat(),
    }


def _run_incremental(portal, state, provider, client, sources, window_start, window_end) -> dict:
    catchup_start = _incremental_catchup_start(state, window_end)
    written = 0
    failed_source_ids: list[str] = []

    modify_sources = [source for source in sources if source.get("type") in DATE_MODIFY_SOURCE_TYPES]
    event_sources = [source for source in sources if source.get("type") not in DATE_MODIFY_SOURCE_TYPES]

    written += _fetch_and_store(
        portal=portal,
        provider=provider,
        client=client,
        sources=modify_sources,
        date_from=window_start,
        date_to=window_end,
        modified_since=catchup_start,
        failed_source_ids=failed_source_ids,
    )
    written += _fetch_and_store(
        portal=portal,
        provider=provider,
        client=client,
        sources=event_sources,
        date_from=catchup_start,
        date_to=window_end,
        modified_since=None,
        failed_source_ids=failed_source_ids,
    )

    prune_warehouse_rows(portal, now=window_end)
    now = timezone.now()
    state.status = PortalCrmSyncState.Status.READY
    if state.coverage_from is not None and state.coverage_from < window_start:
        state.coverage_from = window_start
    if _backfill_complete(state, window_start):
        state.next_chunk_to = window_start
        state.progress_percent = 100
    else:
        filled_days = max(0, (window_end - (state.coverage_from or window_end)).days)
        state.progress_percent = min(99, int((filled_days / WAREHOUSE_WINDOW_DAYS) * 100))
    state.last_finished_at = now

    if failed_source_ids:
        state.progress_message = "Склад готов, повтор свежих дней"
        state.error_message = (
            "Не удалось обновить источники: " + ", ".join(failed_source_ids[:12])
        )[:2000]
        # Keep coverage_to / last_incremental_at so the next run still catch-up from the gap.
    else:
        state.coverage_to = window_end
        state.last_incremental_at = window_end
        state.progress_message = "Склад готов"
        state.error_message = ""

    state.save()
    return {
        "ok": True,
        "mode": "incremental",
        "written": written,
        "failed_sources": failed_source_ids,
        "status": state.status,
        "catchup_from": catchup_start.isoformat(),
    }


def _incremental_catchup_start(state: PortalCrmSyncState, window_end):
    floor = window_end - timedelta(days=WAREHOUSE_INCREMENTAL_MAX_CATCHUP_DAYS)
    recent = window_end - timedelta(days=WAREHOUSE_INCREMENTAL_LOOKBACK_DAYS)
    candidates = [recent]
    if state.last_incremental_at is not None:
        candidates.append(state.last_incremental_at)
    if state.coverage_to is not None:
        candidates.append(state.coverage_to)
    return max(min(candidates), floor)


def _fetch_and_store(
    *,
    portal,
    provider,
    client,
    sources,
    date_from,
    date_to,
    modified_since,
    failed_source_ids: list[str] | None = None,
) -> int:
    written = 0
    for source in sources:
        source_id = str(source.get("id") or "")
        try:
            rows = provider._load_single_source_rows(
                client=client,
                source=source,
                date_from=date_from,
                date_to=date_to,
                modified_since=modified_since,
            )
        except BitrixRestTokenRefreshError:
            logger.warning(
                "CRM warehouse stopped: OAuth reauth required portal=%s source=%s",
                portal.pk,
                source_id,
            )
            if failed_source_ids is not None:
                failed_source_ids.append(source_id)
            break
        except Exception:
            logger.warning(
                "CRM warehouse source load failed portal=%s source=%s",
                portal.pk,
                source_id,
                exc_info=True,
            )
            if failed_source_ids is not None and source_id:
                failed_source_ids.append(source_id)
            continue
        written += upsert_source_rows(portal=portal, source_id=source_id, rows=rows)
        if source_id:
            extend_source_coverage(portal, source_id, date_from, date_to)
    return written
