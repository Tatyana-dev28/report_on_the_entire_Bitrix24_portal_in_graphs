from datetime import timedelta
from unittest.mock import Mock, patch

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.bitrix.models import BitrixAuthToken, BitrixPortal
from apps.bitrix.services.install import (
    create_or_update_portal_from_bitrix_payload,
    normalize_bitrix_payload,
)
from apps.bitrix.services.rest_client import BitrixRestClient


class BitrixOAuthInstallTests(TestCase):
    def test_normalize_flat_bitrix_payload(self):
        normalized = normalize_bitrix_payload(
            {
                "DOMAIN": "https://demo.bitrix24.ru/",
                "member_id": "member-123",
                "PROTOCOL": "1",
                "LANG": "ru",
                "APP_SID": "app-sid",
                "AUTH_ID": "access-token",
                "REFRESH_ID": "refresh-token",
                "AUTH_EXPIRES": "7200",
                "APPLICATION_TOKEN": "application-token",
                "client_endpoint": "https://demo.bitrix24.ru/rest/",
                "server_endpoint": "https://oauth.bitrix.info/rest/",
                "USER_ID": "42",
                "USER_NAME": "Анна Иванова",
                "SCOPE": "crm,user,telephony",
            }
        )

        self.assertEqual(normalized["domain"], "demo.bitrix24.ru")
        self.assertEqual(normalized["member_id"], "member-123")
        self.assertEqual(normalized["access_token"], "access-token")
        self.assertEqual(normalized["refresh_token"], "refresh-token")
        self.assertEqual(normalized["application_token"], "application-token")
        self.assertEqual(normalized["auth_user_id"], "42")
        self.assertEqual(normalized["auth_user_name"], "Анна Иванова")
        self.assertEqual(normalized["scope"], "crm,user,telephony")

    def test_normalize_nested_auth_payload(self):
        normalized = normalize_bitrix_payload(
            {
                "auth": {
                    "domain": "demo.bitrix24.ru",
                    "member_id": "member-123",
                    "access_token": "nested-access-token",
                    "refresh_token": "nested-refresh-token",
                    "expires_in": "3600",
                    "client_endpoint": "https://demo.bitrix24.ru/rest/",
                    "server_endpoint": "https://oauth.bitrix.info/rest/",
                    "user_id": "84",
                    "user_name": "Петр Петров",
                    "scope": "crm",
                },
                "data": {
                    "LANGUAGE_ID": "ru",
                },
            }
        )

        self.assertEqual(normalized["domain"], "demo.bitrix24.ru")
        self.assertEqual(normalized["member_id"], "member-123")
        self.assertEqual(normalized["access_token"], "nested-access-token")
        self.assertEqual(normalized["refresh_token"], "nested-refresh-token")
        self.assertEqual(normalized["auth_user_id"], "84")
        self.assertEqual(normalized["auth_user_name"], "Петр Петров")
        self.assertEqual(normalized["language"], "ru")

    @patch("apps.bitrix.services.install.ensure_free_subscription_and_access")
    def test_create_or_update_portal_saves_tokens(self, _ensure_access):
        portal = create_or_update_portal_from_bitrix_payload(
            payload={
                "DOMAIN": "demo.bitrix24.ru",
                "member_id": "member-123",
                "AUTH_ID": "access-token",
                "REFRESH_ID": "refresh-token",
                "AUTH_EXPIRES": "3600",
                "USER_ID": "42",
                "USER_NAME": "Анна Иванова",
                "SCOPE": "crm,user",
            },
            mark_installed=True,
        )

        token = BitrixAuthToken.objects.get(portal=portal)

        self.assertEqual(portal.domain, "demo.bitrix24.ru")
        self.assertEqual(portal.member_id, "member-123")
        self.assertEqual(token.get_access_token(), "access-token")
        self.assertEqual(token.get_refresh_token(), "refresh-token")
        self.assertEqual(token.auth_user_id, "42")
        self.assertEqual(token.auth_user_name, "Анна Иванова")
        self.assertEqual(token.scope, "crm,user")
        self.assertFalse(token.is_expired)

    @patch("apps.bitrix.services.install.ensure_free_subscription_and_access")
    def test_save_auth_token_preserves_existing_refresh_token_when_missing(self, _ensure_access):
        portal = create_or_update_portal_from_bitrix_payload(
            payload={
                "DOMAIN": "demo.bitrix24.ru",
                "member_id": "member-123",
                "AUTH_ID": "first-access-token",
                "REFRESH_ID": "first-refresh-token",
                "AUTH_EXPIRES": "3600",
                "USER_ID": "42",
                "USER_NAME": "Анна Иванова",
            },
            mark_installed=True,
        )

        create_or_update_portal_from_bitrix_payload(
            payload={
                "DOMAIN": "demo.bitrix24.ru",
                "member_id": "member-123",
                "AUTH_ID": "second-access-token",
                "AUTH_EXPIRES": "3600",
                "USER_ID": "42",
                "USER_NAME": "Анна Иванова",
            },
            mark_installed=False,
        )

        token = BitrixAuthToken.objects.get(portal=portal)

        self.assertEqual(token.get_access_token(), "second-access-token")
        self.assertEqual(token.get_refresh_token(), "first-refresh-token")

    @patch("apps.bitrix.services.install.ensure_free_subscription_and_access")
    def test_install_endpoint_returns_safe_bootstrap(self, _ensure_access):
        response = self.client.post(
            "/bitrix/install/",
            data={
                "DOMAIN": "demo.bitrix24.ru",
                "member_id": "member-123",
                "AUTH_ID": "access-token",
                "REFRESH_ID": "refresh-token",
                "AUTH_EXPIRES": "3600",
                "USER_ID": "42",
                "USER_NAME": "Анна Иванова",
                "SCOPE": "crm,user",
            },
        )

        self.assertEqual(response.status_code, 200)

        payload = response.json()

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["mode"], "install")
        self.assertEqual(payload["bootstrap"]["portal"]["domain"], "demo.bitrix24.ru")
        self.assertEqual(payload["bootstrap"]["portal"]["member_id"], "member-123")
        self.assertNotIn("access_token", str(payload))
        self.assertNotIn("refresh_token", str(payload))


