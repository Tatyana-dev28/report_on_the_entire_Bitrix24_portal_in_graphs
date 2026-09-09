from __future__ import annotations

import logging
from datetime import timedelta

from django.utils import timezone

from apps.bitrix.models import BitrixPortal
from apps.reports.models import PortalCrmSyncState
from apps.reports.services.bitrix_report_data_provider import BitrixReportDataProvider
from apps.reports.services.crm_warehouse import (
    DATE_MODIFY_SOURCE_TYPES,
    WAREHOUSE_CHUNK_DAYS,
    WAREHOUSE_WINDOW_DAYS,
    WAREHOUSE_INCREMENTAL_LOOKBACK_DAYS,
    WAREHOUSE_INCREMENTAL_MIN_INTERVAL,
    WAREHOUSE_STALE_RUNNING,
    iter_pro_portal_ids,
    portal_has_pro,
    prune_warehouse_rows,
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
    if state.status == PortalCrmSyncState.Status.RUNNING:
        started = state.last_started_at or state.updated_at
        return bool(started and timezone.now() - started < WAREHOUSE_STALE_RUNNING)
    if state.status == PortalCrmSyncState.Status.READY and state.last_incremental_at:
        return timezone.now() - state.last_incremental_at < WAREHOUSE_INCREMENTAL_MIN_INTERVAL
    return False


def sync_portal_crm_warehouse(portal_id: int) -> dict:
    portal = BitrixPortal.objects.filter(pk=portal_id).first()
    if portal is None:
        return {"ok": False, "reason": "missing_portal"}

    if not portal_has_pro(portal):
        return {"ok": True, "reason": "not_pro"}

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


def _run_sync_step(portal, state: PortalCrmSyncState, previous_status: str) -> dict:
    now = timezone.now()
    window_start, window_end = warehouse_window(now)
    provider = BitrixReportDataProvider()
    client = provider.rest_client_factory(portal)
    ensure_portal_timezone(portal, client)
    sources = warehouse_sources_for_portal(portal)

    if previous_status == PortalCrmSyncState.Status.READY or _backfill_complete(state, window_start):
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
    lookback = window_end - timedelta(days=WAREHOUSE_INCREMENTAL_LOOKBACK_DAYS)
    modified_since = state.last_incremental_at or lookback
    written = 0

    modify_sources = [source for source in sources if source.get("type") in DATE_MODIFY_SOURCE_TYPES]
    event_sources = [source for source in sources if source.get("type") not in DATE_MODIFY_SOURCE_TYPES]

    written += _fetch_and_store(
        portal=portal,
        provider=provider,
        client=client,
        sources=modify_sources,
        date_from=window_start,
        date_to=window_end,
        modified_since=modified_since,
    )
    written += _fetch_and_store(
        portal=portal,
        provider=provider,
        client=client,
        sources=event_sources,
        date_from=lookback,
        date_to=window_end,
        modified_since=None,
    )

    prune_warehouse_rows(portal, now=window_end)
    state.status = PortalCrmSyncState.Status.READY
    state.coverage_from = window_start
    state.coverage_to = window_end
    state.next_chunk_to = window_start
    state.progress_percent = 100
    state.progress_message = "Склад готов"
    state.last_incremental_at = window_end
    state.last_finished_at = window_end
    state.error_message = ""
    state.save()
    return {"ok": True, "mode": "incremental", "written": written, "status": state.status}


def _fetch_and_store(*, portal, provider, client, sources, date_from, date_to, modified_since) -> int:
    written = 0
    for source in sources:
        try:
            rows = provider._load_single_source_rows(
                client=client,
                source=source,
                date_from=date_from,
                date_to=date_to,
                modified_since=modified_since,
            )
        except Exception:
            logger.warning(
                "CRM warehouse source load failed portal=%s source=%s",
                portal.pk,
                source.get("id"),
                exc_info=True,
            )
            continue
        written += upsert_source_rows(portal=portal, source_id=str(source.get("id") or ""), rows=rows)
    return written
