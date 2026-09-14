"""Which incremental failures may freeze global warehouse coverage.

Catalog extras (smart-process, CRM forms) can 400/404 on a portal that
does not have them. Those holes stay in source_coverage. Core CRM types
still block coverage_to so reports do not pretend MySQL is fresh.
"""

from __future__ import annotations


# Types whose failed fetch must keep coverage_to / last_incremental_at
# so the next run still catch-up from the gap.
COVERAGE_BLOCKING_SOURCE_TYPES = frozenset(
    {
        "deal",
        "lead",
        "invoice",
        "quote",
        "company",
        "contact",
        "telephony",
        "activity",
        "task",
    }
)


def failed_ids_block_incremental_coverage(
    failed_source_ids: list[str],
    sources: list[dict],
) -> list[str]:
    """Return failed ids that must not advance global coverage_to."""

    if not failed_source_ids:
        return []

    type_by_id = {
        str(source.get("id") or ""): source.get("type")
        for source in sources
        if source.get("id")
    }
    blocking: list[str] = []
    seen: set[str] = set()
    for source_id in failed_source_ids:
        if not source_id or source_id in seen:
            continue
        seen.add(source_id)
        source_type = type_by_id.get(source_id)
        if source_type is None or source_type in COVERAGE_BLOCKING_SOURCE_TYPES:
            blocking.append(source_id)
    return blocking
