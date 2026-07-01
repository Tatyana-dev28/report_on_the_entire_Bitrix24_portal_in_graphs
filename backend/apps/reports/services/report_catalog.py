from __future__ import annotations

import logging
from typing import Any

from django.db import transaction

from apps.bitrix.models import BitrixPortal
from apps.bitrix.services.rest_client import BitrixRestClient, BitrixRestError
from apps.reports.catalog import METRIC_SECTIONS, METRICS, PERIOD_OPTIONS, REPORT_SOURCES
from apps.reports.models import CrmSource


SOURCE_TYPE_TO_MODEL = {
    "lead": CrmSource.SourceType.LEAD,
    "deal": CrmSource.SourceType.DEAL,
    "smartProcess": CrmSource.SourceType.SMART_PROCESS,
    "invoice": CrmSource.SourceType.INVOICE,
    "telephony": CrmSource.SourceType.CALL,
    "activity": CrmSource.SourceType.ACTIVITY,
    "company": CrmSource.SourceType.COMPANY,
    "contact": CrmSource.SourceType.CONTACT,
    "task": CrmSource.SourceType.TASK,
    "quote": CrmSource.SourceType.OTHER,
    "crm_form": CrmSource.SourceType.OTHER,
}

SOURCE_TYPE_TO_API = {
    CrmSource.SourceType.LEAD: "lead",
    CrmSource.SourceType.DEAL: "deal",
    CrmSource.SourceType.SMART_PROCESS: "smartProcess",
    CrmSource.SourceType.INVOICE: "invoice",
    CrmSource.SourceType.CALL: "telephony",
    CrmSource.SourceType.ACTIVITY: "activity",
    CrmSource.SourceType.COMPANY: "company",
    CrmSource.SourceType.CONTACT: "contact",
    CrmSource.SourceType.TASK: "task",
}

VIRTUAL_REPORT_SOURCE_IDS = {
    "telephony-default",
    "activity-default",
    "quote-default",
    "company-default",
    "contact-default",
    "task-default",
    "crm-form-default",
}
SOURCE_TYPE_ORDER = {
    "lead": 10,
    "deal": 20,
    "smartProcess": 30,
    "invoice": 40,
    "telephony": 50,
    "activity": 60,
    "quote": 70,
    "company": 80,
    "contact": 90,
    "task": 100,
    "crm_form": 110,
}
logger = logging.getLogger(__name__)


class ReportCatalogError(Exception):
    pass


def build_report_catalog(portal: BitrixPortal | None = None) -> dict:
    return {
        "periods": PERIOD_OPTIONS,
        "sources": get_report_sources(portal),
        "metricSections": METRIC_SECTIONS,
        "metrics": METRICS,
    }


def get_report_sources(portal: BitrixPortal | None = None) -> list[dict]:
    if not portal:
        return [dict(source) for source in REPORT_SOURCES]

    if _portal_has_access_token(portal):
        try:
            sources = load_sources_from_bitrix(portal)
            sync_crm_sources(portal=portal, sources=sources)
            return sources
        except BitrixRestError:
            logger.warning("Bitrix report catalog loading failed; using cached or static sources.", exc_info=True)

    cached_sources = get_cached_report_sources(portal)

    if cached_sources:
        return _sort_sources(_deduplicate_sources([*cached_sources, *_virtual_report_sources()]))

    return [dict(source) for source in REPORT_SOURCES]


def get_cached_report_sources(portal: BitrixPortal) -> list[dict]:
    sources = CrmSource.objects.filter(
        portal=portal,
        is_active=True,
    )

    return _sort_sources(_deduplicate_sources([_model_to_api_source(source) for source in sources]))


def load_sources_from_bitrix(portal: BitrixPortal) -> list[dict]:
    client = BitrixRestClient(portal)
    sources = [
        _lead_source(),
        *_deal_sources(client),
        *_smart_process_sources(client),
        _invoice_source(),
        *_virtual_report_sources(),
    ]

    return _sort_sources(_deduplicate_sources(sources))


