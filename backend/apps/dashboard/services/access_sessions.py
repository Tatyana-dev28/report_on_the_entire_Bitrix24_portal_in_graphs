from __future__ import annotations

import secrets

from django.utils import timezone

from apps.bitrix.models import BitrixPortal, PortalUser
from apps.common.services.crypto import hash_value, make_fingerprint
from apps.dashboard.models import DashboardAccessSession


def create_dashboard_access_session(
    *,
    portal: BitrixPortal,
    user: PortalUser | None,
    bitrix_user_id: str,
    user_name: str,
    is_trusted_device: bool,
    user_agent: str = "",
    ip_address: str | None = None,
) -> tuple[DashboardAccessSession, str]:
    raw_token = secrets.token_urlsafe(48)

    session = DashboardAccessSession.objects.create(
        portal=portal,
        user=user,
        bitrix_user_id=str(bitrix_user_id),
        user_name=user_name,
        session_key_hash=hash_value(raw_token),
        session_key_fingerprint=make_fingerprint(raw_token, length=12),
        is_trusted_device=is_trusted_device,
        user_agent=user_agent,
        ip_address=ip_address,
    )

    return session, raw_token


def end_dashboard_access_session(raw_token: str) -> DashboardAccessSession | None:
    if not raw_token:
        return None

    session = DashboardAccessSession.objects.filter(
        session_key_hash=hash_value(raw_token),
        ended_at__isnull=True,
        revoked_at__isnull=True,
    ).first()

    if not session:
        return None

    session.ended_at = timezone.now()
    session.save(update_fields=["ended_at", "updated_at"])

    return session


def get_dashboard_access_session(raw_token: str) -> DashboardAccessSession | None:
    if not raw_token:
        return None

    session = DashboardAccessSession.objects.select_related("portal", "user").filter(
        session_key_hash=hash_value(raw_token),
        ended_at__isnull=True,
        revoked_at__isnull=True,
        is_active=True,
    ).first()

    if not session:
        return None

    session.last_seen_at = timezone.now()
    session.save(update_fields=["last_seen_at", "updated_at"])

    return session


def revoke_portal_dashboard_access_sessions(
    *,
    portal: BitrixPortal,
    bitrix_user_id: str = "",
) -> int:
    queryset = DashboardAccessSession.objects.filter(
        portal=portal,
        revoked_at__isnull=True,
    )

    if bitrix_user_id:
        queryset = queryset.filter(bitrix_user_id=str(bitrix_user_id))

    return queryset.update(revoked_at=timezone.now(), updated_at=timezone.now())
