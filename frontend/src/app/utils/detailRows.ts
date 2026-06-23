import { formatMetricValue } from '../../services/report/reportCatalog';
import type { DetailColumnKey, DetailContext, DetailRow } from '../types';

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

export const formatDetailContextSummary = (context: DetailContext, entityLabel: string) =>
  `${context.point.label} · ${formatMetricValue(context.value, context.metric.type)} · ${entityLabel}`;

