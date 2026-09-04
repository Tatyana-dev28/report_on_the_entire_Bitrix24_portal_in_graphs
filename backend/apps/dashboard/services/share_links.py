from __future__ import annotations

import secrets
from datetime import timedelta

from django.utils import timezone

from apps.bitrix.models import BitrixPortal
from apps.common.services.crypto import hash_value, make_fingerprint
from apps.dashboard.constants import ALLOWED_SHARE_TTL_DAYS
from apps.dashboard.models import DashboardShareLink


class DashboardShareError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _parse_ttl_days(value) -> int | None:
    if value in (None, "", 0, "0"):
        return None

    try:
        days = int(value)
    except (TypeError, ValueError) as error:
        raise DashboardShareError("Срок жизни ссылки должен быть числом дней.") from error

    if days not in ALLOWED_SHARE_TTL_DAYS:
        raise DashboardShareError(
            "Срок жизни ссылки может быть 1, 7, 30 дней или без ограничения.",
        )

    return days


def create_dashboard_share_link(
    *,
    portal: BitrixPortal,
    report_id: str,
    report_name: str,
    expires_in_days=None,
    created_by_bitrix_user_id: str = "",
) -> tuple[DashboardShareLink, str]:
    report_id = str(report_id or "").strip()
    report_name = str(report_name or "").strip()

    if not report_id or not report_name:
        raise DashboardShareError("Выберите сохранённый отчёт для ссылки «Поделиться».")

    ttl_days = _parse_ttl_days(expires_in_days)
    raw_token = secrets.token_urlsafe(32)
    expires_at = timezone.now() + timedelta(days=ttl_days) if ttl_days else None

    link = DashboardShareLink.objects.create(
        portal=portal,
        report_id=report_id,
        report_name=report_name,
        token_hash=hash_value(raw_token),
        token_fingerprint=make_fingerprint(raw_token, length=12),
        expires_at=expires_at,
        created_by_bitrix_user_id=str(created_by_bitrix_user_id or ""),
    )

    return link, raw_token


def get_dashboard_share_link(raw_token: str) -> DashboardShareLink:
    if not str(raw_token or "").strip():
        raise DashboardShareError("Нет токена ссылки на отчёт.", status=403)

    link = (
        DashboardShareLink.objects.select_related("portal")
        .filter(token_hash=hash_value(raw_token.strip()))
        .first()
    )

    if not link or not link.is_available:
        raise DashboardShareError(
            "Ссылка на отчёт недействительна, истекла или отключена.",
            status=403,
        )

    return link


def disable_dashboard_share_link(*, portal: BitrixPortal, public_id: str) -> DashboardShareLink:
    public_id = str(public_id or "").strip()

    if not public_id:
        raise DashboardShareError("Не указана ссылка для отключения.", status=400)

    link = DashboardShareLink.objects.filter(portal=portal, public_id=public_id).first()

    if not link:
        raise DashboardShareError("Ссылка не найдена.", status=404)

    if not link.disabled_at:
        link.disabled_at = timezone.now()
        link.is_active = False
        link.save(update_fields=["disabled_at", "is_active", "updated_at"])

    return link


def serialize_share_link(link: DashboardShareLink, *, raw_token: str | None = None) -> dict:
    payload = {
        "id": str(link.public_id),
        "reportId": link.report_id,
        "reportName": link.report_name,
        "expiresAt": link.expires_at.isoformat() if link.expires_at else None,
        "disabledAt": link.disabled_at.isoformat() if link.disabled_at else None,
        "isAvailable": link.is_available,
        "fingerprint": link.token_fingerprint,
    }

    if raw_token:
        payload["token"] = raw_token

    return payload
