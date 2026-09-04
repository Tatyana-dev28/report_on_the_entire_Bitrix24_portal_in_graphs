from __future__ import annotations

try:
    from celery import shared_task
except ImportError:  # pragma: no cover - Celery is optional in local development.
    shared_task = None


if shared_task is not None:

    @shared_task(name="apps.dashboard.tasks.run_dashboard_refresh")
    def run_dashboard_refresh_task(run_id: int) -> None:
        from apps.dashboard.services.refresh import run_portal_refresh

        run_portal_refresh(run_id)

    @shared_task(name="apps.dashboard.tasks.refresh_due_dashboard_portals")
    def refresh_due_dashboard_portals() -> dict:
        from apps.dashboard.services.refresh import refresh_due_portals

        return refresh_due_portals()
