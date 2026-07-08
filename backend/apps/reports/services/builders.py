from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from apps.bitrix.models import BitrixPortal, PortalUser
from apps.reports.models import ReportBuild, ReportSession
from apps.reports.services.background_jobs import enqueue_report_build
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


ASYNC_DATE_RANGE_DAYS = 30
ASYNC_SOURCE_COUNT_THRESHOLD = 2
HEAVY_ASYNC_SOURCE_IDS = {
    "activity-default",
    "telephony-default",
    "task-default",
}
HEAVY_ASYNC_DATE_RANGE_DAYS = 7


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
        ttl_seconds = int(getattr(settings, "REPORT_SESSION_CACHE_TTL_SECONDS", 1800))
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

        if _should_build_in_background(filters):
            build = self._create_report_build(
                context=context,
                session=session,
                filters=filters,
                filters_hash=filters_hash,
                cache_key="",
                started_at=None,
                status=ReportBuild.Status.PENDING,
                finished_at=None,
            )
            job_id = enqueue_report_build(build.id)
            build.celery_task_id = job_id
            build.save(update_fields=["celery_task_id", "updated_at"])

            session.metadata = {
                **session.metadata,
                "calculation": "queued",
                "provider": "bitrix",
                "buildId": build.id,
            }
            session.save(update_fields=["metadata", "updated_at"])

            return self._queued_payload(
                session=session,
                filters=filters,
                filters_hash=filters_hash,
                ttl_seconds=ttl_seconds,
                build=build,
            )

        return self._build_and_store_preview(
            filters=filters,
            context=context,
            session=session,
            filters_hash=filters_hash,
            ttl_seconds=ttl_seconds,
            started_at=now,
        )

    def run_queued_build(self, build_id: int) -> None:
        build = ReportBuild.objects.select_related("session", "portal", "requested_by").get(id=build_id)
        session = build.session

        if session is None:
            build.status = ReportBuild.Status.FAILED
            build.error_message = "Report session was not found."
            build.finished_at = timezone.now()
            build.save(update_fields=["status", "error_message", "finished_at", "updated_at"])
            return

        if build.status not in {ReportBuild.Status.PENDING, ReportBuild.Status.RUNNING}:
            return

        started_at = timezone.now()
        build.status = ReportBuild.Status.RUNNING
        build.started_at = started_at
        build.save(update_fields=["status", "started_at", "updated_at"])

        session.metadata = {
            **session.metadata,
            "calculation": "running",
            "provider": "bitrix",
            "buildId": build.id,
        }
        session.save(update_fields=["metadata", "updated_at"])

        context = ReportBuildContext(
            portal=build.portal,
            user=build.requested_by,
            bitrix_user_id=build.requested_by_bitrix_user_id,
            user_name=session.user_name,
        )

        try:
            self._build_and_store_preview(
                filters=session.state_snapshot,
                context=context,
                session=session,
                filters_hash=build.filters_hash,
                ttl_seconds=session.cache_ttl_seconds,
                started_at=started_at,
                build=build,
            )
        except ReportPreviewSessionError:
            return

    def _build_and_store_preview(
        self,
        *,
        filters: dict,
        context: ReportBuildContext,
        session: ReportSession,
        filters_hash: str,
        ttl_seconds: int,
        started_at,
        build: ReportBuild | None = None,
    ) -> dict:
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
        except ReportPreviewSessionError as error:
            self._mark_failed(
                context=context,
                session=session,
                filters=filters,
                filters_hash=filters_hash,
                started_at=started_at,
                error=error,
                build=build,
            )
            raise
        except Exception as error:
            self._mark_failed(
                context=context,
                session=session,
                filters=filters,
                filters_hash=filters_hash,
                started_at=started_at,
                error=error,
                build=build,
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

        if build is None:
            self._create_report_build(
                context=context,
                session=session,
                filters=filters,
                filters_hash=filters_hash,
                cache_key=cache_key,
                started_at=started_at,
            )
        else:
            build.cache_key = cache_key
            build.status = ReportBuild.Status.SUCCESS
            build.error_message = ""
            build.finished_at = timezone.now()
            build.save(update_fields=["cache_key", "status", "error_message", "finished_at", "updated_at"])

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
            "source_metrics": result_payload.get("source_metrics", {}),
            "metadata": result_payload.get("metadata", {}),
            "message": result_payload["meta"]["message"],
        }

    def _queued_payload(
        self,
        *,
        session: ReportSession,
        filters: dict,
        filters_hash: str,
        ttl_seconds: int,
        build: ReportBuild,
    ) -> dict:
        return {
            "status": "queued",
            "sessionKey": str(session.session_key),
            "filtersHash": filters_hash,
            "cacheTtlSeconds": ttl_seconds,
            "expiresAt": session.expires_at.isoformat() if session.expires_at else None,
            "filters": filters,
            "data": [],
            "employees": [],
            "details": [],
            "metadata": {
                "async": True,
                "buildId": build.id,
            },
            "message": "Отчет строится. Данные появятся автоматически после завершения.",
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
        build: ReportBuild | None = None,
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

        if build is None:
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
        else:
            build.status = ReportBuild.Status.FAILED
            build.error_message = error_message
            build.finished_at = timezone.now()
            build.save(update_fields=["status", "error_message", "finished_at", "updated_at"])

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
        finished_at=timezone.now,
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
            metrics=filters.get("selectedMetricIds") or [],
            options={
                "metricMode": filters.get("metricMode"),
                "chartDisplayMode": filters.get("chartDisplayMode"),
            },
            filters_hash=filters_hash,
            cache_key=cache_key,
            status=status,
            error_message=error_message,
            started_at=started_at,
            finished_at=finished_at() if callable(finished_at) else finished_at,
        )


def _should_build_in_background(filters: dict) -> bool:
    if getattr(settings, "REPORT_DATA_PROVIDER", "bitrix").lower() != "bitrix":
        return False

    selected_sources = {str(source) for source in filters.get("selectedSources") or []}

    if len(selected_sources) > ASYNC_SOURCE_COUNT_THRESHOLD:
        return True

    date_range = filters.get("dateRange") or {}
    date_from = parse_report_datetime(date_range.get("from"))
    date_to = parse_report_datetime(date_range.get("to"), end_of_day=True)

    if not date_from or not date_to:
        return False

    range_days = abs((date_to.date() - date_from.date()).days) + 1

    if range_days > ASYNC_DATE_RANGE_DAYS:
        return True

    if selected_sources.intersection(HEAVY_ASYNC_SOURCE_IDS):
        return range_days > HEAVY_ASYNC_DATE_RANGE_DAYS

    return False
