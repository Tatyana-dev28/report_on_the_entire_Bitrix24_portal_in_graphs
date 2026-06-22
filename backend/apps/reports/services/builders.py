from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from apps.bitrix.models import BitrixPortal, PortalUser
from apps.reports.models import ReportBuild, ReportSession
from apps.reports.services.cache_repository import ReportCacheRepository
from apps.reports.services.data_providers import (
    ReportDataProvider,
    ReportDataProviderContext,
    get_report_data_provider,
)
from apps.reports.services.filters import (
    make_filters_hash,
    parse_report_datetime,
    result_size_bytes,
)
from apps.reports.services.exceptions import ReportPreviewSessionError


@dataclass(frozen=True)
class ReportBuildContext:
    portal: BitrixPortal
    user: PortalUser | None
    bitrix_user_id: str
    user_name: str


class ReportBuilder:
    def __init__(
        self,
        *,
        data_provider: ReportDataProvider | None = None,
        cache_repository: ReportCacheRepository | None = None,
    ):
        self.data_provider = data_provider or get_report_data_provider()
        self.cache_repository = cache_repository or ReportCacheRepository()

    def build_preview(self, *, filters: dict, context: ReportBuildContext) -> dict:
        filters_hash = make_filters_hash(filters)
        ttl_seconds = int(getattr(settings, "REPORT_SESSION_CACHE_TTL_SECONDS", 7200))
        now = timezone.now()
        expires_at = now + timedelta(seconds=ttl_seconds)

        session = ReportSession.objects.create(
            portal=context.portal,
            user=context.user,
            bitrix_user_id=context.bitrix_user_id,
            user_name=context.user_name,
            status=ReportSession.Status.ACTIVE,
            period_key=filters["period"],
            state_snapshot=filters,
            filters_hash=filters_hash,
            cache_ttl_seconds=ttl_seconds,
            opened_at=now,
            last_activity_at=now,
            last_calculated_at=now,
            expires_at=expires_at,
            metadata={
                "source": "api.reports.preview",
                "calculation": "provider_pending",
            },
        )

        try:
            provider_result = self.data_provider.build_preview(
                filters=filters,
                context=ReportDataProviderContext(
                    portal=context.portal,
                    user=context.user,
                    bitrix_user_id=context.bitrix_user_id,
                    user_name=context.user_name,
                ),
            )
        except Exception as error:
            self._mark_failed(
                context=context,
                session=session,
                filters=filters,
                filters_hash=filters_hash,
                started_at=now,
                error=error,
            )
            raise ReportPreviewSessionError(
                "Не удалось построить отчет по данным Bitrix24.",
                status=getattr(error, "status", 502),
                details={
                    "sessionKey": str(session.session_key),
                    "filtersHash": filters_hash,
                    "message": str(error),
                },
            ) from error

        cache_key = self.cache_repository.make_preview_cache_key(
            portal_id=context.portal.id,
            session_key=str(session.session_key),
            filters_hash=filters_hash,
        )
        result_payload = provider_result.to_cache_payload(
            session_key=str(session.session_key),
            filters_hash=filters_hash,
        )

        self.cache_repository.save_result(
            cache_key=cache_key,
            result_payload=result_payload,
            ttl_seconds=ttl_seconds,
        )

        session.cache_key = cache_key
        session.result_size_bytes = result_size_bytes(result_payload)
        session.metadata = {
            **session.metadata,
            "calculation": provider_result.status,
            "provider": result_payload["meta"].get("provider", "unknown"),
        }
        session.save(
            update_fields=[
                "cache_key",
                "result_size_bytes",
                "metadata",
                "updated_at",
            ],
        )

        self._create_report_build(
            context=context,
            session=session,
            filters=filters,
            filters_hash=filters_hash,
            cache_key=cache_key,
            started_at=now,
        )

        return {
            "status": "ready",
            "sessionKey": str(session.session_key),
            "filtersHash": filters_hash,
            "cacheTtlSeconds": ttl_seconds,
            "expiresAt": session.expires_at.isoformat() if session.expires_at else None,
            "filters": filters,
            "data": result_payload["data"],
            "employees": result_payload["employees"],
            "details": result_payload["details"],
            "message": result_payload["meta"]["message"],
        }

    def _mark_failed(
        self,
        *,
        context: ReportBuildContext,
        session: ReportSession,
        filters: dict,
        filters_hash: str,
        started_at,
        error: Exception,
    ) -> None:
        error_message = str(error)
        session.status = ReportSession.Status.ERROR
        session.error_message = error_message
        session.metadata = {
            **session.metadata,
            "calculation": "failed",
            "provider": "bitrix",
        }
        session.save(
            update_fields=[
                "status",
                "error_message",
                "metadata",
                "updated_at",
            ],
        )

        self._create_report_build(
            context=context,
            session=session,
            filters=filters,
            filters_hash=filters_hash,
            cache_key="",
            started_at=started_at,
            status=ReportBuild.Status.FAILED,
            error_message=error_message,
        )

    def _create_report_build(
        self,
        *,
        context: ReportBuildContext,
        session: ReportSession,
        filters: dict,
        filters_hash: str,
        cache_key: str,
        started_at,
        status: str = ReportBuild.Status.SUCCESS,
        error_message: str = "",
    ) -> ReportBuild:
        date_range = filters.get("dateRange") or {}
        date_from = parse_report_datetime(date_range.get("from"))
        date_to = parse_report_datetime(date_range.get("to"), end_of_day=True)

        return ReportBuild.objects.create(
            portal=context.portal,
            session=session,
            requested_by=context.user,
            requested_by_bitrix_user_id=context.bitrix_user_id,
            period_key=filters["period"],
            date_from=date_from,
            date_to=date_to,
            sources=filters["selectedSources"],
            metrics=filters["selectedMetricIds"],
            options={
                "metricMode": filters.get("metricMode"),
                "chartDisplayMode": filters.get("chartDisplayMode"),
            },
            filters_hash=filters_hash,
            cache_key=cache_key,
            status=status,
            error_message=error_message,
            started_at=started_at,
            finished_at=timezone.now(),
        )
