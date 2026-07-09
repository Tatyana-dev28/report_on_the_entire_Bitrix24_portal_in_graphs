import { formatMoney, metrics, type MetricRow, type Period, type ReportPoint } from '../../services/report/reportCatalog';
import type { ChartMetricMode, MockEmployee, ScheduleFilters } from '../types';

/** Successful/won money metrics that may contribute to the main chart in "sum" mode. */
export const SUCCESS_MONEY_METRIC_IDS = [
  'deals_won_sum',
  'invoices_won_sum',
  'quotes_accepted_sum',
  'smart_process_success_sum',
  'contracts_signed_sum',
  'leads_quality_sum',
] as const;

const readMetricValue = (values: ReportPoint['values'], metricId: string | undefined) => {
  if (!metricId) {
    return 0;
  }

  const raw = values[metricId];
  const numeric = typeof raw === 'number' ? raw : Number(raw);

  return Number.isFinite(numeric) ? numeric : 0;
};

type SourceKindFlags = {
  isLeadSource: boolean;
  isDealSource: boolean;
  isProductionSource: boolean;
  isInvoiceSource: boolean;
  isQuoteSource: boolean;
  isTelephonySource: boolean;
  isActivitySource: boolean;
  isContractSource: boolean;
  isMeetingSource: boolean;
  isCompanySource: boolean;
  isContactSource: boolean;
  isTaskSource: boolean;
  isCrmFormSource: boolean;
};

const getSourceKindFlags = (source: string): SourceKindFlags => {
  const normalizedSource = source.toLowerCase();

  return {
    isLeadSource: normalizedSource.includes('lead') || normalizedSource.includes('лид'),
    isDealSource:
      normalizedSource.includes('deal') ||
      normalizedSource.includes('сдел') ||
      normalizedSource.includes('продаж'),
    isProductionSource:
      normalizedSource.includes('smart') ||
      normalizedSource.includes('смарт') ||
      normalizedSource.includes('производ'),
    isInvoiceSource:
      normalizedSource.includes('invoice') ||
      normalizedSource.includes('счет') ||
      normalizedSource.includes('счёт'),
    isQuoteSource:
      normalizedSource.includes('quote') ||
      normalizedSource.includes('кп') ||
      normalizedSource.includes('предлож'),
    isTelephonySource:
      normalizedSource.includes('telephony') ||
      normalizedSource.includes('call') ||
      normalizedSource.includes('звон'),
    isActivitySource:
      normalizedSource.includes('activity') ||
      normalizedSource.includes('актив') ||
      normalizedSource.includes('дел'),
    isContractSource:
      normalizedSource.includes('smart-170-') ||
      normalizedSource.includes('contract') ||
      normalizedSource.includes('договор'),
    isMeetingSource:
      normalizedSource.includes('smart-1070-') ||
      normalizedSource.includes('meeting') ||
      normalizedSource.includes('встреч'),
    isCompanySource: normalizedSource.includes('company') || normalizedSource.includes('компан'),
    isContactSource: normalizedSource.includes('contact') || normalizedSource.includes('контакт'),
    isTaskSource: normalizedSource.includes('task') || normalizedSource.includes('задач'),
    isCrmFormSource:
      normalizedSource.includes('crm-form') ||
      normalizedSource.includes('crm_form') ||
      normalizedSource.includes('форм'),
  };
};

/** Metric id used for a single chart series for the given source. */
export const getChartMetricId = (source: string, metricMode: ChartMetricMode): string | null => {
  const {
    isLeadSource,
    isDealSource,
    isProductionSource,
    isInvoiceSource,
    isQuoteSource,
    isTelephonySource,
    isActivitySource,
    isContractSource,
    isMeetingSource,
    isCompanySource,
    isContactSource,
    isTaskSource,
    isCrmFormSource,
  } = getSourceKindFlags(source);

  if (metricMode === 'count') {
    if (isCompanySource) {
      return 'companies_new';
    }
    if (isContactSource) {
      return 'contacts_new';
    }
    if (isTaskSource) {
      return 'tasks_created';
    }
    if (isCrmFormSource) {
      return 'crm_forms';
    }
    if (isContractSource) {
      return 'contracts_created';
    }
    if (isMeetingSource) {
      return 'meetings_created';
    }
    if (isLeadSource) {
      return 'leads_created';
    }
    if (isProductionSource) {
      return 'smart_process_total';
    }
    if (isInvoiceSource) {
      return 'invoices_created';
    }
    if (isDealSource) {
      return 'deals_created';
    }
    if (isQuoteSource) {
      return 'quotes_created';
    }
    if (isTelephonySource) {
      return 'calls_total';
    }
    if (isActivitySource) {
      return 'activities_created';
    }

    return 'deals_created';
  }

  if (isLeadSource) {
    return 'leads_quality_sum';
  }
  if (isContractSource) {
    return 'contracts_signed_sum';
  }
  if (isMeetingSource || isCompanySource || isContactSource || isTaskSource || isCrmFormSource) {
    return null;
  }
  if (isProductionSource) {
    return 'smart_process_success_sum';
  }
  if (isInvoiceSource) {
    return 'invoices_won_sum';
  }
  if (isDealSource) {
    return 'deals_won_sum';
  }
  if (isQuoteSource) {
    return 'quotes_accepted_sum';
  }

  // Telephony/activity and unknown sources have no own money metric — do not
  // fall back to deals_won_sum (that caused 3× inflation when those sources
  // were selected together with deals).
  return null;
};

