import type { MetricRow } from '../../services/report/reportCatalog';
import type { ChartMetricMode, RecommendedThresholdValues, ThresholdValues } from '../types';

export function parseThreshold(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export const getThresholdAverage = (threshold: ThresholdValues) => {
  const upper = parseThreshold(threshold.upper);
  const lower = parseThreshold(threshold.lower);

  if (upper === null || lower === null) {
    return null;
  }

  return Math.round((upper + lower) / 2);
};

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
  const validValues = values.filter((value) => Number.isFinite(value));

  if (!validValues.length) {
    return { upper: '', average: '', lower: '' };
  }

  const average = validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
  const upperValues = validValues.filter((value) => value > average);
  const lowerValues = validValues.filter((value) => value < average);
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
    return recommended ? 'Рекомендованное верхнее значение' : 'Верхнее значение';
  }

  if (key === 'average') {
    return recommended ? 'Рекомендованное среднее значение' : 'Среднее значение';
  }

  return recommended ? 'Рекомендованное нижнее значение' : 'Нижнее значение';
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
  const average = getThresholdAverage(threshold);

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

  // No meaningful band (e.g. all zeros → upper=lower=0): don't paint every cell.
  if (upper !== null && lower !== null && upper === lower) {
    return '';
  }

  if (upper !== null && value >= upper) {
    return 'is-above-threshold';
  }

  if (lower !== null && value < lower) {
    return 'is-below-threshold';
  }

  return '';
};
