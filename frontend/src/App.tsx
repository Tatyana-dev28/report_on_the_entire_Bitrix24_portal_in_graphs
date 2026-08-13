import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
  type UIEvent,
} from 'react';
import {
  BookOpen,
  CalendarDays,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cog,
  Crown,
  LifeBuoy,
  MoreVertical,
  Minus,
  Pin,
  PinOff,
  Plus,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  TrendingUp,
  GripVertical,
  X,
} from 'lucide-react';
import ReportBuildLoader from './app/components/ReportBuildLoader';
import ReportOnboarding from './app/components/ReportOnboarding';
import AutoSetupConfirmModal from './app/components/AutoSetupConfirmModal';
import IndicatorsSettingsPanel, {
  createIndicatorsSettingsDraft,
  type IndicatorsSettingsDraft,
} from './app/components/IndicatorsSettingsPanel';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatMetricValue,
  formatRangeLabel,
  metricSections as defaultMetricSections,
  metrics as defaultMetrics,
  periodOptions as defaultPeriodOptions,
  type DateRange,
  type MetricSection,
  type MetricRow,
  type Period,
  type ReportPoint,
} from './services/report/reportCatalog';
import { reportDataSource } from './services/report/reportDataSource';
import type { CrmSource, CrmSourceType, MetricDetailItem, ReportLoadFilters, SourceMetricsData, ValueStateMap } from './services/report/reportTypes';
import {
  isReloadRequiredErrorMessage,
  loadReportSettings,
  RELOAD_PAGE_TO_CONTINUE_MESSAGE,
  saveReportSettings,
  type PortalEmployeeItem,
} from './services/api/reportApiClient';
import {
  createProPayment,
  loadBillingState,
  type BillingPlan,
} from './services/api/billingApiClient';
import {
  APP_SETTINGS_STORAGE_KEY,
  CHART_AXIS_WIDTH,
  DETAIL_COLUMN_STORAGE_KEY,
  LAST_AVAILABLE_MONTH_INDEX,
  MAX_PERIOD_COLUMN_WIDTH,
  MIN_PERIOD_COLUMN_WIDTH,
  MONTH_LABELS,
  PERIOD_COLUMN_WIDTH,
  chartMetricModeOptions,
  chartSeriesColors,
  createDefaultSchedule,
  createDefaultFilters,
  defaultAppSettings,
  defaultSavedView,
  detailColumnMinWidthSum,
  detailColumns,
  scheduleTimeOptions,
  serializeFilters,
  deserializeFilters,
  weekDayOptions,
} from './app/constants';
import type {
  ActiveChartPoint,
  AppSettings,
  BitrixEntityType,
  ChartDisplayMode,
  ChartDotPayloadProps,
  ChartDraftSettings,
  ChartMetricMode,
  ChartTooltipItem,
  DetailColumnKey,
  DetailContext,
  DetailRow,
  DetailSort,
  MockEmployee,
  ReportEmployee,
  RecommendedThresholdValues,
  ReportFilters,
  SavedReportViewState,
  SavedReportViewOption,
  ScheduleFilters,
  SelectOption,
  TableRow,
  TableRowChartsMode,
  ThresholdValues,
} from './app/types';
import {
  bitrixEntityLabels,
  getEntityTypeForMetric,
  openBitrixEntity,
  openBitrixUser,
} from './app/utils/bitrixNavigation';
import { AUTOMATIC_REPORT_PRESET } from './app/config/automaticReportPreset';
import {
  MAIN_INDICATOR_DIRECTION_KEY,
  isMetricDirection,
  resolveMetricDirection,
  resolveMetricDirectionForIds,
  type MetricDirection,
} from './app/config/metricDirections';
import {
  buildAutomaticReportSummaryMessage,
  hasFilledCorridor,
} from './app/utils/automaticReportSummary';
import {
  constrainRangeForPeriod,
  getDefaultRangeForPeriod,
  getRangeFromMonthIndexes,
  getPreviousWeekFromYesterdayRange,
  monthIndex,
  toMonthInputValue,
} from './app/utils/dateRanges';
import {
  normalizeDetailColumnWidths,
  resizeDetailColumnWidths,
  sumDetailColumnWidths,
} from './app/utils/detailColumns';
import {
  applyScheduleToReportData,
  buildTrend,
  createZeroReportData,
  formatAxisTick,
  formatMainAxisTick,
  formatMainChartValue,
  getChartDomain,
  getWorkdayScheduleError,
  getChartSeriesCorridorValue,
  getChartSeriesValue,
  getChartSumCorridorValue,
  getChartSumValue,
  MIN_TREND_POINTS,
} from './app/utils/reportCalculations';
import { enrichEmployeesWithDirectory, detectRobotByName, getEmployeeFullName, isSystemEmployeeRow, resolveEmployeeDetailList, UNAVAILABLE_EMPLOYEE_ID } from './app/utils/employees';
import { formatOpenDetailTooltip } from './app/utils/detailRows';
import { buildMainIndicatorCaption, hasResolvableMainChartSources } from './app/utils/mainIndicatorCaption';
import {
  clearReportOnboardingCompleted,
  isReportOnboardingCompleted,
  markReportOnboardingCompleted,
} from './app/utils/reportOnboarding';
import {
  mergeDetailsForMetrics,
  mergeEmployeesForMetrics,
  mergeReportPointsForMetrics,
  mergeValueStatesForMetrics,
  resolveReportBuildStage,
  SECTION_LOAD_ERROR_MESSAGE,
  SECTION_LOAD_RETRY_LABEL,
  sectionHasLoadError,
  type ReportBuildStageLabel,
} from './app/utils/reportLoadStates';
import {
  calculateRecommendedThresholds,
  appendThresholdTooltip,
  formatChartCorridorTooltipNote,
  getAppliedThresholdItems,
  getThresholdClass,
  getThresholdLineLabel,
  isManualThreshold,
  parseThreshold,
  resolveDisplayedThresholdAverage,
  thresholdLineColors,
  toCorridorValue,
} from './app/utils/thresholds';
import {
  BrandLogo,
  CustomSelect,
  FloatingPopover,
  TooltipButton,
  TooltipPortal,
  ValueCellButton,
  useOutsideClose,
} from './app/components/common';
import { ChartPointTooltip, HoverChartDot } from './app/components/charts';
import {
  AppSettingsModal,
  ConfirmDeleteViewModal,
  DetailModal,
  FreeSaveLimitModal,
  InstructionModal,
  ProVersionModal,
  SaveViewModal,
} from './app/components/modals';
import {
  DateRangePicker,
  ReportDownloadMenu,
  RowActionsMenu,
  RowMetricChart,
  SavedViewsSelect,
  SectionMetricsMenu,
} from './app/components/reportControls';
import {
  isAutoSetupPromptSuppressed,
  markAutoSetupPromptSuppressed,
} from './app/utils/autoSetupPrompt';
import { exportReportPdf } from './app/export/exportReportPdf';
import { exportReportExcel } from './app/export/exportReportExcel';

const splitEmployeeName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] || 'Сотрудник',
    lastName: parts.slice(1).join(' '),
  };
};

const BILLING_LOAD_ERROR_MESSAGE = 'Не удалось загрузить платные тарифы. Попробуйте открыть приложение заново или напишите нам.';

const getFriendlyBillingError = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const normalizedMessage = message.toLowerCase();

  if (
    !message ||
    isReloadRequiredErrorMessage(message) ||
    normalizedMessage === 'failed to fetch' ||
    normalizedMessage.includes('networkerror') ||
    normalizedMessage.includes('load failed') ||
    normalizedMessage.includes('vite_api_base_url')
  ) {
    return BILLING_LOAD_ERROR_MESSAGE;
  }

  return message;
};

const getFriendlyReportError = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : '';
  if (isReloadRequiredErrorMessage(message)) {
    return RELOAD_PAGE_TO_CONTINUE_MESSAGE;
  }
  return message || fallback;
};

const toReportEmployee = (employee: {
  id: string;
  userId?: number;
  name: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  values?: Record<string, number>;
}): ReportEmployee => {
  const split = splitEmployeeName(employee.name);
  const userId = employee.userId ?? Number(employee.id);
  const firstName = employee.firstName?.trim() || split.firstName;
  const lastName = employee.lastName?.trim() || split.lastName;

  return {
    ...employee,
    userId: Number.isFinite(userId) ? userId : 0,
    firstName,
    lastName,
  };
};

const backendDetailDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const detailIdToNumber = (id: string | number, fallback: number) => {
  if (typeof id === 'number' && Number.isFinite(id)) {
    return id;
  }

  const numeric = Number(id);

  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  const formMatch = String(id).match(/^(?:lead|deal)-form-(\d+)$/i);
  if (formMatch) {
    const formId = Number(formMatch[1]);
    if (Number.isFinite(formId) && formId > 0) {
      return formId;
    }
  }

  return 900000 + fallback;
};

const normalizeDetailEntityRawId = (
  id: string | number | undefined,
): string | number | undefined => {
  if (id === undefined || id === null || id === '') {
    return undefined;
  }

  const formMatch = String(id).match(/^(?:lead|deal)-form-(\d+)$/i);
  return formMatch ? formMatch[1] : id;
};

const normalizePeriodKey = (value: string) => value.slice(0, 10);

/** True when key encodes an hour bucket (e.g. 2026-08-03T16:00:00). */
const hasHourPrecisionPeriodKey = (value: string) =>
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}/.test(value);

/**
 * Match key for detail drill-down:
 * - hour buckets → YYYY-MM-DDTHH (never date-only, or all day hours collapse together)
 * - day/week/month → YYYY-MM-DD
 */
const periodMatchKey = (value: string) => {
  const hourMatch = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2})/);
  if (hourMatch) {
    return `${hourMatch[1]}T${hourMatch[2]}`;
  }

  return normalizePeriodKey(value);
};

const matchDetailSourceId = (detailSourceId: string | undefined, sourceIds: string[]) => {
  if (!sourceIds.length || !detailSourceId) {
    return true;
  }

  return sourceIds.some(
    (sourceId) =>
      detailSourceId === sourceId
      || detailSourceId.includes(sourceId)
      || sourceId.includes(detailSourceId),
  );
};

const matchDetailMetricId = (detailMetricId: string | undefined, metricIds: string[]) => {
  if (!metricIds.length || !detailMetricId) {
    return true;
  }

  return metricIds.includes(detailMetricId);
};

const matchDetailPeriodKey = (detailPeriodKey: string | undefined, pointKey: string) => {
  if (!detailPeriodKey) {
    // Missing period must not dump every entity into an hour/day cell drill-down.
    return false;
  }

  if (detailPeriodKey === pointKey) {
    return true;
  }

  // Hour columns: compare date+hour. Date-only fallback wrongly includes the whole day
  // (e.g. cell "16:00 → 8" opened 200+ missed calls from 17:xx–18:xx).
  if (hasHourPrecisionPeriodKey(detailPeriodKey) || hasHourPrecisionPeriodKey(pointKey)) {
    return periodMatchKey(detailPeriodKey) === periodMatchKey(pointKey);
  }

  return normalizePeriodKey(detailPeriodKey) === normalizePeriodKey(pointKey);
};

const normalizeDetailEntityType = (value: string | undefined): BitrixEntityType | null => {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  const supportedTypes: BitrixEntityType[] = [
    'deal',
    'lead',
    'invoice',
    'quote',
    'company',
    'contact',
    'task',
    'activity',
    'call',
    'email',
    'message',
    'crm_form',
  ];

  return supportedTypes.includes(normalized as BitrixEntityType)
    ? normalized as BitrixEntityType
    : null;
};

const buildBackendDetailRows = (
  details: MetricDetailItem[],
  context: DetailContext,
): DetailRow[] =>
  details
    .filter((detail) => {
      const sourceDetailIds = context.detailSourceIds ?? [];
      const sourceMetricIds = context.detailMetricIds ?? [];

      // For source_metric rows: filter by detailSourceIds AND detailMetricIds
      if (sourceDetailIds.length > 0 || sourceMetricIds.length > 0) {
        const sourceIds = sourceDetailIds.length > 0
          ? sourceDetailIds
          : context.sourceId
            ? [context.sourceId]
            : [];

        // Source must match one of the detailSourceIds
        if (!matchDetailSourceId(detail.sourceId, sourceIds)) {
          return false;
        }

        // Metric must match one of the detailMetricIds (if specified)
        if (!matchDetailMetricId(detail.metricId, sourceMetricIds)) {
          return false;
        }

        // Period must match
        if (!matchDetailPeriodKey(detail.periodKey, context.point.key)) {
          return false;
        }

        // Employee filter if present
        if (context.employee && detail.employeeId && detail.employeeId !== context.employee.id) {
          return false;
        }

        return true;
      }

      // For standard metric rows: use the original logic
      if (!context.sourceId) {
        if (detail.metricId && detail.metricId !== context.metric.id) {
          return false;
        }
      }

      if (!matchDetailPeriodKey(detail.periodKey, context.point.key)) {
        return false;
      }

      if (context.employee && detail.employeeId && detail.employeeId !== context.employee.id) {
        return false;
      }

      if (context.sourceId && detail.sourceId && detail.sourceId !== context.sourceId) {
        return false;
      }

      // When deal-default + funnel are both loaded, section details must use only
      // deal-default rows so the popup matches deals_* aggregates (no double-count).
      // Funnel drill-down still works via detailSourceIds above.
      if (
        detail.sourceId
        && detail.sourceId.startsWith('deal-')
        && detail.sourceId !== 'deal-default'
        && details.some((item) => (
          item.sourceId === 'deal-default'
          && item.metricId === context.metric.id
          && (!item.periodKey || item.periodKey === context.point.key)
        ))
      ) {
        return false;
      }

      return true;
    })
    .map((detail, index) => {
      const createdAtDate = detail.createdAt ? new Date(detail.createdAt) : new Date(context.point.key);
      const createdAtSortValue = Number.isFinite(createdAtDate.getTime())
        ? createdAtDate.getTime()
        : index;
      const responsibleId = Number(detail.employeeId ?? context.employee?.id ?? 0);
      const isCrmFormDetail = Boolean(
        detail.sourceId?.startsWith('crm-form-')
        || context.entityType === 'crm_form',
      );
      const detailEntityId = normalizeDetailEntityRawId(
        isCrmFormDetail
          ? (detail.navigationEntityId ?? detail.entityId ?? detail.id)
          : (detail.entityId ?? detail.id),
      );
      const resolvedEntityId = detailEntityId ?? String(index + 1);

      return {
        rowNumber: index + 1,
        entityId: detailIdToNumber(resolvedEntityId, index + 1),
        entityRawId: detailEntityId,
        title: detail.title || detail.metricLabel || context.metric.label,
        linkedElementTitle: detail.linkedElementTitle || '',
        linkedElementId: detail.linkedElementId,
        linkedElementType: normalizeDetailEntityType(detail.linkedElementType) ?? undefined,
        responsibleId: Number.isFinite(responsibleId) ? responsibleId : 0,
        responsibleName: detail.responsibleName || detail.employeeName || context.employee?.name || '',
        createdAt: Number.isFinite(createdAtDate.getTime())
          ? backendDetailDateFormatter.format(createdAtDate)
          : context.point.label,
        createdAtSortValue,
        entityType: normalizeDetailEntityType(detail.entityType) ?? context.entityType,
        sourceId: detail.sourceId,
        navigationEntityId: detail.navigationEntityId,
        navigationEntityType: normalizeDetailEntityType(detail.navigationEntityType) ?? undefined,
        navigationEntityTypeId: detail.navigationEntityTypeId,
      };
    });

const areStringArraysEqual = (first: string[], second: string[]) =>
  first.length === second.length && first.every((value, index) => value === second[index]);

const readValuesByPeriod = (
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

const ZERO_VALUE_TOOLTIP = 'За этот период в системе не зарегистрировано действий';

const valueStateTooltipByReason = {
  no_data: 'Данные за этот период отсутствуют',
  load_error: 'Не удалось получить данные',
  access_denied: 'Нет доступа к данным показателя',
  not_applicable: 'Показатель неприменим',
} as const;

const resolvePeriodValueState = (
  valueStates: ValueStateMap | undefined,
  periodKey: string,
  metricIds: string | string[],
) => {
  const ids = Array.isArray(metricIds) ? metricIds : [metricIds];

  return ids.map((id) => valueStates?.[periodKey]?.[id]).find(Boolean);
};

const getValueCellDisplay = (
  value: number | undefined,
  metricType: MetricRow['type'],
  state?: ValueStateMap[string][string],
) => {
  if (state) {
    return {
      label: '—',
      tooltip: state.message || valueStateTooltipByReason[state.reason],
      hasNumericValue: false,
      accessDenied: state.reason === 'access_denied',
    };
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      label: '—',
      tooltip: valueStateTooltipByReason.no_data,
      hasNumericValue: false,
      accessDenied: false,
    };
  }

  return {
    label: formatMetricValue(value, metricType),
    tooltip: value === 0 ? ZERO_VALUE_TOOLTIP : undefined,
    hasNumericValue: true,
    accessDenied: false,
  };
};

/** True when a cell shows a real non-zero number (not 0 and not «—»). */
const isNonZeroPeriodValue = (
  value: number | undefined,
  state?: ValueStateMap[string][string],
) => {
  if (state) {
    return false;
  }

  return typeof value === 'number' && Number.isFinite(value) && value !== 0;
};

const reportRowHasNonZeroValues = (
  points: ReportPoint[],
  readValue: (point: ReportPoint) => number | undefined,
  readState?: (point: ReportPoint) => ValueStateMap[string][string] | undefined,
) => points.some((point) => isNonZeroPeriodValue(readValue(point), readState?.(point)));

const getValueCellOpenTooltip = (
  value: number | undefined,
  metricLabel: string,
  metricType: MetricRow['type'],
  display: ReturnType<typeof getValueCellDisplay>,
  threshold?: ThresholdValues,
  direction: MetricDirection = 'none',
) => {
  // F-16: 0 and «—» keep distinct tooltips; never infer presence/absence at work.
  if (display.accessDenied) {
    return 'Нет доступа';
  }

  if (!display.hasNumericValue) {
    return display.tooltip ?? valueStateTooltipByReason.no_data;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return display.tooltip ?? valueStateTooltipByReason.no_data;
  }

  if (value === 0) {
    return appendThresholdTooltip(ZERO_VALUE_TOOLTIP, value, threshold, direction) ?? ZERO_VALUE_TOOLTIP;
  }

  const openTooltip = formatOpenDetailTooltip(value, metricLabel, metricType);

  return appendThresholdTooltip(openTooltip, value, threshold, direction) ?? openTooltip;
};

const getEmployeePeriodMetricValue = (
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

const buildEmployeeChartValuesByPeriod = (
  employee: ReportEmployee,
  reportData: ReportPoint[],
  metricId: string,
) =>
  Object.fromEntries(
    reportData.map((point) => [
      point.key,
      getEmployeePeriodMetricValue(employee, point, metricId),
    ]),
  );

const buildEmployeeThresholdValues = (
  metricId: string,
  employees: ReportEmployee[],
  selectedEmployeeIds: Set<string> | undefined,
  reportData: ReportPoint[],
  valueStates?: ValueStateMap,
  stateMetricIds: string[] = [metricId],
) => {
  if (!selectedEmployeeIds || selectedEmployeeIds.size === 0) {
    return [];
  }

  return employees
    .filter((employee) => selectedEmployeeIds.has(employee.id))
    .flatMap((employee) =>
      reportData.map((point) =>
        toCorridorValue(
          getEmployeePeriodMetricValue(employee, point, metricId),
          resolvePeriodValueState(valueStates, point.key, stateMetricIds),
        ),
      ),
    );
};

/** Build per-employee period values for a funnel/smart source_metric from details. */
const buildSourceMetricEmployees = (
  details: MetricDetailItem[],
  detailSourceIds: string[],
  detailMetricIds: string[],
  knownEmployees: ReportEmployee[],
): ReportEmployee[] => {
  if (!detailSourceIds.length && !detailMetricIds.length) {
    return [];
  }

  const sourceIds = detailSourceIds.map(String);
  const metricIds = detailMetricIds.map(String);
  const knownById = new Map(knownEmployees.map((employee) => [employee.id, employee]));
  const byEmployee = new Map<string, { name: string; valuesByPeriod: Record<string, Record<string, number>> }>();

  details.forEach((detail) => {
    const employeeId = detail.employeeId?.trim();
    if (!employeeId) {
      return;
    }

    if (!matchDetailSourceId(detail.sourceId, sourceIds)) {
      return;
    }

    if (!matchDetailMetricId(detail.metricId, metricIds)) {
      return;
    }

    const periodKey = detail.periodKey?.trim();
    if (!periodKey) {
      return;
    }

    const metricId = detail.metricId || 'value';
    const rawValue = typeof detail.value === 'number' ? detail.value : Number(detail.value);
    const value = Number.isFinite(rawValue) ? rawValue : 0;
    const known = knownById.get(employeeId);
    const name = detail.employeeName || detail.responsibleName || known?.name || employeeId;
    const storageKeys = Array.from(new Set([periodKey, normalizePeriodKey(periodKey)]));

    const entry = byEmployee.get(employeeId) ?? {
      name,
      valuesByPeriod: {},
    };

    storageKeys.forEach((key) => {
      if (!entry.valuesByPeriod[key]) {
        entry.valuesByPeriod[key] = {};
      }
      entry.valuesByPeriod[key][metricId] = (entry.valuesByPeriod[key][metricId] ?? 0) + value;
    });

    if (detail.employeeName || detail.responsibleName) {
      entry.name = name;
    }

    byEmployee.set(employeeId, entry);
  });

  return Array.from(byEmployee.entries()).map(([id, entry]) => {
    const known = knownById.get(id);
    const { firstName, lastName } = splitEmployeeName(entry.name);

    return {
      id,
      userId: known?.userId ?? (Number(id) || 0),
      name: entry.name,
      firstName: known?.firstName || firstName,
      lastName: known?.lastName || lastName,
      avatarUrl: known?.avatarUrl,
      valuesByPeriod: entry.valuesByPeriod,
      isActive: known?.isActive,
      isRobot: known?.isRobot ?? detectRobotByName(entry.name),
      isTechnical: known?.isTechnical,
      workPosition: known?.workPosition,
      department: known?.department,
      departmentIds: known?.departmentIds,
      departments: known?.departments,
    } satisfies ReportEmployee;
  });
};

/** Canonical action id for a funnel/smart metric — same role as catalog metric.id for CRM rows. */
const buildSourceMetricActionId = (sourceKey: string, metricKey: string) =>
  `${sourceKey}::${metricKey}`;

const buildEmployeeChartId = (metricId: string, employeeId: string) =>
  `${metricId}::${employeeId}`;

const buildSourceMetricActionIds = (
  sourceKey: string,
  metricKey: string,
  sourceData: SourceMetricsData | undefined,
) =>
  Array.from(
    new Set([
      buildSourceMetricActionId(sourceKey, metricKey),
      sourceData?.id ? `${sourceData.id}::${metricKey}` : '',
      sourceData?.sourceId ? `${sourceData.sourceId}::${metricKey}` : '',
      ...(sourceData?.detailSourceIds ?? []).map((sourceId) => `${sourceId}::${metricKey}`),
    ].filter(Boolean)),
  );

const resolveThresholdForIds = (
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

const createEmptySourceMetrics = (source: CrmSource): SourceMetricsData => {
  const isSmartProcess = source.type === 'smartProcess';
  const metrics: SourceMetricsData['metrics'] = isSmartProcess
    ? {
        created: {
          label: 'Создано',
          valueType: 'count',
          valuesByPeriod: {},
          detailMetricIds: ['smart_process_total'],
        },
        working: {
          label: 'В работе',
          valueType: 'count',
          valuesByPeriod: {},
          detailMetricIds: ['smart_process_working'],
        },
        success: {
          label: 'Завершено',
          valueType: 'count',
          valuesByPeriod: {},
          detailMetricIds: ['smart_process_success'],
        },
        failed: {
          label: 'Проиграно',
          valueType: 'count',
          valuesByPeriod: {},
          detailMetricIds: ['smart_process_failed'],
        },
        success_sum: {
          label: 'Сумма',
          valueType: 'money',
          valuesByPeriod: {},
          detailMetricIds: ['smart_process_success_sum'],
        },
        conversion: {
          label: 'Конверсия',
          valueType: 'percent',
          valuesByPeriod: {},
          detailMetricIds: ['smart_process_success', 'smart_process_total'],
        },
      }
    : {
        created: {
          label: 'Создано',
          valueType: 'count',
          valuesByPeriod: {},
          detailMetricIds: ['deals_created'],
        },
        won: {
          label: 'Успешных',
          valueType: 'count',
          valuesByPeriod: {},
          detailMetricIds: ['deals_won'],
        },
        lost: {
          label: 'Проигранных',
          valueType: 'count',
          valuesByPeriod: {},
          detailMetricIds: ['deals_lost'],
        },
        won_sum: {
          label: 'Сумма успешных',
          valueType: 'money',
          valuesByPeriod: {},
          detailMetricIds: ['deals_won_sum'],
        },
        lost_sum: {
          label: 'Сумма проигранных',
          valueType: 'money',
          valuesByPeriod: {},
          detailMetricIds: ['deals_lost_sum'],
        },
        conversion: {
          label: 'Конверсия',
          valueType: 'percent',
          valuesByPeriod: {},
          detailMetricIds: ['deals_won', 'deals_created'],
        },
      };

  return {
    id: source.id,
    label: source.title,
    entityTypeId: source.entityTypeId ?? (source.type === 'deal' ? 2 : 0),
    categoryId: source.categoryId ?? null,
    type: source.type,
    sourceId: source.id,
    detailSourceIds: [source.id],
    metrics,
  };
};

/** Remap detail metric keys onto the canonical action id so CRM employee value helpers work unchanged. */
const remapEmployeeValuesToMetricId = (
  employee: ReportEmployee,
  fromMetricIds: string[],
  toMetricId: string,
): ReportEmployee => {
  const metricIds = fromMetricIds.length > 0 ? fromMetricIds : ['value'];
  const valuesByPeriod: Record<string, Record<string, number>> = {};

  Object.entries(employee.valuesByPeriod ?? {}).forEach(([periodKey, periodValues]) => {
    const sum = metricIds.reduce((total, metricId) => total + (periodValues[metricId] ?? 0), 0);
    valuesByPeriod[periodKey] = { [toMetricId]: sum };
  });

  return {
    ...employee,
    valuesByPeriod,
  };
};

const CRM_ENTITY_SOURCE_GROUP = 'crm-сущности';
const PIPELINE_SOURCE_GROUP = 'воронки и смарт процессы';
const CRM_SOURCE_TYPE_ORDER: Partial<Record<CrmSourceType, number>> = {
  lead: 10,
  invoice: 20,
  quote: 30,
  company: 40,
  contact: 50,
  task: 60,
  activity: 70,
  telephony: 80,
  call: 90,
  email: 100,
  message: 110,
  crm_form: 120,
  other: 130,
  deal: 1000,
  smartProcess: 1010,
};

const CRM_SOURCE_TYPE_TO_SECTION_ID: Partial<Record<CrmSourceType, string>> = {
  lead: 'leads',
  invoice: 'invoices',
  quote: 'quotes',
  company: 'companies',
  contact: 'companies',
  task: 'tasks',
  telephony: 'calls',
  call: 'calls',
  email: 'email',
  message: 'messages',
  crm_form: 'crm_forms',
  activity: 'activities',
};

const SECTION_ID_TO_ENTITY_SOURCE_IDS: Record<string, string[]> = {
  deals: ['deal-default'],
  leads: ['lead-default'],
  invoices: ['invoice-default'],
  quotes: ['quote-default'],
  companies: ['company-default', 'contact-default'],
  calls: ['telephony-default'],
  crm_forms: ['crm-form-default'],
  tasks: ['task-default'],
  activities: ['activity-default'],
};

const ENTITY_SOURCE_ID_TO_SECTION_ID = Object.fromEntries(
  Object.entries(SECTION_ID_TO_ENTITY_SOURCE_IDS).flatMap(([sectionId, sourceIds]) =>
    sourceIds.map((sourceId) => [sourceId, sectionId]),
  ),
);

const resolveRetrySourceIdsForSection = (
  sectionId: string,
  crmSources: CrmSource[],
  selectedSourceIds: string[],
): string[] => {
  const selected = new Set(selectedSourceIds);
  const matched = new Set<string>();
  const defaults = SECTION_ID_TO_ENTITY_SOURCE_IDS[sectionId] ?? [];

  defaults.forEach((sourceId) => {
    matched.add(sourceId);
  });

  if (sectionId === 'messages' || sectionId === 'email') {
    matched.add('activity-default');
  }

  crmSources.forEach((source) => {
    if (!selected.has(source.id) && !defaults.includes(source.id)) {
      return;
    }

    const mappedSection = CRM_SOURCE_TYPE_TO_SECTION_ID[source.type];
    if (mappedSection === sectionId) {
      matched.add(source.id);
      return;
    }

    if (sectionId === 'deals' && source.type === 'deal') {
      matched.add(source.id);
      return;
    }

    if (
      (sectionId === 'contracts' || sectionId === 'smart_processes' || sectionId === 'activities')
      && source.type === 'smartProcess'
      && selected.has(source.id)
    ) {
      matched.add(source.id);
    }
  });

  const preferred = [...matched].filter((sourceId) => selected.has(sourceId));
  return preferred.length > 0 ? preferred : [...matched];
};

const isDealEntitySource = (source: CrmSource) => (
  source.id === 'deal-default'
  || (source.type === 'deal' && (source.categoryId === null || source.categoryId === undefined))
);

const isDealPipelineSource = (source: CrmSource) => (
  source.type === 'deal' && !isDealEntitySource(source)
);

const getSourceGroup = (source: CrmSource) => (
  isDealEntitySource(source)
    ? CRM_ENTITY_SOURCE_GROUP
    : source.type === 'deal' || source.type === 'smartProcess'
      ? PIPELINE_SOURCE_GROUP
      : CRM_ENTITY_SOURCE_GROUP
);

const getSourceGroupRank = (source: CrmSource) => (
  isDealEntitySource(source)
    ? 0
    : source.type === 'deal' || source.type === 'smartProcess'
      ? 1
      : 0
);

const entitySourceIdsForSections = (sectionIds: Iterable<string>) => {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const sectionId of sectionIds) {
    const sourceIds = SECTION_ID_TO_ENTITY_SOURCE_IDS[sectionId] ?? [];
    sourceIds.forEach((sourceId) => {
      if (!seen.has(sourceId)) {
        seen.add(sourceId);
        ids.push(sourceId);
      }
    });
  }

  return ids;
};

const resolveSavedTableSelectionFromSourceIds = (
  selectedSourceIds: string[],
  availableSectionIds: Set<string>,
) => {
  const sectionIds = new Set<string>();
  const pipelineSourceIds: string[] = [];
  const entitySourceIds: string[] = [];
  const seenPipelines = new Set<string>();
  const seenEntities = new Set<string>();

  selectedSourceIds.forEach((sourceId) => {
    if (sourceId !== 'deal-default' && (sourceId.startsWith('deal-') || sourceId.startsWith('smart-'))) {
      if (!seenPipelines.has(sourceId)) {
        seenPipelines.add(sourceId);
        pipelineSourceIds.push(sourceId);
      }
      return;
    }

    const sectionId = ENTITY_SOURCE_ID_TO_SECTION_ID[sourceId];
    if (sectionId && availableSectionIds.has(sectionId)) {
      sectionIds.add(sectionId);
      if (!seenEntities.has(sourceId)) {
        seenEntities.add(sourceId);
        entitySourceIds.push(sourceId);
      }
    }
  });

  return { sectionIds, pipelineSourceIds, entitySourceIds };
};

const resolveTableSelectionFromSources = (
  selectedSourceIds: string[],
  crmSources: CrmSource[],
  availableSectionIds: Set<string>,
) => {
  const sourceById = new Map(crmSources.map((source) => [source.id, source]));
  const sectionIds = new Set<string>();
  const pipelineSourceIds: string[] = [];
  const entitySourceIds: string[] = [];
  const seenPipelines = new Set<string>();
  const seenEntities = new Set<string>();

  selectedSourceIds.forEach((sourceId) => {
    const source = sourceById.get(sourceId);

    if (!source) {
      return;
    }

    if (isDealEntitySource(source)) {
      if (availableSectionIds.has('deals')) {
        sectionIds.add('deals');
      }
      if (!seenEntities.has(source.id)) {
        seenEntities.add(source.id);
        entitySourceIds.push(source.id);
      }
      return;
    }

    if (isDealPipelineSource(source) || source.type === 'smartProcess') {
      if (!seenPipelines.has(source.id)) {
        seenPipelines.add(source.id);
        pipelineSourceIds.push(source.id);
      }
      return;
    }

    const sectionId = CRM_SOURCE_TYPE_TO_SECTION_ID[source.type];
    if (sectionId && availableSectionIds.has(sectionId)) {
      sectionIds.add(sectionId);
    }
    if (!seenEntities.has(source.id)) {
      seenEntities.add(source.id);
      entitySourceIds.push(source.id);
    }
  });

  return { sectionIds, pipelineSourceIds, entitySourceIds };
};

/** Keep preferred order; append any new ids that are not yet listed. */
const mergeIdOrder = (preferred: string[], available: string[]) => {
  const availableSet = new Set(available);
  const ordered = preferred.filter((id) => availableSet.has(id));
  const seen = new Set(ordered);

  available.forEach((id) => {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  });

  return ordered;
};

const cloneSetRecord = (record: Record<string, Set<string>>) =>
  Object.fromEntries(
    Object.entries(record).map(([key, values]) => [key, new Set(values)]),
  );

const serializeSetRecord = (record: Record<string, Set<string>>) =>
  Object.fromEntries(
    Object.entries(record).map(([key, values]) => [key, [...values]]),
  );

const deserializeSetRecord = (record?: Record<string, string[]>) => {
  if (!record || typeof record !== 'object') {
    return {} as Record<string, Set<string>>;
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, values]) => [
      key,
      new Set(Array.isArray(values) ? values.map(String) : []),
    ]),
  );
};