/**
 * Sum-mode chart value: unique success metrics for selected sources.
 * Prevents double-counting the same portal-wide metric across several sources
 * (e.g. deal + telephony + activity all mapping to deals_won_sum).
 */
export const getChartSumValue = (
  point: ReportPoint,
  sources: string[],
  metricMode: ChartMetricMode,
) => {
  const metricIds = new Set<string>();

  for (const source of sources) {
    const metricId = getChartMetricId(source, metricMode);

    if (metricId) {
      metricIds.add(metricId);
    }
  }

  let sum = 0;

  for (const metricId of metricIds) {
    sum += readMetricValue(point.values, metricId);
  }

  return sum;
};

export function buildTrend(values: number[]) {
  if (values.length <= 1) {
    return values;
  }

  const n = values.length;
  const finiteValues = values.map((value) => (Number.isFinite(value) ? value : 0));
  const sumX = finiteValues.reduce((sum, _value, index) => sum + index, 0);
  const sumY = finiteValues.reduce((sum, value) => sum + value, 0);
  const sumXY = finiteValues.reduce((sum, value, index) => sum + index * value, 0);
  const sumXX = finiteValues.reduce((sum, _value, index) => sum + index * index, 0);
  const denominator = n * sumXX - sumX * sumX;

  if (denominator === 0) {
    return finiteValues;
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return finiteValues.map((_value, index) => Math.round(intercept + slope * index));
}

export const getEmployeeInitials = (employee: MockEmployee) =>
  `${employee.firstName.charAt(0)}${employee.lastName.charAt(0)}`;

export const getEmployeeMetricValue = (
  value: number,
  metric: MetricRow,
  employeeIndex: number,
  pointIndex: number,
) => {
  const shares = [0.42, 0.34, 0.24];
  const wave = 1 + Math.sin((pointIndex + employeeIndex + metric.base) / 3) * 0.08;

  if (metric.type === 'percent') {
    return Math.max(
      0,
      Math.min(
        100,
        Math.round((value + (employeeIndex - 1) * 3 + Math.sin(pointIndex) * 2) * 10) / 10,
      ),
    );
  }

  return Math.max(0, Math.round(value * (shares[employeeIndex] ?? 0.2) * wave));
};

const zeroMetricValues = metrics.reduce<Record<string, number>>((acc, metric) => {
  acc[metric.id] = 0;
  return acc;
}, {});

export const createZeroReportData = (data: ReportPoint[]) =>
  data.map((point) => ({
    ...point,
    indicator: 0,
    values: { ...zeroMetricValues },
  }));

export const numberFormatter = new Intl.NumberFormat('ru-RU');

const parseTimeToMinutes = (value: string) => {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const getMondayBasedDayId = (date: Date) => {
  const day = date.getDay();

  return day === 0 ? 6 : day - 1;
};

export const applyScheduleToReportData = (
  data: ReportPoint[],
  period: Period,
  schedule: ScheduleFilters,
) => {
  if (period === 'days') {
    return data.filter((point) => {
      const date = new Date(point.key);

      return !schedule.weekendDayIds.includes(getMondayBasedDayId(date));
    });
  }

  if (period !== 'hours') {
    return data;
  }

  const startMinutes = parseTimeToMinutes(schedule.workdayStart);
  const endMinutes = parseTimeToMinutes(schedule.workdayEnd);

  if (startMinutes === 0 && endMinutes === 0) {
    return data;
  }

  const minMinutes = Math.min(startMinutes, endMinutes);
  const maxMinutes = Math.max(startMinutes, endMinutes);

  return data.filter((point) => {
    const date = new Date(point.key);
    const minutes = date.getHours() * 60 + date.getMinutes();

    return minutes >= minMinutes && minutes <= maxMinutes;
  });
};

export const getChartSeriesValue = (
  point: ReportPoint,
  source: string,
  metricMode: ChartMetricMode,
) => {
  const metricId = getChartMetricId(source, metricMode);

  if (!metricId) {
    return 0;
  }

  // smart_process_total historically used || 0; keep same semantics via readMetricValue.
  return readMetricValue(point.values, metricId);
};
export const formatMainChartValue = (value: number, metricMode: ChartMetricMode) => {
  if (metricMode === 'money') {
    return formatMoney(value);
  }

  return numberFormatter.format(Math.round(value));
};

export const formatMainAxisTick = (value: number | string, metricMode: ChartMetricMode) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return '';
  }

  if (metricMode === 'money') {
    return `${Math.round(numericValue / 1000)} тыс.`;
  }

  if (Math.abs(numericValue) >= 1000) {
    return `${Math.round(numericValue / 100) / 10} тыс.`;
  }

  return numberFormatter.format(Math.round(numericValue));
};

const moneyAxisFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const numberAxisFormatter = new Intl.NumberFormat('ru-RU', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const formatAxisTick = (value: number | string, type: MetricRow['type']) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return '';
  }

  if (type === 'money') {
    return moneyAxisFormatter.format(numericValue);
  }

  if (type === 'percent') {
    return `${Math.round(numericValue)}%`;
  }

  return numberAxisFormatter.format(numericValue);
};

export const getChartDomain = (values: number[]): [number, number] => {
  const validValues = values.filter((value) => Number.isFinite(value));

  if (!validValues.length) {
    return [0, 1];
  }

  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const base = Math.max(Math.abs(min), Math.abs(max), 1);
  const rawSpan = max - min;
  const span = rawSpan < base * 0.02 ? base * 0.12 : rawSpan;
  const padding = span * 0.18;
  const lower = min - padding;
  const upper = max + padding;

  return [Math.max(0, Math.floor(lower)), Math.ceil(upper)];
};
