import type { MetricRow } from '../../services/report/reportCatalog';
import type { ValueState } from '../../services/report/reportTypes';
import type { MetricDirection } from '../config/metricDirections';
import type { ChartMetricMode, RecommendedThresholdValues, ThresholdValues } from '../types';

export const EMPTY_CORRIDOR_PLACEHOLDER = '—';

/**
 * F-16: map a cell to corridor input.
 * 0 is a real observation and must participate; «—» (state / non-finite) becomes NaN and is dropped.
 */
export const toCorridorValue = (
  value: number | undefined | null,
  state?: ValueState | null,
): number => {
  if (state) {
    return Number.NaN;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Number.NaN;
  }

  return value;
};

export function parseThreshold(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Midpoint of upper/lower — used for manual corridor preview only. */
export const getThresholdAverage = (threshold: ThresholdValues) => {
  const upper = parseThreshold(threshold.upper);
  const lower = parseThreshold(threshold.lower);

  if (upper === null || lower === null) {
    return null;
  }

  return Math.round((upper + lower) / 2);
};

/**
 * Average shown on chart/table/tooltips.
 * Prefer stored formula average (recommended); fall back to midpoint for manual.
 */
export const resolveDisplayedThresholdAverage = (threshold: ThresholdValues) => {
  if (threshold.average != null && threshold.average.trim() !== '') {
    return parseThreshold(threshold.average);
  }

  return getThresholdAverage(threshold);
};

export const formatCorridorFieldValue = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : EMPTY_CORRIDOR_PLACEHOLDER;
};

export type CorridorFieldKey = 'upper' | 'average' | 'lower';
export type CorridorFieldValues = Record<CorridorFieldKey, string>;
export type CorridorValidationErrors = Partial<Record<CorridorFieldKey, string>>;
export type CorridorValueType = MetricRow['type'] | ChartMetricMode;

const isQuantityCorridorType = (valueType?: CorridorValueType) =>
  valueType === 'number' || valueType === 'count';

/** Field-level validation for manual corridor save (F-08). */
export const validateCorridorFields = (
  fields: CorridorFieldValues,
  valueType?: CorridorValueType,
): CorridorValidationErrors => {
  const errors: CorridorValidationErrors = {};
  const disallowNegative = isQuantityCorridorType(valueType);
  const parsed: Partial<Record<CorridorFieldKey, number>> = {};

  (['upper', 'average', 'lower'] as const).forEach((key) => {
    const raw = fields[key].trim();
    if (!raw) {
      errors[key] = 'Заполните поле';
      return;
    }

    const value = parseThreshold(raw);
    if (value === null) {
      errors[key] = 'Неверный формат';
      return;
    }

    if (disallowNegative && value < 0) {
      errors[key] = 'Значение не может быть отрицательным';
      return;
    }

    parsed[key] = value;
  });

  if (
    parsed.lower !== undefined
    && parsed.average !== undefined
    && parsed.lower > parsed.average
  ) {
    errors.lower = 'Нижняя граница не может быть больше средней';
  }

  if (
    parsed.average !== undefined
    && parsed.upper !== undefined
    && parsed.average > parsed.upper
  ) {
    errors.average = 'Средний уровень не может быть больше верхней границы';
  }

  if (
    parsed.lower !== undefined
    && parsed.upper !== undefined
    && parsed.lower > parsed.upper
  ) {
    errors.lower = errors.lower ?? 'Нижняя граница не может быть больше верхней';
  }

  return errors;
};

export const hasCorridorValidationErrors = (errors: CorridorValidationErrors) =>
  Object.keys(errors).length > 0;

export const isManualThreshold = (threshold?: ThresholdValues | null) =>
  threshold?.mode === 'manual';

const formatRecommendedThresholdValue = (value: number, type: MetricRow['type'] | ChartMetricMode = 'number') => {
  if (type === 'percent') {
    return String(Math.round(value * 10) / 10);
  }

  return String(Math.round(value));
};

