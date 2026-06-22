from __future__ import annotations

from django.conf import settings

from apps.bitrix.models import BitrixPortal, PortalUser
from apps.reports.services.exceptions import ReportPreviewSessionError


def resolve_portal(request, payload: dict) -> BitrixPortal:
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