const serializeStringArrayRecord = (record: Record<string, string[]>) =>
  Object.fromEntries(
    Object.entries(record).map(([key, values]) => [key, [...values]]),
  );

const deserializeStringArrayRecord = (record?: Record<string, string[]>) => {
  if (!record || typeof record !== 'object') {
    return {} as Record<string, string[]>;
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, values]) => [
      key,
      Array.isArray(values) ? values.map(String) : [],
    ]),
  );
};

const isCrmSourceAvailable = (_source: CrmSource) => true;

const getCrmSourceDisplayLabel = (source: CrmSource) =>
  (source.sourceLabel || source.title || source.id).trim();

const createAutomaticEnabledMetricIdsBySection = (sections: MetricSection[]) => {
  const configured = AUTOMATIC_REPORT_PRESET.metricIdsBySection;

  return sections.reduce<Record<string, Set<string>>>((acc, section) => {
    const preferred = configured?.[section.id];
    if (preferred && preferred.length > 0) {
      const allowed = new Set(section.metricIds);
      acc[section.id] = new Set(preferred.filter((metricId) => allowed.has(metricId)));
      return acc;
    }

    acc[section.id] = new Set(section.metricIds);
    return acc;
  }, {});
};

const createAutomaticSectionOrder = (sections: MetricSection[]) => {
  const priority = AUTOMATIC_REPORT_PRESET.sectionOrderPriority.filter((sectionId) =>
    sections.some((section) => section.id === sectionId),
  );
  const prioritySet = new Set(priority);
  return [
    ...priority,
    ...sections.map((section) => section.id).filter((id) => !prioritySet.has(id)),
  ];
};

const resolveAutomaticSalesSource = (crmSources: CrmSource[]) => {
  const dealPipelineSources = crmSources.filter(isDealPipelineSource);
  const availableDealPipelines = dealPipelineSources.filter(isCrmSourceAvailable);

  return (
    availableDealPipelines.find((source) => source.id === 'deal-0' || source.categoryId === 0) ??
    availableDealPipelines.find((source) => {
      const label = `${source.sourceLabel} ${source.title}`.toLocaleLowerCase('ru-RU');
      return label.includes('продаж');
    }) ??
    availableDealPipelines[0] ??
    null
  );
};

const resolveAutomaticReportSections = (sections: MetricSection[]) => {
  const configuredSectionIds = AUTOMATIC_REPORT_PRESET.sectionIds;
  if (!configuredSectionIds || configuredSectionIds.length === 0) {
    return sections;
  }

  const allowed = new Set(configuredSectionIds);
  return sections.filter((section) => allowed.has(section.id));
};

const buildAutomaticReportPreset = (
  crmSources: CrmSource[],
  crmSourceIds: string[],
  sections: MetricSection[],
) => {
  const salesSource = resolveAutomaticSalesSource(crmSources);

  if (!salesSource) {
    return null;
  }

  const selectedSections = resolveAutomaticReportSections(sections);
  if (!selectedSections.length) {
    return null;
  }

  const sourceById = new Map(crmSources.map((source) => [source.id, source]));
  const preferredEntitySourceIds = AUTOMATIC_REPORT_PRESET.preferredEntitySourceIds;
  const candidateSourceIds = preferredEntitySourceIds && preferredEntitySourceIds.length > 0
    ? [
        salesSource.id,
        ...preferredEntitySourceIds.filter((id) => id !== salesSource.id),
      ]
    : [
        salesSource.id,
        ...crmSourceIds.filter((id) => id !== salesSource.id),
      ];

  const skippedUnavailable = candidateSourceIds
    .map((id) => sourceById.get(id))
    .filter((source): source is CrmSource => source != null && !isCrmSourceAvailable(source));

  // Auto mode uses only available portal sources; one unavailable source must not block the rest.
  const allTableSources = candidateSourceIds.filter((id) => {
    const source = sourceById.get(id);
    return Boolean(source && isCrmSourceAvailable(source));
  });

  // Currently only one strategy; kept on AUTOMATIC_REPORT_PRESET for future variants.
  const dateRange = getPreviousWeekFromYesterdayRange();
  const chartSources = [salesSource.id];
  const availableSectionIds = new Set(selectedSections.map((section) => section.id));
  const { pipelineSourceIds, entitySourceIds } = resolveTableSelectionFromSources(
    allTableSources,
    crmSources,
    availableSectionIds,
  );

  return {
    salesSource,
    dateRange,
    chartSources,
    allTableSources,
    pipelineSourceIds,
    entitySourceIds,
    tablePreviewSourceIds: Array.from(new Set([...pipelineSourceIds, ...entitySourceIds])),
    enabledSectionIds: availableSectionIds,
    enabledMetricIdsBySection: createAutomaticEnabledMetricIdsBySection(selectedSections),
    sectionOrder: createAutomaticSectionOrder(selectedSections),
    skippedUnavailableLabels: skippedUnavailable.map(getCrmSourceDisplayLabel).filter(Boolean),
    chartMetricMode: AUTOMATIC_REPORT_PRESET.chartMetricMode,
    chartDisplayMode: AUTOMATIC_REPORT_PRESET.chartDisplayMode,
  };
};

