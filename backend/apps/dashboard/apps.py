import sys

from django.apps import AppConfig


class DashboardConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.dashboard"
    verbose_name = "WEB-дашборд"

    def ready(self):
        if not _should_start_refresh_scheduler():
            return

        from apps.dashboard.services.scheduler import start_dashboard_refresh_scheduler

        start_dashboard_refresh_scheduler()


def _should_start_refresh_scheduler() -> bool:
    argv = " ".join(sys.argv).lower()
    skipped_commands = (
        "test",
        "migrate",
        "makemigrations",
        "shell",
        "collectstatic",
        "check",
        "celery",
        "worker",
        "beat",
    )
    if any(command in argv for command in skipped_commands):
        return False

    return True
