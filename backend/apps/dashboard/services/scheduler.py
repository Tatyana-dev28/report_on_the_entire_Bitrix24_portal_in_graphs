from __future__ import annotations

import logging
import threading
import time

from django.core.cache import cache
from django.db import close_old_connections

from apps.dashboard.constants import DASHBOARD_REFRESH_TICK_SECONDS


logger = logging.getLogger(__name__)
_LOCK_KEY = "dashboard:refresh-due-lock"
_started = False
_start_guard = threading.Lock()


def start_dashboard_refresh_scheduler() -> None:
    global _started

    with _start_guard:
        if _started:
            return
        _started = True

    thread = threading.Thread(
        target=_run_scheduler_loop,
        name="dashboard-refresh-scheduler",
        daemon=True,
    )
    thread.start()
    logger.info("Dashboard refresh scheduler started")


def _run_scheduler_loop() -> None:
    interval = max(30, int(DASHBOARD_REFRESH_TICK_SECONDS))
    time.sleep(min(15, interval))

    while True:
        try:
            _tick(interval)
        except Exception:
            logger.exception("Dashboard refresh scheduler tick failed")
        time.sleep(interval)


def _tick(interval: int) -> None:
    if not cache.add(_LOCK_KEY, "1", timeout=max(20, interval - 5)):
        return

    from apps.dashboard.services.refresh import refresh_due_portals

    close_old_connections()
    try:
        result = refresh_due_portals()
        if result.get("started") or result.get("recovered"):
            logger.info(
                "Dashboard scheduled refresh started=%s skipped=%s recovered=%s",
                result.get("started", 0),
                result.get("skipped", 0),
                result.get("recovered", 0),
            )
    finally:
        close_old_connections()
