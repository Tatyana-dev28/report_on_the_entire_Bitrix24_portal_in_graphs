from django.test import TestCase, override_settings
from django.urls import reverse


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
