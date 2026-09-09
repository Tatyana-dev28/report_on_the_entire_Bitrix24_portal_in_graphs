from __future__ import annotations

import logging
from datetime import datetime, timedelta

from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.billing.models import PortalAccess
from apps.reports.catalog import REPORT_SOURCES
from apps.reports.models import CrmSource, PortalCrmRow, PortalCrmSyncState


logger = logging.getLogger(__name__)

WAREHOUSE_WINDOW_DAYS = 180
WAREHOUSE_CHUNK_DAYS = 30
WAREHOUSE_INCREMENTAL_LOOKBACK_DAYS = 3
WAREHOUSE_INCREMENTAL_MIN_INTERVAL = timedelta(minutes=5)
WAREHOUSE_STALE_RUNNING = timedelta(minutes=20)
DATE_MODIFY_SOURCE_TYPES = {
    "deal",
    "lead",
    "invoice",
    "smartProcess",
    "quote",
    "company",
    "contact",
}


def portal_has_pro(portal) -> bool:
    if portal is None:
        return False
    access = PortalAccess.objects.filter(portal=portal).first()
    return bool(access and access.is_pro_valid)


def iter_pro_portal_ids() -> list[int]:
    now = timezone.now()
    queryset = PortalAccess.objects.filter(has_pro=True).exclude(
        access_level=PortalAccess.AccessLevel.BLOCKED,
    ).filter(Q(is_lifetime=True) | Q(valid_until__gte=now))
    return list(queryset.values_list("portal_id", flat=True))


def warehouse_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    moment = now or timezone.now()
    return moment - timedelta(days=WAREHOUSE_WINDOW_DAYS), moment


def serialize_fast_reports(portal) -> dict[str, str | None]:
    if not portal_has_pro(portal):
        return {"fastReports": None}

    state = PortalCrmSyncState.objects.filter(portal=portal).first()
    if state and state.status == PortalCrmSyncState.Status.READY:
        return {"fastReports": "ready"}
    return {"fastReports": "preparing"}


def warehouse_covers_range(
    portal,
    date_from: datetime,
    date_to: datetime,
    source_ids: list[str] | None = None,
) -> bool:
    if not portal_has_pro(portal):
        return False

    state = PortalCrmSyncState.objects.filter(portal=portal).first()
    if state is None:
        return False

    if (
        state.status == PortalCrmSyncState.Status.READY
        and state.coverage_from is not None
        and state.coverage_to is not None
        and state.coverage_from <= date_from
        and state.coverage_to >= date_to
    ):
        return True

    if not source_ids:
        return False

    coverage = state.source_coverage if isinstance(state.source_coverage, dict) else {}
    for source_id in source_ids:
        ranges = _source_coverage_ranges(coverage.get(str(source_id)))
        if not _ranges_cover(ranges, date_from, date_to):
            return False
    return True


def warehouse_sources_for_portal(portal) -> list[dict]:
    from apps.reports.services.bitrix_report_data_provider import (
        SUPPORTED_SOURCE_TYPES,
        _crm_source_to_report_source,
    )

    sources: list[dict] = []
    seen_ids: set[str] = set()

    for source in REPORT_SOURCES:
        source_id = str(source.get("id") or "")
        if not source_id or source.get("type") not in SUPPORTED_SOURCE_TYPES:
            continue
        sources.append(dict(source))
        seen_ids.add(source_id)

    portal_sources = CrmSource.objects.filter(
        portal=portal,
        is_active=True,
        is_available=True,
    )
    for source in portal_sources:
        if source.external_key in seen_ids:
            continue
        mapped = _crm_source_to_report_source(source)
        if mapped.get("type") not in SUPPORTED_SOURCE_TYPES:
            continue
        sources.append(mapped)
        seen_ids.add(source.external_key)

    return sources


def upsert_source_rows(*, portal, source_id: str, rows: list[dict]) -> int:
    from apps.reports.services.bitrix_report_data_provider import (
        _extract_raw_row_id,
        _extract_row_datetime,
    )

    if not rows:
        return 0

    objects: list[PortalCrmRow] = []
    fallback_occurred = timezone.now()

    for row in rows:
        if not isinstance(row, dict):
            continue
        entity_id = _extract_raw_row_id(row)
        if not entity_id:
            continue
        occurred_at = _extract_row_datetime(row) or fallback_occurred
        objects.append(
            PortalCrmRow(
                portal=portal,
                source_id=str(source_id),
                entity_id=entity_id[:64],
                occurred_at=occurred_at,
                payload=row,
            )
        )

    if not objects:
        return 0

    PortalCrmRow.objects.bulk_create(objects, **bulk_upsert_kwargs())
    return len(objects)


def bulk_upsert_kwargs() -> dict:
    kwargs = {
        "batch_size": 500,
        "update_conflicts": True,
        "update_fields": ["occurred_at", "payload"],
    }
    if connection.features.supports_update_conflicts_with_target:
        kwargs["unique_fields"] = ["portal", "source_id", "entity_id"]
    return kwargs


