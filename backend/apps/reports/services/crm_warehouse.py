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
from apps.reports.services.portal_timezone import get_portal_tzinfo


logger = logging.getLogger(__name__)

WAREHOUSE_WINDOW_DAYS = 180
WAREHOUSE_CHUNK_DAYS = 30
WAREHOUSE_BACKFILL_CHUNKS_PER_RUN = 3
WAREHOUSE_INCREMENTAL_LOOKBACK_DAYS = 2
WAREHOUSE_INCREMENTAL_MAX_CATCHUP_DAYS = 14
WAREHOUSE_INCREMENTAL_MIN_INTERVAL = timedelta(minutes=5)
WAREHOUSE_STALE_RUNNING = timedelta(minutes=20)
WAREHOUSE_COVERAGE_GRACE_DAYS = 1
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
    ).filter(
        Q(is_lifetime=True) | Q(valid_until__gte=now),
        portal__oauth_reauth_required=False,
    )
    return list(queryset.values_list("portal_id", flat=True))


def warehouse_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    moment = now or timezone.now()
    return moment - timedelta(days=WAREHOUSE_WINDOW_DAYS), moment


def serialize_fast_reports(portal) -> dict[str, str | None]:
    if not portal_has_pro(portal):
        return {"fastReports": None}

    state = PortalCrmSyncState.objects.filter(portal=portal).first()
    if state is None:
        return {"fastReports": "preparing"}

    window_start, window_end = warehouse_window()
    if _ready_window_covers(portal, state, window_start, window_end):
        return {"fastReports": "ready"}
    return {"fastReports": "preparing"}


def warehouse_covers_range(
    portal,
    date_from: datetime,
    date_to: datetime,
    source_ids: list[str] | None = None,
) -> bool:
    selected_ids = [str(source_id) for source_id in (source_ids or []) if source_id]
    if not selected_ids:
        return False
    return all(
        not warehouse_uncovered_ranges(portal, source_id, date_from, date_to)
        for source_id in selected_ids
    )


def warehouse_uncovered_ranges(
    portal,
    source_id: str,
    date_from: datetime,
    date_to: datetime,
) -> list[tuple[datetime, datetime]]:
    """Date ranges that must be fetched from Bitrix REST for this source."""

    if date_from > date_to:
        return []
    if not portal_has_pro(portal):
        return [(date_from, date_to)]

    state = PortalCrmSyncState.objects.filter(portal=portal).first()
    if state is None:
        return [(date_from, date_to)]

    coverage = state.source_coverage if isinstance(state.source_coverage, dict) else {}
    floor = _coverage_floor_for_reads(portal, state)
    source_ranges = _ranges_with_to_grace(
        portal,
        _clip_ranges_to_floor(_source_coverage_ranges(coverage.get(str(source_id))), floor),
        date_to,
    )

    if _source_requires_own_coverage(source_id):
        if not source_ranges:
            return [(date_from, date_to)]
        return _uncovered_ranges(date_from, date_to, source_ranges)

    # An empty warehouse must not trust a claimed 180-day window.
    if not PortalCrmRow.objects.filter(portal=portal).exists():
        return [(date_from, date_to)]

    combined = list(source_ranges)
    global_range = _honest_global_range(portal, state, date_to)
    if global_range is not None:
        combined.append(global_range)

    if not combined:
        if _source_has_rows(portal, source_id):
            oldest = (
                PortalCrmRow.objects.filter(portal=portal, source_id=str(source_id))
                .order_by("occurred_at")
                .values_list("occurred_at", flat=True)
                .first()
            )
            covered_to = _apply_coverage_to_grace(portal, state.coverage_to, date_to) or date_to
            return _uncovered_ranges(date_from, date_to, [(oldest, covered_to)])
        return []

    gaps = _uncovered_ranges(date_from, date_to, combined)
    if not gaps:
        return []

    # Report sits entirely before the latest stored 30-day chunk (e.g. May in
    # MySQL while the live window is August–September). Keep MySQL, do not REST.
    if floor is not None and _aware_datetime(date_to) is not None and _aware_datetime(date_to) < _aware_datetime(floor):
        return []

    # REST only fills holes in sources that already live in MySQL (or have
    # recorded coverage). Empty catalog sources stay as warehouse zeros.
    if source_ranges or _source_has_rows(portal, source_id):
        return gaps
    return []


def _ready_window_covers(portal, state, date_from: datetime, date_to: datetime) -> bool:
    if state.coverage_from is None or state.coverage_to is None:
        return False

    tz = get_portal_tzinfo(portal)
    today = timezone.localtime(timezone.now(), tz).date()
    covered_from = _local_date(state.coverage_from, tz)
    covered_to = _local_date(state.coverage_to, tz)
    # Same calendar day, or yesterday's sync, still covers a report that ends today.
    # Multi-day lag must not pretend 7–10 Sep are in MySQL if coverage stopped on the 6th.
    if 0 <= (today - covered_to).days <= WAREHOUSE_COVERAGE_GRACE_DAYS:
        covered_to = max(covered_to, today)
    return _local_date(date_from, tz) >= covered_from and _local_date(date_to, tz) <= covered_to


