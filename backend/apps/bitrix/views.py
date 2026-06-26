import json
import os
from urllib.parse import urlencode

from django.conf import settings
from django.http import HttpRequest, JsonResponse
from django.shortcuts import redirect
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from apps.billing.models import PortalAccess
from apps.bitrix.services.install import (
    BitrixInstallError,
    create_or_update_portal_from_bitrix_payload,
)
from apps.bitrix.services.portal_tokens import make_portal_api_token


def parse_bitrix_request_payload(request: HttpRequest) -> dict:
    """
    Достает payload из query params, POST form-data и JSON body.

    Bitrix24 при установке может отправить POST на URL вида:
    /bitrix/install/?DOMAIN=...&PROTOCOL=...&LANG=...&APP_SID=...

    Поэтому query params нужно читать всегда, не только для GET.
    """

    payload = {}

    # Query params нужны и для GET, и для POST.
    payload.update(request.GET.dict())

    if request.method == "POST":
        payload.update(request.POST.dict())

        content_type = str(request.headers.get("Content-Type", "")).lower()

        if "application/json" in content_type and request.body:
            try:
                body_payload = json.loads(request.body.decode("utf-8"))
            except json.JSONDecodeError:
                body_payload = {}

            if isinstance(body_payload, dict):
                payload.update(body_payload)

    return payload


def build_safe_bootstrap(portal) -> dict:
    """
    Безопасные данные для frontend.

    OAuth-токены, refresh token, application_token и другие секреты сюда не попадают.
    """

    access = PortalAccess.objects.filter(portal=portal).first()

    return {
        "portal": {
            "public_id": str(getattr(portal, "public_id", "")),
            "domain": portal.domain,
            "member_id": portal.member_id,
            "status": portal.status,
            "language": portal.language,
            "last_opened_at": portal.last_opened_at.isoformat()
            if portal.last_opened_at
            else None,
            "has_application_token": portal.has_application_token,
        },
        "access": {
            "access_level": access.access_level if access else "free",
            "has_pro": access.has_pro if access else False,
            "is_lifetime": access.is_lifetime if access else False,
            "valid_until": access.valid_until.isoformat()
            if access and access.valid_until
            else None,
            "features": access.features if access else {},
            "limits": access.limits if access else {},
        },
    }


def should_return_json(request: HttpRequest) -> bool:
    """
    Для локальных smoke-тестов и backend-тестов оставляем JSON-режим.

    В Bitrix24 iframe обычный сценарий — redirect на frontend.
    """

    requested_format = str(request.GET.get("format", "")).lower()
    accept_header = str(request.headers.get("Accept", "")).lower()

    return (
        requested_format == "json"
        or "application/json" in accept_header
        or request.GET.get("debug") == "1"
    )


def build_frontend_redirect_url(*, portal, mode: str) -> str:
    """
    Собирает URL frontend-приложения после установки/открытия из Bitrix24.

    Frontend забирает memberId/domain/bitrixUserId из URL и дальше ходит в backend API.
    """

    frontend_url = (
        getattr(settings, "FRONTEND_URL", "")
        or getattr(settings, "BITRIX_FRONTEND_URL", "")
        or os.environ.get("FRONTEND_URL", "")
        or os.environ.get("BITRIX_FRONTEND_URL", "")
        or "https://portal-analytics.sappapp1b24.ru"
    ).rstrip("/")

    query = {
        "mode": mode,
        "memberId": portal.member_id,
        "domain": portal.domain,
        "bitrixUserId": portal.installed_by_user_id or "",
        "portalToken": make_portal_api_token(
            portal=portal,
            bitrix_user_id=portal.installed_by_user_id or "",
        ),
    }

    return f"{frontend_url}/?{urlencode(query)}"


@csrf_exempt
@require_http_methods(["GET", "POST"])
def bitrix_install_view(request: HttpRequest):
    """
    Endpoint установки приложения Bitrix24.

    Делает backend-часть:
    - принимает данные Bitrix24;
    - создает/обновляет портал;
    - сохраняет токены;
    - создает Free-подписку и PortalAccess.

    После этого:
    - для обычного Bitrix24 iframe редиректит на frontend;
    - для тестов/debug может вернуть безопасный JSON.
    """

    payload = parse_bitrix_request_payload(request)

    try:
        portal = create_or_update_portal_from_bitrix_payload(
            payload=payload,
            mark_installed=True,
        )
    except BitrixInstallError as error:
        return JsonResponse(
            {
                "ok": False,
                "error": str(error),
            },
            status=400,
        )

    if should_return_json(request):
        return JsonResponse(
            {
                "ok": True,
                "mode": "install",
                "redirectUrl": build_frontend_redirect_url(
                    portal=portal,
                    mode="install",
                ),
                "bootstrap": build_safe_bootstrap(portal),
            }
        )

    return redirect(
        build_frontend_redirect_url(
            portal=portal,
            mode="install",
        )
    )


@csrf_exempt
@require_http_methods(["GET", "POST"])
def bitrix_app_view(request: HttpRequest):
    """
    Endpoint открытия приложения из Bitrix24.

    Делает backend-часть:
    - принимает данные Bitrix24;
    - обновляет портал/токены/last_opened_at;
    - не отдает токены наружу.

    После этого:
    - для обычного Bitrix24 iframe редиректит на frontend;
    - для тестов/debug может вернуть безопасный JSON.
    """

    payload = parse_bitrix_request_payload(request)

    try:
        portal = create_or_update_portal_from_bitrix_payload(
            payload=payload,
            mark_installed=False,
        )
    except BitrixInstallError as error:
        return JsonResponse(
            {
                "ok": False,
                "error": str(error),
            },
            status=400,
        )

    if should_return_json(request):
        return JsonResponse(
            {
                "ok": True,
                "mode": "app",
                "redirectUrl": build_frontend_redirect_url(
                    portal=portal,
                    mode="app",
                ),
                "bootstrap": build_safe_bootstrap(portal),
            }
        )

    return redirect(
        build_frontend_redirect_url(
            portal=portal,
            mode="app",
        )
    )
