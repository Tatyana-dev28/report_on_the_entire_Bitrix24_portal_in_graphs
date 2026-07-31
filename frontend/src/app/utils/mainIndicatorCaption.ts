import { formatRangeLabel, type DateRange, type Period } from '../../services/report/reportCatalog';
import type { SourceMetricsData } from '../../services/report/reportTypes';
import type { ChartDisplayMode, ChartMetricMode } from '../types';
import {
  findSourceMetricsEntry,
  getChartMetricId,
  getSourceChartMetricKey,
  isPipelineChartSource,
} from './reportCalculations';

const MAX_VISIBLE_NAMES = 3;

export type MainIndicatorCaptionInput = {
  sourceLabels: string[];
  chartDisplayMode: ChartDisplayMode;
  metricMode: ChartMetricMode;
  period: Period;
  dateRange: DateRange;
  periodOptionLabel?: string;
  hasBuiltReport: boolean;
  /** True when chart series has at least one finite non-placeholder contribution after build. */
  hasChartData: boolean;
};

export type MainIndicatorCaption = {
  title: string;
  titleFull: string;
  meta: string;
  empty: boolean;
  emptyMessage?: string;
  emptyHint?: string;
};

const unitLabel = (metricMode: ChartMetricMode) => {
  if (metricMode === 'money') {
    return 'RUB';
  }

  return 'шт.';
};

const groupingLabel = (period: Period, periodOptionLabel?: string) => {
  const raw = periodOptionLabel?.trim();
  if (raw) {
    return raw.replace(/^Группировка:\s*/i, '');
  }

  switch (period) {
    case 'hours':
      return 'по часам';
    case 'days':
      return 'по дням';
    case 'weeks':
      return 'по неделям';
    case 'months':
      return 'по месяцам';
    default:
      return 'по периодам';
  }
};

const joinNames = (names: string[]) => {
  if (names.length <= 1) {
    return names[0] ?? '';
  }

  if (names.length === 2) {
    return `${names[0]}, ${names[1]}`;
  }

  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
};

const buildTitle = (sourceLabels: string[], chartDisplayMode: ChartDisplayMode) => {
  const names = sourceLabels.map((label) => label.trim()).filter(Boolean);

  if (names.length === 0) {
    return { title: '', titleFull: '' };
  }

  if (names.length === 1) {
    return { title: names[0], titleFull: names[0] };
  }

  const fullList = joinNames(names);

  if (chartDisplayMode === 'sum') {
    if (names.length <= MAX_VISIBLE_NAMES) {
      return {
        title: `Сумма: ${fullList}`,
        titleFull: `Сумма: ${fullList}`,
      };
    }

    return {
      title: `Сумма (${names.length} показателей)`,
      titleFull: `Сумма: ${fullList}`,
    };
  }

  if (names.length <= MAX_VISIBLE_NAMES) {
    return { title: fullList, titleFull: fullList };
  }

  const visible = names.slice(0, 2).join(', ');
  const rest = names.length - 2;

  return {
    title: `${visible} и ещё ${rest}`,
    titleFull: fullList,
  };
};

export const hasResolvableMainChartSources = (
  sources: string[],
  metricMode: ChartMetricMode,
  sourceMetrics?: Record<string, SourceMetricsData>,
) =>
  sources.some((source) => {
    if (isPipelineChartSource(source)) {
      const entry = findSourceMetricsEntry(sourceMetrics, source);
      return Boolean(entry && getSourceChartMetricKey(entry.metrics, metricMode));
    }

    return getChartMetricId(source, metricMode) !== null;
  });

export const buildMainIndicatorCaption = (
  input: MainIndicatorCaptionInput,
): MainIndicatorCaption => {
  const { title, titleFull } = buildTitle(input.sourceLabels, input.chartDisplayMode);
  const periodLabel = formatRangeLabel(input.period, input.dateRange);
  const grouping = groupingLabel(input.period, input.periodOptionLabel);
  const unit = unitLabel(input.metricMode);
  const meta = `${periodLabel} · ${grouping} · ${unit}`;

  if (!input.sourceLabels.length) {
    return {
      title: 'Главный показатель не выбран',
      titleFull: 'Главный показатель не выбран',
      meta,
      empty: true,
      emptyMessage: 'Нет данных',
      emptyHint: 'Выберите главный показатель в настройках слева',
    };
  }

  if (input.hasBuiltReport && !input.hasChartData) {
    return {
      title: title || 'Главный показатель',
      titleFull: titleFull || title || 'Главный показатель',
      meta,
      empty: true,
      emptyMessage: 'Нет данных',
      emptyHint: 'Выберите другой главный показатель или измените период',
    };
  }

  return {
    title: title || 'Главный показатель',
    titleFull: titleFull || title || 'Главный показатель',
    meta,
    empty: false,
  };
};