def _stored_rows_reach_from(portal, date_from: datetime) -> bool:
    oldest = (
        PortalCrmRow.objects.filter(portal=portal)
        .order_by("occurred_at")
        .values_list("occurred_at", flat=True)
        .first()
    )
    if oldest is None:
        return False
    tz = get_portal_tzinfo(portal)
    return _local_date(oldest, tz) <= _local_date(date_from, tz)


def _stored_source_rows_reach_from(portal, source_id: str, date_from: datetime) -> bool:
    oldest = (
        PortalCrmRow.objects.filter(portal=portal, source_id=str(source_id))
        .order_by("occurred_at")
        .values_list("occurred_at", flat=True)
        .first()
    )
    if oldest is None:
        return False
    tz = get_portal_tzinfo(portal)
    return _local_date(oldest, tz) <= _local_date(date_from, tz)


def _apply_coverage_to_grace(portal, covered_to: datetime | None, date_to: datetime) -> datetime | None:
    covered_to = _aware_datetime(covered_to)
    date_to = _aware_datetime(date_to)
    if covered_to is None or date_to is None:
        return covered_to
    tz = get_portal_tzinfo(portal)
    today = timezone.localtime(timezone.now(), tz).date()
    if 0 <= (today - _local_date(covered_to, tz)).days <= WAREHOUSE_COVERAGE_GRACE_DAYS:
        return max(covered_to, date_to)
    return covered_to


def _ranges_with_to_grace(
    portal,
    ranges: list[tuple[datetime, datetime]],
    date_to: datetime,
) -> list[tuple[datetime, datetime]]:
    return [
        (start, _apply_coverage_to_grace(portal, end, date_to) or end)
        for start, end in ranges
    ]


def _local_date(value: datetime, tz):
    moment = _aware_datetime(value)
    if moment is None:
        return timezone.localtime(timezone.now(), tz).date()
    return timezone.localtime(moment, tz).date()


def _source_requires_own_coverage(source_id: str) -> bool:
    return str(source_id or "").startswith("telephony-")


def _source_has_rows(portal, source_id: str) -> bool:
    return PortalCrmRow.objects.filter(portal=portal, source_id=str(source_id)).exists()


def _honest_global_range(portal, state: PortalCrmSyncState, date_to: datetime):
    floor = _coverage_floor_for_reads(portal, state)
    if floor is None or state.coverage_to is None:
        return None
    covered_to = _apply_coverage_to_grace(portal, state.coverage_to, date_to) or state.coverage_to
    floor = _aware_datetime(floor)
    covered_to = _aware_datetime(covered_to)
    if floor is None or covered_to is None or floor > covered_to:
        return None
    return (floor, covered_to)


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

    objects_by_entity: dict[str, PortalCrmRow] = {}
    fallback_occurred = timezone.now()
    normalized_source_id = str(source_id)

    for row in rows:
        if not isinstance(row, dict):
            continue
        entity_id = _extract_raw_row_id(row)
        if not entity_id:
            continue
        occurred_at = _extract_row_datetime(row) or fallback_occurred
        key = entity_id[:64]
        objects_by_entity[key] = PortalCrmRow(
            portal=portal,
            source_id=normalized_source_id,
            entity_id=key,
            occurred_at=occurred_at,
            payload=row,
        )

    objects = list(objects_by_entity.values())
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
    return not _uncovered_ranges(date_from, date_to, ranges)


def _uncovered_ranges(
    date_from: datetime,
    date_to: datetime,
    ranges: list[tuple[datetime, datetime]],
) -> list[tuple[datetime, datetime]]:
    start = _aware_datetime(date_from)
    end = _aware_datetime(date_to)
    if start is None or end is None or start > end:
        return []

    gaps: list[tuple[datetime, datetime]] = []
    cursor = start
    for covered_start, covered_end in _merge_ranges(ranges):
        covered_start = _aware_datetime(covered_start)
        covered_end = _aware_datetime(covered_end)
        if covered_start is None or covered_end is None or covered_end < cursor:
            continue
        if covered_start > cursor:
            gap_end = min(covered_start, end)
            if cursor < gap_end:
                gaps.append((cursor, gap_end))
        cursor = max(cursor, covered_end)
        if cursor >= end:
            break
    if cursor < end:
        gaps.append((cursor, end))
    return gaps


