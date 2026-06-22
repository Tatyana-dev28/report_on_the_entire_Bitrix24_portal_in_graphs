import json

from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse

from apps.bitrix.models import BitrixPortal
from apps.reports.models import ReportBuild, ReportSession


class ReportPreviewApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.portal = BitrixPortal.objects.create(
            member_id="test-member",
            domain="test.bitrix24.ru",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.ACTIVE,
        )

    def test_preview_creates_session_build_and_cache_payload(self):
        response = self.client.post(
            reverse("reports:preview"),
            data=json.dumps(
                {
                    "memberId": self.portal.member_id,
                    "bitrixUserId": "42",
                    "period": "days",
                    "dateRange": {"start": "2026-05-01", "end": "2026-05-31"},
                    "selectedSources": ["Воронка продажи"],
                    "selectedMetricIds": ["deals_created"],
                    "metricMode": "money",
                    "chartDisplayMode": "sum",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["data"], [])
        self.assertEqual(payload["employees"], [])
        self.assertEqual(payload["details"], [])

        session = ReportSession.objects.get(session_key=payload["sessionKey"])
        self.assertEqual(session.portal, self.portal)
        self.assertEqual(session.bitrix_user_id, "42")
        self.assertEqual(session.filters_hash, payload["filtersHash"])
        self.assertEqual(session.status, ReportSession.Status.ACTIVE)
        self.assertTrue(session.cache_key)

        cached_payload = cache.get(session.cache_key)
        self.assertIsInstance(cached_payload, dict)
        self.assertEqual(cached_payload["meta"]["filtersHash"], payload["filtersHash"])
        self.assertEqual(cached_payload["meta"]["sessionKey"], payload["sessionKey"])

        build = ReportBuild.objects.get(session=session)
        self.assertEqual(build.status, ReportBuild.Status.SUCCESS)
        self.assertEqual(build.cache_key, session.cache_key)
        self.assertEqual(build.sources, ["Воронка продажи"])
        self.assertEqual(build.metrics, ["deals_created"])

    def test_preview_rejects_unknown_period(self):
        response = self.client.post(
            reverse("reports:preview"),
            data=json.dumps(
                {
                    "memberId": self.portal.member_id,
                    "period": "years",
                    "selectedSources": [],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        payload = response.json()
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"], "Некорректный период отчета.")