def load_warehouse_source_rows(
    *,
    portal,
    selected_sources: list[dict],
    date_from: datetime,
    date_to: datetime,
) -> dict[str, list[dict]]:
    rows_by_source: dict[str, list[dict]] = {}
    source_ids = [str(source.get("id") or "") for source in selected_sources if source.get("id")]

    stored = PortalCrmRow.objects.filter(
        portal=portal,
        source_id__in=source_ids,
        occurred_at__gte=date_from,
        occurred_at__lte=date_to,
    ).values_list("source_id", "payload")

    grouped: dict[str, list[dict]] = {source_id: [] for source_id in source_ids}
    for source_id, payload in stored:
        if isinstance(payload, dict):
            grouped.setdefault(source_id, []).append(payload)

    for source in selected_sources:
        source_id = str(source.get("id") or "")
        rows_by_source[source_id] = grouped.get(source_id, [])

    return rows_by_source


def persist_live_report_rows(
    *,
    portal,
    rows_by_source: dict[str, list[dict]],
    date_from: datetime,
    date_to: datetime,
    failed_source_ids: set[str] | None = None,
) -> None:
    if not portal_has_pro(portal):
        return

    skipped = failed_source_ids or set()
    for source_id, rows in rows_by_source.items():
        if not source_id or source_id in skipped:
            continue
        try:
            upsert_source_rows(portal=portal, source_id=source_id, rows=rows)
            extend_source_coverage(portal, source_id, date_from, date_to)
        except Exception:
            logger.exception(
                "Failed to persist live PRO report rows for portal=%s source=%s",
                getattr(portal, "id", None),
                source_id,
            )


def extend_source_coverage(portal, source_id: str, date_from: datetime, date_to: datetime) -> None:
    state, _created = PortalCrmSyncState.objects.get_or_create(portal=portal)
    coverage = dict(state.source_coverage or {}) if isinstance(state.source_coverage, dict) else {}
    ranges = _source_coverage_ranges(coverage.get(str(source_id)))
    ranges.append((date_from, date_to))
    merged = _merge_ranges(ranges)
    coverage[str(source_id)] = [
        {"from": start.isoformat(), "to": end.isoformat()}
        for start, end in merged
    ]
    state.source_coverage = coverage
    state.save(update_fields=["source_coverage", "updated_at"])


def _aware_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if timezone.is_naive(value):
        return timezone.make_aware(value, timezone.get_current_timezone())
    return value


def _parse_coverage_datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        return _aware_datetime(value)
    if not value:
        return None
    return _aware_datetime(parse_datetime(str(value)))


def _source_coverage_ranges(raw) -> list[tuple[datetime, datetime]]:
    items = raw if isinstance(raw, list) else ([raw] if isinstance(raw, dict) else [])
    ranges: list[tuple[datetime, datetime]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        start = _parse_coverage_datetime(item.get("from"))
        end = _parse_coverage_datetime(item.get("to"))
        if start is None or end is None or start > end:
            continue
        ranges.append((start, end))
    return ranges


def _merge_ranges(ranges: list[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    if not ranges:
        return []
    ordered = sorted(ranges, key=lambda item: item[0])
    merged = [ordered[0]]
    for start, end in ordered[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def _ranges_cover(ranges: list[tuple[datetime, datetime]], date_from: datetime, date_to: datetime) -> bool:
    for start, end in _merge_ranges(ranges):
        if start <= date_from and end >= date_to:
            return True
    return False


def prune_warehouse_rows(portal, *, now: datetime | None = None) -> int:
    moment = now or timezone.now()
    cutoff = moment - timedelta(days=WAREHOUSE_WINDOW_DAYS)
    state = PortalCrmSyncState.objects.filter(portal=portal).first()
    if state is not None:
        if state.coverage_from is not None:
            cutoff = min(cutoff, state.coverage_from)
        coverage = state.source_coverage if isinstance(state.source_coverage, dict) else {}
        for raw_ranges in coverage.values():
            for start, _end in _source_coverage_ranges(raw_ranges):
                cutoff = min(cutoff, start)
    deleted, _ = PortalCrmRow.objects.filter(portal=portal, occurred_at__lt=cutoff).delete()
    return int(deleted)


def get_or_create_sync_state(portal) -> PortalCrmSyncState:
    state, _created = PortalCrmSyncState.objects.get_or_create(portal=portal)
    return state


def mark_sync_running(state: PortalCrmSyncState, *, message: str = "") -> PortalCrmSyncState:
    now = timezone.now()
    state.status = PortalCrmSyncState.Status.RUNNING
    state.last_started_at = now
    state.error_message = ""
    if message:
        state.progress_message = message
    state.save(
        update_fields=[
            "status",
            "last_started_at",
            "error_message",
            "progress_message",
            "updated_at",
        ]
    )
    return state


def is_sync_lock_stale(state: PortalCrmSyncState) -> bool:
    if state.status != PortalCrmSyncState.Status.RUNNING:
        return False
    started = state.last_started_at or state.updated_at
    if started is None:
        return True
    return timezone.now() - started >= WAREHOUSE_STALE_RUNNING


def try_acquire_sync_lock(portal) -> tuple[PortalCrmSyncState, str] | tuple[None, None]:
    with transaction.atomic():
        state, _created = PortalCrmSyncState.objects.select_for_update().get_or_create(portal=portal)
        previous_status = state.status
        if state.status == PortalCrmSyncState.Status.RUNNING and not is_sync_lock_stale(state):
            return None, None
        mark_sync_running(state, message="Загрузка склада CRM")
        return state, previous_status
