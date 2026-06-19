import json

from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from apps.billing.models import PortalAccess
from apps.bitrix.services.install import (
    BitrixInstallError,
    create_or_update_portal_from_bitrix_payload,
)


def parse_bitrix_request_payload(request: HttpRequest) -> dict:
    """
    Достает payload из POST/GET/JSON.

    Сейчас возвращаем JSON для проверки backend-логики.
    React-интерфейс подключим следующим шагом.
    """

    payload = {}

    if request.method == "POST":
        payload.update(request.POST.dict())

        if not payload and request.body:
            try:
                payload.update(json.loads(request.body.decode("utf-8")))
            except json.JSONDecodeError:
                pass

    if request.method == "GET":
        payload.update(request.GET.dict())

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


@csrf_exempt
@require_http_methods(["GET", "POST"])
def bitrix_install_view(request: HttpRequest):
    """
    Endpoint установки приложения Bitrix24.

    Сейчас:
    - принимает данные Bitrix24;
    - создает/обновляет портал;
    - сохраняет токены;
    - создает Free-подписку и PortalAccess;
    - возвращает безопасный JSON.

    Позже этот endpoint будет отдавать React install route.
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

    return JsonResponse(
        {
            "ok": True,
            "mode": "install",
            "bootstrap": build_safe_bootstrap(portal),
        }
    )


@csrf_exempt
@require_http_methods(["GET", "POST"])
def bitrix_app_view(request: HttpRequest):
    """
    Endpoint открытия приложения из левого меню Bitrix24.

    Сейчас:
    - принимает данные Bitrix24;
    - обновляет портал/токены/last_opened_at;
    - возвращает безопасный JSON.

    Позже этот endpoint будет отдавать React app route.
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

    return JsonResponse(
        {
            "ok": True,
            "mode": "app",
            "bootstrap": build_safe_bootstrap(portal),
        }
    )