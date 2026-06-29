from decimal import Decimal
from urllib.parse import parse_qs, quote, urlparse

from django.core.exceptions import ValidationError
from django.utils import timezone
from django.test import TestCase, override_settings

from apps.billing.management.commands.seed_plans import Command as SeedPlansCommand
from apps.billing.models import Payment, PortalAccess, Subscription
from apps.billing.services.robokassa import (
    build_robokassa_receipt,
    create_robokassa_payment,
    make_signature,
    process_robokassa_result,
)
from apps.bitrix.models import BitrixPortal


ROBOKASSA_TEST_SETTINGS = {
    "ROBOKASSA_MERCHANT_LOGIN": "demo-shop",
    "ROBOKASSA_PASSWORD1": "password-1",
    "ROBOKASSA_PASSWORD2": "password-2",
    "ROBOKASSA_TEST_PASSWORD1": "test-password-1",
    "ROBOKASSA_TEST_PASSWORD2": "test-password-2",
    "ROBOKASSA_TEST_MODE": True,
    "ROBOKASSA_PAYMENT_URL": "https://auth.robokassa.ru/Merchant/Index.aspx",
}


@override_settings(**ROBOKASSA_TEST_SETTINGS)
class RobokassaBillingTests(TestCase):
    def setUp(self):
        SeedPlansCommand().handle()
        self.portal = BitrixPortal.objects.create(
            domain="example.bitrix24.ru",
            member_id="member-1",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.INSTALLED,
        )

    def test_create_payment_builds_robokassa_url(self):
        payment = create_robokassa_payment(portal=self.portal)

        self.assertEqual(payment.status, Payment.Status.PENDING)
        self.assertEqual(payment.amount, Decimal("990.00"))

        parsed_url = urlparse(payment.payment_url)
        query = parse_qs(parsed_url.query)
        out_sum = query["OutSum"][0]
        inv_id = query["InvId"][0]
        receipt_json = build_robokassa_receipt(payment)
        receipt_encoded = quote(receipt_json, safe="")

        self.assertEqual(query["MerchantLogin"][0], "demo-shop")
        self.assertEqual(query["IsTest"][0], "1")
        self.assertEqual(inv_id, str(payment.id))
        # Проверяем двойное URL-кодирование Receipt в сырой строке запроса
        self.assertIn("%257B", parsed_url.query)
        # После декодирования parse_qs значение Receipt должно быть равно receipt_encoded
        self.assertEqual(query["Receipt"][0], receipt_encoded)
        self.assertEqual(
            query["SignatureValue"][0],
            make_signature("demo-shop", out_sum, inv_id, receipt_encoded, "test-password-1"),
        )

    def test_create_payment_adds_customer_email_to_reused_invoice(self):
        payment = create_robokassa_payment(portal=self.portal)

        self.assertEqual(payment.customer_email, "")

        reused_payment = create_robokassa_payment(
            portal=self.portal,
            customer_email="buyer@example.com",
        )
        parsed_url = urlparse(reused_payment.payment_url)
        query = parse_qs(parsed_url.query)

        self.assertEqual(payment.id, reused_payment.id)
        self.assertEqual(reused_payment.customer_email, "buyer@example.com")
        self.assertEqual(query["Email"][0], "buyer@example.com")
        receipt_json = build_robokassa_receipt(reused_payment)
        receipt_encoded = quote(receipt_json, safe="")
        self.assertIn(f"Receipt={receipt_encoded}", parsed_url.query)

    def test_create_payment_reuses_pending_unexpired_invoice(self):
        first_payment = create_robokassa_payment(portal=self.portal)
        second_payment = create_robokassa_payment(portal=self.portal)

        self.assertEqual(first_payment.id, second_payment.id)
        self.assertEqual(Payment.objects.filter(portal=self.portal).count(), 1)

    def test_result_url_activates_paid_subscription(self):
        payment = create_robokassa_payment(portal=self.portal)
        out_sum = "990.00"
        payload = {
            "OutSum": out_sum,
            "InvId": str(payment.id),
            "SignatureValue": make_signature(out_sum, str(payment.id), "test-password-2"),
        }

        event, payment = process_robokassa_result(payload)
        access = PortalAccess.objects.get(portal=self.portal)

        self.assertEqual(event.status, event.Status.PROCESSED)
        self.assertTrue(event.is_signature_valid)
        self.assertEqual(payment.status, Payment.Status.SUCCEEDED)
        self.assertTrue(access.has_pro)
        self.assertEqual(access.access_level, PortalAccess.AccessLevel.PRO)
        self.assertEqual(
            payment.metadata["subscription_paid_until"],
            payment.subscription.paid_until.isoformat(),
        )

    def test_repeated_result_does_not_extend_subscription_twice(self):
        payment = create_robokassa_payment(portal=self.portal)
        payload = {
            "OutSum": "990.00",
            "InvId": str(payment.id),
            "SignatureValue": make_signature("990.00", str(payment.id), "test-password-2"),
        }

        process_robokassa_result(payload)
        payment.refresh_from_db()
        first_paid_until = payment.subscription.paid_until

        process_robokassa_result(payload)
        payment.subscription.refresh_from_db()

        self.assertEqual(payment.subscription.paid_until, first_paid_until)

    def test_active_pro_blocks_second_invoice(self):
        first_payment = create_robokassa_payment(portal=self.portal)
        first_payload = {
            "OutSum": "990.00",
            "InvId": str(first_payment.id),
            "SignatureValue": make_signature("990.00", str(first_payment.id), "test-password-2"),
        }
        process_robokassa_result(first_payload)

        first_payment.expires_at = timezone.now()
        first_payment.save(update_fields=["expires_at", "updated_at"])

        with self.assertRaisesMessage(ValidationError, "PRO-подписка уже активна"):
            create_robokassa_payment(portal=self.portal)

        self.assertEqual(Payment.objects.filter(portal=self.portal).count(), 1)