function App() {
  // Hydration guards: prevent auto-save until settings are fully loaded/applied
  const settingsHydratedRef = useRef(false);
  const applyingBackendSettingsRef = useRef(false);
  const reportSettingsInitializedRef = useRef(false);
  const lastAppliedReportAccessRef = useRef<boolean | null>(null);
  const userTouchedReportSettingsRef = useRef(false);
  const suppressReportSettingsTouchRef = useRef(false);
  const hasObservedReportSettingsStateRef = useRef(false);
  // Skip Pro auto-save while applying one-shot "Построить автоматически" presets.
  // Cleared when that auto-build generation finishes (not via a fixed timer).
  const skipAutoSaveRef = useRef(false);
  const temporaryAutoReportModeRef = useRef(false);
  // After rebuild, re-expand row charts if user kept "with_charts" mode.
  // Wait for a full loading cycle (true → false) so we expand against fresh metrics.
  const pendingExpandRowChartsRef = useRef(false);
  const sawReportLoadingForExpandRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const immediateAutoSaveRef = useRef(false);
  const autoBuildGenerationRef = useRef(0);
  const activeAutoBuildGenerationRef = useRef<number | null>(null);
  const dateRangeSelectedManuallyRef = useRef(false);
  // Chart sources locked for the active auto-build (Sales funnel only).
  // Re-applied after preview so late Pro hydration cannot restore other chart checkboxes.
  const autoBuildChartSourcesRef = useRef<string[] | null>(null);
  // Table sources locked for the active auto-build (all table settings sources).
  // Used in preview request so chart-only selectedSources cannot starve sourceMetrics.
  const autoBuildTableSourcesRef = useRef<string[] | null>(null);
  const autoBuildDateFiltersRef = useRef<Pick<ReportFilters, 'period' | 'dateRange'> | null>(null);
  const manualDateFiltersBeforeAutoRef = useRef<Pick<ReportFilters, 'period' | 'dateRange'> | null>(null);
  // F-06: summary toast after automatic preset finishes loading.
  const pendingAutoBuildSummaryRef = useRef<{
    generation: number;
    mainIndicatorLabel: string;
    skippedUnavailableLabels: string[];
    wantCorridors: boolean;
    corridorMetricsCount?: number;
  } | null>(null);

  const [savedViews, setSavedViews] = useState<SavedReportViewOption[]>(() => [defaultSavedView]);
  const [selectedView, setSelectedView] = useState('default');
  const [draftFilters, setDraftFilters] = useState<ReportFilters>(() => createDefaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<ReportFilters>(() => createDefaultFilters());
  // Separate state for table settings — these are the sources the user selected
  // specifically in "Выбрать показатели". They are NOT the same as chart sources.
  // tableRows uses ONLY these to decide which source sections to show.
  const [tableSelectedSources, setTableSelectedSources] = useState<string[]>([]);
  const [draftTableSelectedSources, setDraftTableSelectedSources] = useState<string[]>([]);
  // CRM-entity source ids selected in table settings (deal-default, lead-default, ...).
  // Kept separate from pipeline tableSelectedSources so sourceMetrics rows stay funnel-only.
  const [tableEntitySourceIds, setTableEntitySourceIds] = useState<string[]>([]);
  const [periodOptions, setPeriodOptions] = useState(defaultPeriodOptions);
  const [metricSections, setMetricSections] = useState(defaultMetricSections);
  const [metrics, setMetrics] = useState(defaultMetrics);
  const [crmSources, setCrmSources] = useState<CrmSource[]>(() =>
    reportDataSource.getInitialCrmSources(),
  );
  const [rawReportData, setRawReportData] = useState<ReportPoint[]>(() => {
    const filters = createDefaultFilters();
    return reportDataSource.getInitialReportData({
      period: filters.period,
      dateRange: filters.dateRange,
      selectedSources: filters.selectedSources,
      metricMode: filters.metricMode,
      chartDisplayMode: filters.chartDisplayMode,
    });
  });
  const [rawChartReportData, setRawChartReportData] = useState<ReportPoint[]>(() => {
    const filters = createDefaultFilters();
    return reportDataSource.getInitialReportData({
      period: filters.period,
      dateRange: filters.dateRange,
      selectedSources: filters.selectedSources,
      metricMode: filters.metricMode,
      chartDisplayMode: filters.chartDisplayMode,
    });
  });
  const [reportEmployees, setReportEmployees] = useState<ReportEmployee[]>([]);
  const [portalEmployees, setPortalEmployees] = useState<PortalEmployeeItem[]>([]);
  const [reportDetails, setReportDetails] = useState<MetricDetailItem[]>([]);
  const [sourceMetrics, setSourceMetrics] = useState<Record<string, SourceMetricsData>>({});
  const [chartSourceMetrics, setChartSourceMetrics] = useState<Record<string, SourceMetricsData>>({});
  const [valueStates, setValueStates] = useState<ValueStateMap>({});
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportElapsed, setReportElapsed] = useState('');
  const [reportBuildStage, setReportBuildStage] = useState<ReportBuildStageLabel>('Получаем данные');
  const [reportError, setReportError] = useState('');
  const [sectionRetryingId, setSectionRetryingId] = useState<string | null>(null);
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [isProOpen, setIsProOpen] = useState(false);
  const [isInstructionOpen, setIsInstructionOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [onboardingStepIndex, setOnboardingStepIndex] = useState(0);
  const onboardingAutoShownRef = useRef(false);
  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false);
  const [isFreeLimitOpen, setIsFreeLimitOpen] = useState(false);
  const [billingHasPro, setBillingHasPro] = useState(false);
  const [billingValidUntil, setBillingValidUntil] = useState<string | null>(null);
  const [billingIsLifetime, setBillingIsLifetime] = useState(false);
  const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([]);
  const [billingError, setBillingError] = useState('');
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingInitialized, setBillingInitialized] = useState(false);
  const [billingLoadFailed, setBillingLoadFailed] = useState(false);
  const [billingCustomerEmail, setBillingCustomerEmail] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [deleteViewId, setDeleteViewId] = useState<string | null>(null);
  const [notification, setNotification] = useState('');
  const [pdfExporting, setPdfExporting] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
  const [newViewName, setNewViewName] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  // F-11: local UI toggle — does not affect saved report settings.
  const [showTrendLine, setShowTrendLine] = useState(true);
  const [hasBuiltReport, setHasBuiltReport] = useState(false);
  const [buildMoment, setBuildMoment] = useState(0);
  const [autoSaveRequest, setAutoSaveRequest] = useState(0);
  // reportBuildRequest is a counter that increments ONLY when the user explicitly
  // clicks "Построить отчет" or "Построить автоматически". The loadReportPreview
  // useEffect depends ONLY on this counter (plus hasBuiltReport as a guard),
  // NOT on appliedFilters or other UI state changes.
  const [reportBuildRequest, setReportBuildRequest] = useState(0);
  const [periodColumnWidth, setPeriodColumnWidth] = useState(PERIOD_COLUMN_WIDTH);
  const [mainThreshold, setMainThreshold] = useState<ThresholdValues>({
    upper: '',
    lower: '',
    mode: null,
  });
  const [activeMainChartPoint, setActiveMainChartPoint] = useState<ActiveChartPoint | null>(null);
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);
  const [detailContext, setDetailContext] = useState<DetailContext | null>(null);
  const [expandedEmployeeMetricIds, setExpandedEmployeeMetricIds] = useState<Set<string>>(() => new Set());
  const [draftEmployeeIdsByMetricId, setDraftEmployeeIdsByMetricId] = useState<Record<string, Set<string>>>({});
  const [appliedEmployeeIdsByMetricId, setAppliedEmployeeIdsByMetricId] = useState<Record<string, Set<string>>>({});
  const [employeeOrderByMetricId, setEmployeeOrderByMetricId] = useState<Record<string, string[]>>({});
  const [expandedChartMetricIds, setExpandedChartMetricIds] = useState<Set<string>>(() => new Set());
  const [expandedEmployeeChartIds, setExpandedEmployeeChartIds] = useState<Set<string>>(() => new Set());
  const [tableRowChartsMode, setTableRowChartsMode] = useState<TableRowChartsMode>('compact');
  const [hideZeroRows, setHideZeroRows] = useState(false);

  const suppressNextReportSettingsTouch = useCallback(() => {
    suppressReportSettingsTouchRef.current = true;
  }, []);
  const [rowThresholds, setRowThresholds] = useState<Record<string, ThresholdValues>>({});
  const [employeeThresholdsByMetricId, setEmployeeThresholdsByMetricId] = useState<Record<string, ThresholdValues>>({});
  // F-09: user overrides only; staff defaults come from resolveMetricDirection().
  const [metricDirectionsById, setMetricDirectionsById] = useState<Record<string, MetricDirection>>({});
  const mainThresholdRef = useRef(mainThreshold);
  const rowThresholdsRef = useRef(rowThresholds);
  const employeeThresholdsRef = useRef(employeeThresholdsByMetricId);
  mainThresholdRef.current = mainThreshold;
  rowThresholdsRef.current = rowThresholds;
  employeeThresholdsRef.current = employeeThresholdsByMetricId;
  const [enabledMetricIdsBySection, setEnabledMetricIdsBySection] = useState<Record<string, Set<string>>>(
    () =>
      metricSections.reduce<Record<string, Set<string>>>((acc, section) => {
        acc[section.id] = new Set();
        return acc;
      }, {}),
  );
  const [appliedEnabledMetricIdsBySection, setAppliedEnabledMetricIdsBySection] = useState<Record<string, Set<string>>>(
    () =>
      metricSections.reduce<Record<string, Set<string>>>((acc, section) => {
        acc[section.id] = new Set();
        return acc;
      }, {}),
  );
  const [sectionOrder, setSectionOrder] = useState<string[]>(
    () => metricSections.map((section) => section.id),
  );
  const [metricOrderBySection, setMetricOrderBySection] = useState<Record<string, string[]>>(
    () =>
      metricSections.reduce<Record<string, string[]>>((acc, section) => {
        acc[section.id] = section.metricIds;
        return acc;
      }, {}),
  );
  // Display-only order for funnel/smart source_section blocks (not CRM sections).
  const [sourceSectionOrder, setSourceSectionOrder] = useState<string[]>([]);
  // After "Построить автоматически": pin this catalog source id (e.g. deal-0) as the
  // first block in the whole table. Cleared on regular build / reset — not used otherwise.
  const [tableLeadingSourceId, setTableLeadingSourceId] = useState<string | null>(null);
  // F-05: corridor highlight is an option for «Построить отчёт»;
  // «Построить автоматически» is a separate one-shot action.
  const [highlightDeviations, setHighlightDeviations] = useState(false);
  // WEB-SET-001: left-zone settings panel / auto confirm / paid custom title.
  const [isIndicatorsSettingsOpen, setIsIndicatorsSettingsOpen] = useState(false);
  const [isAutoSetupConfirmOpen, setIsAutoSetupConfirmOpen] = useState(false);
  const [indicatorsSettingsDraft, setIndicatorsSettingsDraft] = useState<IndicatorsSettingsDraft | null>(null);
  const [mainIndicatorCustomTitle, setMainIndicatorCustomTitle] = useState('');
  const [sourceMetricOrderBySource, setSourceMetricOrderBySource] = useState<Record<string, string[]>>({});
  // Visibility of metrics inside source blocks (separate from CRM enabledMetricIdsBySection).
  const [enabledMetricKeysBySource, setEnabledMetricKeysBySource] = useState<Record<string, Set<string>>>({});
  const [appliedEnabledMetricKeysBySource, setAppliedEnabledMetricKeysBySource] = useState<Record<string, Set<string>>>({});
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(metricSections.map((section) => section.id)),
  );
  const [expandedSourceSections, setExpandedSourceSections] = useState<Set<string>>(() => new Set());
  const isProUser = billingHasPro;

  const settingsEmployees = useMemo<ReportEmployee[]>(
    () =>
      portalEmployees.length > 0
        ? portalEmployees.map((employee) => ({
            ...employee,
            userId: Number(employee.id) || 0,
            avatarUrl: employee.avatarUrl ?? undefined,
            isActive: employee.isActive ?? true,
            isRobot: employee.isRobot ?? false,
            isTechnical: employee.isTechnical ?? false,
            workPosition: employee.workPosition ?? null,
            department: employee.department ?? null,
            departmentIds: employee.departmentIds ?? [],
            departments: employee.departments ?? [],
          }))
        : reportEmployees,
    [portalEmployees, reportEmployees],
  );

  const availableEmployees = useMemo<ReportEmployee[]>(
    () => enrichEmployeesWithDirectory(reportEmployees, portalEmployees),
    [portalEmployees, reportEmployees],
  );

  const horizontalScrollbarRef = useRef<HTMLDivElement>(null);
  const reportCardRef = useRef<HTMLElement>(null);
  const mainChartWrapRef = useRef<HTMLDivElement>(null);
  const chartContentRef = useRef<HTMLDivElement>(null);
  const periodContentRef = useRef<HTMLDivElement>(null);
  const tableContentRef = useRef<HTMLDivElement>(null);
  const detailScrollSnapshotRef = useRef<{
    horizontal: number;
    reportCard: number;
    windowY: number;
  } | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const scrollSyncFrameRef = useRef<number | null>(null);
  const pendingScrollLeftRef = useRef(0);
  const holdDelayRef = useRef<number | null>(null);
  const holdActiveRef = useRef(false);
  const applyAutomaticThresholdsRef = useRef(false);
  const canScrollBackRef = useRef(false);
  const canScrollForwardRef = useRef(false);
  const draggedMetricRef = useRef<{ sectionId: string; metricId: string } | null>(null);
  const draggedSectionRef = useRef<string | null>(null);
  const draggedSourceSectionRef = useRef<string | null>(null);
  const draggedSourceMetricRef = useRef<{ sourceId: string; metricKey: string } | null>(null);
  const draggedEmployeeRef = useRef<{ metricId: string; employeeId: string } | null>(null);
  const reportStartTimeRef = useRef<number>(0);
  const reportLoadingRef = useRef(false);
  const sectionRetryInFlightRef = useRef(false);
  const hasExistingReportDataRef = useRef(false);
  const cancelPendingAutoSave = useCallback(() => {
    if (!autoSaveTimerRef.current) {
      return;
    }

    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
  }, []);
  const resetTemporaryReportUiState = useCallback(() => {
    setExpandedEmployeeMetricIds(new Set());
    setExpandedChartMetricIds(new Set());
    setExpandedEmployeeChartIds(new Set());
    // Keep tableRowChartsMode / hideZeroRows — user preference across rebuilds.
    setDetailContext(null);
    setTableLeadingSourceId(null);
  }, []);

  const upperThresholdNumber = useMemo(() => parseThreshold(mainThreshold.upper), [mainThreshold.upper]);
  const lowerThresholdNumber = useMemo(() => parseThreshold(mainThreshold.lower), [mainThreshold.lower]);
  const averageThresholdNumber = useMemo(
    () => resolveDisplayedThresholdAverage(mainThreshold),
    [mainThreshold],
  );
  const corridorCalculationPeriodLabel = useMemo(
    () => formatRangeLabel(appliedFilters.period, appliedFilters.dateRange),
    [appliedFilters.dateRange, appliedFilters.period],
  );

  useEffect(() => {
    if (!notification || pdfExporting) {
      return undefined;
    }

    const timeoutMs = notification.length > 90 ? 9000 : 5200;
    const timeoutId = window.setTimeout(() => setNotification(''), timeoutMs);
    return () => window.clearTimeout(timeoutId);
  }, [notification, pdfExporting]);

  useEffect(() => {
    reportLoadingRef.current = reportLoading;
  }, [reportLoading]);

  const closeReportOnboarding = useCallback(() => {
    setIsOnboardingOpen(false);
    markReportOnboardingCompleted();
  }, []);

  const startReportOnboarding = useCallback(() => {
    setOnboardingStepIndex(0);
    setIsOnboardingOpen(true);
  }, []);

  useEffect(() => {
    if (!reportLoading) {
      setReportElapsed('');
      setReportBuildStage('Получаем данные');
      return undefined;
    }

    const tick = () => {
      const elapsed = Date.now() - reportStartTimeRef.current;
      const totalSeconds = Math.floor(elapsed / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const padded = (n: number) => String(n).padStart(2, '0');
      setReportElapsed(`${padded(hours)}:${padded(minutes)}:${padded(seconds)}`);
      setReportBuildStage(resolveReportBuildStage(elapsed));
    };

    tick();
    const intervalId = window.setInterval(tick, 500);
    return () => window.clearInterval(intervalId);
  }, [reportLoading]);

  const refreshBillingState = useCallback(() => {
    setBillingError('');
    setBillingLoading(true);

    return loadBillingState()
      .then((state) => {
        setBillingLoadFailed(false);
        setBillingHasPro(Boolean(state.access?.hasPro));
        setBillingValidUntil(state.access?.validUntil ?? null);
        setBillingIsLifetime(Boolean(state.access?.isLifetime));
        setBillingPlans(state.plans ?? []);
        setBillingError(state.bitrixTariff?.message ?? '');
        setBillingInitialized(true);
        return state;
      })
      .catch((error) => {
        console.warn('[Billing] state was not loaded', error);
        setBillingLoadFailed(true);
        setBillingError(getFriendlyBillingError(error));
        return null;
      })
      .finally(() => {
        setBillingLoading(false);
      });
  }, []);

  const refreshPortalEmployees = useCallback(() => {
    return reportDataSource.loadPortalEmployees()
      .then((employees) => {
        setPortalEmployees(employees);
      })
      .catch((error) => {
        console.warn('[Portal] Employees were not loaded', error);
      });
  }, []);

  useEffect(() => {
    refreshBillingState();
  }, [refreshBillingState]);

  useEffect(() => {
    if (isProOpen) {
      refreshBillingState();
    }
  }, [isProOpen, refreshBillingState]);

  useEffect(() => {
    const handleBillingRefresh = () => {
      refreshBillingState();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshBillingState();
      }
    };

    window.addEventListener('focus', handleBillingRefresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleBillingRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshBillingState]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('paymentStatus');

    if (paymentStatus === 'success') {
      setNotification('Возврат из Robokassa получен. Проверяем подтверждение оплаты.');
      refreshBillingState().then((state) => {
        if (!state) {
          return;
        }

        if (state.access?.hasPro) {
          const validUntil = state.access.validUntil ? new Date(state.access.validUntil) : null;
          const validUntilText =
            validUntil && !Number.isNaN(validUntil.getTime())
              ? ` Доступ действует до ${new Intl.DateTimeFormat('ru-RU').format(validUntil)}.`
              : '';

          setNotification(`Оплата подтверждена, PRO включен.${validUntilText}`);
          return;
        }

        setNotification('Платеж ожидает подтверждения Robokassa. PRO включится после webhook.');
      });
    }

    if (paymentStatus === 'fail') {
      setNotification('Оплата не завершена.');
      refreshBillingState();
    }
  }, [refreshBillingState]);

  //
  // Subscription-based settings persistence
  //
  // PRO:  load saved settings from backend on startup, auto-save on changes
  // FREE: reset to defaults, clear localStorage, never save to backend
  //

  const resetToDefaultSettings = useCallback(() => {
    dateRangeSelectedManuallyRef.current = false;
    setDraftFilters(createDefaultFilters());
    setAppliedFilters(createDefaultFilters());
    setTableSelectedSources([]);
    setDraftTableSelectedSources([]);
    setTableEntitySourceIds([]);
    setEnabledMetricIdsBySection(
      metricSections.reduce<Record<string, Set<string>>>((acc, section) => {
        acc[section.id] = new Set();
        return acc;
      }, {}),
    );
    setAppliedEnabledMetricIdsBySection(
      metricSections.reduce<Record<string, Set<string>>>((acc, section) => {
        acc[section.id] = new Set();
        return acc;
      }, {}),
    );
    setSectionOrder(metricSections.map((section) => section.id));
    setMetricOrderBySection(
      metricSections.reduce<Record<string, string[]>>((acc, section) => {
        acc[section.id] = section.metricIds;
        return acc;
      }, {}),
    );
    setSourceSectionOrder([]);
    setTableLeadingSourceId(null);
    setSourceMetricOrderBySource({});
    setEnabledMetricKeysBySource({});
    setAppliedEnabledMetricKeysBySource({});
    setExpandedSections(new Set());
    setExpandedSourceSections(new Set());
    collapsedSourceSectionsByUser.current = new Set();
    setMainThreshold({ upper: '', lower: '', mode: null });
    setRowThresholds({});
    setEmployeeThresholdsByMetricId({});
    setMetricDirectionsById({});
    setSavedViews([defaultSavedView]);
    setAppSettings(defaultAppSettings);
    setHasBuiltReport(false);
    setBuildMoment(0);
    setReportBuildRequest(0);

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem('sapp24-saved-report-views');
        window.localStorage.removeItem('sapp24-app-settings');
        window.localStorage.removeItem('sapp24-detail-column-widths-v2');
        clearReportOnboardingCompleted();
        onboardingAutoShownRef.current = false;
      } catch {
        // ignore storage errors
      }
    }

    // Mark as hydrated for Free version so auto-save won't fire
    settingsHydratedRef.current = true;
  }, [metricSections]);

  // Load settings from backend when PRO is detected
  const applyBackendSettings = useCallback(() => {
    applyingBackendSettingsRef.current = true;

    loadReportSettings()
      .then((response) => {
        if (!response.ok) {
          // Backend responded but no settings — mark as hydrated so auto-save can start
          settingsHydratedRef.current = true;
          return;
        }

        const settings = response.settings as Record<string, unknown>;
        const savedViewsData = response.savedViews as Array<Record<string, unknown>>;
        const appSettingsData = response.appSettings as Record<string, unknown>;
        suppressNextReportSettingsTouch();
        dateRangeSelectedManuallyRef.current = false;

        if (settings && Object.keys(settings).length > 0) {
          // One-shot auto-build (incl. after preview finished) must not be clobbered by a
          // late Pro settings response — otherwise calculated corridors disappear.
          const protectAutoBuildResults =
            temporaryAutoReportModeRef.current
            || activeAutoBuildGenerationRef.current !== null
            || skipAutoSaveRef.current;

          // Apply saved filters
          if (!protectAutoBuildResults && typeof settings.period === 'string') {
            setDraftFilters((current) => ({ ...current, period: settings.period as Period }));
            setAppliedFilters((current) => ({ ...current, period: settings.period as Period }));
          }

          if (!protectAutoBuildResults && settings.dateRange && typeof settings.dateRange === 'object') {
            const dateRange = settings.dateRange as { start?: string; end?: string };
            if (dateRange.start && dateRange.end) {
              const nextRange = { start: dateRange.start, end: dateRange.end };
              dateRangeSelectedManuallyRef.current = true;
              setDraftFilters((current) => ({ ...current, dateRange: nextRange }));
              setAppliedFilters((current) => ({ ...current, dateRange: nextRange }));
            }
          }

          // Do not restore chart sources over an in-flight "Построить автоматически" preset.
          if (
            settings.selectedSources
            && Array.isArray(settings.selectedSources)
            && !protectAutoBuildResults
          ) {
            setDraftFilters((current) => ({ ...current, selectedSources: settings.selectedSources as string[] }));
            setAppliedFilters((current) => ({ ...current, selectedSources: settings.selectedSources as string[] }));
          }

          let restoredSectionIds = new Set<string>();

          if (!protectAutoBuildResults && settings.enabledSectionIds && Array.isArray(settings.enabledSectionIds)) {
            restoredSectionIds = new Set(settings.enabledSectionIds as string[]);
            setDraftFilters((current) => ({ ...current, enabledSectionIds: restoredSectionIds }));
            setAppliedFilters((current) => ({ ...current, enabledSectionIds: new Set(restoredSectionIds) }));
          } else if (
            !protectAutoBuildResults
            && settings.enabledMetricIdsBySection
            && typeof settings.enabledMetricIdsBySection === 'object'
          ) {
            // Legacy Pro saves: derive visible sections from saved metric visibility.
            const savedMetrics = settings.enabledMetricIdsBySection as Record<string, string[]>;
            restoredSectionIds = new Set(
              Object.entries(savedMetrics)
                .filter(([, metricIds]) => Array.isArray(metricIds) && metricIds.length > 0)
                .map(([sectionId]) => sectionId),
            );
            setDraftFilters((current) => ({ ...current, enabledSectionIds: restoredSectionIds }));
            setAppliedFilters((current) => ({ ...current, enabledSectionIds: new Set(restoredSectionIds) }));
          }

          const allowTableRestore = !protectAutoBuildResults;

          if (allowTableRestore && settings.tableSelectedSources && Array.isArray(settings.tableSelectedSources)) {
            const savedTableSources = settings.tableSelectedSources as string[];
            const pipelineIds = savedTableSources.filter((sourceId) => {
              if (sourceId === 'deal-default') {
                return false;
              }
              return sourceId.startsWith('deal-') || sourceId.startsWith('smart-');
            });
            const entityIds = entitySourceIdsForSections(restoredSectionIds);
            setTableSelectedSources(pipelineIds);
            setTableEntitySourceIds(entityIds);
            setDraftTableSelectedSources([...entityIds, ...pipelineIds]);
          } else if (allowTableRestore && settings.selectedSources && Array.isArray(settings.selectedSources)) {
            // Backward compatibility: older saves used chart sources for the table.
            const tableSources = settings.selectedSources as string[];
            const availableSectionIds = new Set(metricSections.map((section) => section.id));
            const { sectionIds, pipelineSourceIds, entitySourceIds } = resolveSavedTableSelectionFromSourceIds(
              tableSources,
              availableSectionIds,
            );
            restoredSectionIds = sectionIds;
            setDraftFilters((current) => ({ ...current, enabledSectionIds: new Set(sectionIds) }));
            setAppliedFilters((current) => ({ ...current, enabledSectionIds: new Set(sectionIds) }));
            setTableSelectedSources(pipelineSourceIds);
            setTableEntitySourceIds(entitySourceIds);
            setDraftTableSelectedSources([...entitySourceIds, ...pipelineSourceIds]);
          } else if (allowTableRestore) {
            const entityIds = entitySourceIdsForSections(restoredSectionIds);
            setTableSelectedSources([]);
            setTableEntitySourceIds(entityIds);
            setDraftTableSelectedSources(entityIds);
          }

          if (!protectAutoBuildResults && typeof settings.chartDisplayMode === 'string') {
            // WEB-SET-001: separate main charts removed — always restore as sum.
            setDraftFilters((current) => ({ ...current, chartDisplayMode: 'sum' }));
            setAppliedFilters((current) => ({ ...current, chartDisplayMode: 'sum' }));
          }

          if (!protectAutoBuildResults && typeof settings.metricMode === 'string') {
            setDraftFilters((current) => ({ ...current, metricMode: settings.metricMode as ChartMetricMode }));
            setAppliedFilters((current) => ({ ...current, metricMode: settings.metricMode as ChartMetricMode }));
          }

          if (!protectAutoBuildResults && settings.schedule && typeof settings.schedule === 'object') {
            const schedule = settings.schedule as Record<string, unknown>;
            const nextSchedule = {
              workdayStart: String(schedule.workdayStart ?? ''),
              workdayEnd: String(schedule.workdayEnd ?? ''),
              weekendDayIds: Array.isArray(schedule.weekendDayIds) ? schedule.weekendDayIds as number[] : [],
              calendarWeekStart: Number(schedule.calendarWeekStart ?? 0),
            };
            setDraftFilters((current) => ({
              ...current,
              schedule: nextSchedule,
            }));
            setAppliedFilters((current) => ({
              ...current,
              schedule: {
                ...nextSchedule,
                weekendDayIds: [...nextSchedule.weekendDayIds],
              },
            }));
          }

          // Apply saved thresholds (never overwrite one-shot auto-build thresholds).
          if (!protectAutoBuildResults) {
            if (settings.mainThreshold && typeof settings.mainThreshold === 'object') {
              const mt = settings.mainThreshold as Record<string, unknown>;
              setMainThreshold({
                upper: String(mt.upper ?? ''),
                lower: String(mt.lower ?? ''),
                average: mt.average != null ? String(mt.average) : undefined,
                mode: (mt.mode as 'manual' | 'recommended' | null) ?? null,
              });
            }

            if (settings.rowThresholds && typeof settings.rowThresholds === 'object') {
              setRowThresholds(settings.rowThresholds as Record<string, { upper: string; lower: string; mode: 'manual' | 'recommended' | null }>);
            }

            if (settings.employeeThresholdsByMetricId && typeof settings.employeeThresholdsByMetricId === 'object') {
              setEmployeeThresholdsByMetricId(
                settings.employeeThresholdsByMetricId as Record<string, { upper: string; lower: string; mode: 'manual' | 'recommended' | null }>,
              );
            }

            if (settings.metricDirectionsById && typeof settings.metricDirectionsById === 'object') {
              const restoredDirections: Record<string, MetricDirection> = {};
              Object.entries(settings.metricDirectionsById as Record<string, unknown>).forEach(([metricId, value]) => {
                if (isMetricDirection(value)) {
                  restoredDirections[metricId] = value;
                }
              });
              setMetricDirectionsById(restoredDirections);
            }
          }

          // Apply saved metric visibility
          if (
            !protectAutoBuildResults
            && settings.enabledMetricIdsBySection
            && typeof settings.enabledMetricIdsBySection === 'object'
          ) {
            const saved = settings.enabledMetricIdsBySection as Record<string, string[]>;
            setEnabledMetricIdsBySection(
              Object.fromEntries(
                Object.entries(saved).map(([sectionId, metricIds]) => [sectionId, new Set(metricIds)]),
              ),
            );
            setAppliedEnabledMetricIdsBySection(
              Object.fromEntries(
                Object.entries(saved).map(([sectionId, metricIds]) => [sectionId, new Set(metricIds)]),
              ),
            );
          }

          // Apply saved section order
          if (!protectAutoBuildResults && settings.sectionOrder && Array.isArray(settings.sectionOrder)) {
            setSectionOrder(settings.sectionOrder as string[]);
          }

          // Apply saved metric order
          if (
            !protectAutoBuildResults
            && settings.metricOrderBySection
            && typeof settings.metricOrderBySection === 'object'
          ) {
            setMetricOrderBySection(settings.metricOrderBySection as Record<string, string[]>);
          }

          if (
            !protectAutoBuildResults
            && settings.sourceSectionOrder
            && Array.isArray(settings.sourceSectionOrder)
          ) {
            setSourceSectionOrder(settings.sourceSectionOrder as string[]);
          }

          if (
            !protectAutoBuildResults
            && settings.sourceMetricOrderBySource
            && typeof settings.sourceMetricOrderBySource === 'object'
          ) {
            setSourceMetricOrderBySource(settings.sourceMetricOrderBySource as Record<string, string[]>);
          }

          if (
            !protectAutoBuildResults
            && settings.enabledMetricKeysBySource
            && typeof settings.enabledMetricKeysBySource === 'object'
          ) {
            const savedSourceMetrics = settings.enabledMetricKeysBySource as Record<string, string[]>;
            const asSets = Object.fromEntries(
              Object.entries(savedSourceMetrics).map(([sourceId, metricKeys]) => [
                sourceId,
                new Set(Array.isArray(metricKeys) ? metricKeys : []),
              ]),
            );
            setEnabledMetricKeysBySource(
              Object.fromEntries(
                Object.entries(asSets).map(([sourceId, metricKeys]) => [sourceId, new Set(metricKeys)]),
              ),
            );
            setAppliedEnabledMetricKeysBySource(asSets);
          }

          // Apply saved expanded sections
          if (
            !protectAutoBuildResults
            && settings.expandedSections
            && Array.isArray(settings.expandedSections)
          ) {
            setExpandedSections(new Set(settings.expandedSections as string[]));
          }
        } else {
          // No saved settings on backend — apply defaults and mark hydrated
          // so auto-save can start capturing user changes
          settingsHydratedRef.current = true;
        }

        // Apply saved views
        if (savedViewsData.length > 0) {
          const restoredViews: SavedReportViewOption[] = [
            defaultSavedView,
            ...savedViewsData
              .map((item) => ({
                value: String(item.value ?? '').trim(),
                label: String(item.label ?? '').trim(),
                isSystem: Boolean(item.isSystem),
                state: item.state as SavedReportViewState | undefined,
              }))
              .filter((item) => item.value && item.label && item.value !== defaultSavedView.value),
          ];
          setSavedViews(restoredViews);
          setSelectedView((current) =>
            restoredViews.some((view) => view.value === current) ? current : defaultSavedView.value,
          );
        }

        // Apply app settings
        if (appSettingsData && Object.keys(appSettingsData).length > 0) {
          setAppSettings({
            reportBuilderUserIds: Array.isArray(appSettingsData.reportBuilderUserIds)
              ? appSettingsData.reportBuilderUserIds as string[]
              : [],
            moneyViewerUserIds: Array.isArray(appSettingsData.moneyViewerUserIds)
              ? appSettingsData.moneyViewerUserIds as string[]
              : [],
            viewSaverUserIds: Array.isArray(appSettingsData.viewSaverUserIds)
              ? appSettingsData.viewSaverUserIds as string[]
              : [],
          });
        }

        // Mark as hydrated after successful load (even if settings were empty)
        settingsHydratedRef.current = true;
      })
      .catch((error) => {
        console.warn('[Settings] Failed to load settings from backend', error);
        // Allow auto-save after a failed load so Pro users can still persist
        // new changes (e.g. after a transient network error).
        settingsHydratedRef.current = true;
      })
      .finally(() => {
        applyingBackendSettingsRef.current = false;
      });
  }, []);

  // Effect: apply report settings only on initial billing load or an actual PRO/FREE access change.
  useEffect(() => {
    if (billingLoading || !billingInitialized) {
      return;
    }

    if (temporaryAutoReportModeRef.current) {
      return;
    }

    const isInitialReportSettingsLoad = !reportSettingsInitializedRef.current;
    const didReportAccessChange = lastAppliedReportAccessRef.current !== billingHasPro;

    if (userTouchedReportSettingsRef.current) {
      reportSettingsInitializedRef.current = true;
      lastAppliedReportAccessRef.current = billingHasPro;
      settingsHydratedRef.current = true;

      if (billingHasPro) {
        setAutoSaveRequest((current) => current + 1);
      }

      return;
    }

    if (!isInitialReportSettingsLoad && !didReportAccessChange) {
      return;
    }

    reportSettingsInitializedRef.current = true;
    lastAppliedReportAccessRef.current = billingHasPro;

    if (billingHasPro) {
      applyBackendSettings();
    } else {
      suppressNextReportSettingsTouch();
      resetToDefaultSettings();
    }
  }, [
    billingHasPro,
    billingInitialized,
    billingLoading,
    applyBackendSettings,
    resetToDefaultSettings,
    suppressNextReportSettingsTouch,
  ]);

  useEffect(() => {
    let isActive = true;
    setCatalogLoading(true);
    setCatalogError('');

    Promise.all([
      reportDataSource.loadCrmSources(),
      reportDataSource.loadPeriods(),
      reportDataSource.loadMetricSections(),
      reportDataSource.loadMetrics(),
      refreshPortalEmployees().then(() => []),
    ])
      .then(([sources, periods, sections, nextMetrics]) => {
        if (!isActive) {
          return;
        }

        setCrmSources(sources);
        setPeriodOptions(periods);
        setMetricSections(sections);
        setMetrics(nextMetrics);

        // Do not wipe Pro-restored (or user) visibility/order when catalog arrives late.
        if (settingsHydratedRef.current || applyingBackendSettingsRef.current) {
          suppressNextReportSettingsTouch();
          setSectionOrder((current) => {
            const known = new Set(current);
            const missing = sections.map((section) => section.id).filter((id) => !known.has(id));
            return missing.length ? [...current, ...missing] : current;
          });
          setMetricOrderBySection((current) => {
            const next = { ...current };
            sections.forEach((section) => {
              // Keep user/drag order, but always append newly arrived catalog metrics
              // (e.g. calls_total after Free reset seeded the old 3-metric fallback).
              next[section.id] = mergeIdOrder(next[section.id] ?? [], section.metricIds);
            });
            return next;
          });
          setEnabledMetricIdsBySection((current) => {
            const next = { ...current };
            sections.forEach((section) => {
              if (!next[section.id]) {
                next[section.id] = new Set();
              }
            });
            return next;
          });
          setAppliedEnabledMetricIdsBySection((current) => {
            const next = { ...current };
            sections.forEach((section) => {
              if (!next[section.id]) {
                next[section.id] = new Set();
              }
            });
            return next;
          });
          return;
        }

        suppressNextReportSettingsTouch();
        setSectionOrder(sections.map((section) => section.id));
        setMetricOrderBySection(
          sections.reduce<Record<string, string[]>>((acc, section) => {
            acc[section.id] = section.metricIds;
            return acc;
          }, {}),
        );
        setEnabledMetricIdsBySection(
          sections.reduce<Record<string, Set<string>>>((acc, section) => {
            acc[section.id] = new Set();
            return acc;
          }, {}),
        );
        setAppliedEnabledMetricIdsBySection(
          sections.reduce<Record<string, Set<string>>>((acc, section) => {
            acc[section.id] = new Set();
            return acc;
          }, {}),
        );
        setExpandedSections(new Set());
      })
      .catch((error) => {
        console.warn('[Report data source] CRM sources were not loaded', error);
        if (isActive) {
          setCatalogError(getFriendlyReportError(error, 'Не удалось загрузить настройки отчета.'));
        }
      })
      .finally(() => {
        if (isActive) {
          setCatalogLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [refreshPortalEmployees, suppressNextReportSettingsTouch]);

  useEffect(() => {
    if (!hasBuiltReport) {
      return undefined;
    }

    let isActive = true;
    const selectedMetricIds = metricSections.flatMap((section) => {
      if (!appliedFilters.enabledSectionIds.has(section.id)) {
        return [];
      }

      // Missing entry = all section metrics enabled; empty Set = none selected.
      const enabledMetricIds = appliedEnabledMetricIdsBySection[section.id];
      if (!enabledMetricIds) {
        return section.metricIds;
      }

      return section.metricIds.filter((metricId) => enabledMetricIds.has(metricId));
    });
    // Auto-build reads locked chart/table sources via refs so a stale closure cannot
    // mix them while the automatic preset is being applied.
    const lockedChartSources = autoBuildChartSourcesRef.current;
    const lockedTableSources = autoBuildTableSourcesRef.current;
    const lockedDateFilters = autoBuildDateFiltersRef.current;
    const chartSourceIds =
      lockedChartSources && lockedChartSources.length > 0
        ? lockedChartSources
        : appliedFilters.selectedSources;
    const tableSourceIds =
      lockedTableSources && lockedTableSources.length > 0
        ? lockedTableSources
        : [...tableSelectedSources, ...tableEntitySourceIds];
    const filters: ReportLoadFilters = {
      period: lockedDateFilters?.period ?? appliedFilters.period,
      dateRange: lockedDateFilters?.dateRange ?? appliedFilters.dateRange,
      selectedSources: tableSourceIds,
      chartSelectedSources: chartSourceIds,
      selectedMetricIds,
      metricMode: appliedFilters.metricMode,
      chartDisplayMode: appliedFilters.chartDisplayMode,
      schedule: {
        workdayStart: appliedFilters.schedule.workdayStart,
        workdayEnd: appliedFilters.schedule.workdayEnd,
        weekendDayIds: [...appliedFilters.schedule.weekendDayIds],
        calendarWeekStart: appliedFilters.schedule.calendarWeekStart,
      },
    };

    setReportLoading(true);
    reportStartTimeRef.current = Date.now();
    setReportError('');
    reportDataSource
      .loadReportPreview(filters)
      .then((preview) => {
        if (isActive) {
          setRawReportData(preview.data);
          setRawChartReportData(preview.chartData ?? preview.data);
          setReportEmployees((preview.employees ?? []).map(toReportEmployee));
          setReportDetails(preview.details ?? []);
          setSourceMetrics(preview.sourceMetrics ?? {});
          setChartSourceMetrics(preview.chartSourceMetrics ?? preview.sourceMetrics ?? {});
          setValueStates(preview.valueStates ?? {});
          hasExistingReportDataRef.current =
            (preview.data?.length ?? 0) > 0
            || Object.keys(preview.sourceMetrics ?? {}).length > 0
            || Object.keys(preview.valueStates ?? {}).length > 0;

          const shouldApplyAutomaticCorridors =
            applyAutomaticThresholdsRef.current
            || Boolean(
              pendingAutoBuildSummaryRef.current?.wantCorridors
              && pendingAutoBuildSummaryRef.current.generation === activeAutoBuildGenerationRef.current,
            );

          if (shouldApplyAutomaticCorridors) {
            const scheduledData = applyScheduleToReportData(preview.data, filters.period, appliedFilters.schedule);
            const scheduledChartData = applyScheduleToReportData(
              preview.chartData ?? preview.data,
              filters.period,
              appliedFilters.schedule,
            );
            const metricMode = filters.metricMode ?? appliedFilters.metricMode;
            // Auto-build chart must stay on the locked Sales funnel only — never merge table sources.
            const lockedChartSources = autoBuildChartSourcesRef.current;
            const chartSourcesForAutoBuild =
              lockedChartSources && lockedChartSources.length > 0
                ? lockedChartSources
                : appliedFilters.selectedSources;

            if (
              lockedChartSources
              && lockedChartSources.length > 0
              && !areStringArraysEqual(lockedChartSources, appliedFilters.selectedSources)
            ) {
              setAppliedFilters((current) => ({
                ...current,
                selectedSources: [...lockedChartSources],
              }));
            }

            // Main chart sum = successful money for locked chart sources only (Sales won_sum).
            const previewValueStates = preview.valueStates ?? {};
            const mainValues = scheduledChartData.map((point) =>
              getChartSumCorridorValue(
                point,
                chartSourcesForAutoBuild,
                metricMode,
                preview.chartSourceMetrics ?? preview.sourceMetrics ?? {},
                previewValueStates,
              ),
            );
            const mainRecommended = calculateRecommendedThresholds(mainValues, metricMode);

            // F-08: do not overwrite a manually saved corridor until the user chooses auto mode.
            const currentMainThreshold = mainThresholdRef.current;
            if (!isManualThreshold(currentMainThreshold)) {
              setMainThreshold({
                upper: mainRecommended.upper,
                lower: mainRecommended.lower,
                average: mainRecommended.average,
                mode: 'recommended',
              });
            }

            const nextRowThresholds: Record<string, ThresholdValues> = {};
            // Count corridors for table indicators only (main chart corridor is separate).
            let corridorMetricsCount = 0;
            const currentRowThresholds = rowThresholdsRef.current;

            // Regular section metrics (deals, leads, …).
            selectedMetricIds.forEach((metricId) => {
              const metric = metrics.find((item) => item.id === metricId);

              if (!metric) {
                return;
              }

              try {
                const recommended = calculateRecommendedThresholds(
                  scheduledData.map((point) =>
                    toCorridorValue(
                      point.values[metricId],
                      resolvePeriodValueState(previewValueStates, point.key, metricId),
                    ),
                  ),
                  metric.type,
                );

                if (!hasFilledCorridor(recommended.upper, recommended.lower)) {
                  return;
                }

                nextRowThresholds[metricId] = {
                  upper: recommended.upper,
                  lower: recommended.lower,
                  average: recommended.average,
                  mode: 'recommended',
                };
              } catch (error) {
                console.warn('[Auto thresholds] skipped section metric', metricId, error);
              }
            });

            // Funnel / smart-process rows use the same action ids as the table UI.
            // Store every known alias so thresholds stay attached across source key formats.
            Object.entries(preview.sourceMetrics ?? {}).forEach(([sourceKey, sourceData]) => {
              Object.entries(sourceData.metrics ?? {}).forEach(([metricKey, metricData]) => {
                try {
                  const valueType =
                    metricData.valueType === 'money'
                      ? 'money'
                      : metricData.valueType === 'percent'
                        ? 'percent'
                        : 'number';
                  const actionIds = buildSourceMetricActionIds(sourceKey, metricKey, sourceData);
                  const recommended = calculateRecommendedThresholds(
                    scheduledData.map((point) =>
                      toCorridorValue(
                        readValuesByPeriod(metricData.valuesByPeriod, point.key),
                        resolvePeriodValueState(previewValueStates, point.key, actionIds),
                      ),
                    ),
                    valueType,
                  );

                  if (!hasFilledCorridor(recommended.upper, recommended.lower)) {
                    return;
                  }

                  const thresholdValue: ThresholdValues = {
                    upper: recommended.upper,
                    lower: recommended.lower,
                    average: recommended.average,
                    mode: 'recommended',
                  };

                  buildSourceMetricActionIds(sourceKey, metricKey, sourceData).forEach((actionId) => {
                    nextRowThresholds[actionId] = thresholdValue;
                  });
                } catch (error) {
                  console.warn('[Auto thresholds] skipped source metric', sourceKey, metricKey, error);
                }
              });
            });

            const mergedRowThresholds: Record<string, ThresholdValues> = { ...currentRowThresholds };
            Object.entries(nextRowThresholds).forEach(([actionId, value]) => {
              if (isManualThreshold(currentRowThresholds[actionId])) {
                return;
              }
              mergedRowThresholds[actionId] = value;
              corridorMetricsCount += 1;
            });
            setRowThresholds(mergedRowThresholds);
            applyAutomaticThresholdsRef.current = false;
            autoBuildChartSourcesRef.current = null;
            autoBuildTableSourcesRef.current = null;
            autoBuildDateFiltersRef.current = null;

            const pendingSummary = pendingAutoBuildSummaryRef.current;
            if (
              pendingSummary
              && activeAutoBuildGenerationRef.current === pendingSummary.generation
            ) {
              pendingSummary.corridorMetricsCount = corridorMetricsCount;
            }
          } else {
            // Regular build: clear auto corridors, but keep manually saved ones (F-08).
            // Never clear while an auto-build still expects corridors (ref can be raced).
            const pendingWantsCorridors = Boolean(
              pendingAutoBuildSummaryRef.current?.wantCorridors
              && pendingAutoBuildSummaryRef.current.generation === activeAutoBuildGenerationRef.current,
            );
            if (!pendingWantsCorridors) {
              const currentMainThreshold = mainThresholdRef.current;
              if (!isManualThreshold(currentMainThreshold)) {
                setMainThreshold({ upper: '', lower: '', mode: null });
              }
              setRowThresholds(
                Object.fromEntries(
                  Object.entries(rowThresholdsRef.current).filter(([, value]) => isManualThreshold(value)),
                ),
              );
              setEmployeeThresholdsByMetricId(
                Object.fromEntries(
                  Object.entries(employeeThresholdsRef.current).filter(([, value]) => isManualThreshold(value)),
                ),
              );
            }
          }

          // End auto-build skip only after thresholds (and other presets) are applied.
          // Defer clearing so the threshold setState autosave effect still sees skip=true.
          const finishedGeneration = activeAutoBuildGenerationRef.current;
          if (
            finishedGeneration !== null &&
            finishedGeneration === autoBuildGenerationRef.current
          ) {
            const pendingSummary = pendingAutoBuildSummaryRef.current;
            if (pendingSummary && pendingSummary.generation === finishedGeneration) {
              const sourceMetricCount = Object.values(preview.sourceMetrics ?? {}).reduce(
                (sum, sourceData) => sum + Object.keys(sourceData.metrics ?? {}).length,
                0,
              );
              const foundMetrics = selectedMetricIds.length + sourceMetricCount;
              const corridorCount = pendingSummary.wantCorridors
                ? (pendingSummary.corridorMetricsCount ?? 0)
                : null;
              const missingDataNote = foundMetrics === 0
                ? 'Не удалось набрать показатели по доступным данным портала.'
                : pendingSummary.wantCorridors
                  && corridorCount !== null
                  && corridorCount < foundMetrics
                  ? 'Для части показателей не хватило данных для расчёта коридоров.'
                  : null;

              setNotification(buildAutomaticReportSummaryMessage({
                foundMetrics,
                mainIndicatorLabel: pendingSummary.mainIndicatorLabel,
                corridorsCalculated: corridorCount,
                skippedUnavailableLabels: pendingSummary.skippedUnavailableLabels,
                missingDataNote,
              }));
              pendingAutoBuildSummaryRef.current = null;
            }

            activeAutoBuildGenerationRef.current = null;
            autoBuildChartSourcesRef.current = null;
            autoBuildTableSourcesRef.current = null;
            autoBuildDateFiltersRef.current = null;
            window.setTimeout(() => {
              if (autoBuildGenerationRef.current === finishedGeneration) {
                skipAutoSaveRef.current = false;
              }
            }, 0);
          }
        }
      })
      .catch((error) => {
        console.warn('[Report data source] report data were not loaded', error);
        if (isActive) {
          const message = getFriendlyReportError(error, 'Не удалось построить отчет.');
          const clearReportState = () => {
            setRawReportData([]);
            setRawChartReportData([]);
            setReportEmployees([]);
            setReportDetails([]);
            setValueStates({});
            setSourceMetrics({});
            setChartSourceMetrics({});
            hasExistingReportDataRef.current = false;
          };

          if (message === RELOAD_PAGE_TO_CONTINUE_MESSAGE) {
            setReportError(RELOAD_PAGE_TO_CONTINUE_MESSAGE);
            clearReportState();
            applyAutomaticThresholdsRef.current = false;
            autoBuildChartSourcesRef.current = null;
            autoBuildTableSourcesRef.current = null;
            autoBuildDateFiltersRef.current = null;
            const failedGeneration = activeAutoBuildGenerationRef.current;
            if (
              failedGeneration !== null &&
              failedGeneration === autoBuildGenerationRef.current
            ) {
              pendingAutoBuildSummaryRef.current = null;
              activeAutoBuildGenerationRef.current = null;
              skipAutoSaveRef.current = false;
            }
            return;
          }

          // F-20: keep a previously built report visible on total failure.
          setReportError(message);
          if (!hasExistingReportDataRef.current) {
            clearReportState();
          }
          applyAutomaticThresholdsRef.current = false;
          autoBuildChartSourcesRef.current = null;
          autoBuildTableSourcesRef.current = null;
          autoBuildDateFiltersRef.current = null;
          const failedGeneration = activeAutoBuildGenerationRef.current;
          if (
            failedGeneration !== null &&
            failedGeneration === autoBuildGenerationRef.current
          ) {
            const pendingSummary = pendingAutoBuildSummaryRef.current;
            if (pendingSummary && pendingSummary.generation === failedGeneration) {
              setNotification(
                pendingSummary.skippedUnavailableLabels.length > 0
                  ? `Автопостроение не завершено. Пропущены недоступные: ${pendingSummary.skippedUnavailableLabels.slice(0, 3).join(', ')}.`
                  : 'Автопостроение не завершено. Попробуйте выбрать показатели вручную.',
              );
              pendingAutoBuildSummaryRef.current = null;
            }
            activeAutoBuildGenerationRef.current = null;
            skipAutoSaveRef.current = false;
          }
        }
      })
      .finally(() => {
        if (isActive) {
          setReportLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [
    // CRITICAL: Only depend on reportBuildRequest (incremented by explicit user actions)
    // and hasBuiltReport (guard). Do NOT add appliedFilters or other UI state here —
    // changes to filters/settings should NOT trigger report building.
    hasBuiltReport,
    reportBuildRequest,
  ]);

  const canStartReportBuild = useCallback(() => (
    !reportLoadingRef.current && !sectionRetryInFlightRef.current
  ), []);

  const requestReportBuild = useCallback(() => {
    if (!canStartReportBuild()) {
      return;
    }
    setReportBuildRequest((current) => current + 1);
  }, [canStartReportBuild]);

  const retrySectionLoad = useCallback(async (sectionId: string) => {
    if (!canStartReportBuild() || sectionRetryingId === sectionId) {
      return;
    }

    const section = metricSections.find((item) => item.id === sectionId);
    if (!section) {
      return;
    }

    const enabledMetricIds = appliedEnabledMetricIdsBySection[sectionId];
    const metricIds = !enabledMetricIds
      ? section.metricIds
      : section.metricIds.filter((metricId) => enabledMetricIds.has(metricId));

    if (!metricIds.length) {
      return;
    }

    const tableSourceIds = [...tableSelectedSources, ...tableEntitySourceIds];
    const retrySourceIds = resolveRetrySourceIdsForSection(sectionId, crmSources, tableSourceIds);

    if (!retrySourceIds.length) {
      setNotification('Не удалось определить источник для повторной загрузки.');
      return;
    }

    const metricIdSet = new Set(metricIds);
    sectionRetryInFlightRef.current = true;
    setSectionRetryingId(sectionId);

    const filters: ReportLoadFilters = {
      period: appliedFilters.period,
      dateRange: appliedFilters.dateRange,
      selectedSources: retrySourceIds,
      chartSelectedSources: [],
      selectedMetricIds: metricIds,
      metricMode: appliedFilters.metricMode,
      chartDisplayMode: appliedFilters.chartDisplayMode,
      schedule: {
        workdayStart: appliedFilters.schedule.workdayStart,
        workdayEnd: appliedFilters.schedule.workdayEnd,
        weekendDayIds: [...appliedFilters.schedule.weekendDayIds],
        calendarWeekStart: appliedFilters.schedule.calendarWeekStart,
      },
    };

    try {
      const preview = await reportDataSource.loadReportPreview(filters);
      setRawReportData((previous) => mergeReportPointsForMetrics(previous, preview.data, metricIdSet));
      setValueStates((previous) => mergeValueStatesForMetrics(previous, preview.valueStates ?? {}, metricIdSet));
      setReportDetails((previous) => mergeDetailsForMetrics(previous, preview.details ?? [], metricIdSet));
      setReportEmployees((previous) => mergeEmployeesForMetrics(
        previous,
        (preview.employees ?? []).map(toReportEmployee),
        metricIdSet,
      ));
      setSourceMetrics((previous) => {
        const next = { ...previous };
        Object.entries(preview.sourceMetrics ?? {}).forEach(([sourceKey, sourceData]) => {
          if (retrySourceIds.includes(sourceKey)) {
            next[sourceKey] = sourceData;
          }
        });
        return next;
      });
      hasExistingReportDataRef.current = true;
      setReportError('');
    } catch (error) {
      console.warn('[Report data source] section retry failed', sectionId, error);
      const message = getFriendlyReportError(error, 'Не удалось получить данные.');
      if (message === RELOAD_PAGE_TO_CONTINUE_MESSAGE) {
        setReportError(RELOAD_PAGE_TO_CONTINUE_MESSAGE);
      } else {
        setNotification(`${SECTION_LOAD_ERROR_MESSAGE} ${SECTION_LOAD_RETRY_LABEL} не выполнен.`);
      }
    } finally {
      sectionRetryInFlightRef.current = false;
      setSectionRetryingId(null);
    }
  }, [
    appliedEnabledMetricIdsBySection,
    appliedFilters.chartDisplayMode,
    appliedFilters.dateRange,
    appliedFilters.metricMode,
    appliedFilters.period,
    appliedFilters.schedule.calendarWeekStart,
    appliedFilters.schedule.weekendDayIds,
    appliedFilters.schedule.workdayEnd,
    appliedFilters.schedule.workdayStart,
    canStartReportBuild,
    crmSources,
    sectionRetryingId,
    tableEntitySourceIds,
    tableSelectedSources,
  ]);

  const appliedReportData = useMemo(
    () => applyScheduleToReportData(rawReportData, appliedFilters.period, appliedFilters.schedule),
    [appliedFilters.period, appliedFilters.schedule, rawReportData],
  );
  const appliedChartReportData = useMemo(
    () => applyScheduleToReportData(rawChartReportData, appliedFilters.period, appliedFilters.schedule),
    [appliedFilters.period, appliedFilters.schedule, rawChartReportData],
  );
  const reportData = useMemo(
    () => (hasBuiltReport ? appliedReportData : createZeroReportData(appliedReportData)),
    [appliedReportData, hasBuiltReport],
  );

  // F-23: show 3 short tips once after the first successful report build.
  useEffect(() => {
    if (
      !hasBuiltReport
      || reportLoading
      || Boolean(reportError)
      || reportData.length === 0
      || isOnboardingOpen
      || onboardingAutoShownRef.current
      || isReportOnboardingCompleted()
    ) {
      return;
    }

    onboardingAutoShownRef.current = true;
    setOnboardingStepIndex(0);
    setIsOnboardingOpen(true);
  }, [hasBuiltReport, isOnboardingOpen, reportData.length, reportError, reportLoading]);

  const chartReportData = useMemo(
    () => (hasBuiltReport ? appliedChartReportData : createZeroReportData(appliedChartReportData)),
    [appliedChartReportData, hasBuiltReport],
  );
  const crmSourceOptions = useMemo(
    () =>
      [...crmSources]
        // Keep all known portal sources visible in pickers.
        .sort((left, right) => {
          const groupDiff = getSourceGroupRank(left) - getSourceGroupRank(right);

          if (groupDiff !== 0) {
            return groupDiff;
          }

          const typeDiff = (CRM_SOURCE_TYPE_ORDER[left.type] ?? 999) - (CRM_SOURCE_TYPE_ORDER[right.type] ?? 999);

          if (typeDiff !== 0) {
            return typeDiff;
          }

          const leftLabel = left.sourceLabel || left.title || left.id;
          const rightLabel = right.sourceLabel || right.title || right.id;
          return leftLabel.localeCompare(rightLabel, 'ru-RU');
        })
        .map((source) => ({
          value: source.id,
          label: source.sourceLabel || source.title || source.id,
          group: getSourceGroup(source),
        })),
    [crmSources],
  );
  const crmSourceIds = useMemo(
    () => crmSourceOptions.map((source) => source.value),
    [crmSourceOptions],
  );
  const crmSourceLabelById = useMemo(
    () => new Map(crmSourceOptions.map((source) => [source.value, source.label])),
    [crmSourceOptions],
  );

  // Chart sources: keep only IDs that still exist. Never expand empty → all/default.
  const sanitizeChartSources = useCallback(
    (sources: string[]) => {
      if (!crmSourceIds.length) {
        return sources;
      }

      const allowedSourceIds = new Set(crmSourceIds);
      return sources.filter((source) => allowedSourceIds.has(source));
    },
    [crmSourceIds],
  );

  useEffect(() => {
    if (!crmSourceIds.length) {
      return;
    }

    // Only prune invalid IDs. Do not auto-fill empty chart selection.
    setDraftFilters((current) => {
      const selectedSources = sanitizeChartSources(current.selectedSources);

      if (areStringArraysEqual(selectedSources, current.selectedSources)) {
        return current;
      }

      return {
        ...current,
        selectedSources,
      };
    });

    setAppliedFilters((current) => {
      const selectedSources = sanitizeChartSources(current.selectedSources);

      if (areStringArraysEqual(selectedSources, current.selectedSources)) {
        return current;
      }

      return {
        ...current,
        selectedSources,
      };
    });

    setDraftTableSelectedSources((current) => {
      const next = sanitizeChartSources(current);
      return areStringArraysEqual(next, current) ? current : next;
    });

    setTableSelectedSources((current) => {
      const next = sanitizeChartSources(current);
      return areStringArraysEqual(next, current) ? current : next;
    });

    setTableEntitySourceIds((current) => {
      const next = sanitizeChartSources(current);
      return areStringArraysEqual(next, current) ? current : next;
    });
  }, [crmSourceIds, sanitizeChartSources]);

  // Chart uses EXACTLY applied chart sources — never silently switch to all sources.
  const selectedChartSources = useMemo(
    () => appliedFilters.selectedSources,
    [appliedFilters.selectedSources],
  );
  const selectedChartSourceLabels = useMemo(
    () =>
      selectedChartSources.map((source) => crmSourceLabelById.get(source) ?? source),
    [crmSourceLabelById, selectedChartSources],
  );
  const isSeparateChart = selectedChartSources.length > 1 && appliedFilters.chartDisplayMode === 'separate';
  const chartSeries = useMemo(
    () =>
      isSeparateChart
        ? selectedChartSources.map((source, index) => ({
            key: `series_${index}`,
            label: crmSourceLabelById.get(source) ?? source,
            color: chartSeriesColors[index % chartSeriesColors.length],
          }))
        : [
            {
              key: 'indicator',
              label: selectedChartSources.length > 1 ? 'Сумма' : (selectedChartSourceLabels[0] ?? 'Показатель'),
              color: '#2274ff',
            },
          ],
    [crmSourceLabelById, isSeparateChart, selectedChartSourceLabels, selectedChartSources],
  );
  const mainIndicatorCaption = useMemo(() => {
    const periodOptionLabel =
      periodOptions.find((option) => option.value === appliedFilters.period)?.label;
    const hasChartData =
      chartReportData.length > 0 &&
      hasResolvableMainChartSources(
        selectedChartSources,
        appliedFilters.metricMode,
        chartSourceMetrics,
      );

    const caption = buildMainIndicatorCaption({
      sourceLabels: selectedChartSourceLabels,
      chartDisplayMode: appliedFilters.chartDisplayMode,
      metricMode: appliedFilters.metricMode,
      period: appliedFilters.period,
      dateRange: appliedFilters.dateRange,
      periodOptionLabel,
      hasBuiltReport,
      hasChartData,
    });
    const customTitle = mainIndicatorCustomTitle.trim();
    if (!customTitle || caption.empty) {
      return caption;
    }
    return {
      ...caption,
      title: customTitle,
      titleFull: customTitle,
    };
  }, [
    appliedFilters.chartDisplayMode,
    appliedFilters.dateRange,
    appliedFilters.metricMode,
    appliedFilters.period,
    chartReportData.length,
    chartSourceMetrics,
    hasBuiltReport,
    mainIndicatorCustomTitle,
    periodOptions,
    selectedChartSourceLabels,
    selectedChartSources,
  ]);
  const chartBaseValues = useMemo(
    () =>
      chartReportData.map((point) =>
        getChartSumValue(point, selectedChartSources, appliedFilters.metricMode, chartSourceMetrics),
      ),
    [appliedFilters.metricMode, chartReportData, selectedChartSources, chartSourceMetrics],
  );
  const mainThresholdRecommendationValues = useMemo(
    () =>
      isSeparateChart
        ? chartReportData.flatMap((point) =>
            selectedChartSources.map((source) =>
              getChartSeriesCorridorValue(
                point,
                source,
                appliedFilters.metricMode,
                chartSourceMetrics,
                valueStates,
              ),
            ),
          )
        : chartReportData.map((point) =>
            getChartSumCorridorValue(
              point,
              selectedChartSources,
              appliedFilters.metricMode,
              chartSourceMetrics,
              valueStates,
            ),
          ),
    [
      appliedFilters.metricMode,
      chartReportData,
      chartSourceMetrics,
      isSeparateChart,
      selectedChartSources,
      valueStates,
    ],
  );
  const mainRecommendedThreshold = useMemo(
    () =>
      // В режиме отдельных линий рекомендации считаются по объединенному массиву всех линий.
      calculateRecommendedThresholds(mainThresholdRecommendationValues, appliedFilters.metricMode),
    [appliedFilters.metricMode, mainThresholdRecommendationValues],
  );
  const trendValues = useMemo(
    () => buildTrend(chartBaseValues),
    [chartBaseValues],
  );
  const hasTrendSeries = useMemo(
    () =>
      !isSeparateChart
      && trendValues.length >= MIN_TREND_POINTS
      && trendValues.length === chartBaseValues.length,
    [chartBaseValues.length, isSeparateChart, trendValues.length],
  );
  const showTrendOnChart = hasTrendSeries && showTrendLine;
  const chartData = useMemo(
    () =>
      chartReportData.map((point, index) => {
        const seriesValues = isSeparateChart
          ? selectedChartSources.reduce<Record<string, number>>((acc, source, sourceIndex) => {
              acc[`series_${sourceIndex}`] = getChartSeriesValue(
                point,
                source,
                appliedFilters.metricMode,
                chartSourceMetrics,
              );
              return acc;
            }, {})
          : {};

        return {
          ...point,
          ...seriesValues,
          chartIndex: index,
          indicator: chartBaseValues[index] ?? 0,
          xIndex: index + 0.5,
          ...(hasTrendSeries ? { trend: trendValues[index] ?? 0 } : {}),
        };
      }),
    [
      appliedFilters.metricMode,
      chartBaseValues,
      chartReportData,
      chartSourceMetrics,
      hasTrendSeries,
      isSeparateChart,
      selectedChartSources,
      trendValues,
    ],
  );
  const thresholdNumbers = useMemo(
    () =>
      [upperThresholdNumber, lowerThresholdNumber, averageThresholdNumber].filter(
        (value): value is number => value !== null,
      ),
    [upperThresholdNumber, lowerThresholdNumber, averageThresholdNumber],
  );
  const chartDomain = useMemo(
    () => {
      const values = isSeparateChart
        ? chartReportData.flatMap((point) =>
            selectedChartSources.map((source) =>
              getChartSeriesValue(point, source, appliedFilters.metricMode, chartSourceMetrics),
            ),
          )
        : showTrendOnChart
          ? [...chartBaseValues, ...trendValues]
          : [...chartBaseValues];

      return getChartDomain([...values, ...thresholdNumbers]);
    },
    [
      appliedFilters.metricMode,
      chartBaseValues,
      chartReportData,
      chartSourceMetrics,
      isSeparateChart,
      selectedChartSources,
      showTrendOnChart,
      thresholdNumbers,
      trendValues,
    ],
  );
  const mainChartYAxisTicks = useMemo(() => {
    if (appliedFilters.metricMode === 'money') {
      return undefined;
    }

    const [min, max] = chartDomain;

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return undefined;
    }

    const lower = Math.max(0, Math.floor(min));
    const upper = Math.ceil(max);

    if (upper - lower > 10) {
      return undefined;
    }

    return Array.from({ length: upper - lower + 1 }, (_item, index) => lower + index);
  }, [appliedFilters.metricMode, chartDomain]);
  const activeMainChartDataPoint = activeMainChartPoint
    ? chartData[activeMainChartPoint.index]
    : null;
  const mainChartTooltipItems = useMemo<ChartTooltipItem[]>(() => {
    if (!activeMainChartDataPoint) {
      return [];
    }

    const activeValues = activeMainChartDataPoint as unknown as Record<string, number>;
    const items = chartSeries.map((series) => ({
      label: series.label,
      value: formatMainChartValue(Number(activeValues[series.key] ?? 0), appliedFilters.metricMode),
      color: series.color,
    }));

    if (showTrendOnChart && Number.isFinite(activeValues.trend)) {
      items.push({
        label: 'Тренд',
        value: formatMainChartValue(Number(activeValues.trend), appliedFilters.metricMode),
        color: 'rgba(34, 116, 255, 0.55)',
      });
    }

    return items;
  }, [activeMainChartDataPoint, appliedFilters.metricMode, chartSeries, showTrendOnChart]);
  const mainThresholdTooltipItems = useMemo(
    () => getAppliedThresholdItems(mainThreshold),
    [mainThreshold],
  );
  const mainChartDirection = useMemo(
    () => resolveMetricDirection(MAIN_INDICATOR_DIRECTION_KEY, metricDirectionsById),
    [metricDirectionsById],
  );
  const mainChartTooltipSummary = useMemo(() => {
    if (!activeMainChartDataPoint) {
      return undefined;
    }

    const activeValues = activeMainChartDataPoint as unknown as Record<string, number>;
    const primarySeries = chartSeries[0];
    const primaryValue = Number(activeValues[primarySeries?.key ?? 'indicator'] ?? 0);
    const formattedValue = formatMainChartValue(primaryValue, appliedFilters.metricMode);
    const metricLabel = (primarySeries?.label ?? 'показатель').toLocaleLowerCase('ru-RU');
    const valuePart = `${formattedValue} ${metricLabel}`;
    const corridorNote = formatChartCorridorTooltipNote(
      primaryValue,
      mainThreshold,
      mainChartDirection,
      (bound) => formatMainChartValue(bound, appliedFilters.metricMode),
    );

    return corridorNote ? `${valuePart}; ${corridorNote}` : valuePart;
  }, [
    activeMainChartDataPoint,
    appliedFilters.metricMode,
    chartSeries,
    mainChartDirection,
    mainThreshold,
  ]);
  const metricMap = useMemo(
    () => new Map(metrics.map((metric) => [metric.id, metric])),
    [metrics],
  );
  const sectionMap = useMemo(
    () => new Map(metricSections.map((section) => [section.id, section])),
    [metricSections],
  );
  const orderedSections = useMemo(
    () =>
      sectionOrder
        .map((sectionId) => sectionMap.get(sectionId))
        .filter((section): section is (typeof metricSections)[number] => Boolean(section)),
    [sectionMap, sectionOrder],
  );
  const visibleSectionIds = hasBuiltReport
    ? appliedFilters.enabledSectionIds
    : draftFilters.enabledSectionIds;

  const visibleSections = useMemo(
    () => orderedSections.filter((section) => visibleSectionIds.has(section.id)),
    [orderedSections, visibleSectionIds],
  );
  const tableRows = useMemo<TableRow[]>(
    () => {
      // CRITICAL: When hasBuiltReport is true, the table must read from
      // appliedEnabledMetricIdsBySection (the "applied" state), NOT from
      // enabledMetricIdsBySection (the "draft" state). This ensures that
      // table settings changes are reflected in the table only after the
      // user clicks "Применить", and not during draft editing.
      const activeMetricIdsBySection = hasBuiltReport
        ? appliedEnabledMetricIdsBySection
        : enabledMetricIdsBySection;
      const shouldHideZeroRows = hideZeroRows && hasBuiltReport && reportData.length > 0;

      const metricHasNonZero = (metricId: string) =>
        reportRowHasNonZeroValues(
          reportData,
          (point) => point.values[metricId],
          (point) => valueStates[point.key]?.[metricId],
        );

      const sourceMetricHasNonZero = (
        valuesByPeriod: Record<string, number> | undefined,
        actionIds: string[],
      ) =>
        reportRowHasNonZeroValues(
          reportData,
          (point) => readValuesByPeriod(valuesByPeriod, point.key),
          (point) => resolvePeriodValueState(valueStates, point.key, actionIds),
        );

      const employeeHasNonZero = (employee: ReportEmployee, metricId: string) =>
        reportRowHasNonZeroValues(
          reportData,
          (point) => getEmployeePeriodMetricValue(employee, point, metricId),
          (point) => valueStates[point.key]?.[metricId],
        );

      const standardRows: TableRow[] = visibleSections.flatMap((section) => {
        const orderedMetricIds = mergeIdOrder(
          metricOrderBySection[section.id] ?? [],
          section.metricIds,
        );
        const enabledMetricIds = activeMetricIdsBySection[section.id] ?? new Set<string>();
        const enabledMetrics = orderedMetricIds
          .filter((metricId) => enabledMetricIds.has(metricId))
          .map((metricId) => metricMap.get(metricId))
          .filter((metric): metric is MetricRow => Boolean(metric));
        const visibleMetrics = shouldHideZeroRows
          ? enabledMetrics.filter((metric) => metricHasNonZero(metric.id))
          : enabledMetrics;

        if (shouldHideZeroRows && visibleMetrics.length === 0) {
          return [];
        }

        const rows: TableRow[] = [
          { kind: 'section', rowId: `section-${section.id}`, sectionId: section.id, label: section.label },
        ];

        if (!expandedSections.has(section.id)) {
          return rows;
        }

        visibleMetrics.forEach((metric) => {
          rows.push({
            kind: 'metric',
            rowId: `metric-${metric.id}`,
            sectionId: section.id,
            metric,
          });

          if (expandedEmployeeMetricIds.has(metric.id)) {
            const appliedEmployeeIds = appliedEmployeeIdsByMetricId[metric.id] ?? new Set<string>();
            const orderedEmployeeIds = mergeIdOrder(
              employeeOrderByMetricId[metric.id] ?? [],
              availableEmployees.map((employee) => employee.id),
            );
            const employeesById = new Map(availableEmployees.map((employee) => [employee.id, employee]));
            const selectedEmployees = orderedEmployeeIds
              .filter((employeeId) => appliedEmployeeIds.has(employeeId))
              .map((employeeId) => employeesById.get(employeeId))
              .filter((employee): employee is ReportEmployee => Boolean(employee));

            const detailResolution = resolveEmployeeDetailList({
              selectedEmployees,
              allEmployees: availableEmployees,
              metricId: metric.id,
              metricType: metric.type,
              reportData,
              readMetricTotal: (point) => point.values[metric.id] ?? 0,
              readEmployeeValue: getEmployeePeriodMetricValue,
            });

            detailResolution.employees.forEach((employee, employeeIndex) => {
              if (shouldHideZeroRows && !employeeHasNonZero(employee, metric.id)) {
                return;
              }

              rows.push({
                kind: 'employee',
                rowId: `employee-${metric.id}-${employee.id}`,
                sectionId: section.id,
                metric,
                employee,
                employeeIndex,
                isSystemDetail: isSystemEmployeeRow(employee.id),
              });

              if (tableRowChartsMode === 'with_charts'
                && expandedEmployeeChartIds.has(buildEmployeeChartId(metric.id, employee.id))) {
                rows.push({
                  kind: 'employee_chart',
                  rowId: `employee-chart-${metric.id}-${employee.id}`,
                  sectionId: section.id,
                  metric,
                  employee,
                });
              }
            });

          }

          if (tableRowChartsMode === 'with_charts' && expandedChartMetricIds.has(metric.id)) {
            rows.push({
              kind: 'chart',
              rowId: `chart-${metric.id}`,
              sectionId: section.id,
              metric,
            });
          }
        });

        return rows;
      });

      // Add source-based sections in sourceSectionOrder (new ids append at end).
      // Selection still comes from tableSelectedSources; this only affects display order.
      const sourceSectionRows: TableRow[] = [];
      const sourceMetricsByLookup = new Map<string, { key: string; data: (typeof sourceMetrics)[string] }>();
      const sourceCatalogById = new Map(crmSources.map((source) => [source.id, source]));

      Object.entries(sourceMetrics).forEach(([sourceKey, sourceData]) => {
        sourceMetricsByLookup.set(sourceKey, { key: sourceKey, data: sourceData });
        sourceMetricsByLookup.set(sourceData.sourceId, { key: sourceKey, data: sourceData });
      });

      if (tableSelectedSources.length > 0) {
        const seenSourceKeys = new Set<string>();
        const matchedSources: Array<{
          key: string;
          data?: (typeof sourceMetrics)[string];
          label: string;
          isPlaceholder: boolean;
        }> = [];

        tableSelectedSources.forEach((selectedId) => {
          const matched = sourceMetricsByLookup.get(selectedId);
          const catalogSource = sourceCatalogById.get(selectedId);
          const sourceKey = matched?.key ?? selectedId;

          if (seenSourceKeys.has(sourceKey)) {
            return;
          }

          const sourceData = matched?.data ?? (catalogSource ? createEmptySourceMetrics(catalogSource) : undefined);
          const label = sourceData?.label ?? catalogSource?.title ?? selectedId;
          seenSourceKeys.add(sourceKey);

          if (hasBuiltReport && (!sourceData || Object.keys(sourceData.metrics).length === 0)) {
            return;
          }

          matchedSources.push({
            key: sourceKey,
            data: sourceData,
            label,
            isPlaceholder: !matched?.data,
          });
        });

        const orderedSourceKeys = mergeIdOrder(
          sourceSectionOrder,
          matchedSources.map((item) => item.key),
        );
        const matchedByKey = new Map(matchedSources.map((item) => [item.key, item]));

        // Auto-build: keep every selected source visible; only move Sales funnel to the front.
        let displaySourceKeys = orderedSourceKeys;
        if (tableLeadingSourceId) {
          const leadingSourceKey =
            matchedSources.find(
              (item) => item.key === tableLeadingSourceId || item.data?.sourceId === tableLeadingSourceId,
            )?.key ?? null;

          if (leadingSourceKey) {
            displaySourceKeys = [
              leadingSourceKey,
              ...orderedSourceKeys.filter((key) => key !== leadingSourceKey),
            ];
          }
        }

        displaySourceKeys.forEach((sourceKey) => {
          const sourceItem = matchedByKey.get(sourceKey);
          if (!sourceItem) {
            return;
          }

          const sourceData = sourceItem.data;
          const isPlaceholder = sourceItem.isPlaceholder;

          if (!sourceData) {
            if (shouldHideZeroRows) {
              return;
            }

            sourceSectionRows.push({
              kind: 'source_section',
              rowId: `source-section-${sourceKey}`,
              sourceId: sourceKey,
              label: sourceItem.label,
            });
            return;
          }

          const defaultMetricKeys = Object.keys(sourceData.metrics);
          const orderedMetricKeys = mergeIdOrder(
            sourceMetricOrderBySource[sourceKey] ?? [],
            defaultMetricKeys,
          );
          const activeSourceMetricKeys = hasBuiltReport
            ? appliedEnabledMetricKeysBySource[sourceKey]
            : enabledMetricKeysBySource[sourceKey];

          const visibleSourceMetrics = orderedMetricKeys.flatMap((metricKey) => {
            const metric = sourceData.metrics[metricKey];
            if (!metric) {
              return [];
            }

            // Missing entry = default "all enabled"; empty Set = none.
            if (!isPlaceholder && activeSourceMetricKeys && !activeSourceMetricKeys.has(metricKey)) {
              return [];
            }

            const actionIds = buildSourceMetricActionIds(sourceKey, metricKey, sourceData);
            if (
              shouldHideZeroRows
              && !sourceMetricHasNonZero(metric.valuesByPeriod, actionIds)
            ) {
              return [];
            }

            const actionId = buildSourceMetricActionId(sourceKey, metricKey);
            const valueType: MetricRow['type'] =
              metric.valueType === 'money'
                ? 'money'
                : metric.valueType === 'percent'
                  ? 'percent'
                  : 'number';

            return [{
              metricKey,
              metric,
              actionId,
              valueType,
              syntheticMetric: {
                id: actionId,
                label: metric.label,
                type: valueType,
                base: 0,
              } satisfies MetricRow,
              detailSourceIds: sourceData.detailSourceIds ?? [],
              detailMetricIds: metric.detailMetricIds ?? [],
            }];
          });

          if (shouldHideZeroRows && visibleSourceMetrics.length === 0) {
            return;
          }

          sourceSectionRows.push({
            kind: 'source_section',
            rowId: `source-section-${sourceKey}`,
            sourceId: sourceKey,
            label: sourceItem.label,
          });

          // Same as CRM sections: collapsed source blocks only keep the header row.
          if (!expandedSourceSections.has(sourceKey)) {
            return;
          }

          visibleSourceMetrics.forEach(({
            metricKey,
            metric,
            actionId,
            valueType,
            syntheticMetric,
            detailSourceIds,
            detailMetricIds,
          }) => {
            sourceSectionRows.push({
              kind: 'source_metric',
              rowId: `source-metric-${sourceKey}-${metricKey}`,
              sourceId: sourceKey,
              metricKey,
              metricLabel: metric.label,
              valueType: metric.valueType,
            });

            // Same chain as CRM metrics: expand flags → employee/chart rows in tableRows.
            if (expandedEmployeeMetricIds.has(actionId)) {
              const sourceMetricEmployees = buildSourceMetricEmployees(
                reportDetails,
                detailSourceIds,
                detailMetricIds,
                availableEmployees,
              );
              const appliedEmployeeIds = appliedEmployeeIdsByMetricId[actionId] ?? new Set<string>();
              const orderedEmployeeIds = mergeIdOrder(
                employeeOrderByMetricId[actionId] ?? [],
                sourceMetricEmployees.map((employee) => employee.id),
              );
              const employeesById = new Map(sourceMetricEmployees.map((employee) => [employee.id, employee]));
              const selectedEmployees = orderedEmployeeIds
                .filter((employeeId) => appliedEmployeeIds.has(employeeId))
                .map((employeeId) => employeesById.get(employeeId))
                .filter((employee): employee is ReportEmployee => Boolean(employee))
                .map((employee) => remapEmployeeValuesToMetricId(employee, detailMetricIds, actionId));

              const remappedAll = sourceMetricEmployees.map((employee) =>
                remapEmployeeValuesToMetricId(employee, detailMetricIds, actionId),
              );

              const detailResolution = resolveEmployeeDetailList({
                selectedEmployees,
                allEmployees: remappedAll,
                metricId: actionId,
                metricType: valueType,
                reportData,
                readMetricTotal: (point) =>
                  readValuesByPeriod(metric.valuesByPeriod, point.key) ?? 0,
                readEmployeeValue: getEmployeePeriodMetricValue,
              });

              detailResolution.employees.forEach((employee, employeeIndex) => {
                if (shouldHideZeroRows && !employeeHasNonZero(employee, actionId)) {
                  return;
                }

                sourceSectionRows.push({
                  kind: 'employee',
                  rowId: `employee-${actionId}-${employee.id}`,
                  sectionId: sourceKey,
                  metric: syntheticMetric,
                  employee,
                  employeeIndex,
                  sourceId: sourceKey,
                  detailSourceIds,
                  detailMetricIds,
                  isSystemDetail: isSystemEmployeeRow(employee.id),
                });

                if (tableRowChartsMode === 'with_charts'
                  && expandedEmployeeChartIds.has(buildEmployeeChartId(actionId, employee.id))) {
                  sourceSectionRows.push({
                    kind: 'employee_chart',
                    rowId: `employee-chart-${actionId}-${employee.id}`,
                    sectionId: sourceKey,
                    metric: syntheticMetric,
                    employee,
                    sourceId: sourceKey,
                  });
                }
              });
            }

            if (tableRowChartsMode === 'with_charts' && expandedChartMetricIds.has(actionId)) {
              sourceSectionRows.push({
                kind: 'chart',
                rowId: `chart-${actionId}`,
                sectionId: sourceKey,
                metric: syntheticMetric,
                sourceId: sourceKey,
                valuesByPeriod: metric.valuesByPeriod,
              });
            }
          });
        });
      }

      // Auto-build only: Sales (+ all other source blocks) first, then CRM sections.
      // Do not split source blocks apart — every selected source stays in the table.
      if (tableLeadingSourceId && sourceSectionRows.length > 0) {
        return [...sourceSectionRows, ...standardRows];
      }

      return [...standardRows, ...sourceSectionRows];
      },
      [
        visibleSections,
        expandedSections,
        expandedSourceSections,
        // CRITICAL: Use appliedEnabledMetricIdsBySection instead of enabledMetricIdsBySection.
        // When hasBuiltReport is true, the table reads from appliedEnabledMetricIdsBySection.
        // Without this dependency, clicking "Применить" in table/section metrics settings
        // would update appliedEnabledMetricIdsBySection but tableRows would NOT recalculate.
        appliedEnabledMetricIdsBySection,
        enabledMetricIdsBySection,
        appliedEnabledMetricKeysBySource,
        enabledMetricKeysBySource,
        availableEmployees,
        appliedEmployeeIdsByMetricId,
        employeeOrderByMetricId,
        metricMap,
        metricOrderBySection,
        expandedEmployeeMetricIds,
        expandedEmployeeChartIds,
        expandedChartMetricIds,
        tableRowChartsMode,
        hideZeroRows,
        crmSources,
        sourceMetrics,
        reportDetails,
        reportData,
        valueStates,
        hasBuiltReport,
        tableSelectedSources,
        tableLeadingSourceId,
        sourceSectionOrder,
        sourceMetricOrderBySource,
      ],
  );

  // Track source sections the user has manually collapsed, so auto-expand does not re-open them
  const collapsedSourceSectionsByUser = useRef<Set<string>>(new Set());

  // Auto-expand newly added source sections (smart processes, deal pipelines)
  // while preserving user-initiated manual collapses
  useEffect(() => {
    const sourceSectionIds = tableRows
      .filter((row) => row.kind === 'source_section')
      .map((row) => row.sourceId);

    if (!sourceSectionIds.length) {
      return;
    }

    setExpandedSourceSections((previous) => {
      let changed = false;
      const next = new Set(previous);

      for (const id of sourceSectionIds) {
        // Only auto-expand if the user has not manually collapsed this section
        if (!next.has(id) && !collapsedSourceSectionsByUser.current.has(id)) {
          next.add(id);
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [tableRows]);

  const rightContentWidth = CHART_AXIS_WIDTH + reportData.length * periodColumnWidth;
  const periodGridTemplate = `${CHART_AXIS_WIDTH}px repeat(${Math.max(reportData.length, 1)}, minmax(${periodColumnWidth}px, 1fr))`;
  const syncedContentStyle = useMemo<CSSProperties>(() => ({
    width: `max(100%, ${rightContentWidth}px)`,
  }), [rightContentWidth]);
  const gridStyle = useMemo<CSSProperties>(() => ({
    gridTemplateColumns: periodGridTemplate,
  }), [periodGridTemplate]);
  const reportSurfaceStyle = useMemo<CSSProperties>(
    () =>
      ({
        '--period-width': `${periodColumnWidth}px`,
        '--period-font-size': periodColumnWidth <= 44 ? '11px' : '13px',
      }) as CSSProperties,
    [periodColumnWidth],
  );

  // Manual edits inside a temporary auto report are still temporary until "Построить отчет".
  const markUserSettingsChange = useCallback(() => {
    if (temporaryAutoReportModeRef.current) {
      cancelPendingAutoSave();
      return;
    }

    userTouchedReportSettingsRef.current = true;
    suppressReportSettingsTouchRef.current = false;
    skipAutoSaveRef.current = false;
  }, [cancelPendingAutoSave]);

  const handlePeriodChange = useCallback((nextPeriod: Period) => {
    manualDateFiltersBeforeAutoRef.current = null;
    markUserSettingsChange();
    dateRangeSelectedManuallyRef.current = false;
    setDraftFilters((current) => ({
      ...current,
      period: nextPeriod,
      dateRange: getDefaultRangeForPeriod(nextPeriod),
    }));
  }, [markUserSettingsChange]);

  const handleDateRangeChange = useCallback((nextRange: DateRange) => {
    manualDateFiltersBeforeAutoRef.current = null;
    dateRangeSelectedManuallyRef.current = true;
    markUserSettingsChange();
    setDraftFilters((current) => ({
      ...current,
      dateRange: constrainRangeForPeriod(current.period, nextRange),
    }));
  }, [markUserSettingsChange]);

  const applySyncedScroll = useCallback((left: number) => {
    const transform = `translate3d(-${left}px, 0, 0)`;

    if (chartContentRef.current) {
      chartContentRef.current.style.transform = transform;
    }

    if (periodContentRef.current) {
      periodContentRef.current.style.transform = transform;
    }

    if (tableContentRef.current) {
      tableContentRef.current.style.setProperty('--table-scroll-left', `${-left}px`);
    }
  }, []);

  const updateScrollButtonState = useCallback((left?: number) => {
    const node = horizontalScrollbarRef.current;

    if (!node) {
      return;
    }

    const currentLeft = left ?? node.scrollLeft;
    const maxScroll = Math.max(0, node.scrollWidth - node.clientWidth);
    const nextCanBack = currentLeft > 1;
    const nextCanForward = currentLeft < maxScroll - 1;

    if (nextCanBack !== canScrollBackRef.current) {
      canScrollBackRef.current = nextCanBack;
      setCanScrollBack(nextCanBack);
    }

    if (nextCanForward !== canScrollForwardRef.current) {
      canScrollForwardRef.current = nextCanForward;
      setCanScrollForward(nextCanForward);
    }
  }, []);

  const handleHorizontalScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    pendingScrollLeftRef.current = event.currentTarget.scrollLeft;

    if (scrollSyncFrameRef.current !== null) {
      return;
    }

    scrollSyncFrameRef.current = requestAnimationFrame(() => {
      applySyncedScroll(pendingScrollLeftRef.current);
      updateScrollButtonState(pendingScrollLeftRef.current);
      scrollSyncFrameRef.current = null;
    });
  }, [applySyncedScroll, updateScrollButtonState]);

  const scrollByStep = useCallback((direction: -1 | 1, smooth = true) => {
    const node = horizontalScrollbarRef.current;

    if (!node) {
      return;
    }

    const maxScroll = Math.max(0, node.scrollWidth - node.clientWidth);
    const nextLeft = Math.min(
      maxScroll,
      Math.max(0, node.scrollLeft + direction * periodColumnWidth * 3),
    );

    node.scrollTo({
      left: nextLeft,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, [periodColumnWidth]);

  useEffect(() => {
    if (horizontalScrollbarRef.current) {
      horizontalScrollbarRef.current.scrollLeft = 0;
    }

    applySyncedScroll(0);
    requestAnimationFrame(() => updateScrollButtonState(0));
  }, [
    applySyncedScroll,
    updateScrollButtonState,
    reportData.length,
    appliedFilters.period,
    appliedFilters.dateRange,
  ]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const node = horizontalScrollbarRef.current;

      if (!node) {
        return;
      }

      const maxScroll = Math.max(0, node.scrollWidth - node.clientWidth);
      const nextLeft = Math.min(node.scrollLeft, maxScroll);

      if (nextLeft !== node.scrollLeft) {
        node.scrollLeft = nextLeft;
      }

      applySyncedScroll(nextLeft);
      updateScrollButtonState(nextLeft);
    });

    return () => cancelAnimationFrame(frame);
  }, [applySyncedScroll, rightContentWidth, updateScrollButtonState]);

  useEffect(
    () => () => {
      if (autoScrollFrameRef.current !== null) {
        cancelAnimationFrame(autoScrollFrameRef.current);
      }

      if (scrollSyncFrameRef.current !== null) {
        cancelAnimationFrame(scrollSyncFrameRef.current);
      }

      if (holdDelayRef.current !== null) {
        window.clearTimeout(holdDelayRef.current);
      }
    },
    [],
  );

  const stopAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }

    if (holdDelayRef.current !== null) {
      window.clearTimeout(holdDelayRef.current);
      holdDelayRef.current = null;
    }
  }, []);

  const startAutoScroll = useCallback((direction: -1 | 1) => {
    if (autoScrollFrameRef.current !== null) {
      return;
    }

    const step = () => {
      const node = horizontalScrollbarRef.current;

      if (!node) {
        stopAutoScroll();
        return;
      }

      const maxScroll = node.scrollWidth - node.clientWidth;
      const nextLeft = Math.min(
        maxScroll,
        Math.max(0, node.scrollLeft + direction * 8),
      );

      if (nextLeft === node.scrollLeft) {
        stopAutoScroll();
        return;
      }

      node.scrollLeft = nextLeft;
      autoScrollFrameRef.current = requestAnimationFrame(step);
    };

    autoScrollFrameRef.current = requestAnimationFrame(step);
  }, [stopAutoScroll]);

  const handleScrollButtonPointerDown = useCallback((direction: -1 | 1, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 && event.button !== 2) {
      return;
    }

    if (event.button === 2) {
      event.preventDefault();
    }

    holdActiveRef.current = false;
    holdDelayRef.current = window.setTimeout(() => {
      holdActiveRef.current = true;
      startAutoScroll(direction);
    }, 160);
  }, [startAutoScroll]);

  const handleScrollButtonPointerUp = useCallback(() => {
    stopAutoScroll();
  }, [stopAutoScroll]);

  const handleScrollButtonClick = useCallback((direction: -1 | 1) => {
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      return;
    }

    scrollByStep(direction, true);
  }, [scrollByStep]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections((current) => {
      const next = new Set(current);

      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }

      return next;
    });
  };

  const toggleSourceSection = (sourceId: string) => {
    // Track user-initiated collapses so auto-expand does not re-open them
    if (expandedSourceSections.has(sourceId)) {
      collapsedSourceSectionsByUser.current = new Set(collapsedSourceSectionsByUser.current);
      collapsedSourceSectionsByUser.current.add(sourceId);
    } else {
      // User is expanding — remove from collapsed tracking
      collapsedSourceSectionsByUser.current = new Set(collapsedSourceSectionsByUser.current);
      collapsedSourceSectionsByUser.current.delete(sourceId);
    }

    setExpandedSourceSections((current) => {
      const next = new Set(current);

      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }

      return next;
    });
  };

  const toggleEnabledSection = (sectionId: string) => {
    markUserSettingsChange();
    const section = metricSections.find((item) => item.id === sectionId);
    const enabling = !draftFilters.enabledSectionIds.has(sectionId);

    setDraftFilters((current) => {
      const nextSectionIds = new Set(current.enabledSectionIds);

      if (enabling) {
        nextSectionIds.add(sectionId);
      } else {
        nextSectionIds.delete(sectionId);
      }

      return {
        ...current,
        enabledSectionIds: nextSectionIds,
      };
    });

    setEnabledMetricIdsBySection((current) => ({
      ...current,
      [sectionId]: enabling && section ? new Set(section.metricIds) : new Set(),
    }));
    if (enabling && section) {
      setMetricOrderBySection((current) => ({
        ...current,
        [sectionId]: mergeIdOrder(current[sectionId] ?? [], section.metricIds),
      }));
    }
  };

  const enableAllTableSettings = useCallback(() => {
    markUserSettingsChange();
    setDraftFilters((current) => ({
      ...current,
      enabledSectionIds: new Set(metricSections.map((section) => section.id)),
    }));
    setDraftTableSelectedSources([...crmSourceIds]);
    setEnabledMetricIdsBySection(
      metricSections.reduce<Record<string, Set<string>>>((acc, section) => {
        acc[section.id] = new Set(section.metricIds);
        return acc;
      }, {}),
    );
    setMetricOrderBySection((current) => {
      const next = { ...current };
      metricSections.forEach((section) => {
        next[section.id] = mergeIdOrder(next[section.id] ?? [], section.metricIds);
      });
      return next;
    });
  }, [crmSourceIds, markUserSettingsChange, metricSections]);

  const resetTableSettings = useCallback(() => {
    markUserSettingsChange();
    setDraftFilters((current) => ({
      ...current,
      enabledSectionIds: new Set(),
    }));
    setDraftTableSelectedSources([]);
    setEnabledMetricIdsBySection(
      metricSections.reduce<Record<string, Set<string>>>((acc, section) => {
        acc[section.id] = new Set();
        return acc;
      }, {}),
    );
  }, [markUserSettingsChange, metricSections]);

  const toggleEnabledMetric = useCallback((sectionId: string, metricId: string) => {
    markUserSettingsChange();
    setEnabledMetricIdsBySection((current) => {
      const currentMetricIds = current[sectionId] ?? new Set<string>();
      const nextMetricIds = new Set(currentMetricIds);

      if (nextMetricIds.has(metricId)) {
        nextMetricIds.delete(metricId);
      } else {
        nextMetricIds.add(metricId);
      }

      return {
        ...current,
        [sectionId]: nextMetricIds,
      };
    });
    setMetricOrderBySection((current) => ({
      ...current,
      [sectionId]: mergeIdOrder(current[sectionId] ?? [], [metricId]),
    }));
  }, [markUserSettingsChange]);

  const selectAllSectionMetrics = useCallback((sectionId: string) => {
    const section = metricSections.find((item) => item.id === sectionId);

    if (!section) {
      return;
    }

    markUserSettingsChange();
    setEnabledMetricIdsBySection((current) => ({
      ...current,
      [sectionId]: new Set(section.metricIds),
    }));
    setMetricOrderBySection((current) => ({
      ...current,
      [sectionId]: mergeIdOrder(current[sectionId] ?? [], section.metricIds),
    }));
  }, [markUserSettingsChange, metricSections]);

  const resetSectionMetrics = useCallback((sectionId: string) => {
    markUserSettingsChange();
    setEnabledMetricIdsBySection((current) => ({
      ...current,
      [sectionId]: new Set(),
    }));
  }, [markUserSettingsChange]);

  const handleTableSelectedSourcesChange = useCallback((values: string[]) => {
    markUserSettingsChange();
    setDraftTableSelectedSources(values);
  }, [markUserSettingsChange]);

  const handleChartDisplayModeChange = useCallback((_value: ChartDisplayMode) => {
    markUserSettingsChange();
    // WEB-SET-001: separate mode removed from product UI.
    setDraftFilters((current) => ({
      ...current,
      chartDisplayMode: 'sum',
    }));
  }, [markUserSettingsChange]);

  const handleMetricModeChange = useCallback((value: ChartMetricMode) => {
    markUserSettingsChange();
    setDraftFilters((current) => ({
      ...current,
      metricMode: value,
    }));
  }, [markUserSettingsChange]);

  const handleScheduleChange = useCallback((schedule: ScheduleFilters) => {
    markUserSettingsChange();
    setDraftFilters((current) => ({
      ...current,
      schedule: {
        ...schedule,
        weekendDayIds: [...schedule.weekendDayIds],
      },
    }));
  }, [markUserSettingsChange]);

  // Chart draft edits only — must NOT touch applied chart state or trigger preview.
  const updateChartDraftSettings = useCallback((settings: ChartDraftSettings) => {
    markUserSettingsChange();
    setDraftFilters((current) => ({
      ...current,
      selectedSources: [...settings.selectedSources],
      chartDisplayMode: settings.chartDisplayMode,
      metricMode: settings.metricMode,
      schedule: {
        ...settings.schedule,
        weekendDayIds: [...settings.schedule.weekendDayIds],
      },
    }));
  }, [markUserSettingsChange]);

  // Chart Apply — commits draft chart settings to applied only.
  // Does not rebuild the report: data load stays on «Построить отчёт» / «Построить автоматически».
  const applyChartSettings = useCallback((settings: ChartDraftSettings) => {
    markUserSettingsChange();
    if (
      draftFilters.period === 'hours'
      && getWorkdayScheduleError(settings.schedule)
    ) {
      return;
    }

    const nextSources = isProUser
      ? [...settings.selectedSources]
      : settings.selectedSources.slice(0, 1);
    const nextSchedule = {
      ...settings.schedule,
      weekendDayIds: [...settings.schedule.weekendDayIds],
    };
    const nextDisplayMode = 'sum' as const;

    setDraftFilters((current) => ({
      ...current,
      selectedSources: nextSources,
      chartDisplayMode: nextDisplayMode,
      metricMode: settings.metricMode,
      schedule: nextSchedule,
    }));
    setAppliedFilters((current) => ({
      ...current,
      selectedSources: nextSources,
      chartDisplayMode: nextDisplayMode,
      metricMode: settings.metricMode,
      schedule: {
        ...nextSchedule,
        weekendDayIds: [...nextSchedule.weekendDayIds],
      },
    }));
  }, [draftFilters.period, isProUser, markUserSettingsChange]);

  // Table Apply — commits table source/section selection only.
  // Does not rebuild the report: data load stays on «Построить отчёт» / «Построить автоматически».
  const applyTableSettings = useCallback(() => {
    markUserSettingsChange();
    const availableSectionIds = new Set(metricSections.map((section) => section.id));
    const { sectionIds, pipelineSourceIds, entitySourceIds } = resolveTableSelectionFromSources(
      draftTableSelectedSources,
      crmSources,
      availableSectionIds,
    );

    const nextEnabledMetricIdsBySection = metricSections.reduce<Record<string, Set<string>>>(
      (acc, section) => {
        acc[section.id] = sectionIds.has(section.id)
          ? new Set(section.metricIds)
          : new Set();
        return acc;
      },
      {},
    );

    // Pipelines/smart only — must not overwrite chart sources.
    setTableSelectedSources(pipelineSourceIds);
    setTableEntitySourceIds(entitySourceIds);
    setDraftTableSelectedSources([...entitySourceIds, ...pipelineSourceIds]);
    setDraftFilters((current) => ({
      ...current,
      enabledSectionIds: new Set(sectionIds),
    }));
    setAppliedFilters((current) => ({
      ...current,
      enabledSectionIds: new Set(sectionIds),
    }));
    setEnabledMetricIdsBySection(
      Object.fromEntries(
        Object.entries(nextEnabledMetricIdsBySection).map(([sectionId, metricIds]) => [
          sectionId,
          new Set(metricIds),
        ]),
      ),
    );
    setAppliedEnabledMetricIdsBySection(
      Object.fromEntries(
        Object.entries(nextEnabledMetricIdsBySection).map(([sectionId, metricIds]) => [
          sectionId,
          new Set(metricIds),
        ]),
      ),
    );
    setMetricOrderBySection((current) => {
      const next = { ...current };
      metricSections.forEach((section) => {
        next[section.id] = mergeIdOrder(next[section.id] ?? [], section.metricIds);
      });
      return next;
    });
    setExpandedSections(new Set(sectionIds));
  }, [
    crmSources,
    draftTableSelectedSources,
    markUserSettingsChange,
    metricSections,
  ]);

  const applySectionMetrics = useCallback((sectionId: string) => {
    markUserSettingsChange();
    setAppliedEnabledMetricIdsBySection((current) => {
      const draftMetricIds = enabledMetricIdsBySection[sectionId];
      if (!draftMetricIds) {
        return current;
      }
      return {
        ...current,
        [sectionId]: new Set(draftMetricIds),
      };
    });
  }, [enabledMetricIdsBySection, markUserSettingsChange]);

  const toggleSourceMetric = useCallback((sourceId: string, metricKey: string) => {
    markUserSettingsChange();
    setEnabledMetricKeysBySource((current) => {
      const defaultKeys = Object.keys(sourceMetrics[sourceId]?.metrics ?? {});
      const currentKeys = current[sourceId] ?? new Set(defaultKeys);
      const nextKeys = new Set(currentKeys);

      if (nextKeys.has(metricKey)) {
        nextKeys.delete(metricKey);
      } else {
        nextKeys.add(metricKey);
      }

      return {
        ...current,
        [sourceId]: nextKeys,
      };
    });
  }, [markUserSettingsChange, sourceMetrics]);

  const selectAllSourceMetrics = useCallback((sourceId: string) => {
    const metricKeys = Object.keys(sourceMetrics[sourceId]?.metrics ?? {});
    markUserSettingsChange();
    setEnabledMetricKeysBySource((current) => ({
      ...current,
      [sourceId]: new Set(metricKeys),
    }));
  }, [markUserSettingsChange, sourceMetrics]);

  const resetSourceMetrics = useCallback((sourceId: string) => {
    markUserSettingsChange();
    setEnabledMetricKeysBySource((current) => ({
      ...current,
      [sourceId]: new Set(),
    }));
  }, [markUserSettingsChange]);

  const applySourceMetrics = useCallback((sourceId: string) => {
    markUserSettingsChange();
    setAppliedEnabledMetricKeysBySource((current) => {
      const draftKeys = enabledMetricKeysBySource[sourceId];
      if (!draftKeys) {
        return current;
      }
      return {
        ...current,
        [sourceId]: new Set(draftKeys),
      };
    });
  }, [enabledMetricKeysBySource, markUserSettingsChange]);

  // Seed default "all metrics enabled" for newly appeared source blocks (no markUserSettingsChange).
  useEffect(() => {
    const entries = Object.entries(sourceMetrics);
    if (!entries.length) {
      return;
    }

    const seedMissing = (current: Record<string, Set<string>>) => {
      let changed = false;
      const next = { ...current };

      entries.forEach(([sourceKey, sourceData]) => {
        if (next[sourceKey]) {
          return;
        }
        next[sourceKey] = new Set(Object.keys(sourceData.metrics));
        changed = true;
      });

      return changed ? next : current;
    };

    setEnabledMetricKeysBySource(seedMissing);
    setAppliedEnabledMetricKeysBySource(seedMissing);
  }, [sourceMetrics]);

  const applyReportBuild = useCallback((
    selectedSources: string[],
    overrides: Partial<Pick<ReportFilters, 'period' | 'dateRange' | 'metricMode' | 'chartDisplayMode' | 'schedule'>> = {},
  ) => {
    if (!canStartReportBuild()) {
      return;
    }

    markUserSettingsChange();
    const period = overrides.period ?? draftFilters.period;
    const dateRange = overrides.dateRange ?? draftFilters.dateRange;
    const metricMode = overrides.metricMode ?? draftFilters.metricMode;
    const chartDisplayMode = overrides.chartDisplayMode ?? draftFilters.chartDisplayMode;
    const schedule = overrides.schedule
      ? {
          ...overrides.schedule,
          weekendDayIds: [...overrides.schedule.weekendDayIds],
        }
      : {
          ...draftFilters.schedule,
          weekendDayIds: [...draftFilters.schedule.weekendDayIds],
        };

    setHasBuiltReport(true);
    setDraftFilters((current) => ({
      ...current,
      period,
      dateRange,
      selectedSources,
      metricMode,
      chartDisplayMode,
      schedule,
    }));
    // Build updates chart filters + period only.
    // Table visibility stays under table settings (applied enabledSectionIds /
    // tableSelectedSources / appliedEnabledMetricIdsBySection).
    setAppliedFilters((current) => ({
      ...current,
      period,
      dateRange,
      selectedSources,
      chartDisplayMode,
      metricMode,
      schedule: {
        ...schedule,
        weekendDayIds: [...schedule.weekendDayIds],
      },
    }));
    setBuildMoment(Date.now());
    requestReportBuild();
  }, [canStartReportBuild, draftFilters, markUserSettingsChange, requestReportBuild]);

  type IndicatorsBuildSnapshot = {
    chartSources: string[];
    metricMode: ChartDraftSettings['metricMode'];
    schedule: ChartDraftSettings['schedule'];
    pipelineSourceIds: string[];
    entitySourceIds: string[];
    sectionIds: Set<string>;
    enabledMetricIdsBySection: Record<string, Set<string>>;
    tableRowChartsMode: IndicatorsSettingsDraft['tableRowChartsMode'];
  };

  const buildReportFromDraft = useCallback((options?: {
    automaticThresholds?: boolean;
    /** Explicit snapshot from settings panel — avoids stale React state after commit. */
    fromIndicators?: IndicatorsBuildSnapshot;
  }) => {
    const automaticThresholds = options?.automaticThresholds ?? false;
    const fromIndicators = options?.fromIndicators;
    const restoredManualDateFilters = temporaryAutoReportModeRef.current
      ? manualDateFiltersBeforeAutoRef.current
      : null;

    temporaryAutoReportModeRef.current = false;
    applyAutomaticThresholdsRef.current = automaticThresholds;
    autoBuildChartSourcesRef.current = null;
    autoBuildTableSourcesRef.current = null;
    autoBuildDateFiltersRef.current = null;
    pendingAutoBuildSummaryRef.current = null;
    manualDateFiltersBeforeAutoRef.current = null;

    let pipelineSourceIds: string[];
    let entitySourceIds: string[];
    let nextEnabledMetricIdsBySection: Record<string, Set<string>>;
    let nextEnabledSectionIds: Set<string>;
    let chartSources: string[];
    let chartMetricMode = draftFilters.metricMode;
    let chartSchedule = draftFilters.schedule;
    let nextTableRowChartsMode = tableRowChartsMode;

    if (fromIndicators) {
      pipelineSourceIds = [...fromIndicators.pipelineSourceIds];
      entitySourceIds = [...fromIndicators.entitySourceIds];
      nextEnabledSectionIds = new Set(fromIndicators.sectionIds);
      nextEnabledMetricIdsBySection = Object.fromEntries(
        Object.entries(fromIndicators.enabledMetricIdsBySection).map(([sectionId, metricIds]) => [
          sectionId,
          new Set(metricIds),
        ]),
      );
      chartSources = sanitizeChartSources(fromIndicators.chartSources);
      chartMetricMode = fromIndicators.metricMode;
      chartSchedule = {
        ...fromIndicators.schedule,
        weekendDayIds: [...fromIndicators.schedule.weekendDayIds],
      };
      nextTableRowChartsMode = fromIndicators.tableRowChartsMode;
    } else {
      const availableSectionIds = new Set(metricSections.map((section) => section.id));
      const resolved = resolveTableSelectionFromSources(
        draftTableSelectedSources,
        crmSources,
        availableSectionIds,
      );
      pipelineSourceIds = resolved.pipelineSourceIds;
      entitySourceIds = resolved.entitySourceIds;
      nextEnabledSectionIds = new Set(draftFilters.enabledSectionIds);
      nextEnabledMetricIdsBySection = Object.fromEntries(
        Object.entries(enabledMetricIdsBySection).map(([sectionId, metricIds]) => [
          sectionId,
          new Set(metricIds),
        ]),
      );
      chartSources = sanitizeChartSources(draftFilters.selectedSources);
    }

    setTableSelectedSources(pipelineSourceIds);
    setTableEntitySourceIds(entitySourceIds);
    setDraftTableSelectedSources([...entitySourceIds, ...pipelineSourceIds]);
    setEnabledMetricIdsBySection(
      Object.fromEntries(
        Object.entries(nextEnabledMetricIdsBySection).map(([sectionId, metricIds]) => [
          sectionId,
          new Set(metricIds),
        ]),
      ),
    );
    setAppliedEnabledMetricIdsBySection(
      Object.fromEntries(
        Object.entries(nextEnabledMetricIdsBySection).map(([sectionId, metricIds]) => [
          sectionId,
          new Set(metricIds),
        ]),
      ),
    );
    setDraftFilters((current) => ({
      ...current,
      enabledSectionIds: new Set(nextEnabledSectionIds),
    }));
    setAppliedFilters((current) => ({
      ...current,
      enabledSectionIds: new Set(nextEnabledSectionIds),
    }));
    if (nextTableRowChartsMode === 'with_charts') {
      pendingExpandRowChartsRef.current = true;
      sawReportLoadingForExpandRef.current = false;
    }
    resetTemporaryReportUiState();
    setMainThreshold({ upper: '', lower: '', mode: null });
    setRowThresholds({});
    setEmployeeThresholdsByMetricId({});
    immediateAutoSaveRef.current = true;
    setAutoSaveRequest((current) => current + 1);
    // Empty chart selection stays empty — never expand to all/default sources.
    applyReportBuild(chartSources, {
      ...(restoredManualDateFilters ?? {}),
      metricMode: chartMetricMode,
      chartDisplayMode: 'sum',
      schedule: chartSchedule,
    });
  }, [
    applyReportBuild,
    crmSources,
    draftFilters.enabledSectionIds,
    draftFilters.metricMode,
    draftFilters.schedule,
    draftFilters.selectedSources,
    draftTableSelectedSources,
    enabledMetricIdsBySection,
    metricSections,
    resetTemporaryReportUiState,
    sanitizeChartSources,
    tableRowChartsMode,
  ]);

  const buildReport = useCallback(() => {
    buildReportFromDraft();
  }, [buildReportFromDraft]);

  const buildReportWithAutomaticThresholds = useCallback(() => {
    buildReportFromDraft({ automaticThresholds: true });
  }, [buildReportFromDraft]);

  const buildAutomaticReport = useCallback((options?: { automaticThresholds?: boolean }) => {
    if (!canStartReportBuild()) {
      return;
    }

    const automaticThresholds = options?.automaticThresholds ?? true;
    const preset = buildAutomaticReportPreset(crmSources, crmSourceIds, metricSections);
    if (!preset) {
      const hasAnyAvailableDeal = crmSources.some(
        (source) => isDealPipelineSource(source) && isCrmSourceAvailable(source),
      );
      setNotification(
        hasAnyAvailableDeal
          ? 'Не удалось подобрать показатели автоматически: нет доступных разделов каталога.'
          : 'Нет доступной воронки продаж. Проверьте права CRM или выберите показатели вручную.',
      );
      return;
    }

    const salesSource = preset.salesSource;
    dateRangeSelectedManuallyRef.current = false;
    if (!manualDateFiltersBeforeAutoRef.current) {
      manualDateFiltersBeforeAutoRef.current = {
        period: draftFilters.period,
        dateRange: draftFilters.dateRange,
      };
    }

    // Do not persist this beginner preset into Pro saved settings.
    // Keep skip active until this generation finishes applying after preview.
    temporaryAutoReportModeRef.current = true;
    cancelPendingAutoSave();
    const generation = autoBuildGenerationRef.current + 1;
    autoBuildGenerationRef.current = generation;
    activeAutoBuildGenerationRef.current = generation;
    skipAutoSaveRef.current = true;
    pendingAutoBuildSummaryRef.current = {
      generation,
      mainIndicatorLabel: getCrmSourceDisplayLabel(salesSource),
      skippedUnavailableLabels: [...preset.skippedUnavailableLabels],
      wantCorridors: automaticThresholds,
    };

    const dateRange = preset.dateRange;
    autoBuildDateFiltersRef.current = {
      period: 'days',
      dateRange,
    };
    // Chart settings only: exactly one source — Sales funnel. Never copy table selection here.
    const chartSources = [...preset.chartSources];
    autoBuildChartSourcesRef.current = chartSources;
    const { pipelineSourceIds, entitySourceIds } = preset;
    // Lock full table selection for preview request (pipelines + entities).
    autoBuildTableSourcesRef.current = [...preset.tablePreviewSourceIds];
    const nextEnabledSectionIds = new Set(preset.enabledSectionIds);
    const nextEnabledMetrics = preset.enabledMetricIdsBySection;
    const nextSectionOrder = preset.sectionOrder;

    applyAutomaticThresholdsRef.current = automaticThresholds;
    setEmployeeThresholdsByMetricId({});
    // Same as manual corridor build: start from a clean auto corridor slate.
    // Manual corridors are preserved in the merge step after preview.
    if (automaticThresholds) {
      setMainThreshold((current) => (
        isManualThreshold(current) ? current : { upper: '', lower: '', mode: null }
      ));
      setRowThresholds((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([, value]) => isManualThreshold(value)),
        ),
      );
    } else {
      setMainThreshold({ upper: '', lower: '', mode: null });
      setRowThresholds({});
    }

    setDraftFilters((current) => ({
      ...current,
      period: 'days',
      dateRange,
      selectedSources: [...chartSources],
      metricMode: preset.chartMetricMode,
      chartDisplayMode: preset.chartDisplayMode,
      enabledSectionIds: new Set(nextEnabledSectionIds),
    }));
    setEnabledMetricIdsBySection(cloneSetRecord(nextEnabledMetrics));
    setAppliedFilters((current) => ({
      ...current,
      period: 'days',
      dateRange,
      selectedSources: [...chartSources],
      metricMode: preset.chartMetricMode,
      chartDisplayMode: preset.chartDisplayMode,
      enabledSectionIds: new Set(nextEnabledSectionIds),
      schedule: {
        ...current.schedule,
        weekendDayIds: [...current.schedule.weekendDayIds],
      },
    }));
    setAppliedEnabledMetricIdsBySection(cloneSetRecord(nextEnabledMetrics));
    setTableSelectedSources(pipelineSourceIds);
    setTableEntitySourceIds(entitySourceIds);
    setDraftTableSelectedSources([...entitySourceIds, ...pipelineSourceIds]);
    setSectionOrder(nextSectionOrder);
    setSourceSectionOrder([]);
    setTableLeadingSourceId(salesSource.id);
    setExpandedSections(new Set(nextEnabledSectionIds));
    setExpandedChartMetricIds(new Set());
    setExpandedEmployeeChartIds(new Set());
    setExpandedEmployeeMetricIds(new Set());
    setTableRowChartsMode('compact');
    setHideZeroRows(true);
    setHighlightDeviations(automaticThresholds);

    setHasBuiltReport(true);
    setBuildMoment(Date.now());
    requestReportBuild();
  }, [cancelPendingAutoSave, canStartReportBuild, crmSourceIds, crmSources, draftFilters.dateRange, draftFilters.period, metricSections, requestReportBuild]);

  const runUnifiedReportBuild = useCallback(() => {
    if (!canStartReportBuild()) {
      return;
    }

    if (highlightDeviations) {
      buildReportWithAutomaticThresholds();
      return;
    }

    buildReport();
  }, [
    buildReport,
    buildReportWithAutomaticThresholds,
    canStartReportBuild,
    highlightDeviations,
  ]);

  const runAutomaticReportBuild = useCallback(() => {
    if (!canStartReportBuild()) {
      return;
    }
    // WEB-SET-001 W04: auto-flow always enables corridors + deviation highlight.
    buildAutomaticReport({ automaticThresholds: true });
  }, [buildAutomaticReport, canStartReportBuild]);

  const openIndicatorsSettingsPanel = useCallback(() => {
    setIndicatorsSettingsDraft(
      createIndicatorsSettingsDraft({
        filters: {
          ...draftFilters,
          selectedSources: isProUser
            ? [...draftFilters.selectedSources]
            : draftFilters.selectedSources.slice(0, 1),
          chartDisplayMode: 'sum',
        },
        tableSelectedSources: draftTableSelectedSources,
        tableRowChartsMode,
        hideZeroRows,
        highlightDeviations,
        customTitle: mainIndicatorCustomTitle,
      }),
    );
    setIsIndicatorsSettingsOpen(true);
  }, [
    draftFilters,
    draftTableSelectedSources,
    hideZeroRows,
    highlightDeviations,
    isProUser,
    mainIndicatorCustomTitle,
    tableRowChartsMode,
  ]);

  const closeIndicatorsSettingsPanel = useCallback(() => {
    setIsIndicatorsSettingsOpen(false);
    setIndicatorsSettingsDraft(null);
  }, []);

  const handleAutoSetupClick = useCallback(() => {
    if (isAutoSetupPromptSuppressed()) {
      runAutomaticReportBuild();
      return;
    }
    setIsAutoSetupConfirmOpen(true);
  }, [runAutomaticReportBuild]);

  const commitIndicatorsSettingsDraft = useCallback((draft: IndicatorsSettingsDraft): IndicatorsBuildSnapshot => {
    const sanitizedSources = (!isProUser || !draft.useSumIndicators)
      ? draft.chart.selectedSources.slice(0, 1)
      : [...draft.chart.selectedSources];
    const chartSources = sanitizeChartSources(sanitizedSources);
    const nextSchedule = {
      ...draft.chart.schedule,
      weekendDayIds: [...draft.chart.schedule.weekendDayIds],
    };

    applyChartSettings({
      selectedSources: chartSources,
      chartDisplayMode: 'sum',
      metricMode: draft.chart.metricMode,
      schedule: nextSchedule,
    });

    markUserSettingsChange();
    const availableSectionIds = new Set(metricSections.map((section) => section.id));
    const { sectionIds, pipelineSourceIds, entitySourceIds } = resolveTableSelectionFromSources(
      draft.tableSelectedSources,
      crmSources,
      availableSectionIds,
    );
    const nextEnabledMetricIdsBySection = metricSections.reduce<Record<string, Set<string>>>(
      (acc, section) => {
        acc[section.id] = sectionIds.has(section.id)
          ? new Set(section.metricIds)
          : new Set();
        return acc;
      },
      {},
    );
    const enabledMetricSnapshot = Object.fromEntries(
      Object.entries(nextEnabledMetricIdsBySection).map(([sectionId, metricIds]) => [
        sectionId,
        new Set(metricIds),
      ]),
    );
    setTableSelectedSources(pipelineSourceIds);
    setTableEntitySourceIds(entitySourceIds);
    setDraftTableSelectedSources([...entitySourceIds, ...pipelineSourceIds]);
    setDraftFilters((current) => ({
      ...current,
      enabledSectionIds: new Set(sectionIds),
    }));
    setAppliedFilters((current) => ({
      ...current,
      enabledSectionIds: new Set(sectionIds),
    }));
    setEnabledMetricIdsBySection(
      Object.fromEntries(
        Object.entries(nextEnabledMetricIdsBySection).map(([sectionId, metricIds]) => [
          sectionId,
          new Set(metricIds),
        ]),
      ),
    );
    setAppliedEnabledMetricIdsBySection(
      Object.fromEntries(
        Object.entries(nextEnabledMetricIdsBySection).map(([sectionId, metricIds]) => [
          sectionId,
          new Set(metricIds),
        ]),
      ),
    );
    setMetricOrderBySection((current) => {
      const next = { ...current };
      metricSections.forEach((section) => {
        next[section.id] = mergeIdOrder(next[section.id] ?? [], section.metricIds);
      });
      return next;
    });
    setExpandedSections(new Set(sectionIds));
    setTableRowChartsMode(draft.tableRowChartsMode);
    setHideZeroRows(draft.hideZeroRows);
    setHighlightDeviations(draft.highlightDeviations);
    setMainIndicatorCustomTitle(isProUser ? draft.customTitle.trim() : '');

    return {
      chartSources,
      metricMode: draft.chart.metricMode,
      schedule: nextSchedule,
      pipelineSourceIds,
      entitySourceIds,
      sectionIds: new Set(sectionIds),
      enabledMetricIdsBySection: enabledMetricSnapshot,
      tableRowChartsMode: draft.tableRowChartsMode,
    };
  }, [
    applyChartSettings,
    crmSources,
    isProUser,
    markUserSettingsChange,
    metricSections,
    sanitizeChartSources,
  ]);

  const showSummaryFromPanel = useCallback(() => {
    if (!indicatorsSettingsDraft) {
      return;
    }
    const scheduleError =
      draftFilters.period === 'hours'
        ? getWorkdayScheduleError(indicatorsSettingsDraft.chart.schedule)
        : null;
    if (scheduleError) {
      setNotification(scheduleError);
      return;
    }
    const draftSnapshot = indicatorsSettingsDraft;
    const committed = commitIndicatorsSettingsDraft(draftSnapshot);
    closeIndicatorsSettingsPanel();
    if (!canStartReportBuild()) {
      return;
    }
    buildReportFromDraft({
      automaticThresholds: draftSnapshot.highlightDeviations,
      fromIndicators: committed,
    });
  }, [
    buildReportFromDraft,
    canStartReportBuild,
    closeIndicatorsSettingsPanel,
    commitIndicatorsSettingsDraft,
    draftFilters.period,
    indicatorsSettingsDraft,
  ]);

  const saveSetFromPanel = useCallback(() => {
    if (!indicatorsSettingsDraft || !isProUser) {
      return;
    }
    const name = indicatorsSettingsDraft.saveSetName.trim();
    if (!name) {
      setNotification('Укажите название набора');
      return;
    }
    const scheduleError =
      draftFilters.period === 'hours'
        ? getWorkdayScheduleError(indicatorsSettingsDraft.chart.schedule)
        : null;
    if (scheduleError) {
      setNotification(scheduleError);
      return;
    }
    const draftSnapshot = indicatorsSettingsDraft;
    const committed = commitIndicatorsSettingsDraft(draftSnapshot);
    closeIndicatorsSettingsPanel();
    if (canStartReportBuild()) {
      buildReportFromDraft({
        automaticThresholds: draftSnapshot.highlightDeviations,
        fromIndicators: committed,
      });
    }
    setNewViewName(name);
    setEditingViewId(null);
    setIsSaveOpen(true);
  }, [
    buildReportFromDraft,
    canStartReportBuild,
    closeIndicatorsSettingsPanel,
    commitIndicatorsSettingsDraft,
    draftFilters.period,
    indicatorsSettingsDraft,
    isProUser,
  ]);

  const openDetail = useCallback((
    metric: MetricRow,
    point: ReportPoint,
    value: number,
    sectionId: string,
    employee?: ReportEmployee,
    sourceId?: string,
    detailSourceIds?: string[],
    detailMetricIds?: string[],
  ) => {
    detailScrollSnapshotRef.current = {
      horizontal: horizontalScrollbarRef.current?.scrollLeft ?? 0,
      reportCard: reportCardRef.current?.scrollTop ?? 0,
      windowY: window.scrollY,
    };

    setDetailContext({
      metric,
      point,
      value,
      employee,
      entityType: getEntityTypeForMetric(metric, sectionId),
      sourceId,
      detailSourceIds,
      detailMetricIds,
    });
  }, []);

  const closeDetail = useCallback(() => {
    setDetailContext(null);

    const snapshot = detailScrollSnapshotRef.current;
    if (!snapshot) {
      return;
    }

    requestAnimationFrame(() => {
      const scrollbar = horizontalScrollbarRef.current;
      if (scrollbar) {
        scrollbar.scrollLeft = snapshot.horizontal;
        applySyncedScroll(snapshot.horizontal);
        updateScrollButtonState(snapshot.horizontal);
      }

      if (reportCardRef.current) {
        reportCardRef.current.scrollTop = snapshot.reportCard;
      }

      window.scrollTo({ top: snapshot.windowY });
    });
  }, [applySyncedScroll, updateScrollButtonState]);
  const detailRows = useMemo(
    () => (detailContext ? buildBackendDetailRows(reportDetails, detailContext) : []),
    [detailContext, reportDetails],
  );

  const toggleEmployeeRows = useCallback((metricId: string) => {
    setExpandedEmployeeMetricIds((current) => {
      const next = new Set(current);

      if (next.has(metricId)) {
        next.delete(metricId);
      } else {
        next.add(metricId);
      }

      return next;
    });
  }, []);

  const ensureEmployeeSelectorDraft = useCallback((metricId: string) => {
    setDraftEmployeeIdsByMetricId((current) => {
      return {
        ...current,
        [metricId]: new Set(appliedEmployeeIdsByMetricId[metricId] ?? []),
      };
    });
  }, [appliedEmployeeIdsByMetricId]);

  const discardEmployeeSelectorDraft = useCallback((metricId: string) => {
    setDraftEmployeeIdsByMetricId((current) => ({
      ...current,
      [metricId]: new Set(appliedEmployeeIdsByMetricId[metricId] ?? []),
    }));
  }, [appliedEmployeeIdsByMetricId]);

  const toggleDraftMetricEmployee = useCallback((metricId: string, employeeId: string) => {
    setDraftEmployeeIdsByMetricId((current) => {
      const nextEmployeeIds = new Set(current[metricId] ?? appliedEmployeeIdsByMetricId[metricId] ?? []);

      if (nextEmployeeIds.has(employeeId)) {
        nextEmployeeIds.delete(employeeId);
      } else {
        nextEmployeeIds.add(employeeId);
      }

      return {
        ...current,
        [metricId]: nextEmployeeIds,
      };
    });
  }, [appliedEmployeeIdsByMetricId]);

  const selectAllDraftMetricEmployees = useCallback((metricId: string, employeeIds: string[]) => {
    setDraftEmployeeIdsByMetricId((current) => ({
      ...current,
      [metricId]: new Set(employeeIds),
    }));
  }, []);

  const resetDraftMetricEmployees = useCallback((metricId: string) => {
    setDraftEmployeeIdsByMetricId((current) => ({
      ...current,
      [metricId]: new Set(),
    }));
  }, []);

  const applyMetricEmployees = useCallback((metricId: string, availableEmployeeIds: string[]) => {
    setAppliedEmployeeIdsByMetricId((current) => {
      const nextEmployeeIds = new Set(draftEmployeeIdsByMetricId[metricId] ?? []);
      const next = { ...current };

      if (nextEmployeeIds.size > 0) {
        next[metricId] = nextEmployeeIds;
      } else {
        delete next[metricId];
      }

      return next;
    });

    setEmployeeOrderByMetricId((current) => {
      const nextEmployeeIds = new Set(draftEmployeeIdsByMetricId[metricId] ?? []);
      const selectedInAvailableOrder = availableEmployeeIds.filter((employeeId) => nextEmployeeIds.has(employeeId));
      const selectedEmployeeIds = [
        ...selectedInAvailableOrder,
        ...Array.from(nextEmployeeIds).filter((employeeId) => !selectedInAvailableOrder.includes(employeeId)),
      ];
      const nextOrder = mergeIdOrder(current[metricId] ?? [], selectedEmployeeIds);
      const next = { ...current };

      if (nextOrder.length > 0) {
        next[metricId] = nextOrder;
      } else {
        delete next[metricId];
      }

      return next;
    });

    setExpandedEmployeeMetricIds((current) => {
      const next = new Set(current);
      const nextEmployeeIds = draftEmployeeIdsByMetricId[metricId] ?? new Set<string>();

      if (nextEmployeeIds.size > 0) {
        next.add(metricId);
      } else {
        next.delete(metricId);
      }

      return next;
    });
  }, [draftEmployeeIdsByMetricId]);

  const hideAppliedMetricEmployee = useCallback((metricId: string, employeeId: string) => {
    setAppliedEmployeeIdsByMetricId((current) => {
      const currentEmployeeIds = current[metricId];

      if (!currentEmployeeIds?.has(employeeId)) {
        return current;
      }

      const nextEmployeeIds = new Set(currentEmployeeIds);
      nextEmployeeIds.delete(employeeId);
      const next = { ...current };

      if (nextEmployeeIds.size > 0) {
        next[metricId] = nextEmployeeIds;
      } else {
        delete next[metricId];
      }

      return next;
    });

    setDraftEmployeeIdsByMetricId((current) => {
      const currentEmployeeIds = current[metricId] ?? appliedEmployeeIdsByMetricId[metricId];

      if (!currentEmployeeIds?.has(employeeId)) {
        return current;
      }

      const nextEmployeeIds = new Set(currentEmployeeIds);
      nextEmployeeIds.delete(employeeId);

      return {
        ...current,
        [metricId]: nextEmployeeIds,
      };
    });

    setExpandedEmployeeChartIds((current) => {
      const chartId = buildEmployeeChartId(metricId, employeeId);

      if (!current.has(chartId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(chartId);
      return next;
    });
  }, [appliedEmployeeIdsByMetricId]);

  const toggleMetricChart = useCallback((metricId: string) => {
    setExpandedChartMetricIds((current) => {
      const next = new Set(current);

      if (next.has(metricId)) {
        next.delete(metricId);
      } else {
        next.add(metricId);
        setTableRowChartsMode('with_charts');
      }

      return next;
    });
  }, []);

  const toggleEmployeeChart = useCallback((metricId: string, employeeId: string) => {
    const chartId = buildEmployeeChartId(metricId, employeeId);

    setExpandedEmployeeChartIds((current) => {
      const next = new Set(current);

      if (next.has(chartId)) {
        next.delete(chartId);
      } else {
        next.add(chartId);
        setTableRowChartsMode('with_charts');
      }

      return next;
    });
  }, []);

  const expandAllEmployeeCharts = useCallback((metricId: string, employeeIds: string[]) => {
    setTableRowChartsMode('with_charts');
    setExpandedEmployeeChartIds((current) => {
      const next = new Set(current);
      employeeIds.forEach((employeeId) => {
        next.add(buildEmployeeChartId(metricId, employeeId));
      });
      return next;
    });
  }, []);

  const collapseAllEmployeeCharts = useCallback((metricId: string) => {
    const prefix = `${metricId}::`;

    setExpandedEmployeeChartIds((current) => {
      const next = new Set<string>();
      current.forEach((chartId) => {
        if (!chartId.startsWith(prefix)) {
          next.add(chartId);
        }
      });
      return next;
    });
  }, []);

  const expandAllRowCharts = useCallback(() => {
    setTableRowChartsMode('with_charts');

    const metricChartIds = new Set<string>();
    Object.values(appliedEnabledMetricIdsBySection).forEach((metricIds) => {
      metricIds.forEach((metricId) => metricChartIds.add(metricId));
    });

    Object.entries(sourceMetrics).forEach(([sourceKey, sourceData]) => {
      const activeKeys = appliedEnabledMetricKeysBySource[sourceKey] ?? enabledMetricKeysBySource[sourceKey];
      const metricKeys = activeKeys
        ? Array.from(activeKeys)
        : Object.keys(sourceData.metrics ?? {});

      metricKeys.forEach((metricKey) => {
        metricChartIds.add(buildSourceMetricActionId(sourceKey, metricKey));
      });
    });

    setExpandedChartMetricIds(metricChartIds);

    const employeeChartIds = new Set<string>();
    expandedEmployeeMetricIds.forEach((metricId) => {
      const employeeIds = appliedEmployeeIdsByMetricId[metricId];
      employeeIds?.forEach((employeeId) => {
        employeeChartIds.add(buildEmployeeChartId(metricId, employeeId));
      });
    });
    setExpandedEmployeeChartIds(employeeChartIds);
  }, [
    appliedEmployeeIdsByMetricId,
    appliedEnabledMetricIdsBySection,
    appliedEnabledMetricKeysBySource,
    enabledMetricKeysBySource,
    expandedEmployeeMetricIds,
    sourceMetrics,
  ]);

  const setTableRowChartsModeAndSync = useCallback((mode: TableRowChartsMode) => {
    if (mode === 'compact') {
      setTableRowChartsMode('compact');
      setExpandedChartMetricIds(new Set());
      setExpandedEmployeeChartIds(new Set());
      return;
    }
    // Selecting "with_charts" immediately expands all row charts.
    expandAllRowCharts();
  }, [expandAllRowCharts]);

  const collapseAllRowCharts = useCallback(() => {
    setExpandedChartMetricIds(new Set());
    setExpandedEmployeeChartIds(new Set());
    setTableRowChartsMode('compact');
  }, []);

  // Rebuild clears expanded chart ids; restore them when mode stays "with_charts".
  useEffect(() => {
    if (!pendingExpandRowChartsRef.current) {
      return;
    }
    if (reportLoading) {
      sawReportLoadingForExpandRef.current = true;
      return;
    }
    if (!sawReportLoadingForExpandRef.current) {
      return;
    }
    if (tableRowChartsMode !== 'with_charts') {
      pendingExpandRowChartsRef.current = false;
      sawReportLoadingForExpandRef.current = false;
      return;
    }
    pendingExpandRowChartsRef.current = false;
    sawReportLoadingForExpandRef.current = false;
    expandAllRowCharts();
  }, [expandAllRowCharts, reportLoading, tableRowChartsMode]);

  const updateRowThreshold = useCallback((metricId: string, value: ThresholdValues) => {
    markUserSettingsChange();
    setRowThresholds((current) => ({
      ...current,
      [metricId]: value,
    }));
  }, [markUserSettingsChange]);

  const updateEmployeeThreshold = useCallback((metricId: string, value: ThresholdValues) => {
    markUserSettingsChange();
    setEmployeeThresholdsByMetricId((current) => ({
      ...current,
      [metricId]: value,
    }));
  }, [markUserSettingsChange]);

  const updateMetricDirection = useCallback((metricId: string, direction: MetricDirection) => {
    markUserSettingsChange();
    setMetricDirectionsById((current) => ({
      ...current,
      [metricId]: direction,
    }));
  }, [markUserSettingsChange]);

  const moveMetricWithinSection = useCallback((sectionId: string, sourceMetricId: string, targetMetricId: string) => {
    if (sourceMetricId === targetMetricId) {
      return;
    }

    markUserSettingsChange();
    setMetricOrderBySection((current) => {
      const source = current[sectionId] ?? [];
      const fromIndex = source.indexOf(sourceMetricId);
      const toIndex = source.indexOf(targetMetricId);

      if (fromIndex === -1 || toIndex === -1) {
        return current;
      }

      const nextSectionOrder = [...source];
      const [moved] = nextSectionOrder.splice(fromIndex, 1);
      nextSectionOrder.splice(toIndex, 0, moved);

      return {
        ...current,
        [sectionId]: nextSectionOrder,
      };
    });
  }, [markUserSettingsChange]);

  const moveSection = useCallback((sourceSectionId: string, targetSectionId: string) => {
    if (sourceSectionId === targetSectionId) {
      return;
    }

    markUserSettingsChange();
    setSectionOrder((current) => {
      const fromIndex = current.indexOf(sourceSectionId);
      const toIndex = current.indexOf(targetSectionId);

      if (fromIndex === -1 || toIndex === -1) {
        return current;
      }

      const nextOrder = [...current];
      const [moved] = nextOrder.splice(fromIndex, 1);
      nextOrder.splice(toIndex, 0, moved);

      return nextOrder;
    });
  }, [markUserSettingsChange]);

  const moveSourceSection = useCallback((sourceId: string, targetSourceId: string) => {
    if (sourceId === targetSourceId) {
      return;
    }

    markUserSettingsChange();
    setSourceSectionOrder((current) => {
      const nextOrder = [...current];
      if (!nextOrder.includes(sourceId)) {
        nextOrder.push(sourceId);
      }
      if (!nextOrder.includes(targetSourceId)) {
        nextOrder.push(targetSourceId);
      }

      const fromIndex = nextOrder.indexOf(sourceId);
      const toIndex = nextOrder.indexOf(targetSourceId);

      if (fromIndex === -1 || toIndex === -1) {
        return current;
      }

      const reordered = [...nextOrder];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);

      return reordered;
    });
  }, [markUserSettingsChange]);

  const moveSourceMetricWithinSource = useCallback((
    sourceId: string,
    sourceMetricKey: string,
    targetMetricKey: string,
  ) => {
    if (sourceMetricKey === targetMetricKey) {
      return;
    }

    markUserSettingsChange();
    setSourceMetricOrderBySource((current) => {
      const defaultKeys = Object.keys(sourceMetrics[sourceId]?.metrics ?? {});
      const source = mergeIdOrder(current[sourceId] ?? [], defaultKeys);
      const fromIndex = source.indexOf(sourceMetricKey);
      const toIndex = source.indexOf(targetMetricKey);

      if (fromIndex === -1 || toIndex === -1) {
        return current;
      }

      const nextOrder = [...source];
      const [moved] = nextOrder.splice(fromIndex, 1);
      nextOrder.splice(toIndex, 0, moved);

      return {
        ...current,
        [sourceId]: nextOrder,
      };
    });
  }, [markUserSettingsChange, sourceMetrics]);

  const moveEmployeeWithinMetric = useCallback((
    metricId: string,
    sourceEmployeeId: string,
    targetEmployeeId: string,
  ) => {
    if (sourceEmployeeId === targetEmployeeId) {
      return;
    }

    markUserSettingsChange();
    setEmployeeOrderByMetricId((current) => {
      const appliedEmployeeIds = appliedEmployeeIdsByMetricId[metricId] ?? new Set<string>();
      const source = mergeIdOrder(current[metricId] ?? [], [...appliedEmployeeIds]);
      const fromIndex = source.indexOf(sourceEmployeeId);
      const toIndex = source.indexOf(targetEmployeeId);

      if (fromIndex === -1 || toIndex === -1) {
        return current;
      }

      const nextOrder = [...source];
      const [moved] = nextOrder.splice(fromIndex, 1);
      nextOrder.splice(toIndex, 0, moved);

      return {
        ...current,
        [metricId]: nextOrder,
      };
    });
  }, [appliedEmployeeIdsByMetricId, markUserSettingsChange]);

  const handleMetricDragStart = useCallback((
    sectionId: string,
    metricId: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', metricId);
    draggedMetricRef.current = { sectionId, metricId };
  }, []);

  const handleMetricDragOver = useCallback((
    sectionId: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    if (draggedMetricRef.current?.sectionId !== sectionId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleMetricDrop = useCallback((
    sectionId: string,
    metricId: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    const dragged = draggedMetricRef.current;
    draggedMetricRef.current = null;

    if (!dragged || dragged.sectionId !== sectionId) {
      return;
    }

    moveMetricWithinSection(sectionId, dragged.metricId, metricId);
  }, [moveMetricWithinSection]);

  const handleSectionDragStart = useCallback((
    sectionId: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sectionId);
    draggedSectionRef.current = sectionId;
  }, []);

  const handleSectionDragOver = useCallback((
    sectionId: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    if (!draggedSectionRef.current || draggedSectionRef.current === sectionId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleSectionDrop = useCallback((
    sectionId: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    const draggedSectionId = draggedSectionRef.current;
    draggedSectionRef.current = null;

    if (!draggedSectionId) {
      return;
    }

    moveSection(draggedSectionId, sectionId);
  }, [moveSection]);

  const handleSourceSectionDragStart = useCallback((
    sourceId: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sourceId);
    draggedSourceSectionRef.current = sourceId;
  }, []);

  const handleSourceSectionDragOver = useCallback((
    sourceId: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    if (!draggedSourceSectionRef.current || draggedSourceSectionRef.current === sourceId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleSourceSectionDrop = useCallback((
    sourceId: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    const draggedSourceId = draggedSourceSectionRef.current;
    draggedSourceSectionRef.current = null;

    if (!draggedSourceId) {
      return;
    }

    moveSourceSection(draggedSourceId, sourceId);
  }, [moveSourceSection]);

  const handleSourceMetricDragStart = useCallback((
    sourceId: string,
    metricKey: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', metricKey);
    draggedSourceMetricRef.current = { sourceId, metricKey };
  }, []);

  const handleSourceMetricDragOver = useCallback((
    sourceId: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    if (draggedSourceMetricRef.current?.sourceId !== sourceId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleSourceMetricDrop = useCallback((
    sourceId: string,
    metricKey: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    const dragged = draggedSourceMetricRef.current;
    draggedSourceMetricRef.current = null;

    if (!dragged || dragged.sourceId !== sourceId) {
      return;
    }

    moveSourceMetricWithinSource(sourceId, dragged.metricKey, metricKey);
  }, [moveSourceMetricWithinSource]);

  const handleEmployeeDragStart = useCallback((
    metricId: string,
    employeeId: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', employeeId);
    draggedEmployeeRef.current = { metricId, employeeId };
  }, []);

  const handleEmployeeDragOver = useCallback((
    metricId: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    if (draggedEmployeeRef.current?.metricId !== metricId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleEmployeeDrop = useCallback((
    metricId: string,
    employeeId: string,
    event: ReactDragEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    const dragged = draggedEmployeeRef.current;
    draggedEmployeeRef.current = null;

    if (!dragged || dragged.metricId !== metricId) {
      return;
    }

    moveEmployeeWithinMetric(metricId, dragged.employeeId, employeeId);
  }, [moveEmployeeWithinMetric]);

  const captureCurrentViewState = useCallback(
    (): SavedReportViewState => ({
      draftFilters: serializeFilters(draftFilters),
      appliedFilters: serializeFilters(appliedFilters),
      tableSelectedSources: [...tableSelectedSources],
      enabledMetricIdsBySection: serializeSetRecord(enabledMetricIdsBySection),
      sectionOrder: [...sectionOrder],
      metricOrderBySection: serializeStringArrayRecord(metricOrderBySection),
      sourceSectionOrder: [...sourceSectionOrder],
      sourceMetricOrderBySource: serializeStringArrayRecord(sourceMetricOrderBySource),
      enabledMetricKeysBySource: serializeSetRecord(enabledMetricKeysBySource),
      expandedSections: [...expandedSections],
      mainThreshold: { ...mainThreshold },
      rowThresholds: { ...rowThresholds },
      employeeThresholdsByMetricId: { ...employeeThresholdsByMetricId },
      metricDirectionsById: { ...metricDirectionsById },
      appliedEmployeeIdsByMetricId: serializeSetRecord(appliedEmployeeIdsByMetricId),
      draftEmployeeIdsByMetricId: serializeSetRecord(draftEmployeeIdsByMetricId),
      employeeOrderByMetricId: serializeStringArrayRecord(employeeOrderByMetricId),
      expandedEmployeeMetricIds: [...expandedEmployeeMetricIds],
      expandedChartMetricIds: [...expandedChartMetricIds],
      expandedEmployeeChartIds: [...expandedEmployeeChartIds],
      tableRowChartsMode,
      hideZeroRows,
      highlightDeviations,
      mainIndicatorCustomTitle,
    }),
    [
      appliedEmployeeIdsByMetricId,
      appliedFilters,
      draftEmployeeIdsByMetricId,
      draftFilters,
      employeeOrderByMetricId,
      employeeThresholdsByMetricId,
      enabledMetricIdsBySection,
      enabledMetricKeysBySource,
      expandedChartMetricIds,
      expandedEmployeeChartIds,
      expandedEmployeeMetricIds,
      expandedSections,
      hideZeroRows,
      highlightDeviations,
      mainIndicatorCustomTitle,
      mainThreshold,
      metricDirectionsById,
      metricOrderBySection,
      rowThresholds,
      sectionOrder,
      sourceMetricOrderBySource,
      sourceSectionOrder,
      tableRowChartsMode,
      tableSelectedSources,
    ],
  );

  const saveViews = useCallback((views: SavedReportViewOption[]) => {
    setSavedViews(views);
    // Pro сохраняет savedViews через triggerAutoSave → saveReportSettings() на backend.
    // localStorage не используется — ни для Free, ни для Pro.
  }, []);

  const triggerAutoSave = useCallback(() => {
    // The first effect run only observes the initial React state.
    if (!hasObservedReportSettingsStateRef.current) {
      hasObservedReportSettingsStateRef.current = true;
      return;
    }

    // Do not treat backend application as user work.
    if (applyingBackendSettingsRef.current) {
      return;
    }

    if (suppressReportSettingsTouchRef.current) {
      suppressReportSettingsTouchRef.current = false;
      return;
    }

    if (!settingsHydratedRef.current) {
      return;
    }

    // Free version: never save anything
    if (!billingHasPro) {
      return;
    }

    // One-shot automatic build must not overwrite saved user settings.
    if (skipAutoSaveRef.current || temporaryAutoReportModeRef.current) {
      cancelPendingAutoSave();
      return;
    }

    userTouchedReportSettingsRef.current = true;
    const saveDelayMs = immediateAutoSaveRef.current ? 0 : 2000;
    immediateAutoSaveRef.current = false;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      const currentState = captureCurrentViewState();

      const payload = {
        settings: {
          period: currentState.draftFilters.period,
          dateRange: currentState.draftFilters.dateRange,
          selectedSources: currentState.draftFilters.selectedSources,
          tableSelectedSources: [...tableSelectedSources],
          enabledSectionIds: currentState.draftFilters.enabledSectionIds,
          chartDisplayMode: currentState.draftFilters.chartDisplayMode,
          metricMode: currentState.draftFilters.metricMode,
          schedule: currentState.draftFilters.schedule,
          enabledMetricIdsBySection: currentState.enabledMetricIdsBySection,
          sectionOrder: currentState.sectionOrder,
          metricOrderBySection: currentState.metricOrderBySection,
          sourceSectionOrder: currentState.sourceSectionOrder,
          sourceMetricOrderBySource: currentState.sourceMetricOrderBySource,
          enabledMetricKeysBySource: currentState.enabledMetricKeysBySource,
          expandedSections: currentState.expandedSections,
          mainThreshold: currentState.mainThreshold,
          rowThresholds: currentState.rowThresholds,
          employeeThresholdsByMetricId: currentState.employeeThresholdsByMetricId ?? {},
          metricDirectionsById: currentState.metricDirectionsById ?? {},
        },
        savedViews: savedViews.filter((view) => !view.isSystem).map((view) => ({
          value: view.value,
          label: view.label,
          isSystem: view.isSystem,
          state: view.state,
        })),
        appSettings: {
          reportBuilderUserIds: appSettings.reportBuilderUserIds,
          moneyViewerUserIds: appSettings.moneyViewerUserIds,
          viewSaverUserIds: appSettings.viewSaverUserIds,
        },
        detailColumnWidths: {},
      };

      saveReportSettings(payload).catch((error) => {
        console.warn('[Settings] Auto-save failed', error);
      });
    }, saveDelayMs);
  }, [billingHasPro, cancelPendingAutoSave, captureCurrentViewState, savedViews, appSettings, tableSelectedSources]);

  // Watch for changes and trigger auto-save
  useEffect(() => {
    triggerAutoSave();
  }, [
    draftFilters,
    appliedFilters,
    enabledMetricIdsBySection,
    sectionOrder,
    metricOrderBySection,
    sourceSectionOrder,
    sourceMetricOrderBySource,
    enabledMetricKeysBySource,
    expandedSections,
    mainThreshold,
    rowThresholds,
    employeeThresholdsByMetricId,
    metricDirectionsById,
    savedViews,
    appSettings,
    tableSelectedSources,
    draftTableSelectedSources,
    autoSaveRequest,
    triggerAutoSave,
  ]);

  const openSaveCurrentView = useCallback(() => {
    const userViewsCount = savedViews.filter((view) => !view.isSystem).length;

    if (!isProUser && userViewsCount >= 1) {
      setIsFreeLimitOpen(true);
      return;
    }

    setEditingViewId(null);
    setNewViewName('');
    setIsSaveOpen(true);
  }, [isProUser, savedViews]);

  const applySavedViewState = useCallback((
    state: SavedReportViewState,
    options?: { rebuild?: boolean },
  ) => {
    dateRangeSelectedManuallyRef.current = true;
    const deserializedDraft = deserializeFilters(state.draftFilters);
    const deserializedApplied = deserializeFilters(state.appliedFilters);
    const sanitizeMainSources = (sources: string[]) => (
      isProUser ? [...sources] : sources.slice(0, 1)
    );
    setDraftFilters({
      ...deserializedDraft,
      chartDisplayMode: 'sum',
      selectedSources: sanitizeMainSources(deserializedDraft.selectedSources),
    });
    setAppliedFilters({
      ...deserializedApplied,
      chartDisplayMode: 'sum',
      selectedSources: sanitizeMainSources(deserializedApplied.selectedSources),
    });
    // Table sources are independent from chart sources.
    const restoredTableSources = Array.isArray(state.tableSelectedSources)
      ? [...state.tableSelectedSources]
      : [];
    const pipelineIds = restoredTableSources.filter((sourceId) => {
      if (sourceId === 'deal-default') {
        return false;
      }
      return sourceId.startsWith('deal-') || sourceId.startsWith('smart-');
    });
    const entityIds = entitySourceIdsForSections(deserializedApplied.enabledSectionIds);
    setTableSelectedSources(pipelineIds);
    setTableEntitySourceIds(entityIds);
    setDraftTableSelectedSources([...entityIds, ...pipelineIds]);
    const restoredMetricIds = Object.fromEntries(
      Object.entries(state.enabledMetricIdsBySection).map(([sectionId, metricIds]) => [
        sectionId,
        new Set(metricIds),
      ]),
    );
    setEnabledMetricIdsBySection(restoredMetricIds);
    setAppliedEnabledMetricIdsBySection(
      Object.fromEntries(
        Object.entries(restoredMetricIds).map(([sectionId, metricIds]) => [
          sectionId,
          new Set(metricIds),
        ]),
      ),
    );
    setSectionOrder([...state.sectionOrder]);
    setMetricOrderBySection(
      Object.fromEntries(
        Object.entries(state.metricOrderBySection).map(([sectionId, metricIds]) => [
          sectionId,
          [...metricIds],
        ]),
      ),
    );
    setSourceSectionOrder(
      Array.isArray(state.sourceSectionOrder) ? [...state.sourceSectionOrder] : [],
    );
    setSourceMetricOrderBySource(
      state.sourceMetricOrderBySource && typeof state.sourceMetricOrderBySource === 'object'
        ? Object.fromEntries(
            Object.entries(state.sourceMetricOrderBySource).map(([sourceId, metricKeys]) => [
              sourceId,
              [...metricKeys],
            ]),
          )
        : {},
    );
    if (state.enabledMetricKeysBySource && typeof state.enabledMetricKeysBySource === 'object') {
      const restoredSourceMetrics = Object.fromEntries(
        Object.entries(state.enabledMetricKeysBySource).map(([sourceId, metricKeys]) => [
          sourceId,
          new Set(metricKeys),
        ]),
      );
      setEnabledMetricKeysBySource(
        Object.fromEntries(
          Object.entries(restoredSourceMetrics).map(([sourceId, metricKeys]) => [
            sourceId,
            new Set(metricKeys),
          ]),
        ),
      );
      setAppliedEnabledMetricKeysBySource(restoredSourceMetrics);
    } else {
      setEnabledMetricKeysBySource({});
      setAppliedEnabledMetricKeysBySource({});
    }
    setExpandedSections(new Set(state.expandedSections));
    setMainThreshold({ ...state.mainThreshold });
    setRowThresholds({ ...state.rowThresholds });
    setEmployeeThresholdsByMetricId({ ...(state.employeeThresholdsByMetricId ?? {}) });
    setMetricDirectionsById({ ...(state.metricDirectionsById ?? {}) });
    const restoredAppliedEmployees = deserializeSetRecord(state.appliedEmployeeIdsByMetricId);
    const restoredDraftEmployees = state.draftEmployeeIdsByMetricId
      ? deserializeSetRecord(state.draftEmployeeIdsByMetricId)
      : cloneSetRecord(restoredAppliedEmployees);
    setAppliedEmployeeIdsByMetricId(restoredAppliedEmployees);
    setDraftEmployeeIdsByMetricId(restoredDraftEmployees);
    setEmployeeOrderByMetricId(deserializeStringArrayRecord(state.employeeOrderByMetricId));
    setExpandedEmployeeMetricIds(new Set(state.expandedEmployeeMetricIds ?? []));
    setExpandedChartMetricIds(new Set(state.expandedChartMetricIds ?? []));
    setExpandedEmployeeChartIds(new Set(state.expandedEmployeeChartIds ?? []));
    setTableRowChartsMode(
      state.tableRowChartsMode === 'with_charts' ? 'with_charts' : 'compact',
    );
    setHideZeroRows(Boolean(state.hideZeroRows));
    setHighlightDeviations(Boolean(state.highlightDeviations));
    setMainIndicatorCustomTitle(
      typeof state.mainIndicatorCustomTitle === 'string' ? state.mainIndicatorCustomTitle : '',
    );
    if (options?.rebuild === false) {
      return;
    }
    setHasBuiltReport(true);
    setBuildMoment(Date.now());
    // Trigger report build for the restored view state
    setReportBuildRequest((current) => current + 1);
  }, [isProUser]);

  const applyDefaultOverviewView = useCallback(() => {
    dateRangeSelectedManuallyRef.current = false;
    setDraftFilters(createDefaultFilters());
    setAppliedFilters(createDefaultFilters());
    setTableSelectedSources([]);
    setDraftTableSelectedSources([]);
    setTableEntitySourceIds([]);
    setEnabledMetricIdsBySection(
      metricSections.reduce<Record<string, Set<string>>>((acc, section) => {
        acc[section.id] = new Set();
        return acc;
      }, {}),
    );
    setAppliedEnabledMetricIdsBySection(
      metricSections.reduce<Record<string, Set<string>>>((acc, section) => {
        acc[section.id] = new Set();
        return acc;
      }, {}),
    );
    setSectionOrder(metricSections.map((section) => section.id));
    setMetricOrderBySection(
      metricSections.reduce<Record<string, string[]>>((acc, section) => {
        acc[section.id] = [...section.metricIds];
        return acc;
      }, {}),
    );
    setSourceSectionOrder([]);
    setTableLeadingSourceId(null);
    setSourceMetricOrderBySource({});
    setEnabledMetricKeysBySource({});
    setAppliedEnabledMetricKeysBySource({});
    setExpandedSections(new Set());
    setExpandedSourceSections(new Set());
    collapsedSourceSectionsByUser.current = new Set();
    setMainThreshold({ upper: '', lower: '', mode: null });
    setRowThresholds({});
    setEmployeeThresholdsByMetricId({});
    setMetricDirectionsById({});
    setAppliedEmployeeIdsByMetricId({});
    setDraftEmployeeIdsByMetricId({});
    setEmployeeOrderByMetricId({});
    setExpandedEmployeeMetricIds(new Set());
    setExpandedChartMetricIds(new Set());
    setExpandedEmployeeChartIds(new Set());
    setTableRowChartsMode('compact');
    setHideZeroRows(false);
    setHasBuiltReport(true);
    setBuildMoment(Date.now());
    setReportBuildRequest((current) => current + 1);
  }, [metricSections]);

  const handleSavedViewChange = useCallback((viewId: string) => {
    const selectedSavedView = savedViews.find((view) => view.value === viewId);

    if (!selectedSavedView) {
      setSelectedView(defaultSavedView.value);
      applyDefaultOverviewView();
      setNotification('Представление недоступно. Открыт «Обзор бизнеса».');
      return;
    }

    if (selectedSavedView.isSystem || selectedSavedView.value === defaultSavedView.value) {
      const switchingToDefault = selectedView !== defaultSavedView.value;
      setSelectedView(defaultSavedView.value);
      if (switchingToDefault) {
        applyDefaultOverviewView();
      }
      return;
    }

    if (!selectedSavedView.state) {
      setSelectedView(defaultSavedView.value);
      applyDefaultOverviewView();
      setNotification('Представление недоступно или повреждено. Открыт «Обзор бизнеса».');
      return;
    }

    setSelectedView(viewId);
    applySavedViewState(selectedSavedView.state);
  }, [applyDefaultOverviewView, applySavedViewState, savedViews, selectedView]);

  const editSavedView = useCallback((viewId: string) => {
    const view = savedViews.find((item) => item.value === viewId && !item.isSystem);

    if (!view) {
      return;
    }

    setEditingViewId(viewId);
    setNewViewName(view.label);
    setIsSaveOpen(true);
  }, [savedViews]);

  const requestDeleteSavedView = useCallback((viewId: string) => {
    const view = savedViews.find((item) => item.value === viewId && !item.isSystem);

    if (view) {
      setDeleteViewId(viewId);
    }
  }, [savedViews]);

  const confirmDeleteSavedView = useCallback(() => {
    if (!deleteViewId) {
      return;
    }

    const nextViews = savedViews.filter((view) => view.value !== deleteViewId);
    saveViews(nextViews);

    if (selectedView === deleteViewId) {
      setSelectedView(defaultSavedView.value);
      applyDefaultOverviewView();
      setNotification('Отображение удалено. Открыт «Обзор бизнеса».');
    }

    setDeleteViewId(null);
  }, [applyDefaultOverviewView, deleteViewId, saveViews, savedViews, selectedView]);

  const saveAppSettings = useCallback((settings: AppSettings) => {
    setAppSettings(settings);
    // Pro сохраняет appSettings через triggerAutoSave → saveReportSettings() на backend.
    // localStorage не используется — ни для Free, ни для Pro.
    setNotification('Настройки приложения сохранены');
    setIsAppSettingsOpen(false);
  }, []);

  const handleCreateProPayment = useCallback(() => {
    if (isProUser) {
      setNotification('PRO-подписка уже активна для этого портала.');
      refreshBillingState();
      return;
    }

    const normalizedEmail = billingCustomerEmail.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setBillingError('Введите email для отправки чека.');
      return;
    }

    setPaymentLoading(true);
    setBillingError('');
    const paymentWindow = window.open('', '_blank');

    createProPayment(normalizedEmail)
      .then((response) => {
        const paymentUrl = response.payment.paymentUrl;

        if (!paymentUrl) {
          throw new Error('Backend did not return Robokassa payment URL.');
        }

        if (paymentWindow) {
          paymentWindow.opener = null;
          paymentWindow.location.href = paymentUrl;
          return;
        }

        window.location.assign(paymentUrl);
      })
      .catch((error) => {
        paymentWindow?.close();
        console.warn('[Billing] payment was not created', error);
        setBillingError(getFriendlyBillingError(error));
      })
      .finally(() => {
        setPaymentLoading(false);
      });
  }, [billingCustomerEmail, isProUser, refreshBillingState]);

  const openAppSettings = useCallback(() => {
    setIsAppSettingsOpen(true);
    refreshPortalEmployees();
  }, [refreshPortalEmployees]);

  const saveCurrentView = () => {
    const name = newViewName.trim();

    if (!name) {
      return;
    }

    if (editingViewId) {
      const nextViews = savedViews.map((view) =>
        view.value === editingViewId
          ? {
              ...view,
              label: name,
              state: view.state ? { ...view.state } : captureCurrentViewState(),
            }
          : view,
      );
      saveViews(nextViews);
      setNotification('Название отображения изменено');
      setEditingViewId(null);
      setNewViewName('');
      setIsSaveOpen(false);
      return;
    }

    const userViewsCount = savedViews.filter((view) => !view.isSystem).length;

    if (!isProUser && userViewsCount >= 1) {
      setIsSaveOpen(false);
      setIsFreeLimitOpen(true);
      return;
    }

    const value = `saved-view-${Date.now()}`;
    const nextViews = [
      ...savedViews,
      {
        value,
        label: name,
        state: captureCurrentViewState(),
      },
    ];
    saveViews(nextViews);
    setSelectedView(value);
    setNotification('Отображение сохранено');
    setNewViewName('');
    setIsSaveOpen(false);
  };

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const exportExcel = useCallback(async () => {
    if (!hasBuiltReport || !reportData.length) {
      return;
    }

    const currentViewLabel = savedViews.find((view) => view.value === selectedView)?.label ?? 'Обзор бизнеса';
    const params = new URLSearchParams(window.location.search);
    const portalLabel = params.get('DOMAIN') || params.get('domain') || 'Портал Bitrix24';
    const periodOptionLabel = periodOptions.find((option) => option.value === appliedFilters.period)?.label ?? 'Группировка';
    const periodLabel = formatRangeLabel(appliedFilters.period, appliedFilters.dateRange);

    try {
      await exportReportExcel({
        hasBuiltReport,
        reportData,
        chartData,
        tableRows: tableRows.filter((row) => row.kind !== 'chart' && row.kind !== 'employee_chart'),
        reportDetails,
        sourceMetrics,
        valueStates,
        appliedFilters: {
          period: appliedFilters.period,
          dateRange: appliedFilters.dateRange,
          metricMode: appliedFilters.metricMode,
          chartDisplayMode: appliedFilters.chartDisplayMode,
          selectedSources: appliedFilters.selectedSources,
          enabledSectionIds: appliedFilters.enabledSectionIds,
          schedule: {
            workdayStart: appliedFilters.schedule.workdayStart,
            workdayEnd: appliedFilters.schedule.workdayEnd,
            weekendDayIds: [...appliedFilters.schedule.weekendDayIds],
            calendarWeekStart: appliedFilters.schedule.calendarWeekStart,
          },
        },
        mainThreshold,
        rowThresholds,
        employeeThresholdsByMetricId,
        metricDirectionsById,
        crmSources,
        tableSelectedSources,
        tableEntitySourceIds,
        currentViewLabel,
        portalLabel,
        periodOptionLabel,
        periodLabel,
        tableRowChartsMode,
      });
    } catch (error) {
      console.warn('[Excel export] report Excel was not generated', error);
      setNotification('Не удалось скачать Excel. Попробуйте уменьшить период или количество строк.');
    }
  }, [
    appliedFilters.chartDisplayMode,
    appliedFilters.dateRange,
    appliedFilters.enabledSectionIds,
    appliedFilters.metricMode,
    appliedFilters.period,
    appliedFilters.schedule.calendarWeekStart,
    appliedFilters.schedule.weekendDayIds,
    appliedFilters.schedule.workdayEnd,
    appliedFilters.schedule.workdayStart,
    appliedFilters.selectedSources,
    chartData,
    crmSources,
    employeeThresholdsByMetricId,
    formatRangeLabel,
    hasBuiltReport,
    mainThreshold,
    metricDirectionsById,
    periodOptions,
    reportData,
    reportDetails,
    rowThresholds,
    savedViews,
    selectedView,
    sourceMetrics,
    tableEntitySourceIds,
    tableRowChartsMode,
    tableRows,
    tableSelectedSources,
    valueStates,
  ]);

  const exportPdf = useCallback(async (includeRowCharts: boolean) => {
    if (!hasBuiltReport || !reportData.length || pdfExporting) {
      return;
    }

    const currentViewLabel = savedViews.find((view) => view.value === selectedView)?.label ?? 'Обзор бизнеса';
    const params = new URLSearchParams(window.location.search);
    const portalLabel = params.get('DOMAIN') || params.get('domain') || 'Портал Bitrix24';
    const periodOptionLabel = periodOptions.find((option) => option.value === appliedFilters.period)?.label ?? 'Группировка';
    const periodLabel = formatRangeLabel(appliedFilters.period, appliedFilters.dateRange);

    setPdfExporting(true);
    setNotification(includeRowCharts ? 'Формируем PDF с графиками…' : 'Формируем PDF…');

    try {
      await exportReportPdf(
        {
          hasBuiltReport,
          reportData,
          tableRows: tableRows.filter((row) => row.kind !== 'chart' && row.kind !== 'employee_chart'),
          chartData,
          appliedFilters: {
            period: appliedFilters.period,
            dateRange: appliedFilters.dateRange,
            metricMode: appliedFilters.metricMode,
          },
          mainThreshold,
          rowThresholds,
          employeeThresholdsByMetricId,
          metricDirectionsById,
          sourceMetrics,
          valueStates,
          currentViewLabel,
          portalLabel,
          periodOptionLabel,
          periodLabel,
          tableRowChartsMode: includeRowCharts ? 'with_charts' : 'compact',
          mainChartSourcesLabel: mainIndicatorCaption.titleFull,
        },
        {
          onProgress: (current, total) => {
            setNotification(
              includeRowCharts
                ? `Формируем PDF с графиками… страница ${current} из ${total}`
                : `Формируем PDF… страница ${current} из ${total}`,
            );
          },
        },
      );
      setNotification('');
    } catch (error) {
      console.warn('[PDF export] report PDF was not generated', error);
      setNotification('Не удалось скачать PDF. Попробуйте уменьшить период или количество строк отчета.');
    } finally {
      setPdfExporting(false);
    }
  }, [
    appliedFilters.dateRange,
    appliedFilters.metricMode,
    appliedFilters.period,
    chartData,
    formatRangeLabel,
    hasBuiltReport,
    mainIndicatorCaption.titleFull,
    mainThreshold,
    metricDirectionsById,
    employeeThresholdsByMetricId,
    pdfExporting,
    periodOptions,
    reportData,
    rowThresholds,
    savedViews,
    selectedView,
    sourceMetrics,
    tableRows,
    valueStates,
  ]);

  return (
    <main className="page">
      <section className="report-card" ref={reportCardRef}>
        <header className="top-panel">
          <BrandLogo />
          <div className="top-controls">
            <SavedViewsSelect
              options={savedViews}
              value={selectedView}
              onChange={handleSavedViewChange}
              onSaveClick={openSaveCurrentView}
              onEdit={editSavedView}
              onDelete={requestDeleteSavedView}
            />
            <CustomSelect
              options={periodOptions}
              value={draftFilters.period}
              onChange={handlePeriodChange}
              ariaLabel="Фильтр периода"
              className="period-select"
            />
            <DateRangePicker
              period={draftFilters.period}
              range={draftFilters.dateRange}
              onChange={handleDateRangeChange}
            />
          </div>
          <div className="top-actions">
            <TooltipButton
              label="Настроить приложение"
              onClick={openAppSettings}
            >
              <Cog size={18} />
            </TooltipButton>
            <TooltipButton
              label="Как читать отчёт"
              onClick={() => setIsInstructionOpen(true)}
            >
              <BookOpen size={18} />
            </TooltipButton>
            <TooltipButton
              label="Помощь"
              onClick={() => window.open('https://sapp24.com/apps/help/', '_blank', 'noreferrer')}
            >
              <LifeBuoy size={18} />
            </TooltipButton>
            <TooltipButton
              label={isProUser ? 'PRO-подписка активна' : 'Активировать ПРО версию чтобы сохранять разные отображения отчета'}
              onClick={() => setIsProOpen(true)}
              className="pro-crown-button"
            >
              <Crown size={18} className={`pro-crown-icon${!isProUser ? ' pro-crown-icon--promo' : ''}`} />
            </TooltipButton>
            <ReportDownloadMenu
              disabled={!hasBuiltReport || !reportData.length || reportLoading}
              pdfBusy={pdfExporting}
              onSelect={(option) => {
                if (option === 'excel') {
                  void exportExcel();
                  return;
                }
                void exportPdf(option === 'pdf_charts');
              }}
            />
          </div>
        </header>

        <div className="soft-divider" />

        {(catalogLoading || catalogError || reportLoading || reportError || (hasBuiltReport && !reportLoading && !reportError && reportData.length === 0)) && (
          <div className={`report-status-bar ${catalogError || reportError ? 'is-error' : ''}`}>
            {catalogLoading && <span>Загружаем настройки отчета из backend...</span>}
            {catalogError && <span>{catalogError}</span>}
            {reportLoading && <span>{reportBuildStage}… {reportElapsed}</span>}
            {reportError && <span>{reportError}</span>}
            {hasBuiltReport && !reportLoading && !reportError && reportData.length === 0 && (
              <span>По выбранным фильтрам данных нет. Измените период, источники или метрики и постройте отчет заново.</span>
            )}
          </div>
        )}

        <section className={`report-surface ${isPinned ? 'is-pinned' : ''}`} style={reportSurfaceStyle}>
          <div className="fixed-column">
            <div className={`left-pane chart-left${mainIndicatorCaption.empty ? ' is-empty' : ''}`}>
              <div className="section-title-row">
                <p>Показатели бизнеса</p>
                <div className="section-title-actions">
                  <TooltipButton
                    label="Закрепить график при прокрутке"
                    onClick={() => setIsPinned((current) => !current)}
                    ariaPressed={isPinned}
                    className={isPinned ? 'active-pin' : ''}
                  >
                    {isPinned ? <PinOff size={18} /> : <Pin size={18} />}
                  </TooltipButton>
                </div>
              </div>
              <div className="business-indicators-actions">
                <button
                  type="button"
                  className="business-action-card"
                  onClick={handleAutoSetupClick}
                  disabled={reportLoading || Boolean(sectionRetryingId)}
                >
                  <span className="business-action-card-icon" aria-hidden="true">
                    <Sparkles size={18} />
                  </span>
                  <span className="business-action-card-copy">
                    <strong>Показать автоматически</strong>
                    <em>Система всё настроит за вас</em>
                  </span>
                </button>
                <button
                  type="button"
                  className={`business-action-card ${isIndicatorsSettingsOpen ? 'is-active' : ''}`}
                  onClick={openIndicatorsSettingsPanel}
                  disabled={reportLoading || Boolean(sectionRetryingId)}
                >
                  <span className="business-action-card-icon" aria-hidden="true">
                    <Settings2 size={18} />
                  </span>
                  <span className="business-action-card-copy">
                    <strong>Настроить показатели</strong>
                    <em>Период, главный и остальные</em>
                  </span>
                </button>
                {isProUser && savedViews.some((view) => !view.isSystem) ? (
                  <div className="business-saved-set-block">
                    <p className="business-saved-set-label">Выбранный набор показателей</p>
                    <SavedViewsSelect
                      options={savedViews}
                      value={selectedView}
                      onChange={(value) => {
                        const view = savedViews.find((item) => item.value === value);
                        setSelectedView(value);
                        if (view?.isSystem || !view?.state) {
                          return;
                        }
                        // W05: apply set into state; build only on «Показать сводку».
                        applySavedViewState(view.state, { rebuild: false });
                      }}
                      onSaveClick={openSaveCurrentView}
                      onEdit={editSavedView}
                      onDelete={(value) => setDeleteViewId(value)}
                    />
                  </div>
                ) : null}
                <button
                  type="button"
                  className="business-action-card business-action-card--primary"
                  onClick={runUnifiedReportBuild}
                  disabled={reportLoading || Boolean(sectionRetryingId)}
                >
                  <span className="business-action-card-icon" aria-hidden="true">
                    <Play size={18} />
                  </span>
                  <span className="business-action-card-copy">
                    <strong>Показать сводку</strong>
                    <em>Отобразить выбранный набор</em>
                  </span>
                </button>
              </div>
            </div>

            <div className="indicator-left">Показатели</div>
            <div className="scrollbar-left-spacer" />
          </div>

          <div className="scroll-column">
            <div className={`sync-viewport chart-viewport${mainIndicatorCaption.empty ? ' is-empty' : ''}`}>
              {reportLoading && (
                <div className="chart-loading-overlay">
                  <ReportBuildLoader stageLabel={reportBuildStage} />
                </div>
              )}
              <div
                className={`sync-content chart-sync-content${mainIndicatorCaption.empty ? ' is-empty' : ''}`}
                style={syncedContentStyle}
                ref={chartContentRef}
              >
                <div className={`chart-top-block${mainIndicatorCaption.empty ? ' is-empty' : ''}`}>
                  <div
                    className="main-indicator-caption"
                    title={mainIndicatorCaption.titleFull !== mainIndicatorCaption.title ? mainIndicatorCaption.titleFull : undefined}
                  >
                    <div className="main-indicator-caption-title">{mainIndicatorCaption.title}</div>
                    <div className="main-indicator-caption-meta">{mainIndicatorCaption.meta}</div>
                  </div>
                  {mainIndicatorCaption.empty ? (
                    <div className="main-indicator-empty" role="status">
                      <p>{mainIndicatorCaption.emptyMessage}</p>
                      {mainIndicatorCaption.emptyHint && <span>{mainIndicatorCaption.emptyHint}</span>}
                    </div>
                  ) : !isSeparateChart && hasTrendSeries ? (
                    <div className="chart-series-legend" aria-label="Линии графика">
                      <label className="chart-legend-item chart-legend-trend-toggle">
                        <input
                          type="checkbox"
                          checked={showTrendLine}
                          onChange={(event) => setShowTrendLine(event.target.checked)}
                        />
                        <i className="chart-legend-swatch is-trend" aria-hidden="true" />
                        <span>Тренд</span>
                      </label>
                    </div>
                  ) : null}
                </div>
                {!mainIndicatorCaption.empty ? (
                <div className="chart-wrap" ref={mainChartWrapRef}>
                  <div className="main-chart-values" aria-label="Значения выбранных источников">
                    {chartSeries.map((series) => (
                      <div
                        className="main-chart-values-row"
                        key={`values-${series.key}`}
                        style={{ ...syncedContentStyle, ...gridStyle }}
                        aria-label={series.label}
                      >
                        <span className="period-axis-gutter" aria-hidden="true" />
                        {chartData.map((point) => {
                          const rawValue = point[series.key as keyof typeof point];
                          const value = typeof rawValue === 'number' ? rawValue : Number(rawValue);
                          const numericValue = Number.isFinite(value) ? value : 0;
                          const hasMainCorridor =
                            upperThresholdNumber !== null || lowerThresholdNumber !== null;
                          const thresholdClass = hasMainCorridor
                            ? getThresholdClass(
                              numericValue,
                              mainThreshold,
                              mainChartDirection,
                            )
                            : '';
                          const valueLabel = formatMainChartValue(
                            numericValue,
                            appliedFilters.metricMode,
                          );

                          return (
                            <span
                              className={`value-cell main-chart-value-cell ${thresholdClass}`.trim()}
                              key={`${series.key}-${point.key}`}
                              title={valueLabel}
                            >
                              <span className="value-cell-badge">{valueLabel}</span>
                            </span>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <div className="main-chart-plot">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chartData}
                      margin={{ top: 8, right: 8, left: 0, bottom: 10 }}
                      onMouseLeave={() => setActiveMainChartPoint(null)}
                    >
                      <CartesianGrid stroke="#edf0f4" vertical={false} />
                      <XAxis
                        dataKey="xIndex"
                        type="number"
                        domain={[0, Math.max(chartData.length, 1)]}
                        hide
                      />
                      <YAxis
                        width={CHART_AXIS_WIDTH}
                        domain={chartDomain}
                        ticks={mainChartYAxisTicks}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: '#707782', fontSize: 12 }}
                        tickFormatter={(value) => formatMainAxisTick(value, appliedFilters.metricMode)}
                      />
                      {upperThresholdNumber !== null && (
                        <ReferenceLine
                          y={upperThresholdNumber}
                          stroke={thresholdLineColors.upper}
                          strokeDasharray="6 6"
                          label={{
                            value: getThresholdLineLabel(mainThreshold, 'upper'),
                            position: 'insideTopLeft',
                            fill: '#218454',
                            fontSize: 11,
                            dx: 4,
                            dy: -4,
                          }}
                        />
                      )}
                      {lowerThresholdNumber !== null && (
                        <ReferenceLine
                          y={lowerThresholdNumber}
                          stroke={thresholdLineColors.lower}
                          strokeDasharray="6 6"
                          label={{
                            value: getThresholdLineLabel(mainThreshold, 'lower'),
                            position: 'insideTopLeft',
                            fill: '#b42323',
                            fontSize: 11,
                            dx: 4,
                            dy: -4,
                          }}
                        />
                      )}
                      {averageThresholdNumber !== null && (
                        <ReferenceLine
                          y={averageThresholdNumber}
                          stroke={thresholdLineColors.average}
                          strokeDasharray="6 6"
                          label={{
                            value: getThresholdLineLabel(mainThreshold, 'average'),
                            position: 'insideTopLeft',
                            fill: '#9a6b00',
                            fontSize: 11,
                            dx: 4,
                            dy: -4,
                          }}
                        />
                      )}
                      {showTrendOnChart && (
                        <Line
                          type="linear"
                          dataKey="trend"
                          name="Тренд"
                          stroke="#2274ff"
                          strokeOpacity={0.45}
                          strokeWidth={2.5}
                          dot={false}
                          activeDot={false}
                          isAnimationActive={false}
                        />
                      )}
                      {chartSeries.map((series) => (
                        <Line
                          type="monotone"
                          dataKey={series.key}
                          name={series.label}
                          stroke={series.color}
                          strokeWidth={2}
                          dot={(props: ChartDotPayloadProps) => (
                            <HoverChartDot
                              {...props}
                              stroke={series.color}
                              radius={3}
                              onActivate={setActiveMainChartPoint}
                              onDeactivate={() => setActiveMainChartPoint(null)}
                            />
                          )}
                          activeDot={false}
                          key={series.key}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="chart-zoom-controls" aria-label="Масштаб графика">
                    <TooltipButton
                      label="Увеличить масштаб"
                      onClick={() =>
                        setPeriodColumnWidth((current) =>
                          Math.min(MAX_PERIOD_COLUMN_WIDTH, current + 8),
                        )
                      }
                      className="zoom-icon-button"
                    >
                      <Plus size={16} />
                    </TooltipButton>
                    <TooltipButton
                      label="Уменьшить масштаб"
                      onClick={() =>
                        setPeriodColumnWidth((current) =>
                          Math.max(MIN_PERIOD_COLUMN_WIDTH, current - 8),
                        )
                      }
                      className="zoom-icon-button"
                    >
                      <Minus size={16} />
                    </TooltipButton>
                    <TooltipButton
                      label="Сбросить масштаб"
                      onClick={() => setPeriodColumnWidth(PERIOD_COLUMN_WIDTH)}
                      className="zoom-icon-button"
                    >
                      <RotateCcw size={16} />
                    </TooltipButton>
                  </div>
                  {activeMainChartPoint && activeMainChartDataPoint && (
                    <ChartPointTooltip
                      point={activeMainChartPoint}
                      title={activeMainChartDataPoint.tooltipLabel}
                      items={mainChartTooltipItems}
                      thresholdItems={mainThresholdTooltipItems}
                      containerRef={mainChartWrapRef}
                      valueFormatter={(value) => formatMainChartValue(value, appliedFilters.metricMode)}
                      summary={mainChartTooltipSummary}
                    />
                  )}
                  </div>
                </div>
                ) : null}
              </div>
            </div>

            <div className="sync-viewport indicator-viewport">
              <div
                className="sync-content period-grid"
                style={{ ...syncedContentStyle, ...gridStyle }}
                ref={periodContentRef}
              >
                <span className="period-axis-gutter" aria-hidden="true" />
                {reportData.map((point) => (
                  <span key={point.key} title={point.tooltipLabel || point.label}>
                    {point.label}
                  </span>
                ))}
              </div>
            </div>

            <div
              className="horizontal-scrollbar"
              ref={horizontalScrollbarRef}
              onScroll={handleHorizontalScroll}
            >
              <div className="scrollbar-spacer" style={{ width: `max(100%, ${rightContentWidth}px)` }} />
            </div>
          </div>

          <div className="report-table" ref={tableContentRef} role="table" aria-label="Значения показателей">
            {tableRows.map((row) => {
              const activeMetricId =
                row.kind === 'metric'
                  ? row.metric.id
                  : row.kind === 'source_metric'
                    ? buildSourceMetricActionId(row.sourceId, row.metricKey)
                    : null;
              const isActiveMetricRow = activeMetricId
                ? expandedEmployeeMetricIds.has(activeMetricId) ||
                  expandedChartMetricIds.has(activeMetricId) ||
                  Array.from(expandedEmployeeChartIds).some((chartId) => chartId.startsWith(`${activeMetricId}::`))
                : false;
              const rowClassName = [
                'report-table-row',
                row.kind === 'section' ? 'is-section-row' : '',
                row.kind === 'source_section' ? 'is-section-row' : '',
                row.kind === 'metric' ? 'is-metric-row' : '',
                row.kind === 'source_metric' ? 'is-metric-row' : '',
                isActiveMetricRow ? 'is-active-metric-row' : '',
                row.kind === 'employee' ? 'is-employee-row' : '',
                row.kind === 'employee_sum_hint' ? 'is-employee-sum-hint' : '',
                row.kind === 'chart' || row.kind === 'employee_chart' ? 'is-chart-row' : '',
              ].filter(Boolean).join(' ');
              const leftCellClassName = [
                'table-left-cell',
                row.kind === 'section' ? 'section-left-cell' : '',
                row.kind === 'source_section' ? 'section-left-cell' : '',
                row.kind === 'metric' ? 'metric-left-cell' : '',
                row.kind === 'source_metric' ? 'metric-left-cell' : '',
                row.kind === 'employee' ? 'employee-left-cell' : '',
                row.kind === 'employee_sum_hint' ? 'employee-sum-hint-cell' : '',
                row.kind === 'chart' || row.kind === 'employee_chart' ? 'chart-left-cell' : '',
              ].filter(Boolean).join(' ');

              if (row.kind === 'section') {
                const section = sectionMap.get(row.sectionId);
                const menuEnabledMetricIds =
                  enabledMetricIdsBySection[row.sectionId] ??
                  new Set(section?.metricIds ?? []);
                const tableEnabledMetricIds = (
                  hasBuiltReport
                    ? appliedEnabledMetricIdsBySection[row.sectionId]
                    : enabledMetricIdsBySection[row.sectionId]
                ) ?? new Set<string>();
                const visibleMetricIds = section
                  ? section.metricIds.filter((metricId) => tableEnabledMetricIds.has(metricId))
                  : [];
                const periodKeys = reportData.map((point) => point.key);
                const showSectionLoadError = sectionHasLoadError(
                  visibleMetricIds,
                  valueStates,
                  periodKeys,
                );
                const isSectionRetrying = sectionRetryingId === row.sectionId;

                return (
                  <div
                    className={`${rowClassName}${showSectionLoadError ? ' has-section-load-error' : ''}`}
                    key={row.rowId}
                    role="row"
                    data-row-id={row.rowId}
                    onDragOver={(event) => handleSectionDragOver(row.sectionId, event)}
                    onDrop={(event) => handleSectionDrop(row.sectionId, event)}
                  >
                    <div className={leftCellClassName} role="rowheader">
                      <button
                        className="drag-handle-button"
                        type="button"
                        draggable
                        aria-label="Перетащить раздел"
                        title="Перетащить раздел"
                        onDragStart={(event) => handleSectionDragStart(row.sectionId, event)}
                        onDragEnd={() => {
                          draggedSectionRef.current = null;
                        }}
                      >
                        <GripVertical size={15} />
                      </button>
                      <button
                        className={`section-toggle ${expandedSections.has(row.sectionId) ? '' : 'is-collapsed'}`}
                        type="button"
                        aria-expanded={expandedSections.has(row.sectionId)}
                        title={expandedSections.has(row.sectionId) ? 'Свернуть раздел' : 'Развернуть раздел'}
                        onClick={() => toggleSection(row.sectionId)}
                      >
                        <ChevronDown size={16} />
                        <span title={row.label}>{row.label}</span>
                      </button>
                      {section && (
                        <SectionMetricsMenu
                          section={section}
                          metricMap={metricMap}
                          enabledMetricIds={menuEnabledMetricIds}
                          onToggleMetric={(metricId) => toggleEnabledMetric(row.sectionId, metricId)}
                          onSelectAll={() => selectAllSectionMetrics(row.sectionId)}
                          onReset={() => resetSectionMetrics(row.sectionId)}
                          onApply={applySectionMetrics}
                        />
                      )}
                    </div>
                    <div className="table-right-cell" role="cell">
                      {showSectionLoadError ? (
                        <div className="section-load-error" role="status">
                          <span>{SECTION_LOAD_ERROR_MESSAGE}</span>
                          <button
                            className="section-load-error-button"
                            type="button"
                            disabled={isSectionRetrying || reportLoading || Boolean(sectionRetryingId)}
                            onClick={() => {
                              void retrySectionLoad(row.sectionId);
                            }}
                          >
                            {isSectionRetrying ? 'Загрузка…' : SECTION_LOAD_RETRY_LABEL}
                          </button>
                        </div>
                      ) : (
                        <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                          <div className="value-axis-gutter" aria-hidden="true" />
                          {reportData.map((point) => (
                            <div className="value-cell" key={`${row.rowId}-${point.key}`} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }

              if (row.kind === 'source_section') {
                const sourceData = sourceMetrics[row.sourceId];
                const sourceMetricIds = Object.keys(sourceData?.metrics ?? {});
                const sourceMetricMap = new Map(
                  sourceMetricIds.map((metricKey) => {
                    const metric = sourceData?.metrics[metricKey];
                    const valueType = metric?.valueType === 'money'
                      ? 'money'
                      : metric?.valueType === 'percent'
                        ? 'percent'
                        : 'number';
                    return [
                      metricKey,
                      {
                        id: metricKey,
                        label: metric?.label ?? metricKey,
                        type: valueType as MetricRow['type'],
                        base: 0,
                      } satisfies MetricRow,
                    ] as const;
                  }),
                );
                const enabledSourceMetricIds =
                  enabledMetricKeysBySource[row.sourceId] ?? new Set(sourceMetricIds);

                return (
                  <div
                    className={rowClassName}
                    key={row.rowId}
                    role="row"
                    data-row-id={row.rowId}
                    onDragOver={(event) => handleSourceSectionDragOver(row.sourceId, event)}
                    onDrop={(event) => handleSourceSectionDrop(row.sourceId, event)}
                  >
                    <div className={leftCellClassName} role="rowheader">
                      <button
                        className="drag-handle-button"
                        type="button"
                        draggable
                        aria-label="Перетащить раздел"
                        title="Перетащить раздел"
                        onDragStart={(event) => handleSourceSectionDragStart(row.sourceId, event)}
                        onDragEnd={() => {
                          draggedSourceSectionRef.current = null;
                        }}
                      >
                        <GripVertical size={15} />
                      </button>
                      <button
                        className={`section-toggle ${expandedSourceSections.has(row.sourceId) ? '' : 'is-collapsed'}`}
                        type="button"
                        aria-expanded={expandedSourceSections.has(row.sourceId)}
                        title={expandedSourceSections.has(row.sourceId) ? 'Свернуть раздел' : 'Развернуть раздел'}
                        onClick={() => toggleSourceSection(row.sourceId)}
                      >
                        <ChevronDown size={16} />
                        <span title={row.label}>{row.label}</span>
                      </button>
                      {sourceData && (
                        <SectionMetricsMenu
                          section={{
                            id: row.sourceId,
                            label: row.label,
                            metricIds: sourceMetricIds,
                          }}
                          metricMap={sourceMetricMap}
                          enabledMetricIds={enabledSourceMetricIds}
                          onToggleMetric={(metricKey) => toggleSourceMetric(row.sourceId, metricKey)}
                          onSelectAll={() => selectAllSourceMetrics(row.sourceId)}
                          onReset={() => resetSourceMetrics(row.sourceId)}
                          onApply={applySourceMetrics}
                        />
                      )}
                    </div>
                    <div className="table-right-cell" role="cell">
                      <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                        <div className="value-axis-gutter" aria-hidden="true" />
                        {reportData.map((point) => (
                          <div className="value-cell" key={`${row.rowId}-${point.key}`} />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }

              if (row.kind === 'employee') {
                const employeeChartOpen = expandedEmployeeChartIds.has(
                  buildEmployeeChartId(row.metric.id, row.employee.id),
                );
                const employeeThreshold = employeeThresholdsByMetricId[row.metric.id];
                const employeeFullName = getEmployeeFullName(row.employee);
                const isSystemDetail = row.isSystemDetail || isSystemEmployeeRow(row.employee.id);

                return (
                  <div
                    className={rowClassName}
                    key={row.rowId}
                    role="row"
                    data-row-id={row.rowId}
                    onDragOver={isSystemDetail ? undefined : (event) => handleEmployeeDragOver(row.metric.id, event)}
                    onDrop={isSystemDetail ? undefined : (event) => handleEmployeeDrop(row.metric.id, row.employee.id, event)}
                  >
                    <div className={leftCellClassName} role="rowheader">
                      {!isSystemDetail ? (
                        <button
                          className="drag-handle-button employee-drag-handle-button"
                          type="button"
                          draggable
                          aria-label="Перетащить сотрудника"
                          title="Перетащить сотрудника"
                          onDragStart={(event) => handleEmployeeDragStart(row.metric.id, row.employee.id, event)}
                          onDragEnd={() => {
                            draggedEmployeeRef.current = null;
                          }}
                        >
                          <GripVertical size={15} />
                        </button>
                      ) : (
                        <span className="employee-system-spacer" aria-hidden="true" />
                      )}
                      <input
                        className="employee-visibility-checkbox"
                        type="checkbox"
                        checked={employeeChartOpen}
                        aria-label={employeeChartOpen ? 'Скрыть график сотрудника' : 'Показать график сотрудника'}
                        title={employeeChartOpen ? 'Скрыть график сотрудника' : 'Показать график сотрудника'}
                        onChange={() => toggleEmployeeChart(row.metric.id, row.employee.id)}
                      />
                      {isSystemDetail || row.employee.id === UNAVAILABLE_EMPLOYEE_ID ? (
                        <span className="employee-person-button is-static" title={employeeFullName}>
                          <span>{employeeFullName}</span>
                        </span>
                      ) : (
                        <button
                          className="employee-person-button"
                          type="button"
                          title={employeeFullName}
                          onClick={() => openBitrixUser(row.employee.userId)}
                        >
                          <span>{employeeFullName}</span>
                        </button>
                      )}
                      {!isSystemDetail ? (
                        <button
                          className="employee-chart-toggle-button"
                          type="button"
                          aria-label="Скрыть сотрудника из списка"
                          title="Скрыть сотрудника из списка"
                          onClick={() => hideAppliedMetricEmployee(row.metric.id, row.employee.id)}
                        >
                          <X size={14} />
                        </button>
                      ) : null}
                    </div>
                    <div className="table-right-cell" role="cell">
                      <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                        <div className="value-axis-gutter" aria-hidden="true" />
                        {reportData.map((point) => {
                          const value = hasBuiltReport
                            ? getEmployeePeriodMetricValue(row.employee, point, row.metric.id)
                            : 0;

                          const display = getValueCellDisplay(
                            value,
                            row.metric.type,
                            valueStates[point.key]?.[row.metric.id],
                          );
                          const metricDirection = resolveMetricDirection(row.metric.id, metricDirectionsById);
                          const thresholdClass = display.hasNumericValue
                            ? getThresholdClass(value, employeeThreshold, metricDirection)
                            : '';

                          return (
                            <ValueCellButton
                              className={thresholdClass}
                              valueLabel={display.label}
                              tooltipLabel={getValueCellOpenTooltip(
                                value,
                                row.metric.label,
                                row.metric.type,
                                display,
                                employeeThreshold,
                                metricDirection,
                              )}
                              disabled={display.accessDenied}
                              key={`${row.rowId}-${point.key}`}
                              onClick={() => openDetail(
                                row.metric,
                                point,
                                value,
                                row.sectionId,
                                isSystemDetail ? undefined : row.employee,
                                row.sourceId,
                                row.detailSourceIds,
                                row.detailMetricIds,
                              )}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              }

              if (row.kind === 'employee_sum_hint') {
                return (
                  <div className={`${rowClassName} is-employee-sum-hint`} key={row.rowId} role="row" data-row-id={row.rowId}>
                    <div className={`${leftCellClassName} employee-sum-hint-cell`} role="rowheader">
                      <span title={row.message}>{row.message}</span>
                    </div>
                    <div className="table-right-cell" role="cell">
                      <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                        <div className="value-axis-gutter" aria-hidden="true" />
                        {reportData.map((point) => (
                          <div className="value-cell is-muted" key={`${row.rowId}-${point.key}`} />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }

              if (row.kind === 'employee_chart') {
                return (
                  <div className={rowClassName} key={row.rowId} role="row" data-row-id={row.rowId}>
                    <div className={leftCellClassName} role="rowheader" title={getEmployeeFullName(row.employee)}>
                      {getEmployeeFullName(row.employee)}
                    </div>
                    <div className="table-right-cell" role="cell">
                      <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                        <div className="row-chart-cell employee-row-chart-cell">
                          <RowMetricChart
                            metric={row.metric}
                            reportData={reportData}
                            threshold={employeeThresholdsByMetricId[row.metric.id]}
                            direction={resolveMetricDirection(row.metric.id, metricDirectionsById)}
                            valuesByPeriod={buildEmployeeChartValuesByPeriod(
                              row.employee,
                              reportData,
                              row.metric.id,
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              if (row.kind === 'chart') {
                return (
                  <div className={rowClassName} key={row.rowId} role="row" data-row-id={row.rowId}>
                    <div className={leftCellClassName} role="rowheader" title={row.metric.label}>
                      {row.metric.label}
                    </div>
                    <div className="table-right-cell" role="cell">
                      <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                        <div className="row-chart-cell">
                          <RowMetricChart
                            metric={row.metric}
                            reportData={reportData}
                            threshold={rowThresholds[row.metric.id]}
                            direction={resolveMetricDirection(row.metric.id, metricDirectionsById)}
                            valuesByPeriod={row.valuesByPeriod}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              if (row.kind === 'source_metric') {
                const sourceData = sourceMetrics[row.sourceId];
                const metricData = sourceData?.metrics[row.metricKey];
                const actionId = buildSourceMetricActionId(row.sourceId, row.metricKey);
                const actionIds = buildSourceMetricActionIds(row.sourceId, row.metricKey, sourceData);
                const rowThreshold = resolveThresholdForIds(actionIds, rowThresholds);
                const periodValues = reportData.map((point) =>
                  toCorridorValue(
                    readValuesByPeriod(metricData?.valuesByPeriod, point.key),
                    resolvePeriodValueState(valueStates, point.key, actionIds),
                  ),
                );
                const rowRecommendedThreshold = calculateRecommendedThresholds(
                  periodValues,
                  row.valueType === 'money' ? 'money' : row.valueType === 'percent' ? 'percent' : 'number',
                );
                const chartOpen = expandedChartMetricIds.has(actionId);
                const employeesOpen = expandedEmployeeMetricIds.has(actionId);
                const valueType = row.valueType === 'money' ? 'money' : row.valueType === 'percent' ? 'percent' : 'number';
                const detailSourceIds = sourceData?.detailSourceIds ?? [];
                const detailMetricIds = metricData?.detailMetricIds ?? [];
                const sourceMetricEmployees = buildSourceMetricEmployees(
                  reportDetails,
                  detailSourceIds,
                  detailMetricIds,
                  availableEmployees,
                );
                const sourceMetricEmployeesForThreshold = sourceMetricEmployees.map((employee) =>
                  remapEmployeeValuesToMetricId(employee, detailMetricIds, actionId),
                );
                const employeeThreshold = employeeThresholdsByMetricId[actionId] ?? { upper: '', lower: '', mode: null };
                const employeeRecommendedThreshold = calculateRecommendedThresholds(
                  buildEmployeeThresholdValues(
                    actionId,
                    sourceMetricEmployeesForThreshold,
                    appliedEmployeeIdsByMetricId[actionId],
                    reportData,
                    valueStates,
                    actionIds,
                  ),
                  valueType,
                );
                const syntheticMetric: MetricRow = {
                  id: actionId,
                  label: row.metricLabel,
                  type: valueType,
                  base: 0,
                };
                const applySourceRowThreshold = (value: ThresholdValues) => {
                  actionIds.forEach((id) => updateRowThreshold(id, value));
                };

                return (
                  <div
                    className={rowClassName}
                    key={row.rowId}
                    role="row"
                    data-row-id={row.rowId}
                    onDragOver={(event) => handleSourceMetricDragOver(row.sourceId, event)}
                    onDrop={(event) => handleSourceMetricDrop(row.sourceId, row.metricKey, event)}
                  >
                    <div className={leftCellClassName} role="rowheader">
                      <button
                        className="drag-handle-button"
                        type="button"
                        draggable
                        aria-label="Перетащить строку"
                        title="Перетащить строку"
                        onDragStart={(event) => handleSourceMetricDragStart(row.sourceId, row.metricKey, event)}
                        onDragEnd={() => {
                          draggedSourceMetricRef.current = null;
                        }}
                      >
                        <GripVertical size={15} />
                      </button>
                      <span className="metric-name" title={row.metricLabel}>{row.metricLabel}</span>
                      <RowActionsMenu
                        employeesOpen={employeesOpen}
                        hasAppliedEmployees={(appliedEmployeeIdsByMetricId[actionId]?.size ?? 0) > 0}
                        chartOpen={chartOpen}
                        threshold={rowThreshold}
                        recommendedThreshold={rowRecommendedThreshold}
                        employeeThreshold={employeeThreshold}
                        employeeRecommendedThreshold={employeeRecommendedThreshold}
                        showEmployees
                        metricId={actionId}
                        onToggleEmployees={() => toggleEmployeeRows(actionId)}
                        onOpenEmployeeSelector={() => ensureEmployeeSelectorDraft(actionId)}
                        employees={sourceMetricEmployees}
                        selectedEmployeeIds={draftEmployeeIdsByMetricId[actionId] ?? new Set<string>()}
                        onToggleEmployee={(employeeId) => toggleDraftMetricEmployee(actionId, employeeId)}
                        onSelectAllEmployees={(employeeIds) => selectAllDraftMetricEmployees(actionId, employeeIds)}
                        onResetEmployees={() => resetDraftMetricEmployees(actionId)}
                        onApplyEmployees={() => applyMetricEmployees(actionId, sourceMetricEmployees.map((employee) => employee.id))}
                        onDiscardEmployees={() => discardEmployeeSelectorDraft(actionId)}
                        onExpandAllEmployeeCharts={() => {
                          const employeeIds = tableRows
                            .filter((tableRow): tableRow is Extract<TableRow, { kind: 'employee' }> =>
                              tableRow.kind === 'employee' && tableRow.metric.id === actionId)
                            .map((tableRow) => tableRow.employee.id);
                          expandAllEmployeeCharts(actionId, employeeIds);
                        }}
                        onCollapseAllEmployeeCharts={() => collapseAllEmployeeCharts(actionId)}
                        employeeChartsExpanded={Array.from(expandedEmployeeChartIds).some((chartId) =>
                          chartId.startsWith(`${actionId}::`))}
                        onToggleChart={() => toggleMetricChart(actionId)}
                        onThresholdChange={applySourceRowThreshold}
                        onEmployeeThresholdChange={(value) => updateEmployeeThreshold(actionId, value)}
                        calculationPeriodLabel={corridorCalculationPeriodLabel}
                        valueType={valueType}
                        direction={resolveMetricDirectionForIds(actionIds, metricDirectionsById)}
                        onDirectionChange={(nextDirection) => {
                          actionIds.forEach((id) => updateMetricDirection(id, nextDirection));
                        }}
                      />
                    </div>
                    <div className="table-right-cell" role="cell">
                      <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                        <div className="value-axis-gutter" aria-hidden="true" />
                        {reportData.map((point) => {
                          if (!hasBuiltReport) {
                            return <div className="value-cell" key={`${row.rowId}-${point.key}`} />;
                          }

                          const value = readValuesByPeriod(metricData?.valuesByPeriod, point.key);
                          const display = getValueCellDisplay(
                            value,
                            valueType,
                            actionIds
                              .map((id) => valueStates[point.key]?.[id])
                              .find(Boolean),
                          );
                          const metricDirection = resolveMetricDirectionForIds(actionIds, metricDirectionsById);
                          const thresholdClass = display.hasNumericValue
                            ? getThresholdClass(value, rowThreshold, metricDirection)
                            : '';

                          return (
                            <ValueCellButton
                              className={thresholdClass}
                              valueLabel={display.label}
                              tooltipLabel={getValueCellOpenTooltip(
                                value,
                                row.metricLabel,
                                valueType,
                                display,
                                rowThreshold,
                                metricDirection,
                              )}
                              disabled={display.accessDenied}
                              key={`${row.rowId}-${point.key}`}
                              onClick={() => openDetail(
                                syntheticMetric,
                                point,
                                value,
                                '',
                                undefined,
                                row.sourceId,
                                detailSourceIds,
                                detailMetricIds,
                              )}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              }

              // Fallthrough for 'metric' kind (narrowed by previous checks)
              const metricRow = row as { kind: 'metric'; rowId: string; sectionId: string; metric: MetricRow };
              const rowThreshold = rowThresholds[metricRow.metric.id] ?? { upper: '', lower: '' };
              const rowRecommendedThreshold = calculateRecommendedThresholds(
                reportData.map((point) =>
                  toCorridorValue(
                    point.values[metricRow.metric.id],
                    resolvePeriodValueState(valueStates, point.key, metricRow.metric.id),
                  ),
                ),
                metricRow.metric.type,
              );
              const employeeThreshold = employeeThresholdsByMetricId[metricRow.metric.id] ?? { upper: '', lower: '', mode: null };
              const employeeRecommendedThreshold = calculateRecommendedThresholds(
                buildEmployeeThresholdValues(
                  metricRow.metric.id,
                  availableEmployees,
                  appliedEmployeeIdsByMetricId[metricRow.metric.id],
                  reportData,
                  valueStates,
                ),
                metricRow.metric.type,
              );
              const employeesOpen = expandedEmployeeMetricIds.has(metricRow.metric.id);
              const chartOpen = expandedChartMetricIds.has(metricRow.metric.id);

              return (
                <div
                  className={rowClassName}
                  key={metricRow.rowId}
                  role="row"
                  data-row-id={metricRow.rowId}
                  onDragOver={(event) => handleMetricDragOver(metricRow.sectionId, event)}
                  onDrop={(event) => handleMetricDrop(metricRow.sectionId, metricRow.metric.id, event)}
                >
                  <div className={leftCellClassName} role="rowheader">
                    <button
                      className="drag-handle-button"
                      type="button"
                      draggable
                      aria-label="Перетащить строку"
                      title="Перетащить строку"
                      onDragStart={(event) => handleMetricDragStart(metricRow.sectionId, metricRow.metric.id, event)}
                      onDragEnd={() => {
                        draggedMetricRef.current = null;
                      }}
                    >
                      <GripVertical size={15} />
                    </button>
                    <span className="metric-name" title={metricRow.metric.label}>{metricRow.metric.label}</span>
                    <RowActionsMenu
                      employeesOpen={employeesOpen}
                      hasAppliedEmployees={(appliedEmployeeIdsByMetricId[metricRow.metric.id]?.size ?? 0) > 0}
                      chartOpen={chartOpen}
                      threshold={rowThreshold}
                      recommendedThreshold={rowRecommendedThreshold}
                      employeeThreshold={employeeThreshold}
                      employeeRecommendedThreshold={employeeRecommendedThreshold}
                      metricId={metricRow.metric.id}
                      onToggleEmployees={() => toggleEmployeeRows(metricRow.metric.id)}
                      onOpenEmployeeSelector={() => ensureEmployeeSelectorDraft(metricRow.metric.id)}
                      employees={availableEmployees}
                      selectedEmployeeIds={draftEmployeeIdsByMetricId[metricRow.metric.id] ?? new Set<string>()}
                      onToggleEmployee={(employeeId) => toggleDraftMetricEmployee(metricRow.metric.id, employeeId)}
                      onSelectAllEmployees={(employeeIds) => selectAllDraftMetricEmployees(metricRow.metric.id, employeeIds)}
                      onResetEmployees={() => resetDraftMetricEmployees(metricRow.metric.id)}
                      onApplyEmployees={() => applyMetricEmployees(metricRow.metric.id, availableEmployees.map((employee) => employee.id))}
                      onDiscardEmployees={() => discardEmployeeSelectorDraft(metricRow.metric.id)}
                      onExpandAllEmployeeCharts={() => {
                        const employeeIds = tableRows
                          .filter((tableRow): tableRow is Extract<TableRow, { kind: 'employee' }> =>
                            tableRow.kind === 'employee' && tableRow.metric.id === metricRow.metric.id)
                          .map((tableRow) => tableRow.employee.id);
                        expandAllEmployeeCharts(metricRow.metric.id, employeeIds);
                      }}
                      onCollapseAllEmployeeCharts={() => collapseAllEmployeeCharts(metricRow.metric.id)}
                      employeeChartsExpanded={Array.from(expandedEmployeeChartIds).some((chartId) =>
                        chartId.startsWith(`${metricRow.metric.id}::`))}
                      onToggleChart={() => toggleMetricChart(metricRow.metric.id)}
                      onThresholdChange={(value) => updateRowThreshold(metricRow.metric.id, value)}
                      onEmployeeThresholdChange={(value) => updateEmployeeThreshold(metricRow.metric.id, value)}
                      calculationPeriodLabel={corridorCalculationPeriodLabel}
                      valueType={metricRow.metric.type}
                      direction={resolveMetricDirection(metricRow.metric.id, metricDirectionsById)}
                      onDirectionChange={(nextDirection) => updateMetricDirection(metricRow.metric.id, nextDirection)}
                    />
                  </div>
                  <div className="table-right-cell" role="cell">
                    <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                      <div className="value-axis-gutter" aria-hidden="true" />
                      {reportData.map((point) => {
                        const value = point.values[metricRow.metric.id];
                        const display = getValueCellDisplay(
                          value,
                          metricRow.metric.type,
                          valueStates[point.key]?.[metricRow.metric.id],
                        );
                        const metricDirection = resolveMetricDirection(metricRow.metric.id, metricDirectionsById);
                        const thresholdClass = display.hasNumericValue
                          ? getThresholdClass(value, rowThreshold, metricDirection)
                          : '';

                        return (
                          <ValueCellButton
                            className={thresholdClass}
                            valueLabel={display.label}
                            tooltipLabel={getValueCellOpenTooltip(
                              value,
                              metricRow.metric.label,
                              metricRow.metric.type,
                              display,
                              rowThreshold,
                              metricDirection,
                            )}
                            disabled={display.accessDenied}
                            key={`${metricRow.rowId}-${point.key}`}
                            onClick={() => openDetail(metricRow.metric, point, value, metricRow.sectionId)}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
            {tableRows.length === 0 && (
              <div className="report-table-row is-empty-row" role="row">
                <div className="table-left-cell empty-left-cell" role="rowheader">
                  Разделы не выбраны
                </div>
                <div className="table-right-cell" role="cell">
                  <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                    <div className="value-axis-gutter" aria-hidden="true" />
                    {reportData.map((point) => (
                      <div className="value-cell" key={`empty-${point.key}`} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {canScrollBack && (
            <TooltipButton
              className="scroll-button scroll-back-button"
              label="Прокрутить временную шкалу влево"
              onClick={() => handleScrollButtonClick(-1)}
              onPointerDown={(event) => handleScrollButtonPointerDown(-1, event)}
              onPointerUp={handleScrollButtonPointerUp}
              onPointerCancel={handleScrollButtonPointerUp}
              onPointerLeave={handleScrollButtonPointerUp}
              onContextMenu={(event) => event.preventDefault()}
            >
              <ChevronLeft size={24} />
            </TooltipButton>
          )}

          <TooltipButton
            className={`scroll-button scroll-forward-button ${canScrollForward ? '' : 'is-disabled'}`}
            label="Прокрутить временную шкалу вправо"
            onClick={() => handleScrollButtonClick(1)}
            onPointerDown={(event) => handleScrollButtonPointerDown(1, event)}
            onPointerUp={handleScrollButtonPointerUp}
            onPointerCancel={handleScrollButtonPointerUp}
            onPointerLeave={handleScrollButtonPointerUp}
            onContextMenu={(event) => event.preventDefault()}
            disabled={!canScrollForward}
          >
            <ChevronRight size={24} />
          </TooltipButton>
        </section>
        <div className="floating-layer" />
      </section>

      {indicatorsSettingsDraft && (
        <IndicatorsSettingsPanel
          open={isIndicatorsSettingsOpen}
          isProUser={isProUser}
          period={draftFilters.period}
          crmSourceOptions={crmSourceOptions}
          mainThreshold={mainThreshold}
          mainRecommendedThreshold={mainRecommendedThreshold}
          calculationPeriodLabel={corridorCalculationPeriodLabel}
          mainDirection={resolveMetricDirection(MAIN_INDICATOR_DIRECTION_KEY, metricDirectionsById)}
          draft={indicatorsSettingsDraft}
          onDraftChange={setIndicatorsSettingsDraft}
          onMainDirectionChange={(direction) => updateMetricDirection(MAIN_INDICATOR_DIRECTION_KEY, direction)}
          onThresholdApply={(value) => {
            markUserSettingsChange();
            setMainThreshold(value);
          }}
          onThresholdReset={() => {
            markUserSettingsChange();
            setMainThreshold({ upper: '', lower: '', mode: null });
          }}
          onCancel={closeIndicatorsSettingsPanel}
          onShowSummary={showSummaryFromPanel}
          onSaveSet={saveSetFromPanel}
          onExpandAllRowCharts={expandAllRowCharts}
          onCollapseAllRowCharts={collapseAllRowCharts}
        />
      )}

      {isAutoSetupConfirmOpen && (
        <AutoSetupConfirmModal
          onCancel={() => setIsAutoSetupConfirmOpen(false)}
          onConfirm={(suppressPrompt) => {
            if (suppressPrompt) {
              markAutoSetupPromptSuppressed();
            }
            setIsAutoSetupConfirmOpen(false);
            runAutomaticReportBuild();
          }}
        />
      )}

      {isSaveOpen && (
        <SaveViewModal
          value={newViewName}
          onValueChange={setNewViewName}
          onClose={() => {
            setIsSaveOpen(false);
            setEditingViewId(null);
            setNewViewName('');
          }}
          onSave={saveCurrentView}
          title={editingViewId ? 'Редактировать набор' : 'Сохранить набор'}
        />
      )}

      {deleteViewId && (
        <ConfirmDeleteViewModal
          onConfirm={confirmDeleteSavedView}
          onCancel={() => setDeleteViewId(null)}
        />
      )}

      {isFreeLimitOpen && (
        <FreeSaveLimitModal
          onClose={() => setIsFreeLimitOpen(false)}
          onOpenPro={() => {
            setIsFreeLimitOpen(false);
            setIsProOpen(true);
          }}
        />
      )}

      {isInstructionOpen && (
        <InstructionModal
          onClose={() => setIsInstructionOpen(false)}
          onStartTips={startReportOnboarding}
        />
      )}

      <ReportOnboarding
        open={isOnboardingOpen}
        stepIndex={onboardingStepIndex}
        onStepChange={setOnboardingStepIndex}
        onClose={closeReportOnboarding}
      />

      {isAppSettingsOpen && (
        <AppSettingsModal
          settings={appSettings}
          employees={settingsEmployees}
          onSave={saveAppSettings}
          onClose={() => setIsAppSettingsOpen(false)}
          onOpenPro={() => setIsProOpen(true)}
        />
      )}

      {isProOpen && (
        <ProVersionModal
          onClose={() => setIsProOpen(false)}
          onSubscribe={handleCreateProPayment}
          isLoading={paymentLoading}
          isBillingLoading={billingLoading}
          hasBillingLoadFailed={billingLoadFailed}
          plans={billingPlans}
          hasPro={billingHasPro}
          validUntil={billingValidUntil}
          isLifetime={billingIsLifetime}
          error={billingError}
          customerEmail={billingCustomerEmail}
          onCustomerEmailChange={setBillingCustomerEmail}
        />
      )}

      {detailContext && (
        <DetailModal context={detailContext} rows={detailRows} onClose={closeDetail} />
      )}

      {notification && (
        <div className="toast-message" role="status">
          {notification}
        </div>
      )}
    </main>
  );
}

export default App;


