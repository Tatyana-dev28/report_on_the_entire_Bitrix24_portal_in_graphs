import json
import logging
import os
from urllib.parse import urlencode

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured, PermissionDenied, ValidationError
from django.core import signing
from django.core.validators import validate_email
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import redirect
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from apps.billing.models import Payment
from apps.billing.services.robokassa import (
    create_robokassa_payment,
    get_billing_state,
    get_request_payload,
    process_robokassa_result,
    verify_success_signature,
)
from apps.billing.services.bitrix_tariffs import refresh_portal_bitrix_license
from apps.bitrix.models import BitrixPortal
from apps.bitrix.services.portal_tokens import (
    get_portal_token_from_request,
    load_portal_api_token,
    make_portal_api_token,
)


logger = logging.getLogger(__name__)


def _json_error(message: str, status: int = 400, details: dict | None = None) -> JsonResponse:
    payload: dict = {
        "ok": False,
        "error": message,
    }

    if details:
        payload["details"] = details

    return JsonResponse(payload, status=status, json_dumps_params={"ensure_ascii": False})


def _parse_json_body(request: HttpRequest) -> tuple[dict, JsonResponse | None]:
    if not request.body:
        return {}, None

    try:
        payload = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError as error:
        return {}, _json_error(
            "Некорректный JSON в теле запроса.",
            details={"message": str(error)},
        )

    if not isinstance(payload, dict):
        return {}, _json_error("Тело запроса должно быть JSON-объектом.")

    return payload, None


def _frontend_payment_redirect(payment_status: str, payment: Payment | None = None):
    frontend_url = (
        getattr(settings, "FRONTEND_URL", "")
        or getattr(settings, "BITRIX_FRONTEND_URL", "")
        or os.environ.get("FRONTEND_URL", "")
        or os.environ.get("BITRIX_FRONTEND_URL", "")
        or "https://portal-analytics.sappapp1b24.ru"
    ).rstrip("/")

    query = {
        "paymentStatus": payment_status,
    }

    if payment:
        query.update(
            {
                "paymentId": str(payment.public_id),
                "memberId": payment.portal.member_id,
                "domain": payment.portal.domain,
                "bitrixUserId": payment.portal.installed_by_user_id or "",
                "portalToken": make_portal_api_token(
                    portal=payment.portal,
                    bitrix_user_id=payment.portal.installed_by_user_id or "",
                ),
            }
        )

    return redirect(f"{frontend_url}/?{urlencode(query)}")


def _get_signed_redirect_payment(payload: dict) -> Payment | None:
    try:
        inv_id = int(str(payload.get("InvId", "")))
    except (TypeError, ValueError):
        return None

    payment = Payment.objects.filter(id=inv_id).select_related("portal").first()

    if not payment:
        return None

    try:
        if not verify_success_signature(payload, payment):
            return None
    except ImproperlyConfigured as error:
        logger.warning("Could not verify Robokassa success redirect: %s", error)
        return None

    return payment


def _resolve_billing_portal(request: HttpRequest, payload: dict) -> BitrixPortal:
    portal_token = get_portal_token_from_request(request, payload)

    if portal_token:
        try:
            token_payload = load_portal_api_token(portal_token)
        except signing.BadSignature as error:
            raise PermissionDenied(
                "Не удалось подтвердить доступ к порталу Bitrix24. Откройте приложение заново из Bitrix24."
            ) from error

        member_id = str(token_payload.get("member_id") or "").strip()
        domain = str(token_payload.get("domain") or "").strip()

        if not member_id:
            raise PermissionDenied("В токене портала нет идентификатора Bitrix24.")

        portal = BitrixPortal.objects.filter(member_id=member_id).first()

        if not portal or (domain and portal.domain.lower() != domain.lower()):
            raise PermissionDenied(
                "Токен портала не соответствует сохраненному порталу Bitrix24."
            )

        return portal

    if not settings.DEBUG:
        raise PermissionDenied(
            "Не удалось подтвердить доступ к порталу Bitrix24. Откройте приложение заново из Bitrix24."
        )

    member_id = (
        payload.get("memberId")
        or payload.get("member_id")
        or request.headers.get("X-Bitrix-Member-Id")
    )
    domain = (
        payload.get("domain")
        or payload.get("DOMAIN")
        or request.headers.get("X-Bitrix-Domain")
    )

    if member_id:
        portal = BitrixPortal.objects.filter(member_id=str(member_id)).first()

        if portal:
            return portal

    if domain:
        portal = BitrixPortal.objects.filter(domain=str(domain)).first()

        if portal:
            return portal

    raise ValidationError("Не удалось определить портал для оплаты.")


