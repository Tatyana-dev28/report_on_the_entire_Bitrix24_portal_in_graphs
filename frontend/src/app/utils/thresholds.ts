import type { MetricRow } from '../../services/report/reportCatalog';
import type { ChartMetricMode, RecommendedThresholdValues, ThresholdValues } from '../types';

export const EMPTY_CORRIDOR_PLACEHOLDER = '—';

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
  // Zero is a real value and must participate; only drop non-finite.
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

export const getThresholdClass = (value: number, threshold?: ThresholdValues) => {
  if (!threshold || !Number.isFinite(value)) {
    return '';
  }

  const upper = parseThreshold(threshold.upper);
  const lower = parseThreshold(threshold.lower);

  if (upper !== null && value >= upper) {
    return 'is-above-threshold';
  }

  if (lower !== null && value < lower) {
    return 'is-below-threshold';
  }

  return '';
};
