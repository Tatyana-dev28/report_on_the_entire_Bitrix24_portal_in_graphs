from __future__ import annotations

from django.conf import settings
from django.core import signing

from apps.bitrix.models import BitrixPortal, PortalUser
from apps.bitrix.services.portal_tokens import (
    get_portal_token_from_request,
    load_portal_api_token,
)
from apps.reports.services.exceptions import ReportPreviewSessionError


def resolve_portal(request, payload: dict) -> BitrixPortal:
    portal_token = get_portal_token_from_request(request, payload)

    if portal_token:
        try:
            token_payload = load_portal_api_token(portal_token)
        except signing.BadSignature as error:
            raise ReportPreviewSessionError(
                "Не удалось подтвердить доступ к порталу Bitrix24. Откройте приложение заново из Bitrix24.",
                status=403,
            ) from error

        member_id = str(token_payload.get("member_id") or "").strip()
        domain = str(token_payload.get("domain") or "").strip()

        if not member_id:
            raise ReportPreviewSessionError(
                "В токене портала нет идентификатора Bitrix24.",
                status=403,
            )

        portal = BitrixPortal.objects.filter(member_id=member_id).first()

        if not portal or (domain and portal.domain.lower() != domain.lower()):
            raise ReportPreviewSessionError(
                "Токен портала не соответствует сохраненному порталу Bitrix24.",
                status=403,
            )

        return portal

    if not settings.DEBUG:
        raise ReportPreviewSessionError(
            "Не удалось подтвердить доступ к порталу Bitrix24. Откройте приложение заново из Bitrix24.",
            status=403,
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

    portal = BitrixPortal.objects.order_by("id").first()

    if portal:
        return portal

    if settings.DEBUG:
        portal, _created = BitrixPortal.objects.get_or_create(
            member_id="local-dev",
            defaults={
                "domain": "local-dev.bitrix24.local",
                "protocol": BitrixPortal.Protocol.HTTPS,
                "status": BitrixPortal.Status.ACTIVE,
            },
        )

        return portal

    raise ReportPreviewSessionError(
        "Не удалось определить портал Битрикс24 для построения отчета.",
        status=400,
    )


def resolve_user(portal: BitrixPortal, request, payload: dict) -> tuple[PortalUser | None, str, str]:
    bitrix_user_id = (
        payload.get("bitrixUserId")
        or payload.get("bitrix_user_id")
        or payload.get("userId")
        or request.headers.get("X-Bitrix-User-Id")
        or "local-dev"
    )

    bitrix_user_id = str(bitrix_user_id)

    user = PortalUser.objects.filter(
        portal=portal,
        bitrix_user_id=bitrix_user_id,
    ).first()

    user_name = (
        payload.get("bitrixUserName")
        or payload.get("userName")
        or ""
    )

    if user and not user_name:
        user_name = user.full_name or str(user)

    return user, bitrix_user_id, str(user_name or "")
