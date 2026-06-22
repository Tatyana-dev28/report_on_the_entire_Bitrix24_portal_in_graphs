from django.test import TestCase

from apps.bitrix.models import BitrixPortal
from apps.reports.services.bitrix_report_data_provider import BitrixReportDataProvider
from apps.reports.services.data_providers import ReportDataProviderContext


class FakeEmployeeBreakdownBitrixRestClient:
    def __init__(self, portal):
        self.portal = portal

    def call_list(self, method, params=None, *, max_pages=None):
        if method == "crm.deal.list":
            return [
                {
                    "ID": "1",
                    "TITLE": "Won deal by manager 42",
                    "DATE_CREATE": "2026-05-01T10:00:00+03:00",
                    "STAGE_ID": "C0:WON",
                    "OPPORTUNITY": "1000",
                    "ASSIGNED_BY_ID": "42",
                    "ASSIGNED_BY_NAME": "Анна",
                    "ASSIGNED_BY_LAST_NAME": "Иванова",
                },
                {
                    "ID": "2",
                    "TITLE": "Lost deal by manager 77",
                    "DATE_CREATE": "2026-05-01T11:00:00+03:00",
                    "STAGE_ID": "C0:LOSE",
                    "OPPORTUNITY": "500",
                    "ASSIGNED_BY_ID": "77",
                    "ASSIGNED_BY_NAME": "Петр",
                    "ASSIGNED_BY_LAST_NAME": "Петров",
                },
            ]

        if method == "crm.lead.list":
            return [
                {
                    "ID": "10",
                    "TITLE": "Lead by manager 42",
                    "DATE_CREATE": "2026-05-01T12:00:00+03:00",
                    "STATUS_ID": "CONVERTED",
                    "OPPORTUNITY": "700",
                    "ASSIGNED_BY_ID": "42",
                    "ASSIGNED_BY_NAME": "Анна",
                    "ASSIGNED_BY_LAST_NAME": "Иванова",
                },
            ]

        if method == "voximplant.statistic.get":
            return [
                {
                    "ID": "400",
                    "CALL_ID": "call-400",
                    "CALL_START_DATE": "2026-05-01T13:00:00+03:00",
                    "CALL_TYPE": "1",
                    "CALL_DURATION": "25",
                    "CALL_FAILED_CODE": "200",
                    "PORTAL_USER_ID": "42",
                    "PHONE_NUMBER": "+79990000001",
                },
                {
                    "ID": "401",
                    "CALL_ID": "call-401",
                    "CALL_START_DATE": "2026-05-01T14:00:00+03:00",
                    "CALL_TYPE": "2",
                    "CALL_DURATION": "10",
                    "CALL_FAILED_CODE": "200",
                    "PORTAL_USER_ID": "77",
                    "PHONE_NUMBER": "+79990000002",
                },
            ]

        return []


class EmployeeBreakdownTests(TestCase):
    def setUp(self):
        self.portal = BitrixPortal.objects.create(
            member_id="test-member",
            domain="test.bitrix24.ru",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.ACTIVE,
        )

    def test_provider_builds_employees_and_details_breakdown(self):
        provider = BitrixReportDataProvider(rest_client_factory=FakeEmployeeBreakdownBitrixRestClient)

        result = provider.build_preview(
            filters={
                "period": "days",
                "dateRange": {"from": "2026-05-01", "to": "2026-05-01"},
                "selectedSources": [
                    "Воронка продажи",
                    "Лиды",
                    "Телефония",
                ],
                "selectedMetricIds": [
                    "deals_created",
                    "deals_won",
                    "deals_lost",
                    "leads_created",
                    "calls_total",
                    "calls_out_success",
                    "calls_in",
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
        self.assertEqual(len(result.data), 1)
        self.assertEqual(len(result.employees), 2)

        employees_by_id = {employee["id"]: employee for employee in result.employees}

        self.assertIn("42", employees_by_id)
        self.assertIn("77", employees_by_id)

        self.assertEqual(employees_by_id["42"]["name"], "Анна Иванова")
        self.assertEqual(employees_by_id["77"]["name"], "Петр Петров")

        manager_42_values = employees_by_id["42"]["values"]
        manager_77_values = employees_by_id["77"]["values"]

        self.assertEqual(manager_42_values["deals_created"], 1)
        self.assertEqual(manager_42_values["deals_won"], 1)
        self.assertEqual(manager_42_values["leads_created"], 1)
        self.assertEqual(manager_42_values["calls_total"], 1)
        self.assertEqual(manager_42_values["calls_out_success"], 1)

        self.assertEqual(manager_77_values["deals_created"], 1)
        self.assertEqual(manager_77_values["deals_lost"], 1)
        self.assertEqual(manager_77_values["leads_created"], 0)
        self.assertEqual(manager_77_values["calls_total"], 1)
        self.assertEqual(manager_77_values["calls_in"], 1)

        detail_ids = {detail["id"] for detail in result.details}

        self.assertIn("42:deals_created", detail_ids)
        self.assertIn("42:deals_won", detail_ids)
        self.assertIn("42:leads_created", detail_ids)
        self.assertIn("42:calls_total", detail_ids)
        self.assertIn("77:deals_created", detail_ids)
        self.assertIn("77:deals_lost", detail_ids)
        self.assertIn("77:calls_total", detail_ids)