def _clip_ranges_to_floor(
    ranges: list[tuple[datetime, datetime]],
    floor: datetime | None,
) -> list[tuple[datetime, datetime]]:
    if floor is None:
        return ranges
    floor = _aware_datetime(floor)
    clipped: list[tuple[datetime, datetime]] = []
    for start, end in ranges:
        start = _aware_datetime(start)
        end = _aware_datetime(end)
        if floor is None or start is None or end is None or end < floor:
            continue
        clipped.append((max(start, floor), end))
    return clipped


def _coverage_floor_for_reads(portal, state: PortalCrmSyncState) -> datetime | None:
    window_start, _window_end = warehouse_window()
    floor = _aware_datetime(state.coverage_from)
    if floor is None:
        return None
    chunk_floor = timezone.now() - timedelta(days=WAREHOUSE_CHUNK_DAYS)
    if _needs_false_coverage_repair(portal, state, window_start):
        return chunk_floor
    if floor > window_start:
        # Backfill in progress. The latest stored chunk is 30 days, even if the
        # oldest row inside it is newer (quiet days at the start of the chunk).
        return min(floor, chunk_floor)
    return floor


def _needs_false_coverage_repair(portal, state: PortalCrmSyncState, window_start: datetime) -> bool:
    if state.coverage_from is None or state.coverage_from > window_start:
        return False
    now = timezone.now()
    recent_start = now - timedelta(days=WAREHOUSE_CHUNK_DAYS)
    previous_start = recent_start - timedelta(days=WAREHOUSE_CHUNK_DAYS)
    window_head_end = window_start + timedelta(days=WAREHOUSE_CHUNK_DAYS)
    has_window_head = PortalCrmRow.objects.filter(
        portal=portal,
        occurred_at__lte=window_head_end,
    ).exists()
    has_previous_chunk = PortalCrmRow.objects.filter(
        portal=portal,
        occurred_at__gte=previous_start,
        occurred_at__lt=recent_start,
    ).exists()
    return not (has_window_head and has_previous_chunk)


def _recent_block_frontier(portal):
    now = timezone.now()
    recent_start = now - timedelta(days=WAREHOUSE_CHUNK_DAYS)
    return (
        PortalCrmRow.objects.filter(
            portal=portal,
            occurred_at__gte=recent_start - timedelta(days=2),
        )
        .order_by("occurred_at")
        .values_list("occurred_at", flat=True)
        .first()
    )


def repair_false_warehouse_coverage(portal, state: PortalCrmSyncState, window_start: datetime) -> bool:
    """If MySQL only has recent rows but coverage_from claims 180 days, resume backfill.

    Incremental used to set coverage_from to the sliding window start without
    downloading older days. Reports then read MySQL and showed zeros at the
    start of a long range (e.g. 3–6 Aug in 3 Aug–6 Sep).

    Do not use the globally oldest row: a recently modified old deal would skip
    the August hole and resume backfill from March.
    """

    if state.coverage_from is None:
        return False
    if not _needs_false_coverage_repair(portal, state, window_start):
        _clip_source_coverage_to_floor(state)
        return False

    frontier = _recent_block_frontier(portal)
    if frontier is None:
        oldest = (
            PortalCrmRow.objects.filter(portal=portal)
            .order_by("occurred_at")
            .values_list("occurred_at", flat=True)
            .first()
        )
        if oldest is None:
            return False
        frontier = oldest

    slack = timedelta(days=2)
    if frontier <= state.coverage_from + slack:
        _clip_source_coverage_to_floor(state)
        return False

    state.coverage_from = frontier
    state.next_chunk_to = frontier
    if state.progress_percent >= 100:
        state.progress_percent = 99
    _clip_source_coverage_to_floor(state, persist=False)
    state.save(
        update_fields=[
            "coverage_from",
            "next_chunk_to",
            "progress_percent",
            "source_coverage",
            "updated_at",
        ]
    )
    logger.info(
        "CRM warehouse coverage repaired portal=%s coverage_from=%s (recent block)",
        getattr(portal, "pk", None),
        frontier.isoformat(),
    )
    return True


def _clip_source_coverage_to_floor(state: PortalCrmSyncState, *, persist: bool = True) -> None:
    floor = _aware_datetime(state.coverage_from)
    coverage = dict(state.source_coverage or {}) if isinstance(state.source_coverage, dict) else {}
    if not coverage or floor is None:
        return

    changed = False
    clipped: dict[str, list[dict]] = {}
    for source_id, raw in coverage.items():
        ranges = []
        for start, end in _source_coverage_ranges(raw):
            if end < floor:
                changed = True
                continue
            if start < floor:
                start = floor
                changed = True
            ranges.append((start, end))
        clipped[str(source_id)] = [
            {"from": item_start.isoformat(), "to": item_end.isoformat()}
            for item_start, item_end in _merge_ranges(ranges)
        ]

    if not changed:
        return
    state.source_coverage = clipped
    if persist:
        state.save(update_fields=["source_coverage", "updated_at"])


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
