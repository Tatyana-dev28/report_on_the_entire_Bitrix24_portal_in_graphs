from __future__ import annotations

import threading

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


def enqueue_report_build(build_id: int) -> str:
    backend = getattr(settings, "REPORT_BACKGROUND_BACKEND", "thread").lower()

    if backend == "celery":
        return _enqueue_celery_report_build(build_id)

    if backend != "thread":
        raise ImproperlyConfigured(
            "REPORT_BACKGROUND_BACKEND must be one of: thread, celery."
        )

    job_id = f"local-thread:{build_id}"
    thread = threading.Thread(
        target=_run_report_build,
        args=(build_id,),
        name=f"report-build-{build_id}",
        daemon=True,
    )
    thread.start()
    return job_id


def _enqueue_celery_report_build(build_id: int) -> str:
    try:
        from apps.reports.tasks import run_report_build_task
    except ImportError as error:
        raise ImproperlyConfigured(
            "Celery is not installed. Install backend requirements or use REPORT_BACKGROUND_BACKEND=thread."
        ) from error

    async_result = run_report_build_task.delay(build_id)

    return f"celery:{async_result.id}"


def _run_report_build(build_id: int) -> None:
    from django.db import close_old_connections

    from apps.reports.services.builders import ReportBuilder

    close_old_connections()
    try:
        ReportBuilder().run_queued_build(build_id)
    finally:
        close_old_connections()
