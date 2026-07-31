"""
Neutral module for PeriodBucket dataclass and period-related helpers.
This module must NOT import from bitrix_report_data_provider or source_metrics_service
to avoid circular imports.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class PeriodBucket:
    key: str
    label: str
    tooltip_label: str
    start: datetime
    end: datetime
    is_partial: bool = False