class BitrixRestClientRefreshTests(TestCase):
    @patch("apps.bitrix.services.install.ensure_free_subscription_and_access")
    @override_settings(BITRIX_CLIENT_ID="client-id", BITRIX_CLIENT_SECRET="client-secret")
    def test_rest_client_refreshes_tokens(self, _ensure_access):
        portal = create_or_update_portal_from_bitrix_payload(
            payload={
                "DOMAIN": "demo.bitrix24.ru",
                "member_id": "member-123",
                "AUTH_ID": "old-access-token",
                "REFRESH_ID": "old-refresh-token",
                "AUTH_EXPIRES": "3600",
                "USER_ID": "42",
                "USER_NAME": "Анна Иванова",
                "SCOPE": "crm,user",
            },
            mark_installed=True,
        )

        token = BitrixAuthToken.objects.get(portal=portal)
        token.expires_at = timezone.now() - timedelta(minutes=5)
        token.save(update_fields=["expires_at", "updated_at"])

        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "access_token": "new-access-token",
            "refresh_token": "new-refresh-token",
            "expires_in": 3600,
            "scope": "crm,user,telephony",
            "user_id": "42",
            "member_id": "member-123",
            "client_endpoint": "https://demo.bitrix24.ru/rest/",
            "server_endpoint": "https://oauth.bitrix.info/rest/",
        }

        with patch("apps.bitrix.services.rest_client.requests.get", return_value=response):
            refreshed_token = BitrixRestClient(portal).refresh_tokens()

        self.assertEqual(refreshed_token.get_access_token(), "new-access-token")
        self.assertEqual(refreshed_token.get_refresh_token(), "new-refresh-token")
        self.assertEqual(refreshed_token.scope, "crm,user,telephony")

        portal.refresh_from_db()

        self.assertEqual(portal.client_endpoint, "https://demo.bitrix24.ru/rest/")
        self.assertEqual(portal.server_endpoint, "https://oauth.bitrix.info/rest/")