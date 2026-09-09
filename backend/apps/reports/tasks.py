from __future__ import annotations

try:
    from celery import shared_task
except ImportError:  # pragma: no cover - Celery is optional in local development.
    shared_task = None


if shared_task is not None:

    @shared_task(
        bind=True,
        autoretry_for=(Exception,),
        retry_backoff=True,
        retry_kwargs={"max_retries": 2},
    )
    def run_report_build_task(self, build_id: int) -> None:
        from apps.reports.services.builders import ReportBuilder

        ReportBuilder().run_queued_build(build_id)

    @shared_task(name="apps.reports.tasks.sync_due_crm_warehouses")
    def sync_due_crm_warehouses() -> dict:
        from apps.reports.services.crm_warehouse_sync import sync_due_crm_warehouses as run_due

        return run_due(enqueue=lambda portal_id: sync_portal_crm_warehouse_task.delay(portal_id))

    @shared_task(name="apps.reports.tasks.sync_portal_crm_warehouse")
    def sync_portal_crm_warehouse_task(portal_id: int) -> dict:
        from apps.reports.services.crm_warehouse_sync import sync_portal_crm_warehouse

        return sync_portal_crm_warehouse(portal_id)
