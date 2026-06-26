from decimal import Decimal
from urllib.parse import parse_qs, urlparse

from django.test import TestCase, override_settings

from apps.billing.management.commands.seed_plans import Command as SeedPlansCommand
from apps.billing.models import Payment, PortalAccess
from apps.billing.services.robokassa import (
    create_robokassa_payment,
    make_signature,
    process_robokassa_result,
)
from apps.bitrix.models import BitrixPortal


ROBOKASSA_TEST_SETTINGS = {
    "ROBOKASSA_MERCHANT_LOGIN": "demo-shop",
    "ROBOKASSA_PASSWORD1": "password-1",
    "ROBOKASSA_PASSWORD2": "password-2",
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

        self.assertEqual(query["MerchantLogin"][0], "demo-shop")
        self.assertEqual(query["IsTest"][0], "1")
        self.assertEqual(inv_id, str(payment.id))
        self.assertEqual(
            query["SignatureValue"][0],
            make_signature("demo-shop", out_sum, inv_id, "password-1"),
        )

    def test_result_url_activates_paid_subscription(self):
        payment = create_robokassa_payment(portal=self.portal)
        out_sum = "990.00"
        payload = {
            "OutSum": out_sum,
            "InvId": str(payment.id),
            "SignatureValue": make_signature(out_sum, str(payment.id), "password-2"),
        }

        event, payment = process_robokassa_result(payload)
        access = PortalAccess.objects.get(portal=self.portal)

        self.assertEqual(event.status, event.Status.PROCESSED)
        self.assertTrue(event.is_signature_valid)
        self.assertEqual(payment.status, Payment.Status.SUCCEEDED)
        self.assertTrue(access.has_pro)
        self.assertEqual(access.access_level, PortalAccess.AccessLevel.PRO)
