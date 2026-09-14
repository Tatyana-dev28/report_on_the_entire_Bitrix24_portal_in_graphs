"""PRO banner status. A few lagging coverage_to days must not look like a 180-day download."""

from __future__ import annotations

from datetime import datetime

from django.utils import timezone

from apps.reports.models import PortalCrmSyncState
from apps.reports.services.crm_warehouse import WAREHOUSE_COVERAGE_GRACE_DAYS
from apps.reports.services.portal_timezone import get_portal_tzinfo


WAREHOUSE_BANNER_COVERAGE_TO_LAG_DAYS = WAREHOUSE_COVERAGE_GRACE_DAYS


def serialize_fast_reports(portal) -> dict[str, str | None]:
    from apps.reports.services.crm_warehouse import portal_has_pro, warehouse_window

    if not portal_has_pro(portal):
        return {"fastReports": None}

    state = PortalCrmSyncState.objects.filter(portal=portal).first()
    if state is None:
        return {"fastReports": "preparing"}

    window_start, window_end = warehouse_window()
    if _banner_window_covers(portal, state, window_start, window_end):
        return {"fastReports": "ready"}
    return {"fastReports": "preparing"}


def _banner_window_covers(portal, state, date_from: datetime, date_to: datetime) -> bool:
    if state.coverage_from is None or state.coverage_to is None:
        return False

    tz = get_portal_tzinfo(portal)
    today = timezone.localtime(timezone.now(), tz).date()
    covered_from = _local_date(state.coverage_from, tz)
    covered_to = _local_date(state.coverage_to, tz)
    lag_days = (today - covered_to).days
    if 0 <= lag_days <= WAREHOUSE_BANNER_COVERAGE_TO_LAG_DAYS:
        covered_to = max(covered_to, today)
    return _local_date(date_from, tz) >= covered_from and _local_date(date_to, tz) <= covered_to


def _local_date(value: datetime, tz):
    moment = value
    if timezone.is_naive(moment):
        moment = timezone.make_aware(moment, timezone.get_current_timezone())
    return timezone.localtime(moment, tz).date()
