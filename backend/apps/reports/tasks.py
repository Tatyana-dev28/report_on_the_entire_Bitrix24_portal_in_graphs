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

