"""Source availability annotation for the report catalog.

Previously probed Bitrix scopes/REST and marked sources as «Недоступно».
That blocked selection even when CRM data existed, so probes are disabled:
catalog sources stay selectable; access errors surface when building the report.
"""

from __future__ import annotations

from typing import Any


def annotate_sources_availability(
    *,
    portal: Any,
    client: Any,
    sources: list[dict],
) -> list[dict]:
    del portal, client  # kept for call-site compatibility

    for source in sources:
        if not isinstance(source, dict):
            continue

        source["isAvailable"] = True
        source["unavailableReason"] = None

    return sources
