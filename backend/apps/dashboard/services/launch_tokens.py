from __future__ import annotations

import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.bitrix.models import BitrixPortal, PortalUser
from apps.common.services.crypto import hash_value, make_fingerprint
from apps.dashboard.constants import DASHBOARD_LAUNCH_TOKEN_MAX_AGE_SECONDS
from apps.dashboard.models import DashboardOwnerLaunchToken
from apps.reports.services.exceptions import ReportPreviewSessionError


def create_dashboard_launch_token(
    *,
    portal: BitrixPortal,
    user: PortalUser | None,
    bitrix_user_id: str,
    user_name: str,
) -> tuple[DashboardOwnerLaunchToken, str]:
    raw_token = secrets.token_urlsafe(32)

    token = DashboardOwnerLaunchToken.objects.create(
        portal=portal,
        user=user,
        bitrix_user_id=str(bitrix_user_id),
        user_name=user_name,
        token_hash=hash_value(raw_token),
        token_fingerprint=make_fingerprint(raw_token, length=12),
        expires_at=timezone.now() + timedelta(seconds=DASHBOARD_LAUNCH_TOKEN_MAX_AGE_SECONDS),
    )

    return token, raw_token


def consume_dashboard_launch_token(raw_token: str) -> DashboardOwnerLaunchToken:
    if not raw_token:
        raise ReportPreviewSessionError(
            "Нет токена запуска WEB-дашборда. Откройте дашборд из приложения Битрикс24.",
            status=403,
        )

    with transaction.atomic():
        token = (
            DashboardOwnerLaunchToken.objects.select_for_update()
            .select_related("portal", "user")
            .filter(
                token_hash=hash_value(raw_token),
                used_at__isnull=True,
                is_active=True,
            )
            .first()
        )

        if not token or token.expires_at <= timezone.now():
            raise ReportPreviewSessionError(
                "Ссылка запуска WEB-дашборда недействительна или уже использована. Откройте дашборд заново из приложения Битрикс24.",
                status=403,
            )

        token.used_at = timezone.now()
        token.save(update_fields=["used_at", "updated_at"])

    return token
