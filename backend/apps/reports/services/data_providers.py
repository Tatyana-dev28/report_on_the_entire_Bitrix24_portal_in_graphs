from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from apps.bitrix.models import BitrixPortal, PortalUser


@dataclass(frozen=True)
class ReportDataProviderContext:
    portal: BitrixPortal
    user: PortalUser | None
    bitrix_user_id: str
    user_name: str


@dataclass(frozen=True)
class ReportDataResult:
    data: list[dict] = field(default_factory=list)
    employees: list[dict] = field(default_factory=list)
    details: list[dict] = field(default_factory=list)
    status: str = "empty"
    message: str = "Сессия отчета создана. Расчет через Bitrix REST будет подключен следующим этапом."
    metadata: dict = field(default_factory=dict)

    def to_cache_payload(self, *, session_key: str, filters_hash: str) -> dict:
        return {
            "data": self.data,
            "employees": self.employees,
            "details": self.details,
            "meta": {
                "status": self.status,
                "message": self.message,
                "sessionKey": session_key,
                "filtersHash": filters_hash,
                **self.metadata,
            },
        }


class ReportDataProvider(Protocol):
    def build_preview(
        self,
        *,
        filters: dict,
        context: ReportDataProviderContext,
    ) -> ReportDataResult:
        ...


class EmptyReportDataProvider:
    def build_preview(
        self,
        *,
        filters: dict,
        context: ReportDataProviderContext,
    ) -> ReportDataResult:
        return ReportDataResult()


def get_report_data_provider() -> ReportDataProvider:
    return EmptyReportDataProvider()
