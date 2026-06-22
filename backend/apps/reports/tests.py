import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse

from apps.bitrix.models import BitrixPortal
from apps.reports.models import CrmSource, ReportBuild, ReportSession
from apps.reports.services.bitrix_report_data_provider import BitrixReportDataProvider
from apps.reports.services.data_providers import ReportDataProviderContext
from apps.reports.services.report_catalog import build_report_catalog


@override_settings(REPORT_DATA_PROVIDER="empty")
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


class ReportPreviewBitrixProviderFailureTests(TestCase):
    def setUp(self):
        cache.clear()
        self.portal = BitrixPortal.objects.create(
            member_id="test-member",
            domain="test.bitrix24.ru",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.ACTIVE,
        )

    def test_preview_keeps_failed_session_when_bitrix_token_is_missing(self):
        response = self.client.post(
            reverse("reports:preview"),
            data=json.dumps(
                {
                    "memberId": self.portal.member_id,
                    "bitrixUserId": "42",
                    "period": "days",
                    "dateRange": {"start": "2026-05-01", "end": "2026-05-02"},
                    "selectedSources": ["Воронка продажи"],
                    "selectedMetricIds": ["deals_created"],
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 502)
        payload = response.json()
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"], "Не удалось построить отчет по данным Bitrix24.")

        session = ReportSession.objects.get(session_key=payload["details"]["sessionKey"])
        self.assertEqual(session.status, ReportSession.Status.ERROR)
        self.assertIn("OAuth", session.error_message)

        build = ReportBuild.objects.get(session=session)
        self.assertEqual(build.status, ReportBuild.Status.FAILED)
        self.assertEqual(build.cache_key, "")


class FakeBitrixRestClient:
    def __init__(self, portal):
        self.portal = portal

    def call_list(self, method, params=None, *, max_pages=None):
        if method == "crm.deal.list":
            return [
                {
                    "ID": "1",
                    "TITLE": "Won deal",
                    "DATE_CREATE": "2026-05-01T10:15:00+03:00",
                    "STAGE_ID": "C0:WON",
                    "OPPORTUNITY": "1500",
                },
                {
                    "ID": "2",
                    "TITLE": "Lost deal",
                    "DATE_CREATE": "2026-05-01T12:00:00+03:00",
                    "STAGE_ID": "C0:LOSE",
                    "OPPORTUNITY": "700",
                },
                {
                    "ID": "3",
                    "TITLE": "Next day deal",
                    "DATE_CREATE": "2026-05-02T09:00:00+03:00",
                    "STAGE_ID": "C0:NEW",
                    "OPPORTUNITY": "300",
                },
            ]

        if method == "crm.lead.list":
            return [
                {
                    "ID": "10",
                    "TITLE": "Converted lead",
                    "DATE_CREATE": "2026-05-01T11:00:00+03:00",
                    "STATUS_ID": "CONVERTED",
                    "OPPORTUNITY": "900",
                },
                {
                    "ID": "11",
                    "TITLE": "Bad lead",
                    "DATE_CREATE": "2026-05-02T11:00:00+03:00",
                    "STATUS_ID": "JUNK",
                    "OPPORTUNITY": "100",
                },
            ]

        return []


class FakeCatalogBitrixRestClient:
    def __init__(self, portal):
        self.portal = portal

    def call_list(self, method, params=None, *, max_pages=None):
        if method == "crm.dealcategory.list":
            return [
                {"ID": "0", "NAME": "Продажи"},
                {"ID": "12", "NAME": "Производство"},
            ]

        return []

    def call_method(self, method, params=None, *, retry_on_auth_error=True):
        if method == "crm.type.list":
            return type(
                "Result",
                (),
                {
                    "result": {
                        "types": [
                            {
                                "entityTypeId": 180,
                                "title": "Заявки",
                            }
                        ]
                    }
                },
            )()

        if method == "crm.category.list":
            return type(
                "Result",
                (),
                {
                    "result": {
                        "categories": [
                            {
                                "id": 4,
                                "name": "Новые заявки",
                            }
                        ]
                    }
                },
            )()

        return type("Result", (), {"result": {}})()


class ReportCatalogTests(TestCase):
    def setUp(self):
        self.portal = BitrixPortal.objects.create(
            member_id="test-member",
            domain="test.bitrix24.ru",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.ACTIVE,
        )

    @patch("apps.reports.services.report_catalog._portal_has_access_token", return_value=True)
    @patch("apps.reports.services.report_catalog.BitrixRestClient", FakeCatalogBitrixRestClient)
    def test_catalog_loads_sources_from_bitrix_and_syncs_mysql(self, _has_token):
        catalog = build_report_catalog(self.portal)
        source_ids = {source["id"] for source in catalog["sources"]}

        self.assertIn("lead-default", source_ids)
        self.assertIn("deal-0", source_ids)
        self.assertIn("deal-12", source_ids)
        self.assertIn("smart-180-4", source_ids)
        self.assertIn("invoice-default", source_ids)

        deal_source = CrmSource.objects.get(portal=self.portal, external_key="deal-12")
        self.assertEqual(deal_source.source_type, CrmSource.SourceType.DEAL)
        self.assertEqual(deal_source.category_id, 12)
        self.assertEqual(deal_source.title, "Производство")

        smart_source = CrmSource.objects.get(portal=self.portal, external_key="smart-180-4")
        self.assertEqual(smart_source.source_type, CrmSource.SourceType.SMART_PROCESS)
        self.assertEqual(smart_source.entity_type_id, 180)
        self.assertEqual(smart_source.category_id, 4)

    def test_catalog_falls_back_to_cached_sources_without_bitrix_token(self):
        CrmSource.objects.create(
            portal=self.portal,
            external_key="deal-7",
            source_type=CrmSource.SourceType.DEAL,
            entity_type_id=2,
            category_id=7,
            title="Кешированная воронка",
            source_label="Кешированная воронка",
            is_available=True,
        )

        catalog = build_report_catalog(self.portal)

        self.assertEqual(catalog["sources"][0]["id"], "deal-7")
        self.assertEqual(catalog["sources"][0]["sourceLabel"], "Кешированная воронка")


class BitrixReportDataProviderTests(TestCase):
    def setUp(self):
        self.portal = BitrixPortal.objects.create(
            member_id="test-member",
            domain="test.bitrix24.ru",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.ACTIVE,
        )

    def test_provider_builds_daily_deal_and_lead_metrics(self):
        provider = BitrixReportDataProvider(rest_client_factory=FakeBitrixRestClient)
        result = provider.build_preview(
            filters={
                "period": "days",
                "dateRange": {"from": "2026-05-01", "to": "2026-05-02"},
                "selectedSources": ["Воронка продажи", "Лиды"],
                "selectedMetricIds": ["deals_created", "leads_created"],
                "metricMode": "money",
                "chartDisplayMode": "sum",
            },
            context=ReportDataProviderContext(
                portal=self.portal,
                user=None,
                bitrix_user_id="42",
                user_name="",
            ),
        )

        self.assertEqual(result.status, "ready")
        self.assertEqual(len(result.data), 2)

        first_day = result.data[0]["values"]
        self.assertEqual(first_day["deals_created"], 2)
        self.assertEqual(first_day["deals_won"], 1)
        self.assertEqual(first_day["deals_lost"], 1)
        self.assertEqual(first_day["deals_won_sum"], 1500)
        self.assertEqual(first_day["deals_lost_sum"], 700)
        self.assertEqual(first_day["deals_conversion"], 50)
        self.assertEqual(first_day["leads_created"], 1)
        self.assertEqual(first_day["leads_quality"], 1)
        self.assertEqual(first_day["leads_quality_sum"], 900)

        second_day = result.data[1]["values"]
        self.assertEqual(second_day["deals_created"], 1)
        self.assertEqual(second_day["deals_won"], 0)
        self.assertEqual(second_day["leads_created"], 1)
        self.assertEqual(second_day["leads_bad"], 1)
