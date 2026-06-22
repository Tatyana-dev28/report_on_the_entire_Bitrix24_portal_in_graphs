from __future__ import annotations

from django.core.cache import cache


class ReportCacheRepository:
    def make_preview_cache_key(self, *, portal_id: int, session_key: str, filters_hash: str) -> str:
        return f"reports:preview:{portal_id}:{session_key}:{filters_hash}"

    def save_result(self, *, cache_key: str, result_payload: dict, ttl_seconds: int) -> None:
        cache.set(cache_key, result_payload, timeout=ttl_seconds)

    def get_result(self, cache_key: str) -> dict | None:
        result = cache.get(cache_key)

        if isinstance(result, dict):
            return result

        return None
