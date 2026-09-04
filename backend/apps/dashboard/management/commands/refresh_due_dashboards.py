from django.core.management.base import BaseCommand

from apps.dashboard.services.refresh import refresh_due_portals


class Command(BaseCommand):
    help = "Start due WEB-dashboard snapshot refreshes even if gunicorn timer is idle."

    def handle(self, *args, **options):
        result = refresh_due_portals()
        self.stdout.write(
            f"started={result.get('started', 0)} "
            f"skipped={result.get('skipped', 0)} "
            f"recovered={result.get('recovered', 0)}"
        )
