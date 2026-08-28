from django.http import JsonResponse
from django.views.decorators.http import require_GET

from apps.dashboard.constants import (
    ALLOWED_REFRESH_INTERVAL_MINUTES,
    DEFAULT_REFRESH_INTERVAL_MINUTES,
    REFRESH_RUN_RETENTION_DAYS,
    SUCCESSFUL_SNAPSHOT_LIMIT,
)


@require_GET
def owner_dashboard_bootstrap_view(request):
    """
    Initial contract for the external owner WEB-dashboard.

    The final owner verification flow is intentionally not implemented here:
    OQ-5 from the PRO dashboard spec must be approved first.
    """

    return JsonResponse(
        {
            "ok": True,
            "access": "needs_confirmation",
            "portal": None,
            "reports": [],
            "selectedReportId": None,
            "refreshStatus": None,
            "refreshPolicy": {
                "defaultIntervalMinutes": DEFAULT_REFRESH_INTERVAL_MINUTES,
                "allowedIntervalMinutes": list(ALLOWED_REFRESH_INTERVAL_MINUTES),
                "refreshRunRetentionDays": REFRESH_RUN_RETENTION_DAYS,
                "successfulSnapshotLimit": SUCCESSFUL_SNAPSHOT_LIMIT,
                "shareLinksMode": "view_only",
            },
        },
        json_dumps_params={"ensure_ascii": False},
    )