export const calculateRecommendedThresholds = (
  values: number[],
  type: MetricRow['type'] | ChartMetricMode = 'number',
): RecommendedThresholdValues => {
  // F-16: 0 participates in the corridor; NaN/«—» (via toCorridorValue) do not.
  const validValues = values.filter((value) => Number.isFinite(value));

  if (!validValues.length) {
    return { upper: '', average: '', lower: '' };
  }

  const average = validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
  const upperValues = validValues.filter((value) => value > average);
  const lowerValues = validValues.filter((value) => value < average);
  // No values above/below average → that bound equals the average (no division by zero).
  const upperAverage = upperValues.length
    ? upperValues.reduce((sum, value) => sum + value, 0) / upperValues.length
    : average;
  const lowerAverage = lowerValues.length
    ? lowerValues.reduce((sum, value) => sum + value, 0) / lowerValues.length
    : average;

  return {
    upper: formatRecommendedThresholdValue(upperAverage, type),
    average: formatRecommendedThresholdValue(average, type),
    lower: formatRecommendedThresholdValue(lowerAverage, type),
  };
};

export const getThresholdLineLabel = (
  threshold: ThresholdValues | undefined,
  key: 'upper' | 'average' | 'lower',
) => {
  const recommended = threshold?.mode === 'recommended';

  if (key === 'upper') {
    return recommended ? 'Рассчитанная верхняя граница' : 'Верхняя граница';
  }

  if (key === 'average') {
    return recommended ? 'Рассчитанный средний уровень' : 'Средний уровень';
  }

  return recommended ? 'Рассчитанная нижняя граница' : 'Нижняя граница';
};

export const thresholdLineColors = {
  upper: '#2fb36f',
  average: '#eab308',
  lower: '#ef4444',
} as const;

export type ThresholdTooltipItem = {
  key: keyof typeof thresholdLineColors;
  label: string;
  value: number;
  color: string;
};

export const getAppliedThresholdItems = (threshold?: ThresholdValues) => {
  if (!threshold) {
    return [];
  }

  const upper = parseThreshold(threshold.upper);
  const lower = parseThreshold(threshold.lower);
  const average = resolveDisplayedThresholdAverage(threshold);

  const items: Array<ThresholdTooltipItem | null> = [
    upper === null
      ? null
      : {
          key: 'upper' as const,
          label: getThresholdLineLabel(threshold, 'upper'),
          value: upper,
          color: thresholdLineColors.upper,
        },
    average === null
      ? null
      : {
          key: 'average' as const,
          label: getThresholdLineLabel(threshold, 'average'),
          value: average,
          color: thresholdLineColors.average,
        },
    lower === null
      ? null
      : {
          key: 'lower' as const,
          label: getThresholdLineLabel(threshold, 'lower'),
          value: lower,
          color: thresholdLineColors.lower,
        },
  ];

  return items.filter((item): item is ThresholdTooltipItem => item !== null);
};

export type ThresholdDeviationSide = 'above' | 'below';

/** Strict: equality to a bound is NOT a deviation (F-10). */
export const getThresholdDeviationSide = (
  value: number,
  threshold?: ThresholdValues,
): ThresholdDeviationSide | null => {
  if (!threshold || !Number.isFinite(value)) {
    return null;
  }

  const upper = parseThreshold(threshold.upper);
  const lower = parseThreshold(threshold.lower);

  if (upper !== null && value > upper) {
    return 'above';
  }

  if (lower !== null && value < lower) {
    return 'below';
  }

  return null;
};

const isSevereRangeDeviation = (
  value: number,
  side: ThresholdDeviationSide,
  upper: number | null,
  lower: number | null,
) => {
  if (upper === null || lower === null) {
    return true;
  }

  const span = Math.abs(upper - lower);
  if (!(span > 0)) {
    return true;
  }

  const excess = side === 'above' ? value - upper : lower - value;
  // Farther than one full corridor width → red; milder → yellow.
  return excess >= span;
};

