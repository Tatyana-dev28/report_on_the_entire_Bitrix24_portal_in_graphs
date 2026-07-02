from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from django.utils import timezone

from apps.bitrix.models import BitrixPortal
from apps.bitrix.services.rest_client import BitrixRestClient


logger = logging.getLogger(__name__)

UNKNOWN_LICENSE_MESSAGE = (
    "Не удалось автоматически определить тариф Битрикс24. "
    "Напишите нам, чтобы мы подобрали подходящий платный тариф."
)

FREE_PLAN_CODE = "free"

BITRIX_LICENSE_ALLOWED_PLAN_CODES = {
    "basic": ("cloud_basic_5",),
    "cloudbasic": ("cloud_basic_5",),
    "debasic": ("cloud_basic_5",),
    "std": ("cloud_standard_50",),
    "standard": ("cloud_standard_50",),
    "cloudstandard": ("cloud_standard_50",),
    "destd": ("cloud_standard_50",),
    "pro": ("cloud_professional_100",),
    "pro100": ("cloud_professional_100",),
    "professional": ("cloud_professional_100",),
    "cloudprofessional": ("cloud_professional_100",),
    "depro100": ("cloud_professional_100",),
    "ent250": ("cloud_enterprise_250",),
    "cloudenterprise250": ("cloud_enterprise_250",),
    "deent250": ("cloud_enterprise_250",),
    "ent1000": ("cloud_enterprise_1000",),
    "cloudenterprise1000": ("cloud_enterprise_1000",),
    "deent1000": ("cloud_enterprise_1000",),
    "ent2000": ("cloud_enterprise_2000",),
    "cloudenterprise2000": ("cloud_enterprise_2000",),
    "deent2000": ("cloud_enterprise_2000",),
    "shopcrm12": ("box_shop_crm_12",),
    "shopcrm": ("box_shop_crm_12",),
    "corporateportal50": ("box_corporate_50",),
    "corporate50": ("box_corporate_50",),
    "corporateportal100": ("box_corporate_100",),
    "corporate100": ("box_corporate_100",),
    "corporateportal250": ("box_corporate_250",),
    "corporate250": ("box_corporate_250",),
    "corporateportal500": ("box_corporate_500",),
    "corporate500": ("box_corporate_500",),
    "enterprise1000": ("box_enterprise_1000",),
    "enterprise2000": ("box_enterprise_2000",),
    "enterprise3000": ("box_enterprise_3000",),
    "enterprise4000": ("box_enterprise_4000",),
    "enterprise5000": ("box_enterprise_5000",),
    "enterprise6000": ("box_enterprise_6000",),
    "enterprise7000": ("box_enterprise_7000",),
    "enterprise8000": ("box_enterprise_8000",),
    "enterprise9000": ("box_enterprise_9000",),
    "ent10000": ("box_enterprise_10000",),
    "enterprise10000": ("box_enterprise_10000",),
    # NFR (Not For Resale) licenses
    "nfr": ("nfr",),
    "runfr": ("nfr",),
}


@dataclass(frozen=True)
class AllowedPlansPolicy:
    free_plan_code: str
    paid_plan_codes: tuple[str, ...]
    is_known: bool
    message: str
    bitrix_license: str
    bitrix_license_type: str
    bitrix_license_family: str


def refresh_portal_bitrix_license(portal: BitrixPortal) -> bool:
    try:
        response = BitrixRestClient(portal).call_method("app.info")
    except Exception as error:
        logger.warning(
            "Could not load Bitrix app.info for portal %s: %s",
            portal.domain,
            error,
            exc_info=True,
        )
        portal.bitrix_license = ""
        portal.bitrix_license_type = ""
        portal.bitrix_license_family = ""
        portal.bitrix_license_checked_at = timezone.now()
        portal.save(
            update_fields=[
                "bitrix_license",
                "bitrix_license_type",
                "bitrix_license_family",
                "bitrix_license_checked_at",
                "updated_at",
            ]
        )
        return False

    result = response.result if isinstance(response.result, dict) else {}
    update_portal_bitrix_license_from_app_info(portal, result)
    return True


def update_portal_bitrix_license_from_app_info(
    portal: BitrixPortal,
    app_info: dict[str, Any],
) -> None:
    portal.bitrix_license = _string_value(app_info.get("LICENSE"))
    portal.bitrix_license_type = _string_value(app_info.get("LICENSE_TYPE"))
    portal.bitrix_license_family = _string_value(app_info.get("LICENSE_FAMILY"))
    portal.bitrix_license_checked_at = timezone.now()
    portal.save(
        update_fields=[
            "bitrix_license",
            "bitrix_license_type",
            "bitrix_license_family",
            "bitrix_license_checked_at",
            "updated_at",
        ]
    )


def get_allowed_plans_policy(portal: BitrixPortal) -> AllowedPlansPolicy:
    paid_plan_codes = _resolve_paid_plan_codes(portal)
    is_known = bool(paid_plan_codes)

    return AllowedPlansPolicy(
        free_plan_code=FREE_PLAN_CODE,
        paid_plan_codes=paid_plan_codes,
        is_known=is_known,
        message="" if is_known else UNKNOWN_LICENSE_MESSAGE,
        bitrix_license=portal.bitrix_license or "",
        bitrix_license_type=portal.bitrix_license_type or "",
        bitrix_license_family=portal.bitrix_license_family or "",
    )


def is_paid_plan_allowed_for_portal(portal: BitrixPortal, plan_code: str) -> bool:
    policy = get_allowed_plans_policy(portal)
    return str(plan_code or "").strip() in policy.paid_plan_codes


def _resolve_paid_plan_codes(portal: BitrixPortal) -> tuple[str, ...]:
    candidates = (
        portal.bitrix_license_type,
        portal.bitrix_license,
        portal.bitrix_license_family,
    )

    for value in candidates:
        normalized = _normalize_license_value(value)

        if normalized in BITRIX_LICENSE_ALLOWED_PLAN_CODES:
            return BITRIX_LICENSE_ALLOWED_PLAN_CODES[normalized]

    return ()


def _normalize_license_value(value: Any) -> str:
    return (
        str(value or "")
        .strip()
        .lower()
        .replace("-", "")
        .replace("_", "")
        .replace(" ", "")
        .replace("/", "")
    )


def _string_value(value: Any) -> str:
    return str(value or "").strip()
