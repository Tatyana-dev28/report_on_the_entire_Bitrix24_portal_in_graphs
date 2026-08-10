from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from django.utils import timezone

from apps.bitrix.models import BitrixPortal
from apps.bitrix.services.rest_client import BitrixRestClient


logger = logging.getLogger(__name__)

UNKNOWN_LICENSE_MESSAGE = (
    "Произошла ошибка, обратитесь в поддержку."
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
    "ent500": ("cloud_enterprise_500",),
    "cloudenterprise500": ("cloud_enterprise_500",),
    "deent500": ("cloud_enterprise_500",),
    "ent1000": ("cloud_enterprise_1000",),
    "cloudenterprise1000": ("cloud_enterprise_1000",),
    "deent1000": ("cloud_enterprise_1000",),
    "ent2000": ("cloud_enterprise_2000",),
    "cloudenterprise2000": ("cloud_enterprise_2000",),
    "deent2000": ("cloud_enterprise_2000",),
    "ent3000": ("cloud_enterprise_3000",),
    "cloudenterprise3000": ("cloud_enterprise_3000",),
    "deent3000": ("cloud_enterprise_3000",),
    "ent4000": ("cloud_enterprise_4000",),
    "cloudenterprise4000": ("cloud_enterprise_4000",),
    "deent4000": ("cloud_enterprise_4000",),
    "ent5000": ("cloud_enterprise_5000",),
    "cloudenterprise5000": ("cloud_enterprise_5000",),
    "deent5000": ("cloud_enterprise_5000",),
    "ent6000": ("cloud_enterprise_6000",),
    "cloudenterprise6000": ("cloud_enterprise_6000",),
    "deent6000": ("cloud_enterprise_6000",),
    "ent7000": ("cloud_enterprise_7000",),
    "cloudenterprise7000": ("cloud_enterprise_7000",),
    "deent7000": ("cloud_enterprise_7000",),
    "ent8000": ("cloud_enterprise_8000",),
    "cloudenterprise8000": ("cloud_enterprise_8000",),
    "deent8000": ("cloud_enterprise_8000",),
    "ent9000": ("cloud_enterprise_9000",),
    "cloudenterprise9000": ("cloud_enterprise_9000",),
    "deent9000": ("cloud_enterprise_9000",),
    "ent10000": ("cloud_enterprise_10000",),
    "cloudenterprise10000": ("cloud_enterprise_10000",),
    "deent10000": ("cloud_enterprise_10000",),
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
    "enterprise": ("box_enterprise_1000",),
    "boxenterprise": ("box_enterprise_1000",),
    "enterpriseextension1000": ("box_enterprise_extension_1000",),
    "boxenterpriseextension1000": ("box_enterprise_extension_1000",),
    "extensionenterprise1000": ("box_enterprise_extension_1000",),
    "enterpriseholding": ("box_enterprise_holding",),
    "boxenterpriseholding": ("box_enterprise_holding",),
    "holdingenterprise": ("box_enterprise_holding",),
    "enterpriseholdingextension1000": ("box_enterprise_holding_extension_1000",),
    "boxenterpriseholdingextension1000": ("box_enterprise_holding_extension_1000",),
    "holdingenterpriseextension1000": ("box_enterprise_holding_extension_1000",),
    "enterprise1000": ("box_enterprise_1000",),
    "enterprise2000": ("box_enterprise_2000",),
    "enterprise3000": ("box_enterprise_3000",),
    "enterprise4000": ("box_enterprise_4000",),
    "enterprise5000": ("box_enterprise_5000",),
    "enterprise6000": ("box_enterprise_6000",),
    "enterprise7000": ("box_enterprise_7000",),
    "enterprise8000": ("box_enterprise_8000",),
    "enterprise9000": ("box_enterprise_9000",),
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
    bitrix_license_edition: str
    bitrix_license_kind: str
    bitrix_license_max_users: int | None
    bitrix_license_expire_date: str
    bitrix_license_is_demo: bool | None


def refresh_portal_bitrix_license(portal: BitrixPortal) -> bool:
    client = BitrixRestClient(portal)

    try:
        response = client.call_method("app.info")
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
        portal.bitrix_license_edition = ""
        portal.bitrix_license_kind = ""
        portal.bitrix_license_max_users = None
        portal.bitrix_license_expire_date = ""
        portal.bitrix_license_is_demo = None
        portal.bitrix_license_checked_at = timezone.now()
        portal.save(
            update_fields=[
                "bitrix_license",
                "bitrix_license_type",
                "bitrix_license_family",
                "bitrix_license_edition",
                "bitrix_license_kind",
                "bitrix_license_max_users",
                "bitrix_license_expire_date",
                "bitrix_license_is_demo",
                "bitrix_license_checked_at",
                "updated_at",
            ]
        )
        return False

    result = response.result if isinstance(response.result, dict) else {}
    license_result = _load_portal_license_get_result(client, portal)
    update_portal_bitrix_license_from_app_info(portal, result, license_result)
    return True


def _load_portal_license_get_result(
    client: BitrixRestClient,
    portal: BitrixPortal,
) -> dict[str, Any]:
    try:
        response = client.call_method("license.get")
    except Exception as error:
        logger.warning(
            "Could not load Bitrix license.get for portal %s: %s",
            portal.domain,
            error,
            exc_info=True,
        )
        return {}

    return response.result if isinstance(response.result, dict) else {}


def update_portal_bitrix_license_from_app_info(
    portal: BitrixPortal,
    app_info: dict[str, Any],
    license_info: dict[str, Any] | None = None,
) -> None:
    license_info = license_info or {}
    portal.bitrix_license = _string_value(app_info.get("LICENSE"))
    portal.bitrix_license_type = _string_value(app_info.get("LICENSE_TYPE"))
    portal.bitrix_license_family = _string_value(app_info.get("LICENSE_FAMILY"))
    portal.bitrix_license_edition = _string_value(license_info.get("EDITION"))
    portal.bitrix_license_kind = _string_value(license_info.get("TYPE"))
    portal.bitrix_license_max_users = _positive_int_or_none(license_info.get("MAX_USERS"))
    portal.bitrix_license_expire_date = _string_value(license_info.get("EXPIRE_DATE"))
    portal.bitrix_license_is_demo = _bool_or_none(license_info.get("IS_DEMO"))
    portal.bitrix_license_checked_at = timezone.now()
    portal.save(
        update_fields=[
            "bitrix_license",
            "bitrix_license_type",
            "bitrix_license_family",
            "bitrix_license_edition",
            "bitrix_license_kind",
            "bitrix_license_max_users",
            "bitrix_license_expire_date",
            "bitrix_license_is_demo",
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
        bitrix_license_edition=portal.bitrix_license_edition or "",
        bitrix_license_kind=portal.bitrix_license_kind or "",
        bitrix_license_max_users=portal.bitrix_license_max_users,
        bitrix_license_expire_date=portal.bitrix_license_expire_date or "",
        bitrix_license_is_demo=portal.bitrix_license_is_demo,
    )


def is_paid_plan_allowed_for_portal(portal: BitrixPortal, plan_code: str) -> bool:
    policy = get_allowed_plans_policy(portal)
    return str(plan_code or "").strip() in policy.paid_plan_codes


def _resolve_paid_plan_codes(portal: BitrixPortal) -> tuple[str, ...]:
    license_get_plan_codes = _resolve_license_get_plan_codes(portal)

    if license_get_plan_codes:
        return license_get_plan_codes

    candidates = (
        portal.bitrix_license_type,
        portal.bitrix_license,
        portal.bitrix_license_family,
    )

    for value in candidates:
        for key in _license_lookup_keys(value):
            if key in BITRIX_LICENSE_ALLOWED_PLAN_CODES:
                return BITRIX_LICENSE_ALLOWED_PLAN_CODES[key]

    return ()


def _resolve_license_get_plan_codes(portal: BitrixPortal) -> tuple[str, ...]:
    edition = _normalize_license_value(getattr(portal, "bitrix_license_edition", ""))
    family = _normalize_license_value(getattr(portal, "bitrix_license_family", ""))

    # license.get EDITION=enterprise is for box; cloud enterprise uses LICENSE_TYPE=entN.
    if family == "ent":
        return ()

    if edition not in ("enterprise", "boxenterprise"):
        return ()

    users = getattr(portal, "bitrix_license_max_users", None)

    if not users:
        return ("box_enterprise_1000",)

    normalized_users = min(max(((int(users) + 999) // 1000) * 1000, 1000), 10000)
    return (f"box_enterprise_{normalized_users}",)


_REGION_LICENSE_PREFIXES = (
    "ru",
    "en",
    "de",
    "ua",
    "by",
    "kz",
    "uz",
    "pl",
    "br",
    "tr",
    "fr",
    "it",
    "eu",
    "uk",
    "la",
    "cn",
    "in",
    "jp",
    "mx",
    "co",
    "ar",
)


def _license_lookup_keys(value: Any) -> tuple[str, ...]:
    """Build lookup keys for Bitrix LICENSE values like ru_pro100 / de_std."""
    normalized = _normalize_license_value(value)
    if not normalized:
        return ()

    keys = [normalized]
    for prefix in _REGION_LICENSE_PREFIXES:
        if not normalized.startswith(prefix):
            continue
        remainder = normalized[len(prefix):]
        if remainder and remainder not in keys:
            keys.append(remainder)
    return tuple(keys)


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


def _positive_int_or_none(value: Any) -> int | None:
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None

    return result if result > 0 else None


def _bool_or_none(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value

    if value is None or value == "":
        return None

    normalized = str(value).strip().lower()

    if normalized in ("1", "true", "yes", "y"):
        return True

    if normalized in ("0", "false", "no", "n"):
        return False

    return None