export const getThresholdDeviationTooltip = (
  value: number,
  threshold?: ThresholdValues,
  direction: MetricDirection = 'none',
): string | null => {
  const side = getThresholdDeviationSide(value, threshold);

  if (side === 'above') {
    return 'Выше верхней границы';
  }

  if (side === 'below') {
    return 'Ниже нижней границы';
  }

  if (direction === 'range_normal' && threshold) {
    const upper = parseThreshold(threshold.upper);
    const lower = parseThreshold(threshold.lower);
    if (
      upper !== null
      && lower !== null
      && Number.isFinite(value)
      && value >= lower
      && value <= upper
    ) {
      return 'Внутри нормального диапазона';
    }
  }

  return null;
};

/** F-19: evaluation wording for chart/cell tooltips when direction is set. */
export const getDeviationEvaluationLabel = (
  side: ThresholdDeviationSide | null,
  direction: MetricDirection = 'none',
): string | null => {
  if (!side || direction === 'none') {
    return null;
  }

  if (direction === 'range_normal') {
    return 'вне нормального диапазона';
  }

  if (direction === 'higher_better') {
    return side === 'above' ? 'положительное отклонение' : 'отрицательное отклонение';
  }

  if (direction === 'lower_better') {
    return side === 'below' ? 'положительное отклонение' : 'отрицательное отклонение';
  }

  return null;
};

/**
 * F-19 chart point note: «выше верхней границы 78,88; положительное отклонение».
 */
export const formatChartCorridorTooltipNote = (
  value: number,
  threshold: ThresholdValues | undefined,
  direction: MetricDirection,
  formatValue: (value: number) => string,
): string | null => {
  const side = getThresholdDeviationSide(value, threshold);
  const upper = parseThreshold(threshold?.upper ?? '');
  const lower = parseThreshold(threshold?.lower ?? '');

  if (side === 'above') {
    const bound = upper !== null ? ` ${formatValue(upper)}` : '';
    const evaluation = getDeviationEvaluationLabel(side, direction);
    return evaluation
      ? `выше верхней границы${bound}; ${evaluation}`
      : `выше верхней границы${bound}`;
  }

  if (side === 'below') {
    const bound = lower !== null ? ` ${formatValue(lower)}` : '';
    const evaluation = getDeviationEvaluationLabel(side, direction);
    return evaluation
      ? `ниже нижней границы${bound}; ${evaluation}`
      : `ниже нижней границы${bound}`;
  }

  if (direction === 'range_normal' && upper !== null && lower !== null
    && Number.isFinite(value) && value >= lower && value <= upper) {
    return 'внутри нормального диапазона';
  }

  return null;
};

export const getThresholdClass = (
  value: number,
  threshold?: ThresholdValues,
  direction: MetricDirection = 'none',
) => {
  if (!threshold || !Number.isFinite(value)) {
    return '';
  }

  const upper = parseThreshold(threshold.upper);
  const lower = parseThreshold(threshold.lower);
  const side = getThresholdDeviationSide(value, threshold);

  if (direction === 'range_normal') {
    if (!side) {
      if (
        upper !== null
        && lower !== null
        && value >= lower
        && value <= upper
      ) {
        return 'is-inside-range-threshold';
      }
      return '';
    }

    return isSevereRangeDeviation(value, side, upper, lower)
      ? 'is-outside-range-threshold'
      : 'is-outside-range-warning';
  }

  if (!side) {
    return '';
  }

  // Neutral: show corridor deviation without good/bad coloring.
  if (direction === 'none') {
    return side === 'above' ? 'is-above-corridor-neutral' : 'is-below-corridor-neutral';
  }

  if (direction === 'lower_better') {
    // High values are bad, low values are good.
    return side === 'above' ? 'is-below-threshold' : 'is-above-threshold';
  }

  // higher_better
  return side === 'above' ? 'is-above-threshold' : 'is-below-threshold';
};

export const appendThresholdTooltip = (
  baseTooltip: string | undefined,
  value: number,
  threshold?: ThresholdValues,
  direction: MetricDirection = 'none',
) => {
  const note = formatChartCorridorTooltipNote(
    value,
    threshold,
    direction,
    (bound) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(bound),
  ) ?? getThresholdDeviationTooltip(value, threshold, direction);

  if (!note) {
    return baseTooltip;
  }

  const base = (baseTooltip ?? '').trim();
  return base ? `${base} · ${note}` : note;
};
