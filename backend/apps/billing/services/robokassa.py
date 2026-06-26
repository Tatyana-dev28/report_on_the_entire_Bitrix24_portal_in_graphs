from __future__ import annotations

import hashlib
import hmac
import uuid
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from urllib.parse import urlencode

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.db import transaction
from django.utils import timezone

from apps.billing.models import Payment, PaymentWebhookEvent, Plan, PortalAccess, Subscription
from apps.billing.services.access import (
    activate_paid_subscription,
    get_pro_monthly_plan,
    set_free_access,
    sync_portal_access_from_subscription,
)
from apps.bitrix.models import BitrixPortal
from apps.common.services.sanitizers import sanitize_payload


ROBOKASSA_PAY_URL = "https://auth.robokassa.ru/Merchant/Index.aspx"


@dataclass(frozen=True)
class RobokassaConfig:
    merchant_login: str
    password1: str
    password2: str
    is_test: bool
    payment_url: str = ROBOKASSA_PAY_URL


def get_robokassa_config() -> RobokassaConfig:
    merchant_login = getattr(settings, "ROBOKASSA_MERCHANT_LOGIN", "")
    password1 = getattr(settings, "ROBOKASSA_PASSWORD1", "")
    password2 = getattr(settings, "ROBOKASSA_PASSWORD2", "")

    if not merchant_login or not password1 or not password2:
        raise ImproperlyConfigured(
            "Robokassa is not configured. Set ROBOKASSA_MERCHANT_LOGIN, "
            "ROBOKASSA_PASSWORD1 and ROBOKASSA_PASSWORD2."
        )

    return RobokassaConfig(
        merchant_login=merchant_login,
        password1=password1,
        password2=password2,
        is_test=getattr(settings, "ROBOKASSA_TEST_MODE", True),
        payment_url=getattr(settings, "ROBOKASSA_PAYMENT_URL", ROBOKASSA_PAY_URL),
    )


def serialize_plan(plan: Plan) -> dict:
    return {
        "code": plan.code,
        "name": plan.name,
        "description": plan.description,
        "price": str(plan.price),
        "currency": plan.currency,
        "billingPeriod": plan.billing_period,
        "durationMonths": plan.duration_months,
        "features": plan.features,
        "limits": plan.limits,
    }


def serialize_access(access: PortalAccess | None) -> dict:
    if not access:
        return {
            "accessLevel": "free",
            "hasPro": False,
            "isLifetime": False,
            "validUntil": None,
            "features": {},
            "limits": {},
        }

    return {
        "accessLevel": access.access_level,
        "hasPro": access.has_pro,
        "isLifetime": access.is_lifetime,
        "validUntil": access.valid_until.isoformat() if access.valid_until else None,
        "features": access.features,
        "limits": access.limits,
    }


def get_billing_state(portal: BitrixPortal) -> dict:
    access = PortalAccess.objects.filter(portal=portal).first()
    plans = Plan.objects.filter(is_active=True, is_public=True).order_by(
        "sort_order",
        "price",
        "name",
    )

    return {
        "access": serialize_access(access),
        "plans": [serialize_plan(plan) for plan in plans],
    }


def format_robokassa_amount(amount: Decimal) -> str:
    return format(amount.quantize(Decimal("0.00")), "f")


def make_signature(*parts: str) -> str:
    source = ":".join(parts)
    return hashlib.md5(source.encode("utf-8")).hexdigest()


def build_payment_url(payment: Payment, config: RobokassaConfig | None = None) -> str:
    config = config or get_robokassa_config()
    out_sum = format_robokassa_amount(payment.amount)
    signature = make_signature(
        config.merchant_login,
        out_sum,
        str(payment.id),
        config.password1,
    )

    params = {
        "MerchantLogin": config.merchant_login,
        "OutSum": out_sum,
        "InvId": str(payment.id),
        "Description": payment.description,
        "SignatureValue": signature,
        "Culture": "ru",
        "Encoding": "utf-8",
    }

    if payment.customer_email:
        params["Email"] = payment.customer_email

    if config.is_test:
        params["IsTest"] = "1"

    return f"{config.payment_url}?{urlencode(params)}"


def get_or_create_portal_subscription(portal: BitrixPortal) -> Subscription:
    subscription = (
        Subscription.objects
        .filter(portal=portal)
        .order_by("-created_at")
        .first()
    )

    if subscription:
        return subscription

    free_plan = Plan.objects.filter(code="free", is_active=True).first()

    if not free_plan:
        raise ValidationError("Free plan is not configured. Run seed_plans.")

    subscription = Subscription.objects.create(
        portal=portal,
        plan=free_plan,
        status=Subscription.Status.FREE,
        provider=Subscription.Provider.NONE,
        started_at=timezone.now(),
        metadata={"source": "billing_payment"},
    )
    set_free_access(portal, subscription=subscription)

    return subscription


