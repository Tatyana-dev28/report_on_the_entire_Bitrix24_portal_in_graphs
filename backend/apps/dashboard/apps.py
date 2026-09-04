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
    argv = [str(item).lower() for item in sys.argv]
    joined = " ".join(argv)

    if any(item.endswith("celery") or item == "celery" for item in argv):
        return False
    if "beat" in argv:
        return False
    if "manage.py" in joined and "runserver" not in joined:
        return False

    return True
