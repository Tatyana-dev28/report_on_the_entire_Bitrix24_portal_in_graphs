from decimal import Decimal
from urllib.parse import parse_qs, quote, urlparse

from django.core.exceptions import ValidationError
from django.utils import timezone
from django.test import TestCase, override_settings

from apps.billing.management.commands.seed_plans import Command as SeedPlansCommand
from apps.billing.models import Payment, Plan, PortalAccess, Subscription
from apps.billing.services.bitrix_tariffs import UNKNOWN_LICENSE_MESSAGE
from apps.billing.services.robokassa import (
    build_robokassa_receipt,
    create_robokassa_payment,
    get_billing_state,
    make_signature,
    process_robokassa_result,
)
from apps.bitrix.models import BitrixPortal


ROBOKASSA_TEST_SETTINGS = {
    "DEBUG": True,
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
            bitrix_license_type="basic",
        )

    def test_create_payment_builds_robokassa_url(self):
        payment = create_robokassa_payment(portal=self.portal, plan_code="cloud_basic_5")

        self.assertEqual(payment.status, Payment.Status.PENDING)
        self.assertEqual(payment.amount, Decimal("0.00"))

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

    def test_seed_plans_creates_required_tariffs_with_default_zero_prices(self):
        required_codes = {
            "free",
            "cloud_basic_5",
            "cloud_standard_50",
            "cloud_professional_100",
            "cloud_enterprise_250",
            "cloud_enterprise_500",
            "cloud_enterprise_1000",
            "cloud_enterprise_2000",
            "cloud_enterprise_3000",
            "cloud_enterprise_4000",
            "cloud_enterprise_5000",
            "cloud_enterprise_6000",
            "cloud_enterprise_7000",
            "cloud_enterprise_8000",
            "cloud_enterprise_9000",
            "cloud_enterprise_10000",
            "box_shop_crm_12",
            "box_corporate_50",
            "box_corporate_100",
            "box_corporate_250",
            "box_corporate_500",
            "box_enterprise",
            "box_enterprise_extension_1000",
            "box_enterprise_holding",
            "box_enterprise_holding_extension_1000",
            "box_enterprise_1000",
            "box_enterprise_2000",
            "box_enterprise_3000",
            "box_enterprise_4000",
            "box_enterprise_5000",
            "box_enterprise_6000",
            "box_enterprise_7000",
            "box_enterprise_8000",
            "box_enterprise_9000",
            "box_enterprise_10000",
        }
        plans = Plan.objects.filter(code__in=required_codes)

        self.assertEqual(plans.count(), len(required_codes))
        self.assertFalse(plans.exclude(price=Decimal("0.00")).exists())

        free_plan = Plan.objects.get(code="free")
        self.assertEqual(free_plan.price, Decimal("0.00"))
        self.assertFalse(free_plan.is_purchasable)

    def test_seed_plans_does_not_overwrite_admin_price_without_reset(self):
        plan = Plan.objects.get(code="cloud_basic_5")
        plan.price = Decimal("12345.67")
        plan.name = "Old name"
        plan.save(update_fields=["price", "name", "updated_at"])

        SeedPlansCommand().handle()
        plan.refresh_from_db()

        self.assertEqual(plan.price, Decimal("12345.67"))
        self.assertEqual(plan.name, "Базовый тариф")

        SeedPlansCommand().handle(reset_defaults=True)
        plan.refresh_from_db()

        self.assertEqual(plan.price, Decimal("0.00"))

    def test_create_payment_adds_customer_email_to_reused_invoice(self):
        payment = create_robokassa_payment(portal=self.portal, plan_code="cloud_basic_5")

        self.assertEqual(payment.customer_email, "")

        reused_payment = create_robokassa_payment(
            portal=self.portal,
            plan_code="cloud_basic_5",
            customer_email="buyer@example.com",
        )
        parsed_url = urlparse(reused_payment.payment_url)
        query = parse_qs(parsed_url.query)

        self.assertEqual(payment.id, reused_payment.id)
        self.assertEqual(reused_payment.customer_email, "buyer@example.com")
        self.assertEqual(query["Email"][0], "buyer@example.com")
        receipt_json = build_robokassa_receipt(reused_payment)
        receipt_encoded = quote(receipt_json, safe="")
        self.assertEqual(query["Receipt"][0], receipt_encoded)

    def test_create_payment_reuses_pending_unexpired_invoice(self):
        first_payment = create_robokassa_payment(portal=self.portal, plan_code="cloud_basic_5")
        second_payment = create_robokassa_payment(portal=self.portal, plan_code="cloud_basic_5")

        self.assertEqual(first_payment.id, second_payment.id)
        self.assertEqual(Payment.objects.filter(portal=self.portal).count(), 1)

    def test_basic_portal_cannot_create_payment_for_enterprise_or_wrong_plan(self):
        with self.assertRaisesMessage(ValidationError, "Выбранный тариф недоступен"):
            create_robokassa_payment(
                portal=self.portal,
                plan_code="cloud_enterprise_1000",
                customer_email="buyer@example.com",
            )

        with self.assertRaisesMessage(ValidationError, "Выбранный тариф недоступен"):
            create_robokassa_payment(
                portal=self.portal,
                plan_code="cloud_standard_50",
                customer_email="buyer@example.com",
            )

        self.assertFalse(Payment.objects.filter(portal=self.portal).exists())

    def test_standard_portal_sees_only_standard_paid_plan_plus_free_info(self):
        self.portal.bitrix_license_type = "std"
        self.portal.save(update_fields=["bitrix_license_type", "updated_at"])

        state = get_billing_state(self.portal)
        plan_codes = {plan["code"] for plan in state["plans"]}

        self.assertEqual(plan_codes, {"free", "cloud_standard_50"})
        self.assertEqual(state["bitrixTariff"]["allowedPaidPlanCodes"], ["cloud_standard_50"])

    def test_enterprise_portal_sees_only_enterprise_paid_option_plus_free_info(self):
        self.portal.bitrix_license_type = "ent1000"
        self.portal.save(update_fields=["bitrix_license_type", "updated_at"])

        state = get_billing_state(self.portal)
        plan_codes = {plan["code"] for plan in state["plans"]}

        self.assertEqual(plan_codes, {"free", "cloud_enterprise_1000"})
        self.assertEqual(state["bitrixTariff"]["allowedPaidPlanCodes"], ["cloud_enterprise_1000"])

    def test_cloud_license_aliases_return_matching_paid_plan(self):
        cases = {
            "de_basic": "cloud_basic_5",
            "cloud standard": "cloud_standard_50",
            "de_pro100": "cloud_professional_100",
            "de_ent250": "cloud_enterprise_250",
            "ent500": "cloud_enterprise_500",
            "ent3000": "cloud_enterprise_3000",
            "ent10000": "cloud_enterprise_10000",
        }

        for license_type, expected_code in cases.items():
            with self.subTest(license_type=license_type):
                self.portal.bitrix_license_type = license_type
                self.portal.save(update_fields=["bitrix_license_type", "updated_at"])

                state = get_billing_state(self.portal)

                self.assertEqual(state["bitrixTariff"]["allowedPaidPlanCodes"], [expected_code])

    def test_box_license_aliases_return_matching_paid_plan(self):
        cases = {
            "corporate portal 250": "box_corporate_250",
            "box enterprise": "box_enterprise",
            "enterprise extension 1000": "box_enterprise_extension_1000",
            "enterprise holding": "box_enterprise_holding",
            "enterprise holding extension 1000": "box_enterprise_holding_extension_1000",
            "enterprise 10000": "box_enterprise_10000",
        }

        for license_type, expected_code in cases.items():
            with self.subTest(license_type=license_type):
                self.portal.bitrix_license_type = license_type
                self.portal.save(update_fields=["bitrix_license_type", "updated_at"])

                state = get_billing_state(self.portal)

                self.assertEqual(state["bitrixTariff"]["allowedPaidPlanCodes"], [expected_code])

    def test_unknown_license_type_does_not_expose_all_tariffs(self):
        self.portal.bitrix_license_type = "mystery"
        self.portal.save(update_fields=["bitrix_license_type", "updated_at"])

        state = get_billing_state(self.portal)
        plan_codes = {plan["code"] for plan in state["plans"]}

        self.assertEqual(plan_codes, {"free"})
        self.assertFalse(state["bitrixTariff"]["isKnown"])
        self.assertEqual(state["bitrixTariff"]["message"], UNKNOWN_LICENSE_MESSAGE)

    def test_payment_api_rejects_unavailable_plan_id(self):
        response = self.client.post(
            "/api/billing/payments/",
            data={
                "memberId": self.portal.member_id,
                "domain": self.portal.domain,
                "planCode": "cloud_enterprise_1000",
                "customerEmail": "buyer@example.com",
            },
            content_type="application/json",
            secure=True,
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Payment.objects.filter(portal=self.portal).exists())

    def test_billing_access_app_info_failure_returns_free_plan_and_unknown_license(self):
        response = self.client.get(
            "/api/billing/access/",
            data={
                "memberId": self.portal.member_id,
                "domain": self.portal.domain,
            },
            secure=True,
        )

        self.assertEqual(response.status_code, 200)

        payload = response.json()
        plan_codes = {plan["code"] for plan in payload["plans"]}

        self.assertEqual(plan_codes, {"free"})
        self.assertFalse(payload["bitrixTariff"]["license_detected"])
        self.assertEqual(payload["bitrixTariff"]["allowedPaidPlanCodes"], [])
        self.assertEqual(payload["bitrixTariff"]["message"], UNKNOWN_LICENSE_MESSAGE)

    def test_result_url_activates_paid_subscription(self):
        payment = create_robokassa_payment(portal=self.portal, plan_code="cloud_basic_5")
        out_sum = "0.00"
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

    def test_success_redirect_includes_portal_token_only_with_valid_signature(self):
        payment = create_robokassa_payment(portal=self.portal, plan_code="cloud_basic_5")
        out_sum = "0.00"
        response = self.client.get(
            "/api/billing/robokassa/success/",
            data={
                "OutSum": out_sum,
                "InvId": str(payment.id),
                "SignatureValue": make_signature(out_sum, str(payment.id), "test-password-1"),
            },
            secure=True,
        )

        self.assertEqual(response.status_code, 302)
        self.assertIn("paymentStatus=success", response.url)
        self.assertIn("portalToken=", response.url)

    def test_success_redirect_does_not_expose_portal_token_without_valid_signature(self):
        payment = create_robokassa_payment(portal=self.portal, plan_code="cloud_basic_5")
        response = self.client.get(
            "/api/billing/robokassa/success/",
            data={
                "OutSum": "0.00",
                "InvId": str(payment.id),
                "SignatureValue": "bad-signature",
            },
            secure=True,
        )

        self.assertEqual(response.status_code, 302)
        self.assertIn("paymentStatus=success", response.url)
        self.assertNotIn("portalToken=", response.url)

    def test_repeated_result_does_not_extend_subscription_twice(self):
        payment = create_robokassa_payment(portal=self.portal, plan_code="cloud_basic_5")
        payload = {
            "OutSum": "0.00",
            "InvId": str(payment.id),
            "SignatureValue": make_signature("0.00", str(payment.id), "test-password-2"),
        }

        process_robokassa_result(payload)
        payment.refresh_from_db()
        first_paid_until = payment.subscription.paid_until

        process_robokassa_result(payload)
        payment.subscription.refresh_from_db()

        self.assertEqual(payment.subscription.paid_until, first_paid_until)

    def test_active_pro_blocks_second_invoice(self):
        first_payment = create_robokassa_payment(portal=self.portal, plan_code="cloud_basic_5")
        first_payload = {
            "OutSum": "0.00",
            "InvId": str(first_payment.id),
            "SignatureValue": make_signature("0.00", str(first_payment.id), "test-password-2"),
        }
        process_robokassa_result(first_payload)

        first_payment.expires_at = timezone.now()
        first_payment.save(update_fields=["expires_at", "updated_at"])

        with self.assertRaisesMessage(ValidationError, "PRO-подписка уже активна"):
            create_robokassa_payment(portal=self.portal, plan_code="cloud_basic_5")

        self.assertEqual(Payment.objects.filter(portal=self.portal).count(), 1)


