import { formatMetricValue } from '../../services/report/reportCatalog';
import type { MetricRow } from '../../services/report/reportCatalog';
import type { DetailColumnKey, DetailContext, DetailRow } from '../types';
import { getEmployeeFullName } from './employees';

export const detailDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const compareDetailValues = (a: DetailRow, b: DetailRow, key: DetailColumnKey) => {
  if (key === 'createdAt') {
    return a.createdAtSortValue - b.createdAtSortValue;
  }

  if (key === 'rowNumber' || key === 'entityId') {
    return a[key] - b[key];
  }

  return a[key].localeCompare(b[key], 'ru');
};

/** Hover tooltip for clickable report cells (F-15). */
export const formatOpenDetailTooltip = (
  value: number,
  metricLabel: string,
  metricType: MetricRow['type'],
  options?: {
    accessDenied?: boolean;
    emptyHint?: string;
  },
) => {
  if (options?.accessDenied) {
    return 'Нет доступа';
  }

  if (!Number.isFinite(value) || value === 0) {
    return options?.emptyHint ?? 'Нет сущностей для просмотра';
  }

  return `Открыть ${formatMetricValue(value, metricType)} ${metricLabel.toLocaleLowerCase('ru-RU')}`;
};

/** Detail modal subtitle: interval · count · employee. */
export const formatDetailContextSummary = (context: DetailContext) => {
  const interval = context.point.tooltipLabel || context.point.label;
  const count = formatMetricValue(context.value, context.metric.type);
  const parts = [interval, count];

  if (context.employee) {
    parts.push(getEmployeeFullName(context.employee));
  }

  return parts.join(' · ');
};

