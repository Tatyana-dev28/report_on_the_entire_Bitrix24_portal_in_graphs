from __future__ import annotations

from django.conf import settings
from django.core import signing

from apps.bitrix.models import BitrixPortal


PORTAL_TOKEN_SALT = "bitrix.portal-api-token.v1"
DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 12


def make_portal_api_token(*, portal: BitrixPortal, bitrix_user_id: str = "") -> str:
    return signing.dumps(
        {
            "member_id": portal.member_id,
            "domain": portal.domain,
            "bitrix_user_id": str(bitrix_user_id or ""),
        },
        salt=PORTAL_TOKEN_SALT,
    )


def load_portal_api_token(token: str) -> dict:
    max_age = int(
        getattr(
            settings,
            "BITRIX_PORTAL_TOKEN_MAX_AGE_SECONDS",
            DEFAULT_MAX_AGE_SECONDS,
        )
    )
    payload = signing.loads(
        token,
        salt=PORTAL_TOKEN_SALT,
        max_age=max_age,
    )

    if not isinstance(payload, dict):
        raise signing.BadSignature("Portal token payload must be an object.")

    return payload


def get_portal_token_from_request(request, payload: dict | None = None) -> str:
    payload = payload or {}

    return str(
        payload.get("portalToken")
        or payload.get("portal_token")
        or request.GET.get("portalToken")
        or request.GET.get("portal_token")
        or request.headers.get("X-Bitrix-Portal-Token")
        or ""
    ).strip()
