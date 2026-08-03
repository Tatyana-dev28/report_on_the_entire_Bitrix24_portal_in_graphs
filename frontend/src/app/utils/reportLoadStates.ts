import type { ReportPoint } from '../../services/report/reportCatalog';
import type { MetricDetailItem, ValueStateMap } from '../../services/report/reportTypes';
import type { ReportEmployee } from '../types';

export const REPORT_BUILD_STAGE_LABELS = [
  'Получаем данные',
  'Рассчитываем показатели',
  'Строим графики',
] as const;

export type ReportBuildStageLabel = (typeof REPORT_BUILD_STAGE_LABELS)[number];

const REPORT_BUILD_STAGES: Array<{ untilMs: number; label: ReportBuildStageLabel }> = [
  { untilMs: 8_000, label: 'Получаем данные' },
  { untilMs: 25_000, label: 'Рассчитываем показатели' },
  { untilMs: Number.POSITIVE_INFINITY, label: 'Строим графики' },
];

export const SECTION_LOAD_ERROR_MESSAGE = 'Не удалось получить данные.';
export const SECTION_LOAD_RETRY_LABEL = 'Повторить';

export function resolveReportBuildStage(elapsedMs: number): ReportBuildStageLabel {
  const safeElapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;

  for (const stage of REPORT_BUILD_STAGES) {
    if (safeElapsed < stage.untilMs) {
      return stage.label;
    }
  }

  return REPORT_BUILD_STAGES[REPORT_BUILD_STAGES.length - 1].label;
}

/** Section has a retriable load error when any of its metrics failed to load. */
export function sectionHasLoadError(
  metricIds: string[],
  valueStates: ValueStateMap,
  periodKeys: string[],
): boolean {
  if (!metricIds.length || !periodKeys.length) {
    return false;
  }

  return metricIds.some((metricId) =>
    periodKeys.some((periodKey) => valueStates[periodKey]?.[metricId]?.reason === 'load_error'),
  );
}

export function mergeReportPointsForMetrics(
  previous: ReportPoint[],
  incoming: ReportPoint[],
  metricIds: Set<string>,
): ReportPoint[] {
  if (!previous.length) {
    return incoming;
  }

  if (!incoming.length || metricIds.size === 0) {
    return previous;
  }

  const incomingByKey = new Map(incoming.map((point) => [point.key, point]));

  return previous.map((point) => {
    const nextPoint = incomingByKey.get(point.key);

    if (!nextPoint) {
      return point;
    }

    const values = { ...point.values };
    metricIds.forEach((metricId) => {
      if (Object.prototype.hasOwnProperty.call(nextPoint.values, metricId)) {
        values[metricId] = nextPoint.values[metricId];
      }
    });

    return {
      ...point,
      values,
    };
  });
}

export function mergeValueStatesForMetrics(
  previous: ValueStateMap,
  incoming: ValueStateMap,
  metricIds: Set<string>,
): ValueStateMap {
  if (metricIds.size === 0) {
    return previous;
  }

  const periodKeys = new Set([...Object.keys(previous), ...Object.keys(incoming)]);
  const next: ValueStateMap = {};

  periodKeys.forEach((periodKey) => {
    const merged = { ...(previous[periodKey] ?? {}) };

    metricIds.forEach((metricId) => {
      delete merged[metricId];
      const incomingState = incoming[periodKey]?.[metricId];
      if (incomingState) {
        merged[metricId] = incomingState;
      }
    });

    next[periodKey] = merged;
  });

  return next;
}

export function mergeDetailsForMetrics(
  previous: MetricDetailItem[],
  incoming: MetricDetailItem[],
  metricIds: Set<string>,
): MetricDetailItem[] {
  if (metricIds.size === 0) {
    return previous;
  }

  const kept = previous.filter((item) => !item.metricId || !metricIds.has(item.metricId));
  const added = incoming.filter((item) => item.metricId && metricIds.has(item.metricId));

  return [...kept, ...added];
}

export function mergeEmployeesForMetrics(
  previous: ReportEmployee[],
  incoming: ReportEmployee[],
  metricIds: Set<string>,
): ReportEmployee[] {
  if (!incoming.length) {
    return previous;
  }

  if (!previous.length || metricIds.size === 0) {
    return incoming;
  }

  const byId = new Map(previous.map((employee) => [employee.id, employee]));

  incoming.forEach((employee) => {
    const existing = byId.get(employee.id);

    if (!existing) {
      byId.set(employee.id, employee);
      return;
    }

    const values = { ...(existing.values ?? {}) };
    Object.entries(employee.values ?? {}).forEach(([metricId, value]) => {
      if (metricIds.has(metricId)) {
        values[metricId] = value;
      }
    });

    const valuesByPeriod = { ...(existing.valuesByPeriod ?? {}) };
    Object.entries(employee.valuesByPeriod ?? {}).forEach(([periodKey, periodValues]) => {
      const mergedPeriod = { ...(valuesByPeriod[periodKey] ?? {}) };
      Object.entries(periodValues).forEach(([metricId, value]) => {
        if (metricIds.has(metricId)) {
          mergedPeriod[metricId] = value;
        }
      });
      valuesByPeriod[periodKey] = mergedPeriod;
    });

    byId.set(employee.id, {
      ...existing,
      ...employee,
      values,
      valuesByPeriod,
    });
  });

  return Array.from(byId.values());
}
