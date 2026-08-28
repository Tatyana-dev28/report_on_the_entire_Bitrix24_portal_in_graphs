from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from apps.bitrix.models import BitrixPortal
from apps.dashboard.constants import REFRESH_RUN_RETENTION_DAYS, SUCCESSFUL_SNAPSHOT_LIMIT
from apps.dashboard.models import DashboardPreparedSnapshot, DashboardRefreshRun


def prune_dashboard_history(*, portal: BitrixPortal | None = None) -> dict:
    """
    Cleans WEB-dashboard technical history according to approved first-stage rules.

    The function is intentionally not scheduled yet. Wiring it into periodic jobs
    should be done with the auto-refresh implementation.
    """

    portal_filter = Q()
    if portal is not None:
        portal_filter = Q(portal=portal)

    cutoff = timezone.now() - timedelta(days=REFRESH_RUN_RETENTION_DAYS)
    refresh_runs_deleted, _ = DashboardRefreshRun.all_objects.filter(
        portal_filter,
        created_at__lt=cutoff,
    ).hard_delete()

    snapshots_deleted = 0
    portal_ids = (
        DashboardPreparedSnapshot.all_objects.filter(portal_filter)
        .values_list("portal_id", flat=True)
        .distinct()
    )

    for portal_id in portal_ids:
        keep_ids = list(
            DashboardPreparedSnapshot.all_objects.filter(portal_id=portal_id)
            .order_by("-prepared_at", "-id")
            .values_list("id", flat=True)[:SUCCESSFUL_SNAPSHOT_LIMIT]
        )
        delete_query = DashboardPreparedSnapshot.all_objects.filter(portal_id=portal_id)
        if keep_ids:
            delete_query = delete_query.exclude(id__in=keep_ids)

        deleted_count, _ = delete_query.hard_delete()
        snapshots_deleted += deleted_count

    return {
        "refreshRunsDeleted": refresh_runs_deleted,
        "snapshotsDeleted": snapshots_deleted,
    }
