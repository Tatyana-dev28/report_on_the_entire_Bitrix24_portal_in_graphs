from datetime import timedelta

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from apps.bitrix.models import BitrixPortal
from apps.dashboard.constants import (
    ALLOWED_REFRESH_INTERVAL_MINUTES,
    DEFAULT_REFRESH_INTERVAL_MINUTES,
    REFRESH_RUN_RETENTION_DAYS,
    SUCCESSFUL_SNAPSHOT_LIMIT,
)
from apps.dashboard.models import DashboardPreparedSnapshot, DashboardRefreshRun
from apps.dashboard.services.retention import prune_dashboard_history


@override_settings(SECURE_SSL_REDIRECT=False)
class OwnerDashboardBootstrapTests(TestCase):
    def test_bootstrap_requires_future_owner_confirmation(self):
        response = self.client.get(reverse("dashboard:owner-bootstrap"))

        self.assertEqual(response.status_code, 200)

        payload = response.json()

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["access"], "needs_confirmation")
        self.assertIsNone(payload["portal"])
        self.assertEqual(payload["reports"], [])
        self.assertIsNone(payload["selectedReportId"])
        self.assertIsNone(payload["refreshStatus"])
        self.assertEqual(
            payload["refreshPolicy"],
            {
                "defaultIntervalMinutes": DEFAULT_REFRESH_INTERVAL_MINUTES,
                "allowedIntervalMinutes": list(ALLOWED_REFRESH_INTERVAL_MINUTES),
                "refreshRunRetentionDays": REFRESH_RUN_RETENTION_DAYS,
                "successfulSnapshotLimit": SUCCESSFUL_SNAPSHOT_LIMIT,
                "shareLinksMode": "view_only",
            },
        )


class DashboardRetentionTests(TestCase):
    def setUp(self):
        self.portal = BitrixPortal.objects.create(
            member_id="test-member",
            domain="test.bitrix24.ru",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.ACTIVE,
        )

    def test_prune_keeps_three_latest_successful_snapshots(self):
        snapshots = [
            DashboardPreparedSnapshot.objects.create(
                portal=self.portal,
                prepared_at=timezone.now() - timedelta(minutes=index),
                data={"value": index},
            )
            for index in range(5)
        ]

        result = prune_dashboard_history(portal=self.portal)

        self.assertEqual(result["snapshotsDeleted"], 2)
        self.assertEqual(
            list(
                DashboardPreparedSnapshot.all_objects.filter(portal=self.portal)
                .order_by("-prepared_at")
                .values_list("id", flat=True)
            ),
            [snapshot.id for snapshot in snapshots[:3]],
        )

    def test_prune_removes_refresh_runs_older_than_retention(self):
        old_run = DashboardRefreshRun.objects.create(
            portal=self.portal,
            status=DashboardRefreshRun.Status.FAILED,
            error_message="Bitrix24 API error",
        )
        DashboardRefreshRun.all_objects.filter(id=old_run.id).update(
            created_at=timezone.now() - timedelta(days=REFRESH_RUN_RETENTION_DAYS + 1),
        )
        recent_run = DashboardRefreshRun.objects.create(
            portal=self.portal,
            status=DashboardRefreshRun.Status.SUCCESS,
        )

        result = prune_dashboard_history(portal=self.portal)

        self.assertEqual(result["refreshRunsDeleted"], 1)
        self.assertFalse(DashboardRefreshRun.all_objects.filter(id=old_run.id).exists())
        self.assertTrue(DashboardRefreshRun.objects.filter(id=recent_run.id).exists())
