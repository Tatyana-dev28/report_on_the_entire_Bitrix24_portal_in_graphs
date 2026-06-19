import { formatMoney, metrics, type MetricRow, type Period, type ReportPoint } from '../../services/report/reportCatalog';
import type { ChartMetricMode, MockEmployee, ScheduleFilters } from '../types';

export function buildTrend(values: number[]) {
  if (values.length <= 1) {
    return values;
  }

  const n = values.length;
  const sumX = values.reduce((sum, _value, index) => sum + index, 0);
  const sumY = values.reduce((sum, value) => sum + value, 0);
  const sumXY = values.reduce((sum, value, index) => sum + index * value, 0);
  const sumXX = values.reduce((sum, _value, index) => sum + index * index, 0);
  const denominator = n * sumXX - sumX * sumX;

  if (denominator === 0) {
    return values;
  }

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return values.map((_value, index) => Math.round(intercept + slope * index));
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
  const values = point.values;
  const normalizedSource = source.toLowerCase();

  const isLeadSource =
    source === 'Р’РѕСЂРѕРЅРєР° Р»РёРґРѕРІ' ||
    source === 'Р›РёРґС‹' ||
    normalizedSource.includes('Р»РёРґ');

  const isDealSource =
    source === 'Р’РѕСЂРѕРЅРєР° РїСЂРѕРґР°Р¶Рё' ||
    normalizedSource.includes('СЃРґРµР»') ||
    normalizedSource.includes('РїСЂРѕРґР°Р¶');

  const isProductionSource =
    source === 'Р’РѕСЂРѕРЅРєР° РїСЂРѕРёР·РІРѕРґСЃС‚РІРѕ' ||
    normalizedSource.includes('РїСЂРѕРёР·РІРѕРґ');

  const isInvoiceSource =
    source === 'РЎС‡РµС‚Р°' ||
    normalizedSource.includes('СЃС‡РµС‚') ||
    normalizedSource.includes('СЃС‡С‘С‚');

  if (metricMode === 'count') {
    if (isLeadSource) {
      return values.leads_created;
    }

    if (isProductionSource) {
      return values.production_accepted + values.production_work + values.production_ready;
    }

    if (isInvoiceSource) {
      return values.invoices_created;
    }

    if (isDealSource) {
      return values.deals_created;
    }

    switch (source) {
      case 'РЎРјР°СЂС‚-РїСЂРѕС†РµСЃСЃ Р·Р°СЏРІРєРё':
        return values.crm_forms;
      case 'РЎРјР°СЂС‚-РїСЂРѕС†РµСЃСЃ РїСЂРѕРёР·РІРѕРґСЃС‚РІРѕ':
        return values.activities_created + values.production_work;
      case 'РЎРјР°СЂС‚-РїСЂРѕС†РµСЃСЃ РґРѕСЃС‚Р°РІРєР°':
        return values.tasks_done + values.activities_done;
      default:
        return values.deals_created;
    }
  }

  if (isLeadSource) {
    return values.leads_quality_sum;
  }

  if (isProductionSource) {
    return (values.production_accepted + values.production_ready) * 46000;
  }

  if (isInvoiceSource) {
    return values.invoices_won_sum;
  }

  if (isDealSource) {
    return values.deals_won_sum;
  }

  switch (source) {
    case 'РЎРјР°СЂС‚-РїСЂРѕС†РµСЃСЃ Р·Р°СЏРІРєРё':
      return values.crm_forms * 42000;
    case 'РЎРјР°СЂС‚-РїСЂРѕС†РµСЃСЃ РїСЂРѕРёР·РІРѕРґСЃС‚РІРѕ':
      return (values.activities_created + values.production_work) * 36000;
    case 'РЎРјР°СЂС‚-РїСЂРѕС†РµСЃСЃ РґРѕСЃС‚Р°РІРєР°':
      return (values.tasks_done + values.activities_done) * 18000;
    default:
      return values.deals_won_sum;
  }
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
    return `${Math.round(numericValue / 1000)} С‚С‹СЃ.`;
  }

  if (Math.abs(numericValue) >= 1000) {
    return `${Math.round(numericValue / 100) / 10} С‚С‹СЃ.`;
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
