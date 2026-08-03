from __future__ import annotations

import logging
from typing import Any

from django.db import transaction

from apps.bitrix.models import BitrixPortal
from apps.bitrix.services.rest_client import BitrixRestClient, BitrixRestError
from apps.reports.services.source_availability import annotate_sources_availability
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
    "deal-default",
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

# Entity type ID → human-readable name mapping for known CRM entities.
# Smart-process entity type names are loaded dynamically from Bitrix API.
ENTITY_TYPE_NAME_MAP: dict[int, str] = {
    1: "Лиды",
    2: "Сделки",
    31: "Счета",
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

    return _sort_sources(_deduplicate_sources(
        disambiguate_duplicate_pipeline_labels(
            [_model_to_api_source(source) for source in sources]
        )
    ))


def load_sources_from_bitrix(portal: BitrixPortal) -> list[dict]:
    client = BitrixRestClient(portal)
    sources = [
        _lead_source(),
        _deal_entity_source(),
        *_deal_sources(client),
        *_smart_process_sources(client),
        _invoice_source(),
        *_virtual_report_sources(),
    ]

    annotate_sources_availability(portal=portal, client=client, sources=sources)

    return _sort_sources(_deduplicate_sources(
        disambiguate_duplicate_pipeline_labels(sources)
    ))


@transaction.atomic
def sync_crm_sources(*, portal: BitrixPortal, sources: list[dict]) -> None:
    seen_external_keys = set()

    for source in sources:
        external_key = str(source["id"])
        seen_external_keys.add(external_key)
        raw_data = dict(source.get("rawData") or {})
        unavailable_reason = source.get("unavailableReason")
        if unavailable_reason:
            raw_data["_unavailableReason"] = unavailable_reason
        else:
            raw_data.pop("_unavailableReason", None)

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
                "raw_data": raw_data,
            },
        )

    CrmSource.objects.filter(
        portal=portal,
        is_active=True,
    ).exclude(external_key__in=seen_external_keys).update(is_available=False)


def disambiguate_duplicate_pipeline_labels(sources: list[dict]) -> list[dict]:
    """
    If multiple sources share the same base label (sourceLabel / title),
    append entity context in parentheses to distinguish them.

    First pass: append entity type name.
      "Общее" → "Общее (Сделки)"   (deal pipeline)
      "Общее" → "Общее (Договоры)" (smart process pipeline)

    Second pass: if labels are still duplicates, append category ID.
      "Общее (Договоры)" → "Общее (Договоры, ID 12)"
      "Общее (Договоры)" → "Общее (Договоры, ID 18)"
    """
    # Collect sources that have a non-empty base label
    pipeline_sources = [s for s in sources if s.get("sourceLabel") or s.get("title")]
    non_pipeline_sources = [s for s in sources if not (s.get("sourceLabel") or s.get("title"))]

    # Group by base title
    title_groups: dict[str, list[dict]] = {}

    for source in pipeline_sources:
        base_title = str(source.get("sourceLabel") or source.get("title") or "")
        title_groups.setdefault(base_title, []).append(source)

    # Only process groups with more than one source
    for base_title, group in title_groups.items():
        if len(group) <= 1:
            continue

        # --- First pass: append entity type name ---
        for source in group:
            entity_type_name = _resolve_entity_type_name(source)
            if entity_type_name:
                source["sourceLabel"] = f"{base_title} ({entity_type_name})"

        # --- Second pass: if still duplicated, append category ID ---
        label_groups: dict[str, list[dict]] = {}

        for source in group:
            label = str(source.get("sourceLabel") or "")
            label_groups.setdefault(label, []).append(source)

        for label, label_group in label_groups.items():
            if len(label_group) <= 1:
                continue

            for source in label_group:
                category_id = source.get("categoryId")
                source["sourceLabel"] = f"{label}, ID {category_id}"

    return sources


