"""Gunicorn hooks. Use with: gunicorn --config config/gunicorn.conf.py ..."""


def post_fork(server, worker):
    from apps.dashboard.services.scheduler import start_dashboard_refresh_scheduler

    start_dashboard_refresh_scheduler()
