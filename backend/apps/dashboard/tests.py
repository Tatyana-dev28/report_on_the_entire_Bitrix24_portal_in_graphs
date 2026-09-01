import json
from datetime import timedelta

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from apps.billing.models import PortalAccess
from apps.bitrix.models import BitrixPortal
from apps.bitrix.services.portal_tokens import make_portal_api_token
from apps.dashboard.constants import (
    ALLOWED_REFRESH_INTERVAL_MINUTES,
    DASHBOARD_ACCESS_COOKIE_NAME,
    DEFAULT_REFRESH_INTERVAL_MINUTES,
    REFRESH_RUN_RETENTION_DAYS,
    SUCCESSFUL_SNAPSHOT_LIMIT,
)
from apps.dashboard.models import DashboardAccessSession, DashboardPreparedSnapshot, DashboardRefreshRun
from apps.dashboard.services.access_sessions import create_dashboard_access_session
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