def _resolve_entity_type_name(source: dict) -> str | None:
    """Resolve human-readable entity type name for a source."""
    source_type = source.get("type")
    entity_type_id = source.get("entityTypeId")
    raw_data = source.get("rawData") or {}

    if source_type == "deal":
        return ENTITY_TYPE_NAME_MAP.get(2, "Сделки")

    if source_type == "smartProcess":
        return _extract_smart_process_name(raw_data)

    if source_type == "lead":
        return ENTITY_TYPE_NAME_MAP.get(1, "Лиды")

    if source_type == "invoice":
        return ENTITY_TYPE_NAME_MAP.get(31, "Счета")

    # Fallback: use the entity type name map if entity_type_id is known
    if isinstance(entity_type_id, int) and entity_type_id in ENTITY_TYPE_NAME_MAP:
        return ENTITY_TYPE_NAME_MAP[entity_type_id]

    return None


def _extract_smart_process_name(raw_data: dict) -> str | None:
    """Extract the smart process type title from raw_data."""
    if not isinstance(raw_data, dict):
        return None

    # Case 1: rawData has a "type" key with the smart type object
    smart_type = raw_data.get("type")

    if isinstance(smart_type, dict):
        name = (
            smart_type.get("title")
            or smart_type.get("TITLE")
            or smart_type.get("name")
            or smart_type.get("NAME")
        )
        if name:
            return str(name)

    # Case 2: rawData IS the smart type object (no categories case)
    if "entityTypeId" in raw_data or "ENTITY_TYPE_ID" in raw_data:
        name = (
            raw_data.get("title")
            or raw_data.get("TITLE")
            or raw_data.get("name")
            or raw_data.get("NAME")
        )
        if name:
            return str(name)

    return None


def _deal_sources(client: BitrixRestClient) -> list[dict]:
    categories = _deal_categories(client)
    categories = _ensure_default_deal_category(client, categories)

    if not categories:
        categories = [{"ID": 0, "NAME": "Продажи"}]

    return [
        {
            "id": f"deal-{_category_id(category)}",
            "type": "deal",
            "entityTypeId": 2,
            "categoryId": _category_id(category),
            "title": _category_title(category, default="Продажи"),
            "sourceLabel": _category_title(category, default="Продажи"),
            "entityTypeName": "Сделки",
            "isAvailable": True,
            "rawData": {
                **category,
                "_entityTypeName": "Сделки",
            },
        }
        for category in _sort_categories(categories)
    ]


def _deal_categories(client: BitrixRestClient) -> list[dict]:
    """
    Load deal pipelines.

    Prefer crm.category.list (entityTypeId=2): it includes the built-in default
    funnel (id=0) with the real portal name (e.g. «Капы», «Общее»).

    Legacy crm.dealcategory.list often omits category 0 entirely.
    """
    try:
        response = client.call_method(
            "crm.category.list",
            {"entityTypeId": 2, "order": {"sort": "ASC"}},
        )
        categories = _extract_items(response.result, keys=("categories", "items"))
        if categories:
            return categories
    except BitrixRestError:
        logger.warning("Bitrix deal category.list loading failed; falling back to dealcategory.list.", exc_info=True)

    try:
        return client.call_list("crm.dealcategory.list", {"order": {"SORT": "ASC"}})
    except BitrixRestError:
        logger.warning("Bitrix dealcategory.list loading failed.", exc_info=True)
        return []


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
                    "entityTypeName": str(type_title),
                    "isAvailable": True,
                    "rawData": {
                        **smart_type,
                        "_entityTypeName": str(type_title),
                    },
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
                    "entityTypeName": str(type_title),
                    "isAvailable": True,
                    "rawData": {
                        "type": smart_type,
                        "category": category,
                        "_entityTypeName": str(type_title),
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
        "entityTypeName": "Лиды",
        "isAvailable": True,
        "rawData": {
            "_entityTypeName": "Лиды",
        },
    }


def _deal_entity_source() -> dict:
    """CRM-entity "Сделки" (all deals), not a specific pipeline."""
    return {
        "id": "deal-default",
        "type": "deal",
        "entityTypeId": 2,
        "categoryId": None,
        "title": "Сделки",
        "sourceLabel": "Сделки",
        "entityTypeName": "Сделки",
        "isAvailable": True,
        "rawData": {
            "_entityTypeName": "Сделки",
        },
    }


def _invoice_source() -> dict:
    return {
        "id": "invoice-default",
        "type": "invoice",
        "entityTypeId": 31,
        "categoryId": None,
        "title": "Счета",
        "sourceLabel": "Счета",
        "entityTypeName": "Счета",
        "isAvailable": True,
        "rawData": {
            "_entityTypeName": "Счета",
        },
    }


