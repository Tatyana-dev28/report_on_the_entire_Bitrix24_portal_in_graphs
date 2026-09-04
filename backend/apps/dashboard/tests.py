import json
from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from apps.billing.models import PortalAccess
from apps.bitrix.models import BitrixPortal
from apps.bitrix.services.portal_tokens import make_portal_api_token
from apps.dashboard.constants import (
    ALLOWED_REFRESH_INTERVAL_MINUTES,
    DASHBOARD_ACCESS_COOKIE_NAME,
    DASHBOARD_SHARE_COOKIE_NAME,
    DEFAULT_REFRESH_INTERVAL_MINUTES,
    REFRESH_RUN_RETENTION_DAYS,
    SUCCESSFUL_SNAPSHOT_LIMIT,
)
from apps.dashboard.models import (
    DashboardAccessSession,
    DashboardPreparedSnapshot,
    DashboardRefreshRun,
    DashboardShareLink,
)
from apps.dashboard.services.access_sessions import create_dashboard_access_session
from apps.dashboard.services.refresh import (
    DashboardRefreshError,
    request_portal_refresh,
    run_portal_refresh,
    refresh_due_portals,
    sync_portal_refresh_interval,
)
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


@override_settings(SECURE_SSL_REDIRECT=False)
class DashboardAccessSessionApiTests(TestCase):
    def setUp(self):
        self.portal = BitrixPortal.objects.create(
            member_id="test-member",
            domain="test.bitrix24.ru",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.ACTIVE,
        )
        self.portal_token = make_portal_api_token(portal=self.portal, bitrix_user_id="42")

    def test_confirm_rejects_request_without_owner_context(self):
        response = self.client.post(
            reverse("dashboard:owner-access-confirm"),
            data=json.dumps({"trusted": True}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(DashboardAccessSession.objects.exists())

    def test_confirm_creates_trusted_access_session(self):
        response = self.client.post(
            reverse("dashboard:owner-access-confirm"),
            data=json.dumps(
                {
                    "trusted": True,
                    "portalToken": self.portal_token,
                    "bitrixUserId": "42",
                    "bitrixUserName": "Test User",
                }
            ),
            content_type="application/json",
            HTTP_USER_AGENT="Dashboard test",
        )

        self.assertEqual(response.status_code, 200)

        payload = response.json()
        session = DashboardAccessSession.objects.get()

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["access"], "authorized")
        self.assertEqual(payload["session"]["id"], str(session.public_id))
        self.assertTrue(payload["session"]["trusted"])
        self.assertEqual(session.portal, self.portal)
        self.assertEqual(session.bitrix_user_id, "42")
        self.assertEqual(session.user_name, "Test User")
        self.assertTrue(session.is_trusted_device)
        self.assertIn(DASHBOARD_ACCESS_COOKIE_NAME, response.cookies)
        self.assertTrue(response.cookies[DASHBOARD_ACCESS_COOKIE_NAME]["httponly"])

    def test_confirm_creates_session_cookie_for_untrusted_access(self):
        response = self.client.post(
            reverse("dashboard:owner-access-confirm"),
            data=json.dumps(
                {
                    "trusted": False,
                    "portalToken": self.portal_token,
                    "bitrixUserId": "42",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)

        session = DashboardAccessSession.objects.get()

        self.assertFalse(session.is_trusted_device)
        self.assertEqual(response.cookies[DASHBOARD_ACCESS_COOKIE_NAME]["max-age"], "")

    def test_end_marks_current_session_as_ended(self):
        _session, raw_token = create_dashboard_access_session(
            portal=self.portal,
            user=None,
            bitrix_user_id="42",
            user_name="",
            is_trusted_device=False,
        )
        self.client.cookies[DASHBOARD_ACCESS_COOKIE_NAME] = raw_token

        response = self.client.post(
            reverse("dashboard:owner-access-end"),
            data=json.dumps({}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ended"])

        _session.refresh_from_db()
        self.assertIsNotNone(_session.ended_at)

    def test_revoke_all_closes_user_sessions(self):
        first_session, _first_token = create_dashboard_access_session(
            portal=self.portal,
            user=None,
            bitrix_user_id="42",
            user_name="",
            is_trusted_device=True,
        )
        second_session, _second_token = create_dashboard_access_session(
            portal=self.portal,
            user=None,
            bitrix_user_id="42",
            user_name="",
            is_trusted_device=False,
        )

        response = self.client.post(
            reverse("dashboard:owner-access-revoke-all"),
            data=json.dumps(
                {
                    "portalToken": self.portal_token,
                    "bitrixUserId": "42",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["revokedCount"], 2)

        first_session.refresh_from_db()
        second_session.refresh_from_db()
        self.assertIsNotNone(first_session.revoked_at)
        self.assertIsNotNone(second_session.revoked_at)

    def test_bootstrap_returns_authorized_context_for_valid_dashboard_cookie(self):
        _session, raw_token = create_dashboard_access_session(
            portal=self.portal,
            user=None,
            bitrix_user_id="42",
            user_name="",
            is_trusted_device=True,
        )
        DashboardPreparedSnapshot.objects.create(
            portal=self.portal,
            is_current=True,
            saved_views_snapshot=[
                {
                    "value": "sales",
                    "label": "Продажи",
                    "isDefault": True,
                }
            ],
        )
        self.client.cookies[DASHBOARD_ACCESS_COOKIE_NAME] = raw_token

        response = self.client.get(reverse("dashboard:owner-bootstrap"))

        self.assertEqual(response.status_code, 200)

        payload = response.json()

        self.assertEqual(payload["access"], "authorized")
        self.assertEqual(payload["portal"]["domain"], self.portal.domain)
        self.assertEqual(payload["reports"], [{"id": "sales", "name": "Продажи", "isDefault": True}])
        self.assertEqual(payload["selectedReportId"], "sales")

    def test_owner_catalog_requires_dashboard_cookie(self):
        response = self.client.get(reverse("dashboard:owner-catalog"))

        self.assertEqual(response.status_code, 401)

    def test_owner_catalog_returns_snapshot_catalog_for_valid_cookie(self):
        _session, raw_token = create_dashboard_access_session(
            portal=self.portal,
            user=None,
            bitrix_user_id="42",
            user_name="",
            is_trusted_device=True,
        )
        DashboardPreparedSnapshot.objects.create(
            portal=self.portal,
            is_current=True,
            data={
                "catalog": {
                    "periods": [{"value": "days", "label": "По дням"}],
                    "sources": [{"id": "lead-default", "title": "Лиды"}],
                    "metricSections": [{"id": "leads", "label": "Лиды", "metricIds": ["leads_created"]}],
                    "metrics": [{"id": "leads_created", "label": "Создано лидов", "type": "number"}],
                }
            },
        )
        self.client.cookies[DASHBOARD_ACCESS_COOKIE_NAME] = raw_token

        response = self.client.get(reverse("dashboard:owner-catalog"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sources"], [{"id": "lead-default", "title": "Лиды"}])

    def test_owner_preview_returns_current_snapshot_data_for_valid_cookie(self):
        _session, raw_token = create_dashboard_access_session(
            portal=self.portal,
            user=None,
            bitrix_user_id="42",
            user_name="",
            is_trusted_device=True,
        )
        DashboardPreparedSnapshot.objects.create(
            portal=self.portal,
            is_current=True,
            data={
                "preview": {
                    "data": [
                        {
                            "key": "2026-08-31",
                            "label": "31 авг.",
                            "tooltipLabel": "31 августа 2026",
                            "indicator": 10,
                            "values": {"leads_created": 10},
                        }
                    ],
                    "employees": [{"id": "42", "name": "Test User", "values": {"leads_created": 10}}],
                    "details": [{"id": "lead-1", "metricId": "leads_created", "title": "Лид"}],
                }
            },
        )
        self.client.cookies[DASHBOARD_ACCESS_COOKIE_NAME] = raw_token

        response = self.client.post(
            reverse("dashboard:owner-preview"),
            data=json.dumps({}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)

        payload = response.json()

        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["data"][0]["values"]["leads_created"], 10)
        self.assertEqual(payload["employees"][0]["id"], "42")
        self.assertEqual(payload["details"][0]["id"], "lead-1")

    def test_owner_employees_returns_snapshot_employees_for_valid_cookie(self):
        _session, raw_token = create_dashboard_access_session(
            portal=self.portal,
            user=None,
            bitrix_user_id="42",
            user_name="",
            is_trusted_device=True,
        )
        DashboardPreparedSnapshot.objects.create(
            portal=self.portal,
            is_current=True,
            data={
                "employees": [
                    {
                        "id": "42",
                        "name": "Test User",
                    }
                ]
            },
        )
        self.client.cookies[DASHBOARD_ACCESS_COOKIE_NAME] = raw_token

        response = self.client.get(reverse("dashboard:owner-employees"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["employees"], [{"id": "42", "name": "Test User"}])

    def test_save_snapshot_requires_pro_access(self):
        response = self.client.post(
            reverse("dashboard:owner-snapshot-save"),
            data=json.dumps(
                {
                    "portalToken": self.portal_token,
                    "bitrixUserId": "42",
                    "settings": {},
                    "savedViews": [],
                    "data": {},
                    "metadata": {},
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(DashboardPreparedSnapshot.objects.exists())

    def test_save_snapshot_creates_current_snapshot_and_refresh_run_for_pro_portal(self):
        PortalAccess.objects.create(
            portal=self.portal,
            access_level=PortalAccess.AccessLevel.PRO,
            has_pro=True,
            is_lifetime=True,
        )
        old_snapshot = DashboardPreparedSnapshot.objects.create(
            portal=self.portal,
            is_current=True,
            data={"preview": {"data": []}},
        )

        response = self.client.post(
            reverse("dashboard:owner-snapshot-save"),
            data=json.dumps(
                {
                    "portalToken": self.portal_token,
                    "bitrixUserId": "42",
                    "refreshIntervalMinutes": 30,
                    "settings": {"filters": {"period": "days"}},
                    "savedViews": [{"value": "sales", "label": "Продажи"}],
                    "data": {
                        "preview": {
                            "data": [
                                {
                                    "key": "2026-09-01",
                                    "label": "1 сент.",
                                    "tooltipLabel": "1 сентября 2026",
                                    "indicator": 12,
                                    "values": {"leads_created": 12},
                                }
                            ]
                        }
                    },
                    "metadata": {"source": "test"},
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)

        old_snapshot.refresh_from_db()
        self.assertFalse(old_snapshot.is_current)

        snapshot = DashboardPreparedSnapshot.objects.get(is_current=True)
        refresh_run = DashboardRefreshRun.objects.get(snapshot=snapshot)

        self.assertEqual(snapshot.refresh_interval_minutes, 30)
        self.assertEqual(snapshot.settings_snapshot["filters"]["period"], "days")
        self.assertEqual(snapshot.saved_views_snapshot, [{"value": "sales", "label": "Продажи"}])
        self.assertEqual(snapshot.data["preview"]["data"][0]["values"]["leads_created"], 12)
        self.assertGreater(snapshot.payload_size_bytes, 0)
        self.assertEqual(refresh_run.status, DashboardRefreshRun.Status.SUCCESS)
        self.assertEqual(refresh_run.trigger_type, DashboardRefreshRun.TriggerType.MANUAL)
        self.assertEqual(refresh_run.requested_by_bitrix_user_id, "42")
        self.assertIsNotNone(refresh_run.next_planned_at)

    def test_bootstrap_returns_refresh_status_from_saved_snapshot_run(self):
        PortalAccess.objects.create(
            portal=self.portal,
            access_level=PortalAccess.AccessLevel.PRO,
            has_pro=True,
            is_lifetime=True,
        )
        _session, raw_token = create_dashboard_access_session(
            portal=self.portal,
            user=None,
            bitrix_user_id="42",
            user_name="",
            is_trusted_device=True,
        )
        snapshot = DashboardPreparedSnapshot.objects.create(
            portal=self.portal,
            is_current=True,
            saved_views_snapshot=[{"value": "sales", "label": "Продажи"}],
        )
        finished_at = timezone.now()
        next_planned_at = finished_at + timedelta(minutes=10)
        DashboardRefreshRun.objects.create(
            portal=self.portal,
            snapshot=snapshot,
            status=DashboardRefreshRun.Status.SUCCESS,
            finished_at=finished_at,
            next_planned_at=next_planned_at,
        )
        self.client.cookies[DASHBOARD_ACCESS_COOKIE_NAME] = raw_token

        response = self.client.get(reverse("dashboard:owner-bootstrap"))

        self.assertEqual(response.status_code, 200)

        refresh_status = response.json()["refreshStatus"]

        self.assertEqual(refresh_status["lastSuccessfulUpdateAt"], finished_at.isoformat())
        self.assertEqual(refresh_status["nextUpdateAt"], next_planned_at.isoformat())
        self.assertFalse(refresh_status["isRefreshing"])


@override_settings(SECURE_SSL_REDIRECT=False)
class DashboardLaunchTokenApiTests(TestCase):
    def setUp(self):
        self.portal = BitrixPortal.objects.create(
            member_id="test-member",
            domain="test.bitrix24.ru",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.ACTIVE,
        )
        self.portal_token = make_portal_api_token(portal=self.portal, bitrix_user_id="42")
        PortalAccess.objects.create(
            portal=self.portal,
            access_level=PortalAccess.AccessLevel.PRO,
            has_pro=True,
            is_lifetime=True,
        )

    def test_launch_link_requires_pro_and_portal_token(self):
        response = self.client.post(
            reverse("dashboard:owner-launch-link"),
            data=json.dumps({}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)

    def test_launch_link_returns_one_time_token_for_pro_owner(self):
        response = self.client.post(
            reverse("dashboard:owner-launch-link"),
            data=json.dumps(
                {
                    "portalToken": self.portal_token,
                    "bitrixUserId": "42",
                    "bitrixUserName": "Test User",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["launchToken"])
        self.assertEqual(payload["expiresInSeconds"], 300)

    def test_confirm_accepts_launch_token_without_portal_token(self):
        launch_response = self.client.post(
            reverse("dashboard:owner-launch-link"),
            data=json.dumps(
                {
                    "portalToken": self.portal_token,
                    "bitrixUserId": "42",
                    "bitrixUserName": "Test User",
                }
            ),
            content_type="application/json",
        )
        launch_token = launch_response.json()["launchToken"]

        response = self.client.post(
            reverse("dashboard:owner-access-confirm"),
            data=json.dumps({"trusted": True, "launchToken": launch_token}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["access"], "authorized")
        self.assertTrue(DashboardAccessSession.objects.filter(bitrix_user_id="42").exists())

        reused = self.client.post(
            reverse("dashboard:owner-access-confirm"),
            data=json.dumps({"trusted": True, "launchToken": launch_token}),
            content_type="application/json",
        )

        self.assertEqual(reused.status_code, 403)


@override_settings(SECURE_SSL_REDIRECT=False, REPORT_DATA_PROVIDER="empty")
class DashboardRefreshTests(TestCase):
    def setUp(self):
        self.portal = BitrixPortal.objects.create(
            member_id="refresh-member",
            domain="refresh.bitrix24.ru",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.ACTIVE,
        )
        PortalAccess.objects.create(
            portal=self.portal,
            access_level=PortalAccess.AccessLevel.PRO,
            has_pro=True,
            is_lifetime=True,
        )
        self.snapshot = DashboardPreparedSnapshot.objects.create(
            portal=self.portal,
            is_current=True,
            refresh_interval_minutes=10,
            settings_snapshot={
                "period": "days",
                "dateRange": {"start": "2026-09-01", "end": "2026-09-03"},
                "selectedSources": ["lead-default"],
                "enabledMetricIdsBySection": {"leads": ["leads_created"]},
            },
            saved_views_snapshot=[{"value": "sales", "label": "Продажи", "isDefault": True}],
            data={"preview": {"data": [{"key": "old", "values": {"leads_created": 1}}]}},
        )

    def test_refresh_without_snapshot_is_rejected(self):
        DashboardPreparedSnapshot.objects.all().delete()

        with self.assertRaises(DashboardRefreshError):
            request_portal_refresh(portal=self.portal, enqueue=False)

    def test_manual_refresh_is_locked_while_running(self):
        first_run, accepted = request_portal_refresh(portal=self.portal, enqueue=False)

        self.assertTrue(accepted)
        self.assertEqual(first_run.status, DashboardRefreshRun.Status.PENDING)

        second_run, second_accepted = request_portal_refresh(portal=self.portal, enqueue=False)

        self.assertFalse(second_accepted)
        self.assertEqual(second_run.id, first_run.id)
        self.assertEqual(DashboardRefreshRun.objects.filter(portal=self.portal).count(), 1)

    def test_successful_refresh_replaces_current_snapshot(self):
        run, _accepted = request_portal_refresh(portal=self.portal, enqueue=False)
        run_portal_refresh(run.id)

        run.refresh_from_db()
        self.snapshot.refresh_from_db()
        current = DashboardPreparedSnapshot.objects.get(is_current=True)

        self.assertEqual(run.status, DashboardRefreshRun.Status.SUCCESS)
        self.assertFalse(self.snapshot.is_current)
        self.assertNotEqual(current.id, self.snapshot.id)
        self.assertIsNotNone(run.next_planned_at)

    def test_failed_refresh_keeps_previous_snapshot(self):
        provider = MagicMock()
        provider.build_preview.side_effect = Exception("Bitrix24 API error")

        run, _accepted = request_portal_refresh(portal=self.portal, enqueue=False)
        with patch("apps.dashboard.services.refresh.get_report_data_provider", return_value=provider):
            run_portal_refresh(run.id)

        run.refresh_from_db()
        self.snapshot.refresh_from_db()

        self.assertEqual(run.status, DashboardRefreshRun.Status.FAILED)
        self.assertTrue(self.snapshot.is_current)
        self.assertIsNotNone(run.next_planned_at)
        self.assertEqual(
            DashboardPreparedSnapshot.objects.filter(portal=self.portal, is_current=True).count(),
            1,
        )

    def test_due_portals_start_scheduled_refresh(self):
        finished_at = timezone.now() - timedelta(minutes=20)
        DashboardRefreshRun.objects.create(
            portal=self.portal,
            snapshot=self.snapshot,
            status=DashboardRefreshRun.Status.SUCCESS,
            finished_at=finished_at,
            next_planned_at=timezone.now() - timedelta(minutes=1),
        )

        with patch("apps.dashboard.services.refresh.enqueue_dashboard_refresh", return_value="test-job"):
            result = refresh_due_portals()

        self.assertEqual(result["started"], 1)
        self.assertTrue(
            DashboardRefreshRun.objects.filter(
                portal=self.portal,
                trigger_type=DashboardRefreshRun.TriggerType.SCHEDULED,
                status=DashboardRefreshRun.Status.PENDING,
            ).exists()
        )

    def test_owner_refresh_endpoint_requires_session_and_starts_run(self):
        _session, raw_token = create_dashboard_access_session(
            portal=self.portal,
            user=None,
            bitrix_user_id="42",
            user_name="",
            is_trusted_device=True,
        )
        self.client.cookies[DASHBOARD_ACCESS_COOKIE_NAME] = raw_token

        with patch("apps.dashboard.services.refresh.enqueue_dashboard_refresh", return_value="test-job"):
            response = self.client.post(
                reverse("dashboard:owner-refresh"),
                data=json.dumps({}),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["accepted"])
        self.assertTrue(payload["refreshStatus"]["isRefreshing"])

    def test_refresh_with_settings_creates_snapshot_when_missing(self):
        DashboardPreparedSnapshot.objects.all().delete()

        run, accepted = request_portal_refresh(
            portal=self.portal,
            enqueue=False,
            settings={
                "period": "days",
                "dateRange": {"start": "2026-09-01", "end": "2026-09-03"},
                "selectedSources": ["lead-default"],
                "chartSelectedSources": ["lead-default"],
                "enabledMetricIdsBySection": {"leads": ["leads_created"]},
            },
        )

        self.assertTrue(accepted)
        self.assertTrue(DashboardPreparedSnapshot.objects.filter(portal=self.portal, is_current=True).exists())
        self.assertEqual(run.status, DashboardRefreshRun.Status.PENDING)

    def test_owner_refresh_saves_settings_and_does_not_500_when_enqueue_fails(self):
        _session, raw_token = create_dashboard_access_session(
            portal=self.portal,
            user=None,
            bitrix_user_id="42",
            user_name="",
            is_trusted_device=True,
        )
        self.client.cookies[DASHBOARD_ACCESS_COOKIE_NAME] = raw_token

        with patch(
            "apps.dashboard.services.refresh.enqueue_dashboard_refresh",
            side_effect=RuntimeError("redis down"),
        ):
            response = self.client.post(
                reverse("dashboard:owner-refresh"),
                data=json.dumps({
                    "settings": {
                        "period": "weeks",
                        "selectedSources": ["deal-default"],
                        "chartSelectedSources": ["deal-default"],
                    }
                }),
                content_type="application/json",
            )

        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.json()["ok"])
        self.snapshot.refresh_from_db()
        self.assertEqual(self.snapshot.settings_snapshot["period"], "weeks")

    def test_app_settings_interval_is_used_for_next_refresh(self):
        from apps.reports.models import PortalReportSettings

        PortalReportSettings.objects.create(
            portal=self.portal,
            app_settings={"dashboardRefreshIntervalMinutes": 30},
        )
        run, accepted = request_portal_refresh(portal=self.portal, enqueue=False)

        self.assertTrue(accepted)
        self.assertEqual(run.refresh_interval_minutes, 30)

    def test_owner_can_change_refresh_interval_without_rebuild(self):
        interval = sync_portal_refresh_interval(self.portal, 60)
        self.snapshot.refresh_from_db()

        self.assertEqual(interval, 60)
        self.assertEqual(self.snapshot.refresh_interval_minutes, 60)

        _session, raw_token = create_dashboard_access_session(
            portal=self.portal,
            user=None,
            bitrix_user_id="42",
            user_name="",
            is_trusted_device=True,
        )
        self.client.cookies[DASHBOARD_ACCESS_COOKIE_NAME] = raw_token
        response = self.client.post(
            reverse("dashboard:owner-refresh-interval"),
            data=json.dumps({"refreshIntervalMinutes": 30}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["refreshIntervalMinutes"], 30)
        self.snapshot.refresh_from_db()
        self.assertEqual(self.snapshot.refresh_interval_minutes, 30)


@override_settings(SECURE_SSL_REDIRECT=False)
class DashboardShareLinkTests(TestCase):
    def setUp(self):
        self.portal = BitrixPortal.objects.create(
            member_id="share-member",
            domain="share.bitrix24.ru",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.ACTIVE,
        )
        self.portal_token = make_portal_api_token(portal=self.portal, bitrix_user_id="42")
        PortalAccess.objects.create(
            portal=self.portal,
            access_level=PortalAccess.AccessLevel.PRO,
            has_pro=True,
            is_lifetime=True,
        )
        self.snapshot = DashboardPreparedSnapshot.objects.create(
            portal=self.portal,
            is_current=True,
            refresh_interval_minutes=10,
            settings_snapshot={"period": "days"},
            saved_views_snapshot=[
                {
                    "value": "sales",
                    "label": "Продажи",
                    "isDefault": True,
                    "state": {
                        "appliedFilters": {"period": "days"},
                        "draftFilters": {"period": "days"},
                    },
                },
                {
                    "value": "leads",
                    "label": "Лиды",
                },
            ],
            data={
                "preview": {
                    "data": [{"key": "2026-09-01", "values": {"leads_created": 7}}],
                    "employees": [{"id": "42", "name": "Test User"}],
                }
            },
        )

    def _create_link(self, report_id="sales", expires_in_days=7):
        response = self.client.post(
            reverse("dashboard:owner-share-links"),
            data=json.dumps(
                {
                    "portalToken": self.portal_token,
                    "bitrixUserId": "42",
                    "reportId": report_id,
                    "expiresInDays": expires_in_days,
                }
            ),
            content_type="application/json",
        )
        return response

    def test_create_share_link_requires_pro_and_saved_report(self):
        PortalAccess.objects.filter(portal=self.portal).delete()

        response = self._create_link()

        self.assertEqual(response.status_code, 403)
        self.assertFalse(DashboardShareLink.objects.exists())

    def test_create_share_link_returns_unguessable_token_once(self):
        response = self._create_link()

        self.assertEqual(response.status_code, 200)
        payload = response.json()["shareLink"]
        self.assertTrue(payload["token"])
        self.assertEqual(payload["reportId"], "sales")
        self.assertTrue(payload["isAvailable"])
        self.assertEqual(DashboardShareLink.objects.count(), 1)
        self.assertNotEqual(DashboardShareLink.objects.get().token_hash, payload["token"])

    def test_share_open_returns_only_selected_report(self):
        token = self._create_link().json()["shareLink"]["token"]

        response = self.client.post(
            reverse("dashboard:share-open"),
            data=json.dumps({"shareToken": token}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["access"], "share")
        self.assertEqual(payload["viewerMode"], "share")
        self.assertEqual(payload["selectedReportId"], "sales")
        self.assertEqual(len(payload["reports"]), 1)
        self.assertEqual(payload["reports"][0]["id"], "sales")
        self.assertEqual(payload["savedViews"][0]["value"], "sales")
        self.assertIn(DASHBOARD_SHARE_COOKIE_NAME, response.cookies)

    def test_share_live_bootstrap_follows_new_snapshot(self):
        token = self._create_link().json()["shareLink"]["token"]
        self.client.post(
            reverse("dashboard:share-open"),
            data=json.dumps({"shareToken": token}),
            content_type="application/json",
        )
        self.snapshot.is_current = False
        self.snapshot.save(update_fields=["is_current"])
        DashboardPreparedSnapshot.objects.create(
            portal=self.portal,
            is_current=True,
            saved_views_snapshot=[{"value": "sales", "label": "Продажи"}],
            data={"preview": {"data": [{"key": "new", "values": {"leads_created": 21}}]}},
        )

        bootstrap = self.client.get(reverse("dashboard:share-bootstrap"))
        preview = self.client.post(
            reverse("dashboard:share-preview"),
            data=json.dumps({}),
            content_type="application/json",
        )

        self.assertEqual(bootstrap.status_code, 200)
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.json()["data"][0]["values"]["leads_created"], 21)

    def test_disabled_share_link_stops_immediately(self):
        created = self._create_link().json()["shareLink"]
        disable = self.client.post(
            reverse("dashboard:owner-share-link-disable"),
            data=json.dumps(
                {
                    "portalToken": self.portal_token,
                    "bitrixUserId": "42",
                    "id": created["id"],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(disable.status_code, 200)
        self.assertFalse(disable.json()["shareLink"]["isAvailable"])

        opened = self.client.post(
            reverse("dashboard:share-open"),
            data=json.dumps({"shareToken": created["token"]}),
            content_type="application/json",
        )

        self.assertEqual(opened.status_code, 403)

    def test_new_token_does_not_reactivate_disabled_link(self):
        first = self._create_link().json()["shareLink"]
        self.client.post(
            reverse("dashboard:owner-share-link-disable"),
            data=json.dumps(
                {
                    "portalToken": self.portal_token,
                    "bitrixUserId": "42",
                    "id": first["id"],
                }
            ),
            content_type="application/json",
        )
        second = self._create_link().json()["shareLink"]

        self.assertNotEqual(first["token"], second["token"])
        self.assertEqual(
            self.client.post(
                reverse("dashboard:share-open"),
                data=json.dumps({"shareToken": first["token"]}),
                content_type="application/json",
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                reverse("dashboard:share-open"),
                data=json.dumps({"shareToken": second["token"]}),
                content_type="application/json",
            ).status_code,
            200,
        )

    def test_expired_share_link_is_rejected(self):
        token = self._create_link(expires_in_days=1).json()["shareLink"]["token"]
        DashboardShareLink.objects.update(expires_at=timezone.now() - timedelta(minutes=1))

        response = self.client.post(
            reverse("dashboard:share-open"),
            data=json.dumps({"shareToken": token}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)

    def test_share_session_cannot_start_owner_refresh(self):
        token = self._create_link().json()["shareLink"]["token"]
        self.client.post(
            reverse("dashboard:share-open"),
            data=json.dumps({"shareToken": token}),
            content_type="application/json",
        )

        response = self.client.post(
            reverse("dashboard:owner-refresh"),
            data=json.dumps({}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 401)
