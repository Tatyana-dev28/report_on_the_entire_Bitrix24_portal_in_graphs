from django.http import JsonResponse
from django.views.decorators.http import require_GET


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
        },
        json_dumps_params={"ensure_ascii": False},
    )