@transaction.atomic
def sync_crm_sources(*, portal: BitrixPortal, sources: list[dict]) -> None:
    seen_external_keys = set()

    for source in sources:
        external_key = str(source["id"])
        seen_external_keys.add(external_key)
        CrmSource.objects.update_or_create(
            portal=portal,
            external_key=external_key,
            defaults={
                "source_type": SOURCE_TYPE_TO_MODEL.get(
                    source["type"],
                    CrmSource.SourceType.OTHER,
                ),
                "entity_type_id": source.get("entityTypeId"),
                "category_id": source.get("categoryId"),
                "title": source["title"],
                "source_label": source["sourceLabel"],
                "is_available": bool(source.get("isAvailable", True)),
                "is_active": True,
                "raw_data": source.get("rawData") or {},
            },
        )

    CrmSource.objects.filter(
        portal=portal,
        is_active=True,
    ).exclude(external_key__in=seen_external_keys).update(is_available=False)


def _deal_sources(client: BitrixRestClient) -> list[dict]:
    categories = client.call_list("crm.dealcategory.list", {"order": {"SORT": "ASC"}})
    categories = _ensure_default_deal_category(categories)

    if not categories:
        categories = [{"ID": 0, "NAME": "Продажи"}]

    return [
        {
            "id": f"deal-{_safe_int(category.get('ID'), 0)}",
            "type": "deal",
            "entityTypeId": 2,
            "categoryId": _safe_int(category.get("ID"), 0),
            "title": _category_title(category, default="Продажи"),
            "sourceLabel": _category_title(category, default="Продажи"),
            "isAvailable": True,
            "rawData": category,
        }
        for category in _sort_categories(categories)
    ]


def _smart_process_sources(client: BitrixRestClient) -> list[dict]:
    try:
        response = client.call_method("crm.type.list", {})
    except BitrixRestError:
        logger.warning("Bitrix smart-process type catalog loading failed.", exc_info=True)
        return []

    types = _extract_items(response.result, keys=("types", "items"))
    sources = []

    for smart_type in types:
        entity_type_id = _safe_int(
            smart_type.get("entityTypeId") or smart_type.get("ENTITY_TYPE_ID"),
            0,
        )

        if entity_type_id <= 0:
            continue

        type_title = (
            smart_type.get("title")
            or smart_type.get("TITLE")
            or smart_type.get("name")
            or f"Смарт-процесс {entity_type_id}"
        )

        categories = _smart_process_categories(client, entity_type_id)

        if not categories:
            sources.append(
                {
                    "id": f"smart-{entity_type_id}-0",
                    "type": "smartProcess",
                    "entityTypeId": entity_type_id,
                    "categoryId": 0,
                    "title": str(type_title),
                    "sourceLabel": str(type_title),
                    "isAvailable": True,
                    "rawData": smart_type,
                }
            )
            continue

        for category in categories:
            category_id = _safe_int(category.get("id") or category.get("ID"), 0)
            category_title = _category_title(category, default=str(type_title))
            sources.append(
                {
                    "id": f"smart-{entity_type_id}-{category_id}",
                    "type": "smartProcess",
                    "entityTypeId": entity_type_id,
                    "categoryId": category_id,
                    "title": category_title,
                    "sourceLabel": category_title,
                    "isAvailable": True,
                    "rawData": {
                        "type": smart_type,
                        "category": category,
                    },
                }
            )

    return sources


def _smart_process_categories(client: BitrixRestClient, entity_type_id: int) -> list[dict]:
    try:
        response = client.call_method(
            "crm.category.list",
            {"entityTypeId": entity_type_id, "order": {"sort": "ASC"}},
        )
    except BitrixRestError:
        logger.warning(
            "Bitrix smart-process category catalog loading failed for entityTypeId=%s.",
            entity_type_id,
            exc_info=True,
        )
        return []

    return _sort_categories(_extract_items(response.result, keys=("categories", "items")))


