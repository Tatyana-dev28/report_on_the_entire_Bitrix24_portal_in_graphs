import { formatMetricValue } from '../../services/report/reportCatalog';
import { mockEmployees } from '../constants';
import type { DetailColumnKey, DetailContext, DetailRow } from '../types';
import { bitrixEntityTitleRoots } from './bitrixNavigation';

export const detailDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const buildMockDetailRows = (context: DetailContext): DetailRow[] => {
  const baseDate = new Date(context.point.key);
  const safeBaseTime = Number.isFinite(baseDate.getTime()) ? baseDate.getTime() : Date.now();
  const seed = context.metric.id
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), context.point.key.length);
  const count = 10 + (seed % 11);
  const entityTitleRoot = bitrixEntityTitleRoots[context.entityType];

  return Array.from({ length: count }, (_item, index) => {
    const employee = context.employee ?? mockEmployees[(seed + index) % mockEmployees.length];
    const createdAtDate = new Date(safeBaseTime + index * 37 * 60 * 1000);
    const entityId = 10000 + seed * 17 + index + 1;

    return {
      rowNumber: index + 1,
      entityId,
      title: `${entityTitleRoot} ${context.metric.label.toLowerCase()} ${index + 1}`,
      responsibleId: employee.userId,
      responsibleName: `${employee.firstName} ${employee.lastName}`,
      createdAt: detailDateFormatter.format(createdAtDate),
      createdAtSortValue: createdAtDate.getTime(),
      entityType: context.entityType,
    };
  });
};

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

