"""Merge preview filters into a dashboard settings snapshot without dropping UI fields."""

from __future__ import annotations

PREVIEW_SETTING_KEYS = (
    "period",
    "dateRange",
    "selectedSources",
    "chartSelectedSources",
    "selectedMetricIds",
    "metricMode",
    "chartDisplayMode",
    "schedule",
)


def overlay_preview_filters(settings_payload: dict, filters: dict) -> dict:
    merged = dict(settings_payload)
    if isinstance(filters, dict) and filters:
        merged["filters"] = filters
        for key in PREVIEW_SETTING_KEYS:
            if filters.get(key) is not None:
                merged[key] = filters[key]
    return merged


def persist_current_snapshot_settings(
    portal,
    *,
    settings: dict | None = None,
    saved_views: list | None = None,
) -> bool:
    """Update current snapshot settings in place without rebuilding chart data."""
    from apps.dashboard.services.refresh import get_current_snapshot
    from apps.dashboard.services.snapshot_preview import stamp_filters_hash

    snapshot = get_current_snapshot(portal, load_data=False)
    if snapshot is None:
        return False

    update_fields = ["updated_at"]
    if isinstance(settings, dict):
        snapshot.settings_snapshot = settings
        snapshot.metadata = stamp_filters_hash(
            snapshot.metadata if isinstance(snapshot.metadata, dict) else {},
            settings,
        )
        update_fields.extend(["settings_snapshot", "metadata"])
    if isinstance(saved_views, list):
        snapshot.saved_views_snapshot = saved_views
        update_fields.append("saved_views_snapshot")
    snapshot.save(update_fields=update_fields)
    return True