def _lead_source() -> dict:
    return {
        "id": "lead-default",
        "type": "lead",
        "entityTypeId": 1,
        "categoryId": None,
        "title": "Лиды",
        "sourceLabel": "Лиды",
        "isAvailable": True,
    }


def _invoice_source() -> dict:
    return {
        "id": "invoice-default",
        "type": "invoice",
        "entityTypeId": 31,
        "categoryId": None,
        "title": "Счета",
        "sourceLabel": "Счета",
        "isAvailable": True,
    }


def _model_to_api_source(source: CrmSource) -> dict:
    return {
        "id": source.external_key,
        "type": _api_source_type_from_model(source),
        "entityTypeId": source.entity_type_id,
        "categoryId": source.category_id,
        "title": source.title,
        "sourceLabel": source.source_label or source.title,
        "isAvailable": source.is_available,
        "rawData": source.raw_data or {},
    }


def _api_source_type_from_model(source: CrmSource) -> str:
    if source.external_key.startswith("quote-"):
        return "quote"

    if source.external_key.startswith("telephony-"):
        return "telephony"

    if source.external_key.startswith("activity-"):
        return "activity"

    if source.external_key.startswith("crm-form-"):
        return "crm_form"

    return SOURCE_TYPE_TO_API.get(source.source_type, "other")


def _virtual_report_sources() -> list[dict]:
    return [
        dict(source)
        for source in REPORT_SOURCES
        if str(source.get("id")) in VIRTUAL_REPORT_SOURCE_IDS
    ]


def _portal_has_access_token(portal: BitrixPortal) -> bool:
    try:
        return portal.auth_token.has_access_token
    except Exception:
        return False


def _extract_items(value: Any, *, keys: tuple[str, ...]) -> list[dict]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]

    if isinstance(value, dict):
        for key in keys:
            nested = value.get(key)

            if isinstance(nested, list):
                return [item for item in nested if isinstance(item, dict)]

    return []


def _category_title(category: dict, *, default: str) -> str:
    return str(
        category.get("NAME")
        or category.get("name")
        or category.get("TITLE")
        or category.get("title")
        or default
    )


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _ensure_default_deal_category(categories: list[dict]) -> list[dict]:
    normalized_categories = [category for category in categories if isinstance(category, dict)]

    if any(_safe_int(category.get("ID"), -1) == 0 for category in normalized_categories):
        return normalized_categories

    return [{"ID": 0, "NAME": "Продажи", "SORT": 0}, *normalized_categories]


def _sort_categories(categories: list[dict]) -> list[dict]:
    return sorted(
        categories,
        key=lambda category: (
            _safe_int(_first_present(category, "SORT", "sort"), 500),
            _safe_int(_first_present(category, "ID", "id"), 0),
            _category_title(category, default="").casefold(),
        ),
    )


def _source_sort_value(source: dict) -> int:
    raw_data = source.get("rawData") or {}

    if isinstance(raw_data, dict):
        return _safe_int(_first_present(raw_data, "SORT", "sort"), 500)

    return 500


def _first_present(data: dict, *keys: str) -> Any:
    for key in keys:
        value = data.get(key)

        if value is not None and value != "":
            return value

    return None


def _sort_sources(sources: list[dict]) -> list[dict]:
    return sorted(
        sources,
        key=lambda source: (
            SOURCE_TYPE_ORDER.get(str(source.get("type") or ""), 999),
            _safe_int(source.get("entityTypeId"), 0),
            _source_sort_value(source),
            _safe_int(source.get("categoryId"), 0),
            str(source.get("sourceLabel") or source.get("title") or source.get("id") or "").casefold(),
        ),
    )


def _deduplicate_sources(sources: list[dict]) -> list[dict]:
    result = []
    seen = set()

    for source in sources:
        source_id = source["id"]

        if source_id in seen:
            continue

        seen.add(source_id)
        result.append(source)

    return result