@require_GET
def billing_access_view(request: HttpRequest):
    try:
        portal = _resolve_billing_portal(request, request.GET.dict())
    except PermissionDenied as error:
        return _json_error(str(error), status=403)
    except ValidationError as error:
        return _json_error(str(error), status=400)

    refresh_portal_bitrix_license(portal)

    return JsonResponse(
        {
            "ok": True,
            **get_billing_state(portal),
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_http_methods(["POST"])
def create_payment_view(request: HttpRequest):
    payload, error_response = _parse_json_body(request)

    if error_response:
        return error_response

    try:
        customer_email = str(payload.get("customerEmail") or "").strip()

        if not customer_email:
            raise ValidationError("Email for receipt is required.")

        validate_email(customer_email)

        portal = _resolve_billing_portal(request, payload)
        refresh_portal_bitrix_license(portal)
        payment = create_robokassa_payment(
            portal=portal,
            plan_code=str(payload.get("planCode") or "").strip() or None,
            customer_email=customer_email,
        )
    except PermissionDenied as error:
        logger.warning("Payment creation denied: %s", error)
        return _json_error(str(error), status=403)
    except ImproperlyConfigured as error:
        logger.exception("Payment creation failed because Robokassa is not configured.")
        return _json_error(str(error), status=400)
    except ValidationError as error:
        logger.warning("Payment creation validation failed: %s", error)
        return _json_error(str(error), status=400)

    return JsonResponse(
        {
            "ok": True,
            "payment": {
                "id": str(payment.public_id),
                "orderId": payment.order_id,
                "status": payment.status,
                "amount": str(payment.amount),
                "currency": payment.currency,
                "paymentUrl": payment.payment_url,
                "expiresAt": payment.expires_at.isoformat() if payment.expires_at else None,
            },
        },
        json_dumps_params={"ensure_ascii": False},
    )


@csrf_exempt
@require_http_methods(["GET", "POST"])
def robokassa_result_view(request: HttpRequest):
    payload = get_request_payload(request)

    try:
        _event, payment = process_robokassa_result(payload)
    except (ImproperlyConfigured, ValidationError) as error:
        logger.warning("Robokassa result processing failed: %s", error)
        return HttpResponse(str(error), status=400, content_type="text/plain; charset=utf-8")

    return HttpResponse(f"OK{payment.id}", content_type="text/plain; charset=utf-8")


@csrf_exempt
@require_http_methods(["GET", "POST"])
def robokassa_success_view(request: HttpRequest):
    payload = get_request_payload(request)
    payment = _get_signed_redirect_payment(payload)

    return _frontend_payment_redirect("success", payment=payment)


@csrf_exempt
@require_http_methods(["GET", "POST"])
def robokassa_fail_view(request: HttpRequest):
    payload = get_request_payload(request)
    payment = None

    try:
        inv_id = int(str(payload.get("InvId", "")))
        payment = Payment.objects.filter(id=inv_id).select_related("portal").first()

        if payment and payment.status == Payment.Status.PENDING:
            payment.status = Payment.Status.CANCELED
            payment.raw_provider_payload = payload
            payment.save(update_fields=["status", "raw_provider_payload", "updated_at"])
    except (TypeError, ValueError):
        payment = None

    return _frontend_payment_redirect("fail", payment=payment)
