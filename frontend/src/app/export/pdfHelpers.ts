import { formatMetricValue } from '../../services/report/reportCatalog';
import type { MetricRow, ReportPoint } from '../../services/report/reportCatalog';
import type { SourceMetricsData, ValueStateMap } from '../../services/report/reportTypes';
import type { ReportEmployee, ThresholdValues } from '../types';

const normalizePeriodKey = (value: string) => value.slice(0, 10);

export const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const chunk = <T,>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

/** Minimum readable table row height in mm (F-21: no unreadable scaling). */
export const MIN_TABLE_ROW_HEIGHT_MM = 6.8;

export const readValuesByPeriod = (
  valuesByPeriod: Record<string, number> | undefined,
  periodKey: string,
) => {
  if (!valuesByPeriod) {
    return 0;
  }

  const direct = valuesByPeriod[periodKey];
  if (typeof direct === 'number' && Number.isFinite(direct)) {
    return direct;
  }

  const normalized = normalizePeriodKey(periodKey);
  const normalizedDirect = valuesByPeriod[normalized];
  if (typeof normalizedDirect === 'number' && Number.isFinite(normalizedDirect)) {
    return normalizedDirect;
  }

  const matched = Object.entries(valuesByPeriod).find(
    ([key]) => normalizePeriodKey(key) === normalized,
  );

  return matched && Number.isFinite(matched[1]) ? matched[1] : 0;
};

export const getValueCellDisplayLabel = (
  value: number | undefined,
  metricType: MetricRow['type'],
  state?: ValueStateMap[string][string],
) => {
  if (state) {
    return '—';
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }

  return formatMetricValue(value, metricType);
};

export const getEmployeePeriodMetricValue = (
  employee: ReportEmployee,
  point: ReportPoint,
  metricId: string,
): number => {
  const valuesByPeriod = employee.valuesByPeriod ?? {};
  const exactValue = valuesByPeriod[point.key]?.[metricId];

  if (typeof exactValue === 'number') {
    return exactValue;
  }

  const pointDateKey = normalizePeriodKey(point.key);
  const matchedPeriodKey = Object.keys(valuesByPeriod).find(
    (periodKey) => normalizePeriodKey(periodKey) === pointDateKey,
  );

  if (!matchedPeriodKey) {
    return 0;
  }

  return valuesByPeriod[matchedPeriodKey]?.[metricId] ?? 0;
};

const buildSourceMetricActionId = (sourceKey: string, metricKey: string) =>
  `${sourceKey}::${metricKey}`;

export const buildSourceMetricActionIds = (
  sourceKey: string,
  metricKey: string,
  sourceData: SourceMetricsData | undefined,
) =>
  Array.from(
    new Set(
      [
        buildSourceMetricActionId(sourceKey, metricKey),
        sourceData?.id ? `${sourceData.id}::${metricKey}` : '',
        sourceData?.sourceId ? `${sourceData.sourceId}::${metricKey}` : '',
        ...(sourceData?.detailSourceIds ?? []).map((sourceId) => `${sourceId}::${metricKey}`),
      ].filter(Boolean),
    ),
  );

export const resolveThresholdForIds = (
  actionIds: string[],
  thresholds: Record<string, ThresholdValues>,
): ThresholdValues => {
  for (const actionId of actionIds) {
    const value = thresholds[actionId];
    if (value && (value.upper || value.lower)) {
      return value;
    }
  }

  return thresholds[actionIds[0] ?? ''] ?? { upper: '', lower: '', mode: null };
};

/** RGB fills/text matching on-screen corridor cell colors (styles.css value-cell.*). */
export const getPdfThresholdStyle = (thresholdClass: string | undefined) => {
  switch (thresholdClass) {
    case 'is-above-threshold':
    case 'is-inside-range-threshold':
      return {
        fill: [237, 249, 241] as const,
        text: [34, 132, 90] as const,
        stroke: '#22845a',
        fillHex: '#edf9f1',
      };
    case 'is-below-threshold':
    case 'is-outside-range-threshold':
      return {
        fill: [255, 240, 240] as const,
        text: [201, 51, 51] as const,
        stroke: '#c93333',
        fillHex: '#fff0f0',
      };
    case 'is-outside-range-warning':
      return {
        fill: [255, 251, 235] as const,
        text: [180, 83, 9] as const,
        stroke: '#b45309',
        fillHex: '#fffbeb',
      };
    case 'is-above-corridor-neutral':
    case 'is-below-corridor-neutral':
      return {
        fill: [243, 245, 248] as const,
        text: [75, 85, 99] as const,
        stroke: '#4b5563',
        fillHex: '#f3f5f8',
      };
    default:
      return null;
  }
};
