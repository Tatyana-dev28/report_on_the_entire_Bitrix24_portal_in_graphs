from __future__ import annotations

import logging
import os
import threading
import time

from django.core.cache import cache
from django.db import close_old_connections, connection

from apps.dashboard.constants import DASHBOARD_REFRESH_TICK_SECONDS


logger = logging.getLogger(__name__)
_LOCK_KEY = "dashboard:refresh-due-lock"
_started_for_pid: int | None = None
_start_guard = threading.Lock()


def start_dashboard_refresh_scheduler() -> None:
    global _started_for_pid

    pid = os.getpid()
    with _start_guard:
        if _started_for_pid == pid:
            return
        _started_for_pid = pid

    thread = threading.Thread(
        target=_run_scheduler_loop,
        name=f"dashboard-refresh-scheduler-{pid}",
        daemon=True,
    )
    thread.start()
    logger.info("Dashboard refresh scheduler started pid=%s", pid)


def _run_scheduler_loop() -> None:
    interval = max(30, int(DASHBOARD_REFRESH_TICK_SECONDS))

    while True:
        try:
            _tick(interval)
        except Exception:
            logger.exception("Dashboard refresh scheduler tick failed")
        time.sleep(interval)


def _tick(interval: int) -> None:
    from apps.dashboard.services.refresh import refresh_due_portals

    close_old_connections()
    if not _acquire_tick_lock(interval):
        close_old_connections()
        return

    try:
        result = refresh_due_portals()
        logger.info(
            "Dashboard scheduled refresh tick started=%s skipped=%s recovered=%s",
            result.get("started", 0),
            result.get("skipped", 0),
            result.get("recovered", 0),
        )
    finally:
        _release_tick_lock()
        close_old_connections()


def _acquire_tick_lock(interval: int) -> bool:
    timeout = max(20, int(interval) - 5)
    if connection.vendor == "mysql":
        with connection.cursor() as cursor:
            cursor.execute("SELECT GET_LOCK(%s, 0)", [_LOCK_KEY])
            row = cursor.fetchone()
        return bool(row and row[0] == 1)

    return bool(cache.add(_LOCK_KEY, str(os.getpid()), timeout=timeout))


def _release_tick_lock() -> None:
    try:
        if connection.vendor == "mysql":
            with connection.cursor() as cursor:
                cursor.execute("SELECT RELEASE_LOCK(%s)", [_LOCK_KEY])
            return
        cache.delete(_LOCK_KEY)
    except Exception:
        logger.exception("Dashboard refresh scheduler failed to release tick lock")