def _model_to_api_source(source: CrmSource) -> dict:
    raw_data = source.raw_data or {}

    # Resolve entityTypeName from raw_data first, then infer from type
    entity_type_name = raw_data.get("_entityTypeName")

    if not entity_type_name:
        entity_type_name = _infer_entity_type_name_for_model(source, raw_data)

    return {
        "id": source.external_key,
        "type": _api_source_type_from_model(source),
        "entityTypeId": source.entity_type_id,
        "categoryId": source.category_id,
        "title": source.title,
        "sourceLabel": source.source_label or source.title,
        "entityTypeName": entity_type_name,
        "isAvailable": source.is_available,
        "unavailableReason": (
            None
            if source.is_available
            else (raw_data.get("_unavailableReason") or "Недоступно")
        ),
        "rawData": raw_data,
    }


def _infer_entity_type_name_for_model(source: CrmSource, raw_data: dict) -> str | None:
    """Infer entity type name for a CrmSource model that may lack _entityTypeName in raw_data."""
    # Check by entity_type_id
    if source.entity_type_id and source.entity_type_id in ENTITY_TYPE_NAME_MAP:
        return ENTITY_TYPE_NAME_MAP[source.entity_type_id]

    # Smart process: try to extract from raw_data type title
    if source.source_type == CrmSource.SourceType.SMART_PROCESS:
        return _extract_smart_process_name(raw_data)

    # Fallback by source_type
    if source.source_type == CrmSource.SourceType.DEAL:
        return "Сделки"

    if source.source_type == CrmSource.SourceType.LEAD:
        return "Лиды"

    if source.source_type == CrmSource.SourceType.INVOICE:
        return "Счета"

    if source.source_type == CrmSource.SourceType.CALL:
        return "Звонки"

    if source.source_type == CrmSource.SourceType.ACTIVITY:
        return "Дела"

    if source.source_type == CrmSource.SourceType.TASK:
        return "Задачи"

    if source.source_type == CrmSource.SourceType.COMPANY:
        return "Компании"

    if source.source_type == CrmSource.SourceType.CONTACT:
        return "Контакты"

    if source.source_type == CrmSource.SourceType.OTHER:
        if source.external_key.startswith("quote-"):
            return "Предложения"
        if source.external_key.startswith("crm-form-"):
            return "CRM-формы"

    return None


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


def _category_id(category: dict) -> int:
    return _safe_int(_first_present(category, "ID", "id"), 0)


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _ensure_default_deal_category(client: BitrixRestClient, categories: list[dict]) -> list[dict]:
    """
    Bitrix often omits the built-in deal funnel (id=0) from legacy list methods.
    Keep it in the catalog and resolve the real portal name when possible.
    """
    normalized_categories = [category for category in categories if isinstance(category, dict)]

    if any(_category_id(category) == 0 for category in normalized_categories):
        return normalized_categories

    default_name = _fetch_default_deal_category_name(client) or "Продажи"
    return [{"ID": 0, "NAME": default_name, "SORT": 0}, *normalized_categories]


def _fetch_default_deal_category_name(client: BitrixRestClient) -> str | None:
    """Resolve the renamed default deal funnel (id=0), e.g. «Капы» / «Общее»."""
    try:
        response = client.call_method(
            "crm.category.get",
            {"entityTypeId": 2, "id": 0},
        )
        category = _extract_category_payload(response.result)
        title = _category_title(category, default="") if category else ""
        if title:
            return title
    except BitrixRestError:
        logger.warning("Bitrix crm.category.get for default deal funnel failed.", exc_info=True)

    try:
        response = client.call_method("crm.dealcategory.get", {"id": 0})
        category = _extract_category_payload(response.result)
        title = _category_title(category, default="") if category else ""
        if title:
            return title
    except BitrixRestError:
        logger.warning("Bitrix crm.dealcategory.get for default deal funnel failed.", exc_info=True)

    return None


def _extract_category_payload(value: Any) -> dict | None:
    if isinstance(value, dict):
        nested = value.get("category")
        if isinstance(nested, dict):
            return nested
        return value

    return None


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