@override_settings(**ROBOKASSA_TEST_SETTINGS)
class NfrBillingTests(TestCase):
    """Tests for NFR (Not For Resale) license support."""

    def setUp(self):
        SeedPlansCommand().handle()
        self.portal = BitrixPortal.objects.create(
            domain="nfr-portal.bitrix24.ru",
            member_id="member-nfr",
            protocol=BitrixPortal.Protocol.HTTPS,
            status=BitrixPortal.Status.INSTALLED,
            bitrix_license="ru_nfr",
            bitrix_license_type="nfr",
            bitrix_license_family="nfr",
        )

    def test_seed_plans_creates_nfr_plan(self):
        """seed_plans создает NFR plan."""
        nfr_plan = Plan.objects.filter(code="nfr").first()
        self.assertIsNotNone(nfr_plan)
        self.assertEqual(nfr_plan.name, "NFR тариф")
        self.assertEqual(nfr_plan.bitrix_version, "nfr")
        self.assertEqual(nfr_plan.tariff_group, "nfr")
        self.assertTrue(nfr_plan.is_purchasable)
        self.assertTrue(nfr_plan.is_active)
        self.assertEqual(nfr_plan.price, Decimal("0.00"))
        self.assertEqual(nfr_plan.billing_period, Plan.BillingPeriod.MONTH)

    def test_seed_plans_does_not_overwrite_nfr_price(self):
        """Повторный seed_plans не перетирает цену NFR plan."""
        nfr_plan = Plan.objects.get(code="nfr")
        nfr_plan.price = Decimal("999.00")
        nfr_plan.save(update_fields=["price", "updated_at"])

        SeedPlansCommand().handle()
        nfr_plan.refresh_from_db()

        self.assertEqual(nfr_plan.price, Decimal("999.00"))

        SeedPlansCommand().handle(reset_defaults=True)
        nfr_plan.refresh_from_db()

        self.assertEqual(nfr_plan.price, Decimal("0.00"))

    def test_nfr_license_maps_to_nfr_plan(self):
        """LICENSE=ru_nfr мапится в NFR plan."""
        self.portal.bitrix_license = "ru_nfr"
        self.portal.bitrix_license_type = ""
        self.portal.bitrix_license_family = ""
        self.portal.save(update_fields=["bitrix_license", "bitrix_license_type", "bitrix_license_family", "updated_at"])

        state = get_billing_state(self.portal)
        plan_codes = {plan["code"] for plan in state["plans"]}
        allowed_paid = state["bitrixTariff"]["allowedPaidPlanCodes"]

        self.assertIn("nfr", plan_codes)
        self.assertEqual(allowed_paid, ["nfr"])
        self.assertTrue(state["bitrixTariff"]["license_detected"])

    def test_nfr_license_type_maps_to_nfr_plan(self):
        """LICENSE_TYPE=nfr мапится в NFR plan."""
        self.portal.bitrix_license = ""
        self.portal.bitrix_license_type = "nfr"
        self.portal.bitrix_license_family = ""
        self.portal.save(update_fields=["bitrix_license", "bitrix_license_type", "bitrix_license_family", "updated_at"])

        state = get_billing_state(self.portal)
        plan_codes = {plan["code"] for plan in state["plans"]}
        allowed_paid = state["bitrixTariff"]["allowedPaidPlanCodes"]

        self.assertIn("nfr", plan_codes)
        self.assertEqual(allowed_paid, ["nfr"])
        self.assertTrue(state["bitrixTariff"]["license_detected"])

    def test_nfr_license_family_maps_to_nfr_plan(self):
        """LICENSE_FAMILY=nfr мапится в NFR plan."""
        self.portal.bitrix_license = ""
        self.portal.bitrix_license_type = ""
        self.portal.bitrix_license_family = "nfr"
        self.portal.save(update_fields=["bitrix_license", "bitrix_license_type", "bitrix_license_family", "updated_at"])

        state = get_billing_state(self.portal)
        plan_codes = {plan["code"] for plan in state["plans"]}
        allowed_paid = state["bitrixTariff"]["allowedPaidPlanCodes"]

        self.assertIn("nfr", plan_codes)
        self.assertEqual(allowed_paid, ["nfr"])
        self.assertTrue(state["bitrixTariff"]["license_detected"])

    def test_nfr_portal_sees_free_and_nfr_plan(self):
        """Billing access для nfr-портала возвращает free + NFR paid plan."""
        state = get_billing_state(self.portal)
        plan_codes = {plan["code"] for plan in state["plans"]}

        self.assertEqual(plan_codes, {"free", "nfr"})
        self.assertEqual(state["bitrixTariff"]["allowedPaidPlanCodes"], ["nfr"])

    def test_nfr_portal_does_not_show_unknown(self):
        """Billing access для nfr-портала не возвращает 'Тариф не определён'."""
        state = get_billing_state(self.portal)

        self.assertTrue(state["bitrixTariff"]["license_detected"])
        self.assertEqual(state["bitrixTariff"]["message"], "")

    def test_nfr_portal_can_pay_only_nfr_plan(self):
        """Payment creation для nfr-портала разрешает только NFR plan."""
        payment = create_robokassa_payment(
            portal=self.portal,
            plan_code="nfr",
            customer_email="nfr@example.com",
        )

        self.assertEqual(payment.status, Payment.Status.PENDING)
        self.assertEqual(payment.plan.code, "nfr")

    def test_nfr_portal_rejects_basic_plan(self):
        """Payment creation для nfr-портала отклоняет cloud_basic_5."""
        with self.assertRaisesMessage(ValidationError, "Выбранный тариф недоступен"):
            create_robokassa_payment(
                portal=self.portal,
                plan_code="cloud_basic_5",
                customer_email="nfr@example.com",
            )

        self.assertFalse(Payment.objects.filter(portal=self.portal).exists())

    def test_nfr_portal_rejects_other_non_nfr_plans(self):
        """Payment creation для nfr-портала отклоняет прочие не-NFR тарифы."""
        forbidden_codes = [
            "cloud_standard_50",
            "cloud_professional_100",
            "cloud_enterprise_250",
            "cloud_enterprise_1000",
            "box_corporate_100",
            "box_enterprise_1000",
            "pro_monthly",
        ]

        for plan_code in forbidden_codes:
            with self.subTest(plan_code=plan_code):
                with self.assertRaisesMessage(ValidationError, "Выбранный тариф недоступен"):
                    create_robokassa_payment(
                        portal=self.portal,
                        plan_code=plan_code,
                        customer_email="nfr@example.com",
                    )

        self.assertFalse(Payment.objects.filter(portal=self.portal).exists())

    def test_existing_mappings_not_broken(self):
        """Существующие mapping для basic/std/pro/enterprise/cloud/box не сломались."""
        cases = {
            "basic": "cloud_basic_5",
            "std": "cloud_standard_50",
            "pro": "cloud_professional_100",
            "ent250": "cloud_enterprise_250",
            "ent1000": "cloud_enterprise_1000",
            "ent2000": "cloud_enterprise_2000",
            "shopcrm12": "box_shop_crm_12",
            "enterprise1000": "box_enterprise_1000",
            "enterprise10000": "box_enterprise_10000",
        }

        for license_type, expected_code in cases.items():
            with self.subTest(license_type=license_type):
                portal = BitrixPortal.objects.create(
                    domain=f"{license_type}-portal.bitrix24.ru",
                    member_id=f"member-{license_type}",
                    protocol=BitrixPortal.Protocol.HTTPS,
                    status=BitrixPortal.Status.INSTALLED,
                    bitrix_license_type=license_type,
                )

                state = get_billing_state(portal)
                self.assertEqual(
                    state["bitrixTariff"]["allowedPaidPlanCodes"],
                    [expected_code],
                )
                self.assertTrue(state["bitrixTariff"]["license_detected"])
                self.assertEqual(state["bitrixTariff"]["message"], "")
