import json
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse

from apps.bitrix.models import BitrixPortal
from apps.bitrix.services.portal_tokens import make_portal_api_token
from apps.bitrix.services.rest_client import BitrixRestError
from apps.reports.models import CrmSource, ReportBuild, ReportSession
from apps.reports.services.bitrix_report_data_provider import (
    BitrixReportDataProvider,
    resolve_selected_sources_for_portal,
)
from apps.reports.services.data_providers import ReportDataProviderContext
from apps.reports.services.report_catalog import (
    build_report_catalog,
    disambiguate_duplicate_pipeline_labels,
)


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
        self.portal_token = make_portal_api_token(portal=self.portal, bitrix_user_id="42")

    def test_preview_creates_session_build_and_cache_payload(self):
        response = self.client.post(
            reverse("reports:preview"),
            data=json.dumps(
                {
                    "memberId": self.portal.member_id,
                    "portalToken": self.portal_token,
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
        self.assertEqual(payload["metadata"], {})

        session = ReportSession.objects.get(session_key=payload["sessionKey"])

        self.assertEqual(session.portal, self.portal)
        self.assertEqual(session.bitrix_user_id, "42")
        self.assertEqual(session.filters_hash, payload["filtersHash"])
        self.assertEqual(session.status, ReportSession.Status.ACTIVE)
        self.assertTrue(session.cache_key)

        cached_payload = cache.get(session.cache_key)

        self.assertIsInstance(cached_payload, dict)
        self.assertEqual(cached_payload["metadata"], payload["metadata"])
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
                    "portalToken": self.portal_token,
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

    @override_settings(REPORT_DATA_PROVIDER="bitrix")
    @patch("apps.reports.services.builders.enqueue_report_build", return_value="test-job")
    def test_preview_queues_large_activity_report(self, _enqueue_report_build):
        response = self.client.post(
            reverse("reports:preview"),
            data=json.dumps(
                {
                    "memberId": self.portal.member_id,
                    "portalToken": self.portal_token,
                    "bitrixUserId": "42",
                    "period": "months",
                    "dateRange": {"start": "2020-01-01", "end": "2026-05-31"},
                    "selectedSources": ["activity-default"],
                    "selectedMetricIds": ["activities_created"],
                    "metricMode": "count",
                    "chartDisplayMode": "sum",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)

        payload = response.json()

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["status"], "queued")
        self.assertEqual(payload["data"], [])
        self.assertEqual(payload["employees"], [])
        self.assertEqual(payload["details"], [])

        session = ReportSession.objects.get(session_key=payload["sessionKey"])
        build = ReportBuild.objects.get(session=session)

        self.assertEqual(session.cache_key, "")
        self.assertEqual(session.metadata["calculation"], "queued")
        self.assertEqual(build.status, ReportBuild.Status.PENDING)
        self.assertEqual(build.celery_task_id, "test-job")

        status_response = self.client.get(
            reverse("reports:preview-status", kwargs={"session_key": session.session_key}),
            {"memberId": self.portal.member_id, "portalToken": self.portal_token},
        )

        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(status_response.json()["status"], "queued")


class ReportPreviewBitrixProviderFailureTests(TestCase):
    def setUp(self):
        cache.clear()

        self.portal = BitrixPortal.objects.create(
            member_id="test-member",
            domain="test.bitrix24.ru",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.ACTIVE,
        )
        self.portal_token = make_portal_api_token(portal=self.portal, bitrix_user_id="42")

    def test_preview_keeps_failed_session_when_bitrix_token_is_missing(self):
        response = self.client.post(
            reverse("reports:preview"),
            data=json.dumps(
                {
                    "memberId": self.portal.member_id,
                    "portalToken": self.portal_token,
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

        self.assertIn("details", payload)
        self.assertIn("message", payload["details"])
        self.assertIn("OAuth", payload["details"]["message"])
        self.assertIn("filtersHash", payload["details"])
        self.assertIn("sessionKey", payload["details"])

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


class FakeInvoiceBitrixRestClient:
    def __init__(self, portal):
        self.portal = portal

    def call_list(self, method, params=None, *, max_pages=None):
        if method == "crm.item.list":
            return [
                {
                    "id": 100,
                    "title": "Paid smart invoice",
                    "createdTime": "2026-05-01T10:00:00+03:00",
                    "stageId": "DT31_1:SUCCESS",
                    "stageSemanticId": "S",
                    "opportunity": "2500",
                    "currencyId": "RUB",
                    "assignedById": 42,
                },
                {
                    "id": 101,
                    "title": "Failed smart invoice",
                    "createdTime": "2026-05-01T12:00:00+03:00",
                    "stageId": "DT31_1:LOSE",
                    "stageSemanticId": "F",
                    "opportunity": "800",
                    "currencyId": "RUB",
                    "assignedById": 42,
                },
                {
                    "id": 102,
                    "title": "Open smart invoice",
                    "createdTime": "2026-05-02T09:00:00+03:00",
                    "stageId": "DT31_1:NEW",
                    "stageSemanticId": "P",
                    "opportunity": "400",
                    "currencyId": "RUB",
                    "assignedById": 42,
                },
            ]

        return []


class FakeLegacyInvoiceBitrixRestClient:
    def __init__(self, portal):
        self.portal = portal

    def call_list(self, method, params=None, *, max_pages=None):
        if method == "crm.item.list":
            raise BitrixRestError("crm.item.list unavailable")

        if method == "crm.invoice.list":
            return [
                {
                    "ID": "200",
                    "ACCOUNT_NUMBER": "INV-200",
                    "DATE_INSERT": "2026-05-01T10:00:00+03:00",
                    "STATUS_ID": "P",
                    "PRICE": "3000",
                    "CURRENCY": "RUB",
                    "RESPONSIBLE_ID": "42",
                },
                {
                    "ID": "201",
                    "ACCOUNT_NUMBER": "INV-201",
                    "DATE_INSERT": "2026-05-01T12:00:00+03:00",
                    "STATUS_ID": "D",
                    "PRICE": "900",
                    "CURRENCY": "RUB",
                    "RESPONSIBLE_ID": "42",
                },
            ]

        return []


class FakeSmartProcessBitrixRestClient:
    def __init__(self, portal):
        self.portal = portal

    def call_list(self, method, params=None, *, max_pages=None):
        if method != "crm.item.list":
            return []

        return [
            {
                "id": 300,
                "title": "Accepted item",
                "createdTime": "2026-05-01T09:00:00+03:00",
                "stageId": "DT180_4:NEW",
                "stageSemanticId": "P",
                "opportunity": "1000",
                "currencyId": "RUB",
                "assignedById": 42,
                "categoryId": 4,
            },
            {
                "id": 301,
                "title": "Work item",
                "createdTime": "2026-05-01T10:00:00+03:00",
                "stageId": "DT180_4:WORK",
                "stageSemanticId": "P",
                "opportunity": "2000",
                "currencyId": "RUB",
                "assignedById": 42,
                "categoryId": 4,
            },
            {
                "id": 302,
                "title": "Check item",
                "createdTime": "2026-05-01T11:00:00+03:00",
                "stageId": "DT180_4:CHECK",
                "stageSemanticId": "P",
                "opportunity": "3000",
                "currencyId": "RUB",
                "assignedById": 42,
                "categoryId": 4,
            },
            {
                "id": 303,
                "title": "Ready item",
                "createdTime": "2026-05-01T12:00:00+03:00",
                "stageId": "DT180_4:READY",
                "stageSemanticId": "S",
                "opportunity": "4000",
                "currencyId": "RUB",
                "assignedById": 42,
                "categoryId": 4,
            },
            {
                "id": 304,
                "title": "Failed item",
                "createdTime": "2026-05-02T12:00:00+03:00",
                "stageId": "DT180_4:FAILED",
                "stageSemanticId": "F",
                "opportunity": "500",
                "currencyId": "RUB",
                "assignedById": 42,
                "categoryId": 4,
            },
        ]


class FakeTelephonyBitrixRestClient:
    def __init__(self, portal):
        self.portal = portal

    def call_list(self, method, params=None, *, max_pages=None):
        if method != "voximplant.statistic.get":
            return []

        return [
            {
                "ID": "400",
                "CALL_ID": "call-400",
                "CALL_START_DATE": "2026-05-01T09:00:00+03:00",
                "CALL_TYPE": "1",
                "CALL_DURATION": "25",
                "CALL_FAILED_CODE": "200",
                "PORTAL_USER_ID": "42",
                "PHONE_NUMBER": "+79990000001",
            },
            {
                "ID": "401",
                "CALL_ID": "call-401",
                "CALL_START_DATE": "2026-05-01T10:00:00+03:00",
                "CALL_TYPE": "1",
                "CALL_DURATION": "8",
                "CALL_FAILED_CODE": "200",
                "PORTAL_USER_ID": "42",
                "PHONE_NUMBER": "+79990000002",
            },
            {
                "ID": "402",
                "CALL_ID": "call-402",
                "CALL_START_DATE": "2026-05-01T11:00:00+03:00",
                "CALL_TYPE": "2",
                "CALL_DURATION": "44",
                "CALL_FAILED_CODE": "200",
                "PORTAL_USER_ID": "42",
                "PHONE_NUMBER": "+79990000003",
            },
            {
                "ID": "403",
                "CALL_ID": "call-403",
                "CALL_START_DATE": "2026-05-01T12:00:00+03:00",
                "CALL_TYPE": "2",
                "CALL_DURATION": "0",
                "CALL_FAILED_CODE": "304",
                "PORTAL_USER_ID": "42",
                "PHONE_NUMBER": "+79990000004",
            },
            {
                "ID": "404",
                "CALL_ID": "call-404",
                "CALL_START_DATE": "2026-05-02T09:00:00+03:00",
                "CALL_TYPE": "3",
                "CALL_DURATION": "30",
                "CALL_FAILED_CODE": "200",
                "PORTAL_USER_ID": "42",
                "PHONE_NUMBER": "+79990000005",
            },
        ]


class FakeActivityQuoteContractBitrixRestClient:
    def __init__(self, portal):
        self.portal = portal

    def call_list(self, method, params=None, *, max_pages=None):
        params = params or {}

        if method == "crm.activity.list":
            return [
                {
                    "ID": "500",
                    "OWNER_ID": "1",
                    "OWNER_TYPE_ID": "2",
                    "TYPE_ID": "2",
                    "SUBJECT": "Встреча с клиентом",
                    "CREATED": "2026-05-01T08:30:00+03:00",
                    "START_TIME": "2026-05-01T09:00:00+03:00",
                    "END_TIME": "2026-05-01T10:00:00+03:00",
                    "COMPLETED": "N",
                    "STATUS": "1",
                    "RESPONSIBLE_ID": "42",
                    "AUTHOR_ID": "42",
                },
                {
                    "ID": "501",
                    "OWNER_ID": "2",
                    "OWNER_TYPE_ID": "2",
                    "TYPE_ID": "1",
                    "SUBJECT": "Позвонить клиенту",
                    "CREATED": "2026-05-01T10:30:00+03:00",
                    "START_TIME": "2026-05-01T11:00:00+03:00",
                    "END_TIME": "2026-05-01T11:15:00+03:00",
                    "COMPLETED": "Y",
                    "STATUS": "2",
                    "RESPONSIBLE_ID": "42",
                    "AUTHOR_ID": "42",
                },
                {
                    "ID": "502",
                    "OWNER_ID": "3",
                    "OWNER_TYPE_ID": "2",
                    "TYPE_ID": "MEETING",
                    "SUBJECT": "Повторная встреча",
                    "CREATED": "2026-05-02T09:30:00+03:00",
                    "START_TIME": "2026-05-02T10:00:00+03:00",
                    "END_TIME": "2026-05-02T11:00:00+03:00",
                    "COMPLETED": "Y",
                    "STATUS": "2",
                    "RESPONSIBLE_ID": "42",
                    "AUTHOR_ID": "42",
                },
                {
                    "ID": "503",
                    "OWNER_ID": "4",
                    "OWNER_TYPE_ID": "2",
                    "TYPE_ID": "4",
                    "SUBJECT": "Incoming email",
                    "CREATED": "2026-05-01T12:30:00+03:00",
                    "START_TIME": "2026-05-01T12:30:00+03:00",
                    "COMPLETED": "Y",
                    "STATUS": "2",
                    "RESPONSIBLE_ID": "42",
                    "AUTHOR_ID": "42",
                    "PROVIDER_ID": "CRM_EMAIL",
                    "PROVIDER_TYPE_ID": "EMAIL",
                    "DIRECTION": "1",
                },
                {
                    "ID": "504",
                    "OWNER_ID": "5",
                    "OWNER_TYPE_ID": "2",
                    "TYPE_ID": "4",
                    "SUBJECT": "Outgoing email",
                    "CREATED": "2026-05-01T13:30:00+03:00",
                    "START_TIME": "2026-05-01T13:30:00+03:00",
                    "COMPLETED": "Y",
                    "STATUS": "2",
                    "RESPONSIBLE_ID": "42",
                    "AUTHOR_ID": "42",
                    "PROVIDER_ID": "CRM_EMAIL",
                    "PROVIDER_TYPE_ID": "EMAIL",
                    "DIRECTION": "2",
                },
                {
                    "ID": "505",
                    "OWNER_ID": "6",
                    "OWNER_TYPE_ID": "2",
                    "TYPE_ID": "6",
                    "SUBJECT": "Open line message",
                    "CREATED": "2026-05-01T14:30:00+03:00",
                    "START_TIME": "2026-05-01T14:30:00+03:00",
                    "COMPLETED": "Y",
                    "STATUS": "2",
                    "RESPONSIBLE_ID": "42",
                    "AUTHOR_ID": "42",
                    "PROVIDER_ID": "IM",
                    "PROVIDER_TYPE_ID": "IM",
                    "DIRECTION": "1",
                },
            ]

        if method == "crm.company.list":
            return [
                {
                    "ID": "900",
                    "TITLE": "Company",
                    "DATE_CREATE": "2026-05-01T09:00:00+03:00",
                    "ASSIGNED_BY_ID": "42",
                }
            ]

        if method == "crm.contact.list":
            return [
                {
                    "ID": "901",
                    "NAME": "Contact",
                    "LAST_NAME": "Person",
                    "DATE_CREATE": "2026-05-01T09:30:00+03:00",
                    "ASSIGNED_BY_ID": "42",
                }
            ]

        if method == "tasks.task.list":
            return [
                {
                    "ID": "902",
                    "TITLE": "Created task",
                    "CREATED_DATE": "2026-05-01T09:00:00+03:00",
                    "STATUS": "2",
                    "REAL_STATUS": "2",
                    "RESPONSIBLE_ID": "42",
                },
                {
                    "ID": "903",
                    "TITLE": "Closed task",
                    "CREATED_DATE": "2026-04-25T09:00:00+03:00",
                    "CLOSED_DATE": "2026-05-01T15:00:00+03:00",
                    "STATUS": "5",
                    "REAL_STATUS": "5",
                    "RESPONSIBLE_ID": "42",
                },
                {
                    "ID": "904",
                    "TITLE": "Overdue task",
                    "CREATED_DATE": "2026-04-25T09:00:00+03:00",
                    "DEADLINE": "2026-05-01T16:00:00+03:00",
                    "STATUS": "3",
                    "REAL_STATUS": "3",
                    "RESPONSIBLE_ID": "42",
                },
            ]

        if method == "crm.webform.result.list":
            return [
                {
                    "ID": "905",
                    "FORM_NAME": "Brief",
                    "DATE_CREATE": "2026-05-01T17:00:00+03:00",
                    "CRM_ENTITY_ID": "1",
                    "CRM_ENTITY_TYPE": "LEAD",
                }
            ]

        if method == "crm.quote.list":
            return [
                {
                    "ID": "600",
                    "TITLE": "Принятое КП",
                    "DATE_CREATE": "2026-05-01T12:00:00+03:00",
                    "STATUS_ID": "APPROVED",
                    "OPPORTUNITY": "2000",
                    "CURRENCY_ID": "RUB",
                    "ASSIGNED_BY_ID": "42",
                },
                {
                    "ID": "601",
                    "TITLE": "Отклоненное КП",
                    "DATE_CREATE": "2026-05-01T13:00:00+03:00",
                    "STATUS_ID": "DECLINED",
                    "OPPORTUNITY": "500",
                    "CURRENCY_ID": "RUB",
                    "ASSIGNED_BY_ID": "42",
                },
            ]

        if method == "crm.item.list":
            entity_type_id = int(params.get("entityTypeId") or 0)

            if entity_type_id == 181:
                return [
                    {
                        "id": 700,
                        "title": "Отправленный договор",
                        "createdTime": "2026-05-01T14:00:00+03:00",
                        "stageId": "DT181_1:CONTRACT_SENT",
                        "stageSemanticId": "P",
                        "opportunity": "1000",
                        "currencyId": "RUB",
                        "assignedById": 42,
                        "categoryId": 1,
                    },
                    {
                        "id": 701,
                        "title": "Подписанный договор",
                        "createdTime": "2026-05-01T15:00:00+03:00",
                        "stageId": "DT181_1:SIGNED",
                        "stageSemanticId": "S",
                        "opportunity": "2500",
                        "currencyId": "RUB",
                        "assignedById": 42,
                        "categoryId": 1,
                    },
                    {
                        "id": 702,
                        "title": "Отклоненный договор",
                        "createdTime": "2026-05-01T16:00:00+03:00",
                        "stageId": "DT181_1:FAILED",
                        "stageSemanticId": "F",
                        "opportunity": "400",
                        "currencyId": "RUB",
                        "assignedById": 42,
                        "categoryId": 1,
                    },
                ]

            if entity_type_id == 170:
                return [
                    {
                        "id": 710,
                        "title": "Contract sent",
                        "createdTime": "2026-05-01T14:00:00+03:00",
                        "stageId": "DT170_17:CONTRACT_SENT",
                        "stageSemanticId": "P",
                        "opportunity": "1000",
                        "currencyId": "RUB",
                        "assignedById": 42,
                        "categoryId": 17,
                    },
                    {
                        "id": 711,
                        "title": "Contract signed",
                        "createdTime": "2026-05-01T15:00:00+03:00",
                        "stageId": "DT170_17:SIGNED",
                        "stageSemanticId": "S",
                        "opportunity": "2500",
                        "currencyId": "RUB",
                        "assignedById": 42,
                        "categoryId": 17,
                    },
                    {
                        "id": 712,
                        "title": "Contract failed",
                        "createdTime": "2026-05-01T16:00:00+03:00",
                        "stageId": "DT170_17:FAILED",
                        "stageSemanticId": "F",
                        "opportunity": "400",
                        "currencyId": "RUB",
                        "assignedById": 42,
                        "categoryId": 17,
                    },
                ]

            if entity_type_id == 182:
                return [
                    {
                        "id": 800,
                        "title": "КП отправлено из смарт-процесса",
                        "createdTime": "2026-05-01T17:00:00+03:00",
                        "stageId": "DT182_2:SENT",
                        "stageSemanticId": "P",
                        "opportunity": "700",
                        "currencyId": "RUB",
                        "assignedById": 42,
                        "categoryId": 2,
                    },
                    {
                        "id": 801,
                        "title": "КП принято из смарт-процесса",
                        "createdTime": "2026-05-01T18:00:00+03:00",
                        "stageId": "DT182_2:SUCCESS",
                        "stageSemanticId": "S",
                        "opportunity": "1300",
                        "currencyId": "RUB",
                        "assignedById": 42,
                        "categoryId": 2,
                    },
                ]

            if entity_type_id == 1070:
                return [
                    {
                        "id": 900,
                        "title": "Meeting",
                        "createdTime": "2026-05-01T11:00:00+03:00",
                        "stageId": "DT1070_87:NEW",
                        "stageSemanticId": "P",
                        "opportunity": "0",
                        "currencyId": "RUB",
                        "assignedById": 42,
                        "categoryId": 87,
                    },
                ]

        return []


class FakeMonthlyTaskBitrixRestClient:
    def __init__(self, portal):
        self.portal = portal
        self.task_calls = []

    def call_list(self, method, params=None, *, max_pages=None):
        if method != "tasks.task.list":
            return []

        filters = (params or {}).get("filter") or {}
        start = filters.get(">=CREATED_DATE", "")
        end = filters.get("<=CREATED_DATE", "")
        self.task_calls.append((start, end))

        if start[:7] != end[:7]:
            raise BitrixRestError("tasks.task.list pagination exceeded")

        if start.startswith("2026-01"):
            return [
                {
                    "ID": "task-jan",
                    "TITLE": "January task",
                    "CREATED_DATE": "2026-01-15T09:00:00+03:00",
                    "STATUS": "2",
                    "REAL_STATUS": "2",
                    "RESPONSIBLE_ID": "42",
                }
            ]

        if start.startswith("2026-02"):
            return [
                {
                    "ID": "task-feb",
                    "TITLE": "February task",
                    "CREATED_DATE": "2026-02-15T09:00:00+03:00",
                    "CLOSED_DATE": "2026-02-20T09:00:00+03:00",
                    "STATUS": "5",
                    "REAL_STATUS": "5",
                    "RESPONSIBLE_ID": "42",
                }
            ]

        return []


class FakeNumericDealStageBitrixRestClient:
    def __init__(self, portal):
        self.portal = portal

    def call_list(self, method, params=None, *, max_pages=None):
        if method == "crm.deal.list":
            return [
                {
                    "ID": "deal-stage-1",
                    "TITLE": "Numeric new stage",
                    "DATE_CREATE": "2026-05-01T09:00:00+03:00",
                    "STAGE_ID": "C31:1",
                    "OPPORTUNITY": "100",
                },
                {
                    "ID": "deal-stage-5",
                    "TITLE": "Numeric talk stage",
                    "DATE_CREATE": "2026-05-01T10:00:00+03:00",
                    "STAGE_ID": "C31:5",
                    "OPPORTUNITY": "200",
                },
                {
                    "ID": "deal-stage-8",
                    "TITLE": "Numeric invoice stage",
                    "DATE_CREATE": "2026-05-01T11:00:00+03:00",
                    "STAGE_ID": "C31:8",
                    "OPPORTUNITY": "300",
                },
            ]

        return []


class FakeProductionReadyStageBitrixRestClient:
    def __init__(self, portal):
        self.portal = portal

    def call_list(self, method, params=None, *, max_pages=None):
        if method == "crm.item.list":
            return [
                {
                    "id": 14001,
                    "title": "GR configured",
                    "createdTime": "2026-05-01T09:00:00+03:00",
                    "stageId": "DT140_53:UC_1RXT3D",
                    "stageSemanticId": "P",
                    "opportunity": "0",
                    "currencyId": "RUB",
                    "assignedById": 42,
                    "categoryId": 53,
                }
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


class FakeCatalogWithoutDefaultDealBitrixRestClient(FakeCatalogBitrixRestClient):
    def call_list(self, method, params=None, *, max_pages=None):
        if method == "crm.dealcategory.list":
            return [
                {"ID": "12", "NAME": "Production", "SORT": "20"},
                {"ID": "3", "NAME": "Wholesale", "SORT": "10"},
            ]

        return []


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
        self.assertIn("telephony-default", source_ids)

        deal_source = CrmSource.objects.get(portal=self.portal, external_key="deal-12")

        self.assertEqual(deal_source.source_type, CrmSource.SourceType.DEAL)
        self.assertEqual(deal_source.category_id, 12)
        self.assertEqual(deal_source.title, "Производство")

        smart_source = CrmSource.objects.get(portal=self.portal, external_key="smart-180-4")

        self.assertEqual(smart_source.source_type, CrmSource.SourceType.SMART_PROCESS)
        self.assertEqual(smart_source.entity_type_id, 180)
        self.assertEqual(smart_source.category_id, 4)

        telephony_source = CrmSource.objects.get(portal=self.portal, external_key="telephony-default")

        self.assertEqual(telephony_source.source_type, CrmSource.SourceType.CALL)

    @patch("apps.reports.services.report_catalog._portal_has_access_token", return_value=True)
    @patch("apps.reports.services.report_catalog.BitrixRestClient", FakeCatalogWithoutDefaultDealBitrixRestClient)
    def test_catalog_keeps_default_deal_pipeline_and_bitrix_sort_order(self, _has_token):
        catalog = build_report_catalog(self.portal)

        deal_source_ids = [
            source["id"]
            for source in catalog["sources"]
            if source["type"] == "deal"
        ]

        self.assertEqual(deal_source_ids, ["deal-0", "deal-3", "deal-12"])

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


class FakeCatalogWithDuplicateLabelsBitrixRestClient:
    """Simulates a Bitrix portal with multiple pipelines having identical names."""

    def __init__(self, portal):
        self.portal = portal

    def call_list(self, method, params=None, *, max_pages=None):
        if method == "crm.dealcategory.list":
            return [
                {"ID": "0", "NAME": "Общее"},
                {"ID": "12", "NAME": "Производство"},
                {"ID": "18", "NAME": "Общее"},
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
                                "title": "Договоры",
                            },
                            {
                                "entityTypeId": 190,
                                "title": "Договоры",
                            },
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
                                "id": 1,
                                "name": "Общее",
                            }
                        ]
                    }
                },
            )()

        return type("Result", (), {"result": {}})()


class ReportCatalogDisambiguationTests(TestCase):
    def setUp(self):
        self.portal = BitrixPortal.objects.create(
            member_id="test-disambig",
            domain="test-disambig.bitrix24.ru",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.ACTIVE,
        )

    def test_disambiguate_duplicate_deal_pipelines(self):
        """Deal pipelines with identical names get entity context appended."""
        sources = [
            {
                "id": "deal-0",
                "type": "deal",
                "entityTypeId": 2,
                "categoryId": 0,
                "title": "Общее",
                "sourceLabel": "Общее",
                "entityTypeName": "Сделки",
                "isAvailable": True,
                "rawData": {"_entityTypeName": "Сделки"},
            },
            {
                "id": "deal-18",
                "type": "deal",
                "entityTypeId": 2,
                "categoryId": 18,
                "title": "Общее",
                "sourceLabel": "Общее",
                "entityTypeName": "Сделки",
                "isAvailable": True,
                "rawData": {"_entityTypeName": "Сделки"},
            },
        ]

        result = disambiguate_duplicate_pipeline_labels(sources)

        deal_0_label = [s["sourceLabel"] for s in result if s["id"] == "deal-0"][0]
        deal_18_label = [s["sourceLabel"] for s in result if s["id"] == "deal-18"][0]

        self.assertIn("Сделки", deal_0_label)
        self.assertIn("Сделки", deal_18_label)
        self.assertNotEqual(deal_0_label, deal_18_label)

    def test_disambiguate_smart_process_pipelines_second_pass_category_id(self):
        """
        When smart processes share both the base name and the entity type name,
        category ID is appended for further disambiguation.
        """
        sources = [
            {
                "id": "smart-180-1",
                "type": "smartProcess",
                "entityTypeId": 180,
                "categoryId": 1,
                "title": "Общее",
                "sourceLabel": "Общее",
                "entityTypeName": "Договоры",
                "isAvailable": True,
                "rawData": {
                    "type": {"title": "Договоры"},
                    "_entityTypeName": "Договоры",
                },
            },
            {
                "id": "smart-190-1",
                "type": "smartProcess",
                "entityTypeId": 190,
                "categoryId": 1,
                "title": "Общее",
                "sourceLabel": "Общее",
                "entityTypeName": "Договоры",
                "isAvailable": True,
                "rawData": {
                    "type": {"title": "Договоры"},
                    "_entityTypeName": "Договоры",
                },
            },
        ]

        result = disambiguate_duplicate_pipeline_labels(sources)

        smart_180_label = [s["sourceLabel"] for s in result if s["id"] == "smart-180-1"][0]
        smart_190_label = [s["sourceLabel"] for s in result if s["id"] == "smart-190-1"][0]

        # Both get entity type appended in first pass
        self.assertIn("Договоры", smart_180_label)
        self.assertIn("Договоры", smart_190_label)

        # Second pass appends category ID since entity type is also identical
        self.assertIn("ID 1", smart_180_label)
        self.assertIn("ID 1", smart_190_label)

        # But they must be distinguishable by ID (different entity type IDs)
        self.assertNotEqual(smart_180_label, smart_190_label)

    def test_disambiguate_skips_single_pipeline(self):
        """A single pipeline with a unique name should not be modified."""
        sources = [
            {
                "id": "deal-12",
                "type": "deal",
                "entityTypeId": 2,
                "categoryId": 12,
                "title": "Производство",
                "sourceLabel": "Производство",
                "entityTypeName": "Сделки",
                "isAvailable": True,
                "rawData": {"_entityTypeName": "Сделки"},
            },
        ]

        result = disambiguate_duplicate_pipeline_labels(sources)

        self.assertEqual(result[0]["sourceLabel"], "Производство")

    def test_disambiguate_with_cached_sources_uses_model_entity_type_name(self):
        """Cached CrmSource records get the same disambiguation applied."""
        CrmSource.objects.create(
            portal=self.portal,
            external_key="deal-0",
            source_type=CrmSource.SourceType.DEAL,
            entity_type_id=2,
            category_id=0,
            title="Общее",
            source_label="Общее",
            is_available=True,
            raw_data={"_entityTypeName": "Сделки"},
        )
        CrmSource.objects.create(
            portal=self.portal,
            external_key="deal-18",
            source_type=CrmSource.SourceType.DEAL,
            entity_type_id=2,
            category_id=18,
            title="Общее",
            source_label="Общее",
            is_available=True,
            raw_data={"_entityTypeName": "Сделки"},
        )

        from apps.reports.services.report_catalog import get_cached_report_sources

        cached = get_cached_report_sources(self.portal)

        self.assertEqual(len(cached), 2)

        deal_0_label = [s["sourceLabel"] for s in cached if s["id"] == "deal-0"][0]
        deal_18_label = [s["sourceLabel"] for s in cached if s["id"] == "deal-18"][0]

        self.assertNotEqual(deal_0_label, deal_18_label)
        self.assertIn("Сделки", deal_0_label)
        self.assertIn("Сделки", deal_18_label)

    @patch("apps.reports.services.report_catalog._portal_has_access_token", return_value=True)
    @patch(
        "apps.reports.services.report_catalog.BitrixRestClient",
        FakeCatalogWithDuplicateLabelsBitrixRestClient,
    )
    def test_catalog_applies_disambiguation_integration(self, _has_token):
        """Full catalog pipeline applies disambiguation to deal pipelines with same name."""
        catalog = build_report_catalog(self.portal)

        deal_sources = [s for s in catalog["sources"] if s["type"] == "deal"]

        # 3 deal pipelines: Общее (ID=0), Производство (ID=12), Общее (ID=18)
        self.assertEqual(len(deal_sources), 3)

        labels = {s["id"]: s["sourceLabel"] for s in deal_sources}

        # "Производство" is unique — should stay unchanged
        self.assertEqual(labels["deal-12"], "Производство")

        # Both "Общее" pipelines should be disambiguated with entity type
        self.assertIn("Сделки", labels["deal-0"])
        self.assertIn("Сделки", labels["deal-18"])

        # And they should end up different (category IDs appended)
        self.assertNotEqual(labels["deal-0"], labels["deal-18"])


class BitrixReportDataProviderTests(TestCase):
    def setUp(self):
        self.portal = BitrixPortal.objects.create(
            member_id="test-member",
            domain="test.bitrix24.ru",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.ACTIVE,
        )

    def test_selected_sources_are_extended_with_essential_sources(self):
        CrmSource.objects.create(
            portal=self.portal,
            external_key="deal-31",
            source_type=CrmSource.SourceType.DEAL,
            entity_type_id=2,
            category_id=31,
            title="Main sales pipeline",
            source_label="Main sales pipeline",
            is_available=True,
        )
        CrmSource.objects.create(
            portal=self.portal,
            external_key="smart-140-53",
            source_type=CrmSource.SourceType.SMART_PROCESS,
            entity_type_id=140,
            category_id=53,
            title="Production",
            source_label="Production",
            is_available=True,
        )

        sources = resolve_selected_sources_for_portal(self.portal, ["task-default"])
        source_ids = {source["id"] for source in sources}

        self.assertIn("task-default", source_ids)
        self.assertIn("deal-31", source_ids)
        self.assertIn("smart-140-53", source_ids)
        self.assertIn("lead-default", source_ids)
        self.assertIn("invoice-default", source_ids)
        self.assertIn("telephony-default", source_ids)
        self.assertIn("activity-default", source_ids)
        self.assertIn("quote-default", source_ids)
        self.assertIn("company-default", source_ids)
        self.assertIn("contact-default", source_ids)
        self.assertIn("crm-form-default", source_ids)

    def test_provider_loads_tasks_by_month_for_long_periods(self):
        provider = BitrixReportDataProvider(rest_client_factory=FakeMonthlyTaskBitrixRestClient)

        result = provider.build_preview(
            filters={
                "period": "months",
                "dateRange": {"from": "2026-01-01", "to": "2026-02-28"},
                "selectedSources": ["task-default"],
                "selectedMetricIds": ["tasks_created", "tasks_done"],
                "metricMode": "count",
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
        self.assertEqual(result.data[0]["values"]["tasks_created"], 1)
        self.assertEqual(result.data[0]["values"]["tasks_done"], 0)
        self.assertEqual(result.data[1]["values"]["tasks_created"], 1)
        self.assertEqual(result.data[1]["values"]["tasks_done"], 1)

    def test_provider_classifies_numeric_deal_stages_for_sales_funnel(self):
        provider = BitrixReportDataProvider(rest_client_factory=FakeNumericDealStageBitrixRestClient)

        result = provider.build_preview(
            filters={
                "period": "days",
                "dateRange": {"from": "2026-05-01", "to": "2026-05-01"},
                "selectedSources": ["deal-sales"],
                "selectedMetricIds": ["sales_new", "sales_talk", "sales_invoice"],
                "metricMode": "count",
                "chartDisplayMode": "sum",
            },
            context=ReportDataProviderContext(
                portal=self.portal,
                user=None,
                bitrix_user_id="42",
                user_name="",
            ),
        )

        values = result.data[0]["values"]

        self.assertEqual(values["sales_new"], 1)
        self.assertEqual(values["sales_talk"], 1)
        self.assertEqual(values["sales_invoice"], 1)

    def test_provider_classifies_uc_stage_as_production_ready(self):
        provider = BitrixReportDataProvider(rest_client_factory=FakeProductionReadyStageBitrixRestClient)

        result = provider.build_preview(
            filters={
                "period": "days",
                "dateRange": {"from": "2026-05-01", "to": "2026-05-01"},
                "selectedSources": ["smart-production"],
                "selectedMetricIds": ["production_ready", "production_work"],
                "metricMode": "count",
                "chartDisplayMode": "sum",
            },
            context=ReportDataProviderContext(
                portal=self.portal,
                user=None,
                bitrix_user_id="42",
                user_name="",
            ),
        )

        values = result.data[0]["values"]

        self.assertEqual(values["production_ready"], 1)
        self.assertEqual(values["production_work"], 0)

    def test_provider_builds_daily_deal_and_lead_metrics(self):
        provider = BitrixReportDataProvider(rest_client_factory=FakeBitrixRestClient)

        result = provider.build_preview(
            filters={
                "period": "days",
                "dateRange": {"from": "2026-05-01", "to": "2026-05-02"},
                "selectedSources": ["Воронка продажи", "Лиды"],
                "selectedMetricIds": [
                    "deals_created",
                    "deals_won",
                    "deals_lost",
                    "deals_won_sum",
                    "deals_lost_sum",
                    "deals_conversion",
                    "leads_created",
                    "leads_quality",
                    "leads_bad",
                    "leads_quality_sum",
                ],
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

    def test_provider_limits_values_and_details_to_selected_metrics(self):
        provider = BitrixReportDataProvider(rest_client_factory=FakeBitrixRestClient)

        result = provider.build_preview(
            filters={
                "period": "days",
                "dateRange": {"from": "2026-05-01", "to": "2026-05-02"},
                "selectedSources": ["deal-sales", "lead-default"],
                "selectedMetricIds": ["deals_created"],
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
        self.assertEqual(set(result.data[0]["values"].keys()), {"deals_created"})
        self.assertEqual(set(result.data[1]["values"].keys()), {"deals_created"})
        self.assertTrue(result.employees)
        self.assertEqual(set(result.employees[0]["values"].keys()), {"deals_created"})
        self.assertEqual({detail["metricId"] for detail in result.details}, {"deals_created"})

    def test_provider_allows_empty_selected_metrics(self):
        provider = BitrixReportDataProvider(rest_client_factory=FakeBitrixRestClient)

        result = provider.build_preview(
            filters={
                "period": "days",
                "dateRange": {"from": "2026-05-01", "to": "2026-05-02"},
                "selectedSources": ["deal-sales"],
                "selectedMetricIds": [],
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
        self.assertEqual(result.data[0]["values"], {})
        self.assertTrue(result.employees)
        self.assertEqual(result.employees[0]["values"], {})
        self.assertEqual(result.details, [])

    def test_provider_builds_smart_invoice_metrics(self):
        provider = BitrixReportDataProvider(rest_client_factory=FakeInvoiceBitrixRestClient)

        result = provider.build_preview(
            filters={
                "period": "days",
                "dateRange": {"from": "2026-05-01", "to": "2026-05-02"},
                "selectedSources": ["Счета"],
                "selectedMetricIds": [
                    "invoices_created",
                    "invoices_won",
                    "invoices_lost",
                    "invoices_won_sum",
                    "invoices_lost_sum",
                    "invoices_conversion",
                ],
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
        self.assertIn("Счета", result.metadata["loadedSources"])
        self.assertEqual(result.metadata["unsupportedSources"], [])

        first_day = result.data[0]["values"]

        self.assertEqual(first_day["invoices_created"], 2)
        self.assertEqual(first_day["invoices_won"], 1)
        self.assertEqual(first_day["invoices_lost"], 1)
        self.assertEqual(first_day["invoices_won_sum"], 2500)
        self.assertEqual(first_day["invoices_lost_sum"], 800)
        self.assertEqual(first_day["invoices_conversion"], 50)

        second_day = result.data[1]["values"]

        self.assertEqual(second_day["invoices_created"], 1)
        self.assertEqual(second_day["invoices_won"], 0)
        self.assertEqual(second_day["invoices_lost"], 0)

    def test_provider_falls_back_to_legacy_invoice_metrics(self):
        provider = BitrixReportDataProvider(rest_client_factory=FakeLegacyInvoiceBitrixRestClient)

        result = provider.build_preview(
            filters={
                "period": "days",
                "dateRange": {"from": "2026-05-01", "to": "2026-05-01"},
                "selectedSources": ["Счета"],
                "selectedMetricIds": [
                    "invoices_created",
                    "invoices_won",
                    "invoices_lost",
                    "invoices_won_sum",
                    "invoices_lost_sum",
                    "invoices_conversion",
                ],
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
        self.assertIn("Счета", result.metadata["loadedSources"])
        self.assertEqual(result.metadata["unsupportedSources"], [])

        values = result.data[0]["values"]

        self.assertEqual(values["invoices_created"], 2)
        self.assertEqual(values["invoices_won"], 1)
        self.assertEqual(values["invoices_lost"], 1)
        self.assertEqual(values["invoices_won_sum"], 3000)
        self.assertEqual(values["invoices_lost_sum"], 900)
        self.assertEqual(values["invoices_conversion"], 50)

    def test_provider_builds_smart_process_metrics_from_dynamic_source(self):
        CrmSource.objects.create(
            portal=self.portal,
            external_key="smart-140-4",
            source_type=CrmSource.SourceType.SMART_PROCESS,
            entity_type_id=140,
            category_id=4,
            title="Новые заявки",
            source_label="Новые заявки",
            is_available=True,
        )

        provider = BitrixReportDataProvider(rest_client_factory=FakeSmartProcessBitrixRestClient)

        result = provider.build_preview(
            filters={
                "period": "days",
                "dateRange": {"from": "2026-05-01", "to": "2026-05-02"},
                "selectedSources": ["Новые заявки"],
                "selectedMetricIds": [
                    "production_accepted",
                    "production_work",
                    "production_check",
                    "production_ready",
                    "production_closed",
                    "smart_process_success_sum",
                ],
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
        self.assertIn("Новые заявки", result.metadata["loadedSources"])
        self.assertEqual(result.metadata["unsupportedSources"], [])

        first_day = result.data[0]["values"]

        self.assertEqual(first_day["production_accepted"], 1)
        self.assertEqual(first_day["production_work"], 1)
        self.assertEqual(first_day["production_check"], 1)
        self.assertEqual(first_day["production_ready"], 1)
        self.assertEqual(first_day["production_closed"], 1)
        self.assertEqual(first_day["smart_process_success_sum"], 4000)
        detail_pairs = {(detail["entityId"], detail["metricId"], detail["periodKey"]) for detail in result.details}
        self.assertIn(("303", "smart_process_success_sum", "2026-05-01T00:00:00+03:00"), detail_pairs)
        second_day = result.data[1]["values"]

        self.assertEqual(second_day["production_accepted"], 0)
        self.assertEqual(second_day["production_work"], 0)
        self.assertEqual(second_day["production_check"], 0)
        self.assertEqual(second_day["production_ready"], 0)
        self.assertEqual(second_day["production_closed"], 0)
        self.assertEqual(second_day["smart_process_success_sum"], 0)

    def test_provider_builds_telephony_metrics(self):
        provider = BitrixReportDataProvider(rest_client_factory=FakeTelephonyBitrixRestClient)

        result = provider.build_preview(
            filters={
                "period": "days",
                "dateRange": {"from": "2026-05-01", "to": "2026-05-02"},
                "selectedSources": ["telephony-default"],
                "selectedMetricIds": [
                    "calls_total",
                    "calls_in",
                    "calls_out",
                    "calls_out_success",
                    "calls_missed",
                ],
                "metricMode": "count",
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
        self.assertIn("Телефония", result.metadata["loadedSources"])
        self.assertEqual(result.metadata["unsupportedSources"], [])
        self.assertEqual(len(result.data), 2)

        first_day = result.data[0]["values"]

        self.assertEqual(first_day["calls_total"], 4)
        self.assertEqual(first_day["calls_out"], 2)
        self.assertEqual(first_day["calls_out_success"], 1)
        self.assertEqual(first_day["calls_in"], 2)
        self.assertEqual(first_day["calls_missed"], 1)

        second_day = result.data[1]["values"]

        self.assertEqual(second_day["calls_total"], 1)
        self.assertEqual(second_day["calls_out"], 0)
        self.assertEqual(second_day["calls_out_success"], 0)
        self.assertEqual(second_day["calls_in"], 1)
        self.assertEqual(second_day["calls_missed"], 0)

    def test_provider_builds_activity_quote_and_contract_metrics(self):
        CrmSource.objects.create(
            portal=self.portal,
            external_key="smart-181-1",
            source_type=CrmSource.SourceType.SMART_PROCESS,
            entity_type_id=181,
            category_id=1,
            title="Договоры",
            source_label="Договоры",
            is_available=True,
        )
        CrmSource.objects.create(
            portal=self.portal,
            external_key="smart-182-2",
            source_type=CrmSource.SourceType.SMART_PROCESS,
            entity_type_id=182,
            category_id=2,
            title="КП из смарт-процесса",
            source_label="КП из смарт-процесса",
            is_available=True,
        )

        provider = BitrixReportDataProvider(rest_client_factory=FakeActivityQuoteContractBitrixRestClient)

        result = provider.build_preview(
            filters={
                "period": "days",
                "dateRange": {"from": "2026-05-01", "to": "2026-05-02"},
                "selectedSources": [
                    "activity-default",
                    "quote-default",
                    "company-default",
                    "contact-default",
                    "task-default",
                    "crm-form-default",
                    "smart-181-1",
                    "smart-182-2",
                ],
                "selectedMetricIds": [
                    "activities_created",
                    "meetings_created",
                    "activities_done",
                    "activities_undone",
                    "email_in",
                    "email_out",
                    "messages_new",
                    "messages_total",
                    "quotes_created",
                    "quotes_sent",
                    "quotes_accepted",
                    "quotes_declined",
                    "quotes_accepted_sum",
                    "quotes_declined_sum",
                    "quotes_conversion",
                    "contracts_created",
                    "contracts_sent",
                    "contracts_signed",
                    "contracts_failed",
                    "contracts_signed_sum",
                    "contracts_conversion",
                    "companies_new",
                    "contacts_new",
                    "tasks_created",
                    "tasks_done",
                    "tasks_overdue",
                    "crm_forms",
                ],
                "metricMode": "count",
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
        self.assertEqual(result.metadata["unsupportedSources"], [])
        self.assertEqual(len(result.data), 2)

        first_day = result.data[0]["values"]

        self.assertEqual(first_day["activities_created"], 5)
        self.assertEqual(first_day["meetings_created"], 1)
        self.assertEqual(first_day["activities_done"], 4)
        self.assertEqual(first_day["activities_undone"], 1)
        self.assertEqual(first_day["email_in"], 1)
        self.assertEqual(first_day["email_out"], 1)
        self.assertEqual(first_day["messages_new"], 1)
        self.assertEqual(first_day["messages_total"], 1)

        self.assertEqual(first_day["companies_new"], 1)
        self.assertEqual(first_day["contacts_new"], 1)
        self.assertEqual(first_day["tasks_created"], 1)
        self.assertEqual(first_day["tasks_done"], 1)
        self.assertEqual(first_day["tasks_overdue"], 1)
        self.assertEqual(first_day["crm_forms"], 1)

        self.assertEqual(first_day["quotes_created"], 4)
        self.assertEqual(first_day["quotes_sent"], 2)
        self.assertEqual(first_day["quotes_accepted"], 2)
        self.assertEqual(first_day["quotes_declined"], 1)
        self.assertEqual(first_day["quotes_accepted_sum"], 3300)
        self.assertEqual(first_day["quotes_declined_sum"], 500)
        self.assertEqual(first_day["quotes_conversion"], 50)

        self.assertEqual(first_day["contracts_created"], 3)
        self.assertEqual(first_day["contracts_sent"], 1)
        self.assertEqual(first_day["contracts_signed"], 1)
        self.assertEqual(first_day["contracts_failed"], 1)
        self.assertEqual(first_day["contracts_signed_sum"], 2500)
        self.assertEqual(first_day["contracts_conversion"], 33.3)

        second_day = result.data[1]["values"]

        self.assertEqual(second_day["activities_created"], 1)
        self.assertEqual(second_day["meetings_created"], 1)
        self.assertEqual(second_day["activities_done"], 1)
        self.assertEqual(second_day["activities_undone"], 0)
        self.assertEqual(second_day["quotes_created"], 0)
        self.assertEqual(second_day["contracts_created"], 0)

    def test_provider_resolves_duplicate_smart_labels_by_source_id(self):
        CrmSource.objects.create(
            portal=self.portal,
            external_key="smart-170-17",
            source_type=CrmSource.SourceType.SMART_PROCESS,
            entity_type_id=170,
            category_id=17,
            title="Общее",
            source_label="Общее",
            is_available=True,
            raw_data={"type": {"title": "Договор"}, "category": {"name": "Общее"}},
        )
        CrmSource.objects.create(
            portal=self.portal,
            external_key="smart-1070-87",
            source_type=CrmSource.SourceType.SMART_PROCESS,
            entity_type_id=1070,
            category_id=87,
            title="Общее",
            source_label="Общее",
            is_available=True,
            raw_data={"type": {"title": "> Встречи"}, "category": {"name": "Общее"}},
        )

        provider = BitrixReportDataProvider(rest_client_factory=FakeActivityQuoteContractBitrixRestClient)

        result = provider.build_preview(
            filters={
                "period": "days",
                "dateRange": {"from": "2026-05-01", "to": "2026-05-02"},
                "selectedSources": [
                    "smart-170-17",
                    "smart-1070-87",
                ],
                "selectedMetricIds": [
                    "meetings_created",
                    "contracts_created",
                    "contracts_sent",
                    "contracts_signed",
                    "contracts_failed",
                    "contracts_signed_sum",
                    "contracts_conversion",
                ],
                "metricMode": "count",
                "chartDisplayMode": "sum",
            },
            context=ReportDataProviderContext(
                portal=self.portal,
                user=None,
                bitrix_user_id="42",
                user_name="",
            ),
        )

        first_day = result.data[0]["values"]

        self.assertEqual(result.status, "ready")
        self.assertEqual(result.metadata["unsupportedSources"], [])
        self.assertEqual(first_day["meetings_created"], 2)
        self.assertEqual(first_day["contracts_created"], 3)
        self.assertEqual(first_day["contracts_sent"], 1)
        self.assertEqual(first_day["contracts_signed"], 1)
        self.assertEqual(first_day["contracts_failed"], 1)
        self.assertEqual(first_day["contracts_signed_sum"], 2500)
        self.assertEqual(first_day["contracts_conversion"], 33.3)