@transaction.atomic
def create_robokassa_payment(
    *,
    portal: BitrixPortal,
    plan_code: str = "pro_monthly",
    customer_email: str = "",
) -> Payment:
    if plan_code != "pro_monthly":
        raise ValidationError("Only pro_monthly payments are available.")

    plan = get_pro_monthly_plan()

    if not plan:
        raise ValidationError("Pro monthly plan is not configured. Run seed_plans.")

    if plan.price <= 0:
        raise ValidationError("Pro monthly plan price must be greater than zero.")

    subscription = get_or_create_portal_subscription(portal)
    existing_payment = (
        Payment.objects.select_for_update()
        .filter(
            portal=portal,
            plan=plan,
            provider=Payment.Provider.ROBOKASSA,
            status=Payment.Status.PENDING,
            amount=plan.price,
            currency=plan.currency,
            expires_at__gt=timezone.now(),
        )
        .order_by("-created_at")
        .first()
    )

    if existing_payment:
        return existing_payment

    payment = Payment.objects.create(
        portal=portal,
        subscription=subscription,
        plan=plan,
        order_id=f"pro-{portal.id}-{uuid.uuid4().hex[:20]}",
        provider=Payment.Provider.ROBOKASSA,
        status=Payment.Status.PENDING,
        amount=plan.price,
        currency=plan.currency,
        description=f"{plan.name} для портала {portal.domain}",
        customer_email=customer_email,
        metadata={
            "plan_code": plan.code,
            "portal_domain": portal.domain,
        },
    )
    payment.payment_url = build_payment_url(payment)
    payment.expires_at = timezone.now() + timedelta(hours=2)
    payment.save(update_fields=["payment_url", "expires_at", "updated_at"])

    return payment


def get_request_payload(request) -> dict:
    payload = {}
    payload.update(request.GET.dict())

    if request.method == "POST":
        payload.update(request.POST.dict())

    return payload


def parse_result_amount(value: str) -> Decimal:
    try:
        return Decimal(str(value).replace(",", "."))
    except (InvalidOperation, TypeError) as error:
        raise ValidationError("Invalid OutSum.") from error


def verify_result_signature(payload: dict, config: RobokassaConfig | None = None) -> bool:
    config = config or get_robokassa_config()
    out_sum = str(payload.get("OutSum", ""))
    inv_id = str(payload.get("InvId", ""))
    signature = str(payload.get("SignatureValue", "")).lower()

    if not out_sum or not inv_id or not signature:
        return False

    expected_signature = make_signature(out_sum, inv_id, config.password2)

    return hmac.compare_digest(expected_signature.lower(), signature)


@transaction.atomic
def process_robokassa_result(payload: dict) -> tuple[PaymentWebhookEvent, Payment]:
    inv_id = str(payload.get("InvId", "")).strip()
    signature = str(payload.get("SignatureValue", "")).strip()
    idempotency_key = f"robokassa-result:{inv_id}:{signature}"

    event = PaymentWebhookEvent(
        provider=PaymentWebhookEvent.Provider.ROBOKASSA,
        event_id=inv_id,
        event_type="payment_result",
        payload=sanitize_payload(payload),
    )
    event.set_idempotency_key(idempotency_key, save=False)
    event.set_signature(signature, save=False)

    duplicate = PaymentWebhookEvent.objects.filter(
        idempotency_key_hash=event.idempotency_key_hash,
    ).first()

    if duplicate and duplicate.status == PaymentWebhookEvent.Status.PROCESSED and duplicate.payment:
        return duplicate, duplicate.payment

    if duplicate:
        event = duplicate
        event.attempts_count += 1
        event.payload = sanitize_payload(payload)
        event.set_signature(signature, save=False)
    else:
        event.attempts_count = 1

    try:
        payment = Payment.objects.select_for_update().get(id=int(inv_id))
    except (Payment.DoesNotExist, ValueError) as error:
        event.status = PaymentWebhookEvent.Status.FAILED
        event.error_message = "Payment was not found."
        event.processed_at = timezone.now()
        event.save()
        raise ValidationError("Payment was not found.") from error

    if not event.pk:
        duplicate = PaymentWebhookEvent.objects.filter(
            idempotency_key_hash=event.idempotency_key_hash,
        ).first()

        if duplicate and duplicate.status == PaymentWebhookEvent.Status.PROCESSED and duplicate.payment:
            return duplicate, duplicate.payment

        if duplicate:
            event = duplicate
            event.attempts_count += 1
            event.payload = sanitize_payload(payload)
            event.set_signature(signature, save=False)

    event.payment = payment
    event.portal = payment.portal
    event.is_signature_valid = verify_result_signature(payload)

    if not event.is_signature_valid:
        event.status = PaymentWebhookEvent.Status.FAILED
        event.error_message = "Invalid Robokassa signature."
        event.processed_at = timezone.now()
        event.save()
        raise ValidationError("Invalid Robokassa signature.")

    result_amount = parse_result_amount(str(payload.get("OutSum", "")))

    if result_amount != payment.amount:
        event.status = PaymentWebhookEvent.Status.FAILED
        event.error_message = "Payment amount does not match."
        event.processed_at = timezone.now()
        event.save()
        raise ValidationError("Payment amount does not match.")

    payment.status = Payment.Status.SUCCEEDED
    payment.paid_at = payment.paid_at or timezone.now()
    payment.provider_invoice_id = str(payload.get("InvId", "")) or payment.provider_invoice_id
    payment.raw_provider_payload = sanitize_payload(payload)
    payment.save(
        update_fields=[
            "status",
            "paid_at",
            "provider_invoice_id",
            "raw_provider_payload",
            "updated_at",
        ]
    )

    if payment.subscription:
        activate_paid_subscription(payment.subscription)
        sync_portal_access_from_subscription(payment.subscription)

    event.status = PaymentWebhookEvent.Status.PROCESSED
    event.error_message = ""
    event.processed_at = timezone.now()
    event.save()

    return event, payment
