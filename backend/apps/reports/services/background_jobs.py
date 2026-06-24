from __future__ import annotations

import threading


def enqueue_report_build(build_id: int) -> str:
    job_id = f"local-thread:{build_id}"
    thread = threading.Thread(
        target=_run_report_build,
        args=(build_id,),
        name=f"report-build-{build_id}",
        daemon=True,
    )
    thread.start()
    return job_id


def _run_report_build(build_id: int) -> None:
    from django.db import close_old_connections

    from apps.reports.services.builders import ReportBuilder

    close_old_connections()
    try:
        ReportBuilder().run_queued_build(build_id)
    finally:
        close_old_connections()
