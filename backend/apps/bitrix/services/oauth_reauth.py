from __future__ import annotations

from django.utils import timezone

from apps.bitrix.models import BitrixPortal


PERMANENT_REFRESH_ERROR_CODES = {
    "invalid_grant",
    "invalid_token",
    "expired_token",
    "unauthorized_client",
    "invalid_client",
}


def serialize_oauth_reauth(portal) -> dict:
    return {"oauthReauthRequired": bool(portal and getattr(portal, "oauth_reauth_required", False))}


def is_permanent_refresh_failure(*, status_code: int | None, error_code: str = "") -> bool:
    code = str(error_code or "").strip().lower()
    if code in PERMANENT_REFRESH_ERROR_CODES:
        return True
    return int(status_code or 0) == 400


def mark_oauth_reauth_required(portal: BitrixPortal, reason: str = "") -> None:
    now = timezone.now()
    portal.oauth_reauth_required = True
    portal.oauth_reauth_required_at = now
    portal.oauth_reauth_error = str(reason or "")[:255]
    portal.save(
        update_fields=[
            "oauth_reauth_required",
            "oauth_reauth_required_at",
            "oauth_reauth_error",
            "updated_at",
        ]
    )


def clear_oauth_reauth_required(portal: BitrixPortal) -> None:
    if not portal.oauth_reauth_required and not portal.oauth_reauth_error and portal.oauth_reauth_required_at is None:
        return

    portal.oauth_reauth_required = False
    portal.oauth_reauth_required_at = None
    portal.oauth_reauth_error = ""
    portal.save(
        update_fields=[
            "oauth_reauth_required",
            "oauth_reauth_required_at",
            "oauth_reauth_error",
            "updated_at",
        ]
    )
