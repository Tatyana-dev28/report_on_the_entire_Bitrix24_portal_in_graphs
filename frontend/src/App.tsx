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
  Download,
  FileText,
  LifeBuoy,
  MoreVertical,
  Minus,
  Pin,
  PinOff,
  Plus,
  Play,
  Settings2,
  SlidersHorizontal,
  GripVertical,
  X,
} from 'lucide-react';
import ReportBuildLoader from './app/components/ReportBuildLoader';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import ExcelJS from 'exceljs';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import {
  formatMetricValue,
  formatRangeLabel,
  metricSections as defaultMetricSections,
  metrics as defaultMetrics,
  periodOptions as defaultPeriodOptions,
  type DateRange,
  type MetricRow,
  type Period,
  type ReportPoint,
} from './services/report/reportCatalog';
import { reportDataSource } from './services/report/reportDataSource';
import type { CrmSource, CrmSourceType, MetricDetailItem, ReportLoadFilters, SourceMetricsData } from './services/report/reportTypes';
import type { PortalEmployeeItem } from './services/api/reportApiClient';
import {
  APP_SETTINGS_STORAGE_KEY,
  CHART_AXIS_WIDTH,
  DETAIL_COLUMN_STORAGE_KEY,
  LAST_AVAILABLE_MONTH_INDEX,
  MAX_PERIOD_COLUMN_WIDTH,
  MIN_PERIOD_COLUMN_WIDTH,
  MONTH_LABELS,
  PERIOD_COLUMN_WIDTH,
  buttonLabels,
  chartDisplayModeOptions,
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
  ThresholdValues,
} from './app/types';
import {
  bitrixEntityLabels,
  getEntityTypeForMetric,
  openBitrixEntity,
  openBitrixUser,
} from './app/utils/bitrixNavigation';
import {
  constrainRangeForPeriod,
  getRangeFromMonthIndexes,
  getPreviousWeekFromYesterdayRange,
  getYesterdayRange,
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
  getChartSeriesValue,
  getChartSumValue,
  getEmployeeInitials,
} from './app/utils/reportCalculations';
import {
  calculateRecommendedThresholds,
  getAppliedThresholdItems,
  getThresholdClass,
  getThresholdAverage,
  getThresholdLineLabel,
  parseThreshold,
  thresholdLineColors,
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
  createProPayment,
  loadBillingState,
  type BillingPlan,
} from './services/api/billingApiClient';
import {
  loadReportSettings,
  saveReportSettings,
} from './services/api/reportApiClient';
import {
  ConfigureChartMenu,
  DateRangePicker,
  RowActionsMenu,
  RowMetricChart,
  SavedViewsSelect,
  SectionMetricsMenu,
  TableSettingsMenu,
} from './app/components/reportControls';

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
    normalizedMessage === 'failed to fetch' ||
    normalizedMessage.includes('networkerror') ||
    normalizedMessage.includes('load failed') ||
    normalizedMessage.includes('vite_api_base_url')
  ) {
    return BILLING_LOAD_ERROR_MESSAGE;
  }

  return message;
};

const toReportEmployee = (employee: { id: string; userId?: number; name: string; avatarUrl?: string; values?: Record<string, number> }): ReportEmployee => {
  const { firstName, lastName } = splitEmployeeName(employee.name);
  const userId = employee.userId ?? Number(employee.id);

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

  return 900000 + fallback;
};

const buildBackendDetailRows = (
  details: MetricDetailItem[],
  context: DetailContext,
): DetailRow[] =>
  details
    .filter((detail) => {
      // For source_metric rows: filter by detailSourceIds AND detailMetricIds
      if (context.detailSourceIds && context.detailSourceIds.length > 0) {
        // Source must match one of the detailSourceIds
        if (detail.sourceId && !context.detailSourceIds.includes(detail.sourceId)) {
          return false;
        }

        // Metric must match one of the detailMetricIds (if specified)
        if (context.detailMetricIds && context.detailMetricIds.length > 0) {
          if (detail.metricId && !context.detailMetricIds.includes(detail.metricId)) {
            return false;
          }
        }

        // Period must match
        if (detail.periodKey && detail.periodKey !== context.point.key) {
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

      if (detail.periodKey && detail.periodKey !== context.point.key) {
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

      return {
        rowNumber: index + 1,
        entityId: detailIdToNumber(detail.entityId ?? detail.id, index + 1),
        title: detail.title || detail.metricLabel || context.metric.label,
        responsibleId: Number.isFinite(responsibleId) ? responsibleId : 0,
        responsibleName: detail.responsibleName || detail.employeeName || context.employee?.name || '',
        createdAt: Number.isFinite(createdAtDate.getTime())
          ? backendDetailDateFormatter.format(createdAtDate)
          : context.point.label,
        createdAtSortValue,
        entityType: context.entityType,
      };
    });

const areStringArraysEqual = (first: string[], second: string[]) =>
  first.length === second.length && first.every((value, index) => value === second[index]);

const normalizePeriodKey = (value: string) => value.slice(0, 10);

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

function App() {
  // Hydration guards: prevent auto-save until settings are fully loaded/applied
  const settingsHydratedRef = useRef(false);
  const applyingBackendSettingsRef = useRef(false);
  // Skip Pro auto-save while applying one-shot "Построить автоматически" presets.
  // Cleared when that auto-build generation finishes (not via a fixed timer).
  const skipAutoSaveRef = useRef(false);
  const autoBuildGenerationRef = useRef(0);
  const activeAutoBuildGenerationRef = useRef<number | null>(null);
  // Chart sources locked for the active auto-build (Sales funnel only).
  // Re-applied after preview so late Pro hydration cannot restore other chart checkboxes.
  const autoBuildChartSourcesRef = useRef<string[] | null>(null);

  const [savedViews, setSavedViews] = useState<SavedReportViewOption[]>(() => [defaultSavedView]);
  const [selectedView, setSelectedView] = useState('default');
  const [draftFilters, setDraftFilters] = useState<ReportFilters>(() => createDefaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<ReportFilters>(() => createDefaultFilters());
  // Separate state for table settings — these are the sources the user selected
  // specifically in "Настройка таблицы". They are NOT the same as chart sources.
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
  const [reportEmployees, setReportEmployees] = useState<ReportEmployee[]>([]);
  const [portalEmployees, setPortalEmployees] = useState<PortalEmployeeItem[]>([]);
  const [reportDetails, setReportDetails] = useState<MetricDetailItem[]>([]);
  const [sourceMetrics, setSourceMetrics] = useState<Record<string, SourceMetricsData>>({});
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportElapsed, setReportElapsed] = useState('');
  const [reportError, setReportError] = useState('');
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [isProOpen, setIsProOpen] = useState(false);
  const [isInstructionOpen, setIsInstructionOpen] = useState(false);
  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false);
  const [isFreeLimitOpen, setIsFreeLimitOpen] = useState(false);
  const [billingHasPro, setBillingHasPro] = useState(false);
  const [billingValidUntil, setBillingValidUntil] = useState<string | null>(null);
  const [billingIsLifetime, setBillingIsLifetime] = useState(false);
  const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([]);
  const [billingError, setBillingError] = useState('');
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingLoadFailed, setBillingLoadFailed] = useState(false);
  const [billingCustomerEmail, setBillingCustomerEmail] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [deleteViewId, setDeleteViewId] = useState<string | null>(null);
  const [notification, setNotification] = useState('');
  const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
  const [newViewName, setNewViewName] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [hasBuiltReport, setHasBuiltReport] = useState(false);
  const [buildMoment, setBuildMoment] = useState(0);
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
  const [expandedChartMetricIds, setExpandedChartMetricIds] = useState<Set<string>>(() => new Set());
  const [rowThresholds, setRowThresholds] = useState<Record<string, ThresholdValues>>({});
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
          }))
        : reportEmployees,
    [portalEmployees, reportEmployees],
  );

  const horizontalScrollbarRef = useRef<HTMLDivElement>(null);
  const reportCardRef = useRef<HTMLElement>(null);
  const mainChartWrapRef = useRef<HTMLDivElement>(null);
  const chartContentRef = useRef<HTMLDivElement>(null);
  const periodContentRef = useRef<HTMLDivElement>(null);
  const tableContentRef = useRef<HTMLDivElement>(null);
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
  const reportStartTimeRef = useRef<number>(0);

  const upperThresholdNumber = useMemo(() => parseThreshold(mainThreshold.upper), [mainThreshold.upper]);
  const lowerThresholdNumber = useMemo(() => parseThreshold(mainThreshold.lower), [mainThreshold.lower]);
  const averageThresholdNumber = useMemo(() => {
    if (upperThresholdNumber === null || lowerThresholdNumber === null) {
      return null;
    }

    return Math.round((upperThresholdNumber + lowerThresholdNumber) / 2);
  }, [upperThresholdNumber, lowerThresholdNumber]);

  useEffect(() => {
    if (!notification) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setNotification(''), 5200);
    return () => window.clearTimeout(timeoutId);
  }, [notification]);

  useEffect(() => {
    if (!reportLoading) {
      setReportElapsed('');
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

        if (settings && Object.keys(settings).length > 0) {
          // Apply saved filters
          if (typeof settings.period === 'string') {
            setDraftFilters((current) => ({ ...current, period: settings.period as Period }));
            setAppliedFilters((current) => ({ ...current, period: settings.period as Period }));
          }

          if (settings.dateRange && typeof settings.dateRange === 'object') {
            const dateRange = settings.dateRange as { start?: string; end?: string };
            if (dateRange.start && dateRange.end) {
              const nextRange = { start: dateRange.start, end: dateRange.end };
              setDraftFilters((current) => ({ ...current, dateRange: nextRange }));
              setAppliedFilters((current) => ({ ...current, dateRange: nextRange }));
            }
          }

          // Do not restore chart sources over an in-flight "Построить автоматически" preset.
          if (
            settings.selectedSources
            && Array.isArray(settings.selectedSources)
            && activeAutoBuildGenerationRef.current === null
            && !skipAutoSaveRef.current
          ) {
            setDraftFilters((current) => ({ ...current, selectedSources: settings.selectedSources as string[] }));
            setAppliedFilters((current) => ({ ...current, selectedSources: settings.selectedSources as string[] }));
          }

          let restoredSectionIds = new Set<string>();

          if (settings.enabledSectionIds && Array.isArray(settings.enabledSectionIds)) {
            restoredSectionIds = new Set(settings.enabledSectionIds as string[]);
            setDraftFilters((current) => ({ ...current, enabledSectionIds: restoredSectionIds }));
            setAppliedFilters((current) => ({ ...current, enabledSectionIds: new Set(restoredSectionIds) }));
          } else if (
            settings.enabledMetricIdsBySection &&
            typeof settings.enabledMetricIdsBySection === 'object'
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

          if (settings.tableSelectedSources && Array.isArray(settings.tableSelectedSources)) {
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
          } else if (settings.selectedSources && Array.isArray(settings.selectedSources)) {
            // Backward compatibility: older saves used chart sources for the table.
            const tableSources = settings.selectedSources as string[];
            setTableSelectedSources(tableSources);
            setDraftTableSelectedSources(tableSources);
            setTableEntitySourceIds(entitySourceIdsForSections(restoredSectionIds));
          } else {
            const entityIds = entitySourceIdsForSections(restoredSectionIds);
            setTableSelectedSources([]);
            setTableEntitySourceIds(entityIds);
            setDraftTableSelectedSources(entityIds);
          }

          if (typeof settings.chartDisplayMode === 'string') {
            setDraftFilters((current) => ({ ...current, chartDisplayMode: settings.chartDisplayMode as ChartDisplayMode }));
            setAppliedFilters((current) => ({ ...current, chartDisplayMode: settings.chartDisplayMode as ChartDisplayMode }));
          }

          if (typeof settings.metricMode === 'string') {
            setDraftFilters((current) => ({ ...current, metricMode: settings.metricMode as ChartMetricMode }));
            setAppliedFilters((current) => ({ ...current, metricMode: settings.metricMode as ChartMetricMode }));
          }

          if (settings.schedule && typeof settings.schedule === 'object') {
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

          // Apply saved thresholds
          if (settings.mainThreshold && typeof settings.mainThreshold === 'object') {
            const mt = settings.mainThreshold as Record<string, unknown>;
            setMainThreshold({
              upper: String(mt.upper ?? ''),
              lower: String(mt.lower ?? ''),
              mode: (mt.mode as 'manual' | 'recommended' | null) ?? null,
            });
          }

          if (settings.rowThresholds && typeof settings.rowThresholds === 'object') {
            setRowThresholds(settings.rowThresholds as Record<string, { upper: string; lower: string; mode: 'manual' | 'recommended' | null }>);
          }

          // Apply saved metric visibility
          if (settings.enabledMetricIdsBySection && typeof settings.enabledMetricIdsBySection === 'object') {
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
          if (settings.sectionOrder && Array.isArray(settings.sectionOrder)) {
            setSectionOrder(settings.sectionOrder as string[]);
          }

          // Apply saved metric order
          if (settings.metricOrderBySection && typeof settings.metricOrderBySection === 'object') {
            setMetricOrderBySection(settings.metricOrderBySection as Record<string, string[]>);
          }

          if (settings.sourceSectionOrder && Array.isArray(settings.sourceSectionOrder)) {
            setSourceSectionOrder(settings.sourceSectionOrder as string[]);
          }

          if (
            settings.sourceMetricOrderBySource
            && typeof settings.sourceMetricOrderBySource === 'object'
          ) {
            setSourceMetricOrderBySource(settings.sourceMetricOrderBySource as Record<string, string[]>);
          }

          if (
            settings.enabledMetricKeysBySource
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
          if (settings.expandedSections && Array.isArray(settings.expandedSections)) {
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
            ...savedViewsData.map((item) => ({
              value: String(item.value ?? ''),
              label: String(item.label ?? ''),
              isSystem: Boolean(item.isSystem),
              state: item.state as SavedReportViewState | undefined,
            })),
          ];
          setSavedViews(restoredViews);
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

  // Effect: on billing state change, either load settings (PRO) or reset (FREE)
  useEffect(() => {
    if (billingLoading) {
      return;
    }

    if (billingHasPro) {
      applyBackendSettings();
    } else {
      resetToDefaultSettings();
    }
  }, [billingHasPro, billingLoading, applyBackendSettings, resetToDefaultSettings]);

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
          setSectionOrder((current) => {
            const known = new Set(current);
            const missing = sections.map((section) => section.id).filter((id) => !known.has(id));
            return missing.length ? [...current, ...missing] : current;
          });
          setMetricOrderBySection((current) => {
            const next = { ...current };
            sections.forEach((section) => {
              if (!next[section.id]) {
                next[section.id] = section.metricIds;
              }
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
          setCatalogError(error instanceof Error ? error.message : 'Не удалось загрузить настройки отчета.');
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
  }, [refreshPortalEmployees]);

  useEffect(() => {
    if (!hasBuiltReport) {
      return undefined;
    }

    let isActive = true;
    const selectedMetricIds = metricSections.flatMap((section) => {
      if (!appliedFilters.enabledSectionIds.has(section.id)) {
        return [];
      }

      const enabledMetricIds = appliedEnabledMetricIdsBySection[section.id] ?? new Set<string>();
      return section.metricIds.filter((metricId) => enabledMetricIds.has(metricId));
    });
    const reportSourceIds = Array.from(
      new Set([
        ...appliedFilters.selectedSources,
        ...tableSelectedSources,
        ...tableEntitySourceIds,
      ]),
    );
    const filters: ReportLoadFilters = {
      period: appliedFilters.period,
      dateRange: appliedFilters.dateRange,
      selectedSources: reportSourceIds,
      selectedMetricIds,
      metricMode: appliedFilters.metricMode,
      chartDisplayMode: appliedFilters.chartDisplayMode,
    };

    setReportLoading(true);
    reportStartTimeRef.current = Date.now();
    setReportError('');
    reportDataSource
      .loadReportPreview(filters)
      .then((preview) => {
        if (isActive) {
          setRawReportData(preview.data);
          setReportEmployees((preview.employees ?? []).map(toReportEmployee));
          setReportDetails(preview.details ?? []);
          setSourceMetrics(preview.sourceMetrics ?? {});

          if (applyAutomaticThresholdsRef.current) {
            const scheduledData = applyScheduleToReportData(preview.data, filters.period, appliedFilters.schedule);
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
              setDraftFilters((current) => ({
                ...current,
                selectedSources: [...lockedChartSources],
              }));
              setAppliedFilters((current) => ({
                ...current,
                selectedSources: [...lockedChartSources],
              }));
            }

            // Main chart sum = successful money for locked chart sources only (Sales won_sum).
            const mainValues = scheduledData.map((point) =>
              getChartSumValue(
                point,
                chartSourcesForAutoBuild,
                metricMode,
                preview.sourceMetrics ?? {},
              ),
            );
            const mainRecommended = calculateRecommendedThresholds(mainValues, metricMode);

            setMainThreshold({
              upper: mainRecommended.upper,
              lower: mainRecommended.lower,
              mode: 'recommended',
            });

            const nextRowThresholds: Record<string, ThresholdValues> = {};

            // Regular section metrics (deals, leads, …).
            selectedMetricIds.forEach((metricId) => {
              const metric = metrics.find((item) => item.id === metricId);

              if (!metric) {
                return;
              }

              const recommended = calculateRecommendedThresholds(
                scheduledData.map((point) => point.values[metricId]),
                metric.type,
              );

              nextRowThresholds[metricId] = {
                upper: recommended.upper,
                lower: recommended.lower,
                mode: 'recommended',
              };
            });

            // Funnel / smart-process rows use `${sourceKey}::${metricKey}` (same as table UI).
            Object.entries(preview.sourceMetrics ?? {}).forEach(([sourceKey, sourceData]) => {
              Object.entries(sourceData.metrics ?? {}).forEach(([metricKey, metricData]) => {
                const valueType =
                  metricData.valueType === 'money'
                    ? 'money'
                    : metricData.valueType === 'percent'
                      ? 'percent'
                      : 'number';
                const recommended = calculateRecommendedThresholds(
                  scheduledData.map((point) => metricData.valuesByPeriod?.[point.key] ?? 0),
                  valueType,
                );

                nextRowThresholds[`${sourceKey}::${metricKey}`] = {
                  upper: recommended.upper,
                  lower: recommended.lower,
                  mode: 'recommended',
                };
              });
            });

            setRowThresholds(nextRowThresholds);
            applyAutomaticThresholdsRef.current = false;
            autoBuildChartSourcesRef.current = null;
          } else {
            // Regular build (not automatic): clear thresholds after data load
            // to prevent applyBackendSettings from restoring stale values
            // that may still be on the server (before triggerAutoSave saves empty ones).
            setMainThreshold({ upper: '', lower: '', mode: null });
            setRowThresholds({});
          }

          // End auto-build skip only after thresholds (and other presets) are applied.
          // Defer clearing so the threshold setState autosave effect still sees skip=true.
          const finishedGeneration = activeAutoBuildGenerationRef.current;
          if (
            finishedGeneration !== null &&
            finishedGeneration === autoBuildGenerationRef.current
          ) {
            activeAutoBuildGenerationRef.current = null;
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
          const message = error instanceof Error ? error.message : 'Не удалось построить отчет.';
          setReportError(
            message.includes('OAuth') || message.includes('токен')
              ? 'Нет OAuth-токенов Bitrix24. Откройте приложение из портала или переустановите его, чтобы backend получил доступ к REST API.'
              : message,
          );
          setRawReportData([]);
          setReportEmployees([]);
          setReportDetails([]);
          applyAutomaticThresholdsRef.current = false;
          autoBuildChartSourcesRef.current = null;
          const failedGeneration = activeAutoBuildGenerationRef.current;
          if (
            failedGeneration !== null &&
            failedGeneration === autoBuildGenerationRef.current
          ) {
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

  const appliedReportData = useMemo(
    () => applyScheduleToReportData(rawReportData, appliedFilters.period, appliedFilters.schedule),
    [appliedFilters.period, appliedFilters.schedule, rawReportData],
  );
  const reportData = useMemo(
    () => (hasBuiltReport ? appliedReportData : createZeroReportData(appliedReportData)),
    [appliedReportData, hasBuiltReport],
  );
  const crmSourceOptions = useMemo(
    () =>
      [...crmSources]
        // Keep deal/smart pipelines visible even if Bitrix marks them unavailable —
        // otherwise "Сделки" vanish from table/chart source pickers.
        .filter((source) => source.isAvailable || source.type === 'deal' || source.type === 'smartProcess')
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
  const chartBaseValues = useMemo(
    () =>
      reportData.map((point) =>
        getChartSumValue(point, selectedChartSources, appliedFilters.metricMode, sourceMetrics),
      ),
    [appliedFilters.metricMode, reportData, selectedChartSources, sourceMetrics],
  );
  const mainThresholdRecommendationValues = useMemo(
    () =>
      isSeparateChart
        ? reportData.flatMap((point) =>
            selectedChartSources.map((source) =>
              getChartSeriesValue(point, source, appliedFilters.metricMode, sourceMetrics),
            ),
          )
        : chartBaseValues,
    [appliedFilters.metricMode, chartBaseValues, isSeparateChart, reportData, selectedChartSources, sourceMetrics],
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
  const chartData = useMemo(
    () =>
      reportData.map((point, index) => {
        const seriesValues = isSeparateChart
          ? selectedChartSources.reduce<Record<string, number>>((acc, source, sourceIndex) => {
              acc[`series_${sourceIndex}`] = getChartSeriesValue(
                point,
                source,
                appliedFilters.metricMode,
                sourceMetrics,
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
          trend: trendValues[index] ?? chartBaseValues[index] ?? 0,
        };
      }),
    [
      appliedFilters.metricMode,
      chartBaseValues,
      isSeparateChart,
      reportData,
      selectedChartSources,
      sourceMetrics,
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
        ? reportData.flatMap((point) =>
            selectedChartSources.map((source) =>
              getChartSeriesValue(point, source, appliedFilters.metricMode, sourceMetrics),
            ),
          )
        : [...chartBaseValues, ...trendValues];

      return getChartDomain([...values, ...thresholdNumbers]);
    },
    [
      appliedFilters.metricMode,
      chartBaseValues,
      isSeparateChart,
      reportData,
      selectedChartSources,
      sourceMetrics,
      thresholdNumbers,
      trendValues,
    ],
  );
  const activeMainChartDataPoint = activeMainChartPoint
    ? chartData[activeMainChartPoint.index]
    : null;
  const mainChartTooltipItems = useMemo<ChartTooltipItem[]>(() => {
    if (!activeMainChartDataPoint) {
      return [];
    }

    const activeValues = activeMainChartDataPoint as unknown as Record<string, number>;

    return chartSeries.map((series) => ({
      label: series.label,
      value: formatMainChartValue(Number(activeValues[series.key] ?? 0), appliedFilters.metricMode),
      color: series.color,
    }));
  }, [activeMainChartDataPoint, appliedFilters.metricMode, chartSeries]);
  const mainThresholdTooltipItems = useMemo(
    () => getAppliedThresholdItems(mainThreshold),
    [mainThreshold],
  );
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
  const availableEmployees = useMemo<ReportEmployee[]>(
    () => reportEmployees,
    [reportEmployees],
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

      const standardRows: TableRow[] = visibleSections.flatMap((section) => {
        const rows: TableRow[] = [
          { kind: 'section', rowId: `section-${section.id}`, sectionId: section.id, label: section.label },
        ];

        if (!expandedSections.has(section.id)) {
          return rows;
        }

        const orderedMetricIds = metricOrderBySection[section.id] ?? section.metricIds;

        const enabledMetricIds = activeMetricIdsBySection[section.id] ?? new Set<string>();

        orderedMetricIds.forEach((metricId) => {
          if (!enabledMetricIds.has(metricId)) {
            return;
          }

          const metric = metricMap.get(metricId);

          if (!metric) {
            return;
          }

          rows.push({
            kind: 'metric',
            rowId: `metric-${metric.id}`,
            sectionId: section.id,
            metric,
          });

          if (expandedEmployeeMetricIds.has(metric.id)) {
            availableEmployees.forEach((employee, employeeIndex) => {
              rows.push({
                kind: 'employee',
                rowId: `employee-${metric.id}-${employee.id}`,
                sectionId: section.id,
                metric,
                employee,
                employeeIndex,
              });
            });
          }

          if (expandedChartMetricIds.has(metric.id)) {
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

      Object.entries(sourceMetrics).forEach(([sourceKey, sourceData]) => {
        sourceMetricsByLookup.set(sourceKey, { key: sourceKey, data: sourceData });
        sourceMetricsByLookup.set(sourceData.sourceId, { key: sourceKey, data: sourceData });
      });

      if (hasBuiltReport && tableSelectedSources.length > 0) {
        const seenSourceKeys = new Set<string>();
        const matchedSources: Array<{ key: string; data: (typeof sourceMetrics)[string] }> = [];

        tableSelectedSources.forEach((selectedId) => {
          const matched = sourceMetricsByLookup.get(selectedId);
          if (!matched || seenSourceKeys.has(matched.key)) {
            return;
          }

          seenSourceKeys.add(matched.key);
          if (Object.keys(matched.data.metrics).length === 0) {
            return;
          }

          matchedSources.push(matched);
        });

        const orderedSourceKeys = mergeIdOrder(
          sourceSectionOrder,
          matchedSources.map((item) => item.key),
        );
        const matchedByKey = new Map(matchedSources.map((item) => [item.key, item.data]));

        // Auto-build may pin Sales funnel first in the whole table (above CRM sections).
        let leadingSourceKey: string | null = null;
        if (tableLeadingSourceId) {
          leadingSourceKey =
            matchedSources.find(
              (item) => item.key === tableLeadingSourceId || item.data.sourceId === tableLeadingSourceId,
            )?.key ?? null;
        }

        const displaySourceKeys = leadingSourceKey
          ? [leadingSourceKey, ...orderedSourceKeys.filter((key) => key !== leadingSourceKey)]
          : orderedSourceKeys;

        displaySourceKeys.forEach((sourceKey) => {
          const sourceData = matchedByKey.get(sourceKey);
          if (!sourceData) {
            return;
          }

          const defaultMetricKeys = Object.keys(sourceData.metrics);
          const orderedMetricKeys = mergeIdOrder(
            sourceMetricOrderBySource[sourceKey] ?? [],
            defaultMetricKeys,
          );

          sourceSectionRows.push({
            kind: 'source_section',
            rowId: `source-section-${sourceKey}`,
            sourceId: sourceKey,
            label: sourceData.label,
          });

          orderedMetricKeys.forEach((metricKey) => {
            const metric = sourceData.metrics[metricKey];
            if (!metric) {
              return;
            }

            const activeSourceMetricKeys = hasBuiltReport
              ? appliedEnabledMetricKeysBySource[sourceKey]
              : enabledMetricKeysBySource[sourceKey];
            // Missing entry = default "all enabled"; empty Set = none.
            if (activeSourceMetricKeys && !activeSourceMetricKeys.has(metricKey)) {
              return;
            }

            sourceSectionRows.push({
              kind: 'source_metric',
              rowId: `source-metric-${sourceKey}-${metricKey}`,
              sourceId: sourceKey,
              metricKey,
              metricLabel: metric.label,
              valueType: metric.valueType,
            });
          });
        });
      }

      if (tableLeadingSourceId) {
        const leadingKey =
          sourceSectionRows.find(
            (row) =>
              row.kind === 'source_section'
              && (row.sourceId === tableLeadingSourceId
                || sourceMetrics[row.sourceId]?.sourceId === tableLeadingSourceId),
          )?.sourceId ?? null;

        if (leadingKey) {
          const leadingRows: TableRow[] = [];
          const otherSourceRows: TableRow[] = [];

          sourceSectionRows.forEach((row) => {
            if (
              (row.kind === 'source_section' || row.kind === 'source_metric')
              && row.sourceId === leadingKey
            ) {
              leadingRows.push(row);
            } else {
              otherSourceRows.push(row);
            }
          });

          return [...leadingRows, ...standardRows, ...otherSourceRows];
        }
      }

      return [...standardRows, ...sourceSectionRows];
      },
      [
        visibleSections,
        expandedSections,
        // CRITICAL: Use appliedEnabledMetricIdsBySection instead of enabledMetricIdsBySection.
        // When hasBuiltReport is true, the table reads from appliedEnabledMetricIdsBySection.
        // Without this dependency, clicking "Применить" in table/section metrics settings
        // would update appliedEnabledMetricIdsBySection but tableRows would NOT recalculate.
        appliedEnabledMetricIdsBySection,
        enabledMetricIdsBySection,
        appliedEnabledMetricKeysBySource,
        enabledMetricKeysBySource,
        availableEmployees,
        metricMap,
        metricOrderBySection,
        expandedEmployeeMetricIds,
        expandedChartMetricIds,
        sourceMetrics,
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

  // Manual user edits must outrank the auto-build autosave skip.
  const markUserSettingsChange = useCallback(() => {
    skipAutoSaveRef.current = false;
  }, []);

  const handlePeriodChange = useCallback((nextPeriod: Period) => {
    markUserSettingsChange();
    setDraftFilters((current) => ({
      ...current,
      period: nextPeriod,
      dateRange:
        nextPeriod === 'hours'
          ? getYesterdayRange()
          : constrainRangeForPeriod(nextPeriod, current.dateRange),
    }));
  }, [markUserSettingsChange]);

  const handleDateRangeChange = useCallback((nextRange: DateRange) => {
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

  const handleChartDisplayModeChange = useCallback((value: ChartDisplayMode) => {
    markUserSettingsChange();
    setDraftFilters((current) => ({
      ...current,
      chartDisplayMode: value,
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

  // Chart Apply — commits draft chart settings to applied. Does not change table settings.
  // Rebuilds preview only when a report is already built and chart sources changed
  // (so newly selected chart sources get data without opening settings alone building).
  const applyChartSettings = useCallback((settings: ChartDraftSettings) => {
    markUserSettingsChange();
    const nextSources = [...settings.selectedSources];
    const nextSchedule = {
      ...settings.schedule,
      weekendDayIds: [...settings.schedule.weekendDayIds],
    };
    const sourcesChanged = !areStringArraysEqual(nextSources, appliedFilters.selectedSources);

    setDraftFilters((current) => ({
      ...current,
      selectedSources: nextSources,
      chartDisplayMode: settings.chartDisplayMode,
      metricMode: settings.metricMode,
      schedule: nextSchedule,
    }));
    setAppliedFilters((current) => ({
      ...current,
      selectedSources: nextSources,
      chartDisplayMode: settings.chartDisplayMode,
      metricMode: settings.metricMode,
      schedule: {
        ...nextSchedule,
        weekendDayIds: [...nextSchedule.weekendDayIds],
      },
    }));

    if (hasBuiltReport && sourcesChanged) {
      setBuildMoment(Date.now());
      setReportBuildRequest((current) => current + 1);
    }
  }, [appliedFilters.selectedSources, hasBuiltReport, markUserSettingsChange]);

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
    setExpandedSections(new Set(sectionIds));

    if (hasBuiltReport) {
      setBuildMoment(Date.now());
      setReportBuildRequest((current) => current + 1);
    }
  }, [
    crmSources,
    draftTableSelectedSources,
    hasBuiltReport,
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
    overrides: Partial<Pick<ReportFilters, 'period' | 'dateRange'>> = {},
  ) => {
    markUserSettingsChange();
    const period = overrides.period ?? draftFilters.period;
    const dateRange = overrides.dateRange ?? draftFilters.dateRange;

    setHasBuiltReport(true);
    setDraftFilters((current) => ({
      ...current,
      period,
      dateRange,
      selectedSources,
    }));
    // Build updates chart filters + period only.
    // Table visibility stays under table settings (applied enabledSectionIds /
    // tableSelectedSources / appliedEnabledMetricIdsBySection).
    setAppliedFilters((current) => ({
      ...current,
      period,
      dateRange,
      selectedSources,
      chartDisplayMode: draftFilters.chartDisplayMode,
      metricMode: draftFilters.metricMode,
      schedule: {
        ...draftFilters.schedule,
        weekendDayIds: [...draftFilters.schedule.weekendDayIds],
      },
    }));
    setBuildMoment(Date.now());
    setReportBuildRequest((current) => current + 1);
  }, [draftFilters, markUserSettingsChange]);

  const buildReport = useCallback(() => {
    applyAutomaticThresholdsRef.current = false;
    setTableLeadingSourceId(null);
    setMainThreshold({ upper: '', lower: '', mode: null });
    setRowThresholds({});
    // Empty chart selection stays empty — never expand to all/default sources.
    applyReportBuild(sanitizeChartSources(draftFilters.selectedSources));
  }, [applyReportBuild, draftFilters.selectedSources, sanitizeChartSources]);

  const buildAutomaticReport = useCallback(() => {
    const dealPipelineSources = crmSources.filter(isDealPipelineSource);
    const salesSource =
      dealPipelineSources.find((source) => source.isAvailable && (source.id === 'deal-0' || source.categoryId === 0)) ??
      dealPipelineSources.find((source) => source.id === 'deal-0' || source.categoryId === 0) ??
      dealPipelineSources.find((source) => {
        const label = `${source.sourceLabel} ${source.title}`.toLocaleLowerCase('ru-RU');
        return label.includes('продаж');
      }) ??
      dealPipelineSources.find((source) => source.isAvailable) ??
      dealPipelineSources[0];

    if (!salesSource) {
      setNotification('В каталоге отчета нет доступной воронки "Продажи".');
      return;
    }

    // Do not persist this beginner preset into Pro saved settings.
    // Keep skip active until this generation finishes applying thresholds after preview.
    const generation = autoBuildGenerationRef.current + 1;
    autoBuildGenerationRef.current = generation;
    activeAutoBuildGenerationRef.current = generation;
    skipAutoSaveRef.current = true;

    const dateRange = getPreviousWeekFromYesterdayRange();
    // Chart settings only: exactly one source — Sales funnel. Never copy table selection here.
    const chartSources = [salesSource.id];
    autoBuildChartSourcesRef.current = chartSources;
    // Table: all available sources/entities, with Sales funnel first among pipelines.
    // Independent from chartSources — table checkboxes must not leak into the main chart.
    const allTableSources = [
      salesSource.id,
      ...crmSourceIds.filter((id) => id !== salesSource.id),
    ];
    const availableSectionIds = new Set(metricSections.map((section) => section.id));
    const { pipelineSourceIds, entitySourceIds } = resolveTableSelectionFromSources(
      allTableSources,
      crmSources,
      availableSectionIds,
    );
    const nextEnabledSectionIds = new Set(metricSections.map((section) => section.id));
    const nextEnabledMetrics = metricSections.reduce<Record<string, Set<string>>>((acc, section) => {
      acc[section.id] = new Set(section.metricIds);
      return acc;
    }, {});
    const nextSectionOrder = [
      ...(metricSections.some((section) => section.id === 'deals') ? ['deals'] : []),
      ...metricSections.map((section) => section.id).filter((id) => id !== 'deals'),
    ];

    applyAutomaticThresholdsRef.current = true;

    setDraftFilters((current) => ({
      ...current,
      period: 'days',
      dateRange,
      selectedSources: [...chartSources],
      metricMode: 'money',
      chartDisplayMode: 'sum',
      enabledSectionIds: nextEnabledSectionIds,
    }));
    setAppliedFilters((current) => ({
      ...current,
      period: 'days',
      dateRange,
      selectedSources: [...chartSources],
      metricMode: 'money',
      chartDisplayMode: 'sum',
      enabledSectionIds: new Set(nextEnabledSectionIds),
      schedule: {
        ...current.schedule,
        weekendDayIds: [...current.schedule.weekendDayIds],
      },
    }));
    setEnabledMetricIdsBySection(
      Object.fromEntries(
        Object.entries(nextEnabledMetrics).map(([sectionId, metricIds]) => [
          sectionId,
          new Set(metricIds),
        ]),
      ),
    );
    setAppliedEnabledMetricIdsBySection(
      Object.fromEntries(
        Object.entries(nextEnabledMetrics).map(([sectionId, metricIds]) => [
          sectionId,
          new Set(metricIds),
        ]),
      ),
    );
    setTableSelectedSources(pipelineSourceIds);
    setTableEntitySourceIds(entitySourceIds);
    setDraftTableSelectedSources([...entitySourceIds, ...pipelineSourceIds]);
    setSectionOrder(nextSectionOrder);
    setTableLeadingSourceId(salesSource.id);
    setExpandedSections(new Set(nextEnabledSectionIds));

    setHasBuiltReport(true);
    setBuildMoment(Date.now());
    setReportBuildRequest((current) => current + 1);
  }, [crmSourceIds, crmSources, metricSections]);

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

  const toggleMetricChart = useCallback((metricId: string) => {
    setExpandedChartMetricIds((current) => {
      const next = new Set(current);

      if (next.has(metricId)) {
        next.delete(metricId);
      } else {
        next.add(metricId);
      }

      return next;
    });
  }, []);

  const updateRowThreshold = useCallback((metricId: string, value: ThresholdValues) => {
    markUserSettingsChange();
    setRowThresholds((current) => ({
      ...current,
      [metricId]: value,
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

  const captureCurrentViewState = useCallback(
    (): SavedReportViewState => ({
      draftFilters: serializeFilters(draftFilters),
      appliedFilters: serializeFilters(appliedFilters),
      tableSelectedSources: [...tableSelectedSources],
      enabledMetricIdsBySection: Object.fromEntries(
        Object.entries(enabledMetricIdsBySection).map(([sectionId, metricIds]) => [
          sectionId,
          [...metricIds],
        ]),
      ),
      sectionOrder: [...sectionOrder],
      metricOrderBySection: Object.fromEntries(
        Object.entries(metricOrderBySection).map(([sectionId, metricIds]) => [
          sectionId,
          [...metricIds],
        ]),
      ),
      sourceSectionOrder: [...sourceSectionOrder],
      sourceMetricOrderBySource: Object.fromEntries(
        Object.entries(sourceMetricOrderBySource).map(([sourceId, metricKeys]) => [
          sourceId,
          [...metricKeys],
        ]),
      ),
      enabledMetricKeysBySource: Object.fromEntries(
        Object.entries(enabledMetricKeysBySource).map(([sourceId, metricKeys]) => [
          sourceId,
          [...metricKeys],
        ]),
      ),
      expandedSections: [...expandedSections],
      mainThreshold: { ...mainThreshold },
      rowThresholds: { ...rowThresholds },
    }),
    [
      appliedFilters,
      draftFilters,
      enabledMetricIdsBySection,
      enabledMetricKeysBySource,
      expandedSections,
      mainThreshold,
      metricOrderBySection,
      rowThresholds,
      sectionOrder,
      sourceMetricOrderBySource,
      sourceSectionOrder,
      tableSelectedSources,
    ],
  );

  const saveViews = useCallback((views: SavedReportViewOption[]) => {
    setSavedViews(views);
    // Pro сохраняет savedViews через triggerAutoSave → saveReportSettings() на backend.
    // localStorage не используется — ни для Free, ни для Pro.
  }, []);

  // Debounced auto-save to backend for PRO users
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerAutoSave = useCallback(() => {
    // Free version: never save anything
    if (!billingHasPro) {
      return;
    }

    // One-shot automatic build must not overwrite saved user settings.
    if (skipAutoSaveRef.current) {
      return;
    }

    // Do not save until settings have been hydrated from backend
    if (!settingsHydratedRef.current) {
      return;
    }

    // Do not save while backend settings are being applied
    if (applyingBackendSettingsRef.current) {
      return;
    }

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
    }, 2000);
  }, [billingHasPro, captureCurrentViewState, savedViews, appSettings, tableSelectedSources]);

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
    savedViews,
    appSettings,
    tableSelectedSources,
    draftTableSelectedSources,
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

  const applySavedViewState = useCallback((state: SavedReportViewState) => {
    const deserializedDraft = deserializeFilters(state.draftFilters);
    const deserializedApplied = deserializeFilters(state.appliedFilters);
    setDraftFilters(deserializedDraft);
    setAppliedFilters(deserializedApplied);
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
    setHasBuiltReport(true);
    setBuildMoment(Date.now());
    // Trigger report build for the restored view state
    setReportBuildRequest((current) => current + 1);
  }, []);

  const handleSavedViewChange = useCallback((viewId: string) => {
    setSelectedView(viewId);
    const selectedSavedView = savedViews.find((view) => view.value === viewId);

    if (selectedSavedView?.state) {
      applySavedViewState(selectedSavedView.state);
    }
  }, [applySavedViewState, savedViews]);

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
    }

    setDeleteViewId(null);
  }, [deleteViewId, saveViews, savedViews, selectedView]);

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
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'САПП';
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet('Отчет', {
      views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }],
    });
    const header = ['Показатели', ...reportData.map((point) => point.label)];
    const periodLabel = `${periodOptions.find((option) => option.value === appliedFilters.period)?.label ?? 'Период'}: ${formatRangeLabel(appliedFilters.period, appliedFilters.dateRange)}`;

    worksheet.addRow([periodLabel]);
    worksheet.mergeCells(1, 1, 1, header.length);
    const periodRow = worksheet.getRow(1);
    periodRow.height = 24;
    periodRow.font = { bold: true, color: { argb: 'FF30343B' } };
    periodRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEFF6FF' },
    };
    periodRow.alignment = { vertical: 'middle' };

    const headerRow = worksheet.addRow(header);
    headerRow.font = { bold: true, color: { argb: 'FF30343B' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEAF4FF' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    tableRows
      .filter((row) => row.kind !== 'chart')
      .forEach((row) => {
        if (row.kind === 'section') {
          const sectionRow = worksheet.addRow([row.label, ...reportData.map(() => '')]);
          sectionRow.font = { bold: true, color: { argb: 'FF30343B' } };
          sectionRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF3F5F8' },
          };
          return;
        }

        if (row.kind === 'source_section') {
          const sectionRow = worksheet.addRow([row.label, ...reportData.map(() => '')]);
          sectionRow.font = { bold: true, color: { argb: 'FF30343B' } };
          sectionRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF3F5F8' },
          };
          return;
        }

        if (row.kind === 'employee') {
          const employeeRow = worksheet.addRow([
            `  ${row.employee.firstName} ${row.employee.lastName}`,
            ...reportData.map((point) =>
              formatMetricValue(
                hasBuiltReport ? getEmployeePeriodMetricValue(row.employee, point, row.metric.id) : 0,
                row.metric.type,
              ),
            ),
          ]);
          employeeRow.getCell(1).font = { bold: true, color: { argb: 'FF4D5866' } };
          return;
        }

        if (row.kind === 'source_metric') {
          const sourceData = sourceMetrics[row.sourceId];
          const metricData = sourceData?.metrics[row.metricKey];
          const valueType = row.valueType === 'money' ? 'money' : row.valueType === 'percent' ? 'percent' : 'number';
          const metricRow = worksheet.addRow([
            `  ${row.metricLabel}`,
            ...reportData.map((point) => {
              const value = metricData?.valuesByPeriod[point.key] ?? 0;
              return formatMetricValue(value, valueType);
            }),
          ]);
          metricRow.getCell(1).font = { bold: true, color: { argb: 'FF4D5866' } };
          return;
        }

        const metricRow = worksheet.addRow([
          row.metric.label,
          ...reportData.map((point) => formatMetricValue(point.values[row.metric.id], row.metric.type)),
        ]);
        metricRow.getCell(1).font = { bold: true, color: { argb: 'FF30343B' } };
      });

    worksheet.columns = [
      { width: 34 },
      ...reportData.map(() => ({ width: 16 })),
    ];
    worksheet.eachRow((row) => {
      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE6E9EE' } },
          left: { style: 'thin', color: { argb: 'FFE6E9EE' } },
          bottom: { style: 'thin', color: { argb: 'FFE6E9EE' } },
          right: { style: 'thin', color: { argb: 'FFE6E9EE' } },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: colNumber === 1 ? 'left' : 'center',
        };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'bitrix24-report.xlsx',
    );
  }, [appliedFilters.dateRange, appliedFilters.period, downloadBlob, hasBuiltReport, reportData, tableRows, sourceMetrics]);

  const exportPdf = useCallback(async () => {
    const element = reportCardRef.current;

    if (!element) {
      return;
    }

    const scrollbar = horizontalScrollbarRef.current;
    const savedScrollLeft = scrollbar?.scrollLeft ?? 0;
    const reportSurface = element.querySelector('.report-surface') as HTMLElement | null;
    const leftColumnWidth = reportSurface
      ? parseFloat(getComputedStyle(reportSurface).getPropertyValue('--left-column-width')) || 280
      : 280;
    const expandedWidth = Math.ceil(leftColumnWidth + rightContentWidth);
    const previousWidth = element.style.width;
    const previousMaxWidth = element.style.maxWidth;

    try {
      if (scrollbar) {
        scrollbar.scrollLeft = 0;
      }

      applySyncedScroll(0);
      element.classList.add('pdf-capture-mode');
      element.style.setProperty('--pdf-right-width', `${rightContentWidth}px`);
      element.style.setProperty('--pdf-total-width', `${expandedWidth}px`);
      element.style.width = `${Math.max(expandedWidth, element.scrollWidth)}px`;
      element.style.maxWidth = 'none';

      // PDF сейчас намеренно остается визуальным снимком. Текстовый режим можно добавить отдельной опцией позже.
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

      const captureWidth = Math.max(element.scrollWidth, expandedWidth);
      const captureHeight = element.scrollHeight;
      const canvas = await html2canvas(element, {
        backgroundColor: '#ffffff',
        scale: Math.min(2, window.devicePixelRatio || 1.5),
        useCORS: true,
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: Math.max(document.documentElement.clientWidth, captureWidth),
        windowHeight: Math.max(document.documentElement.clientHeight, captureHeight),
        width: captureWidth,
        height: captureHeight,
      });
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imageHeight = (canvas.height * pdfWidth) / canvas.width;
      const image = canvas.toDataURL('image/png');
      let position = 0;
      let remainingHeight = imageHeight;

      pdf.addImage(image, 'PNG', 0, position, pdfWidth, imageHeight);
      remainingHeight -= pdfHeight;

      while (remainingHeight > 0) {
        position -= pdfHeight;
        pdf.addPage();
        pdf.addImage(image, 'PNG', 0, position, pdfWidth, imageHeight);
        remainingHeight -= pdfHeight;
      }

      const logo = element.querySelector('.brand-mark') as HTMLElement | null;

      if (logo) {
        const logoRect = logo.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const ratio = pdfWidth / elementRect.width;
        const linkX = (logoRect.left - elementRect.left) * ratio;
        const linkY = (logoRect.top - elementRect.top) * ratio;
        const linkWidth = logoRect.width * ratio;
        const linkHeight = logoRect.height * ratio;
        const pageIndex = Math.floor(linkY / pdfHeight);
        const pageY = linkY - pageIndex * pdfHeight;

        pdf.setPage(pageIndex + 1);
        pdf.link(linkX, pageY, linkWidth, linkHeight, {
          url: 'https://sapp24.com/?utm_source=app-b24',
        });
      }

      pdf.save('bitrix24-report.pdf');
    } finally {
      element.classList.remove('pdf-capture-mode');
      element.style.width = previousWidth;
      element.style.maxWidth = previousMaxWidth;
      element.style.removeProperty('--pdf-right-width');
      element.style.removeProperty('--pdf-total-width');

      if (scrollbar) {
        scrollbar.scrollLeft = savedScrollLeft;
      }

      applySyncedScroll(savedScrollLeft);
    }
  }, [applySyncedScroll, rightContentWidth]);

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
            <TableSettingsMenu
              selectedSources={draftTableSelectedSources}
              crmSourceOptions={crmSourceOptions}
              onSourcesChange={handleTableSelectedSourcesChange}
              onApply={applyTableSettings}
            />
            <TooltipButton
              label="Настроить приложение"
              onClick={openAppSettings}
            >
              <Cog size={18} />
            </TooltipButton>
            <TooltipButton
              label="Инструкция"
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
            <TooltipButton
              label="Построить отчет"
              onClick={buildReport}
              className="build-report-icon-button"
            >
              <Play size={18} />
            </TooltipButton>
            <button className="action-button green-button" type="button" onClick={exportExcel}>
              <Download size={17} />
              <span>{buttonLabels.download}</span>
            </button>
            <button className="action-button purple-button" type="button" onClick={exportPdf}>
              <FileText size={17} />
              <span>Скачать PDF</span>
            </button>
          </div>
        </header>

        <div className="soft-divider" />

        {(catalogLoading || catalogError || reportLoading || reportError || (hasBuiltReport && !reportLoading && !reportError && reportData.length === 0)) && (
          <div className={`report-status-bar ${catalogError || reportError ? 'is-error' : ''}`}>
            {catalogLoading && <span>Загружаем настройки отчета из backend...</span>}
            {catalogError && <span>{catalogError}</span>}
            {reportLoading && <span>Отчет формируется {reportElapsed}</span>}
            {reportError && <span>{reportError}</span>}
            {hasBuiltReport && !reportLoading && !reportError && reportData.length === 0 && (
              <span>По выбранным фильтрам данных нет. Измените период, источники или метрики и постройте отчет заново.</span>
            )}
          </div>
        )}

        <section className={`report-surface ${isPinned ? 'is-pinned' : ''}`} style={reportSurfaceStyle}>
          <div className="fixed-column">
            <div className="left-pane chart-left">
              <div className="section-title-row">
                <p>Главный график</p>
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
              <div className="chart-controls chart-action-controls">
                <ConfigureChartMenu
                  filters={draftFilters}
                  crmSourceOptions={crmSourceOptions}
                  mainThreshold={mainThreshold}
                  mainRecommendedThreshold={mainRecommendedThreshold}
                  onApply={applyChartSettings}
                  onDraftChange={updateChartDraftSettings}
                  onThresholdApply={(value) => {
                    markUserSettingsChange();
                    setMainThreshold(value);
                  }}
                  onThresholdReset={() => {
                    markUserSettingsChange();
                    setMainThreshold({ upper: '', lower: '', mode: null });
                  }}
                />
                <TableSettingsMenu
                  selectedSources={draftTableSelectedSources}
                  crmSourceOptions={crmSourceOptions}
                  onSourcesChange={handleTableSelectedSourcesChange}
                  onApply={applyTableSettings}
                  trigger="text"
                />
                <button className="left-panel-action-button left-build-button" type="button" onClick={buildReport}>
                  <Play size={16} />
                  <span>{buttonLabels.build}</span>
                </button>
                <button className="left-panel-action-button left-auto-build-button" type="button" onClick={buildAutomaticReport}>
                  <Settings2 size={16} />
                  <span>Построить автоматически</span>
                </button>
              </div>
            </div>

            <div className="indicator-left">Показатели</div>
            <div className="scrollbar-left-spacer" />
          </div>

          <div className="scroll-column">
            <div className="sync-viewport chart-viewport">
              {reportLoading && (
                <div className="chart-loading-overlay">
                  <ReportBuildLoader />
                </div>
              )}
              <div className="sync-content chart-sync-content" style={syncedContentStyle} ref={chartContentRef}>
                <div className="chart-wrap" ref={mainChartWrapRef}>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart
                      data={chartData}
                      margin={{ top: 18, right: 0, left: 0, bottom: 8 }}
                      onMouseLeave={() => setActiveMainChartPoint(null)}
                    >
                      <CartesianGrid stroke="#edf0f4" vertical={false} />
                      <XAxis
                        dataKey="xIndex"
                        type="number"
                        domain={[0, Math.max(reportData.length, 1)]}
                        hide
                      />
                      <YAxis
                        width={CHART_AXIS_WIDTH}
                        domain={chartDomain}
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
                      {!isSeparateChart && (
                        <Line
                          type="linear"
                          dataKey="trend"
                          name="Линия тренда"
                          stroke="#2274ff"
                          strokeOpacity={0.28}
                          strokeWidth={2}
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
                  {activeMainChartPoint && activeMainChartDataPoint && (
                    <ChartPointTooltip
                      point={activeMainChartPoint}
                      title={activeMainChartDataPoint.tooltipLabel}
                      items={mainChartTooltipItems}
                      thresholdItems={mainThresholdTooltipItems}
                      containerRef={mainChartWrapRef}
                      valueFormatter={(value) => formatMainChartValue(value, appliedFilters.metricMode)}
                    />
                  )}
                </div>
              </div>
              <div className="chart-zoom-controls" aria-label="Масштаб графика">
                <TooltipButton
                  label="Увеличить масштаб графика"
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
                  label="Уменьшить масштаб графика"
                  onClick={() =>
                    setPeriodColumnWidth((current) =>
                      Math.max(MIN_PERIOD_COLUMN_WIDTH, current - 8),
                    )
                  }
                  className="zoom-icon-button"
                >
                  <Minus size={16} />
                </TooltipButton>
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
                  <span key={point.key}>{point.label}</span>
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
              const rowClassName = [
                'report-table-row',
                row.kind === 'section' ? 'is-section-row' : '',
                row.kind === 'source_section' ? 'is-section-row' : '',
                row.kind === 'metric' ? 'is-metric-row' : '',
                row.kind === 'source_metric' ? 'is-metric-row' : '',
                row.kind === 'employee' ? 'is-employee-row' : '',
                row.kind === 'chart' ? 'is-chart-row' : '',
              ].filter(Boolean).join(' ');
              const leftCellClassName = [
                'table-left-cell',
                row.kind === 'section' ? 'section-left-cell' : '',
                row.kind === 'source_section' ? 'section-left-cell' : '',
                row.kind === 'metric' ? 'metric-left-cell' : '',
                row.kind === 'source_metric' ? 'metric-left-cell' : '',
                row.kind === 'employee' ? 'employee-left-cell' : '',
                row.kind === 'chart' ? 'chart-left-cell' : '',
              ].filter(Boolean).join(' ');

              if (row.kind === 'section') {
                const section = sectionMap.get(row.sectionId);
                const enabledMetricIds =
                  enabledMetricIdsBySection[row.sectionId] ??
                  new Set(section?.metricIds ?? []);

                return (
                  <div
                    className={rowClassName}
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
                        onClick={() => toggleSection(row.sectionId)}
                      >
                        <ChevronDown size={16} />
                        <span>{row.label}</span>
                      </button>
                      {section && (
                        <SectionMetricsMenu
                          section={section}
                          metricMap={metricMap}
                          enabledMetricIds={enabledMetricIds}
                          onToggleMetric={(metricId) => toggleEnabledMetric(row.sectionId, metricId)}
                          onSelectAll={() => selectAllSectionMetrics(row.sectionId)}
                          onReset={() => resetSectionMetrics(row.sectionId)}
                          onApply={applySectionMetrics}
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
                        onClick={() => toggleSourceSection(row.sourceId)}
                      >
                        <ChevronDown size={16} />
                        <span>{row.label}</span>
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
                return (
                  <div className={rowClassName} key={row.rowId} role="row" data-row-id={row.rowId}>
                    <div className={leftCellClassName} role="rowheader">
                      <button
                        className="employee-person-button"
                        type="button"
                        onClick={() => openBitrixUser(row.employee.userId)}
                      >
                        <span className="employee-avatar" aria-hidden="true">
                          {row.employee.avatarUrl ? (
                            <img src={row.employee.avatarUrl} alt="" />
                          ) : (
                            <span>{getEmployeeInitials(row.employee)}</span>
                          )}
                        </span>
                        <span>{row.employee.firstName} {row.employee.lastName}</span>
                      </button>
                    </div>
                    <div className="table-right-cell" role="cell">
                      <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                        <div className="value-axis-gutter" aria-hidden="true" />
                        {reportData.map((point) => {
                          const value = hasBuiltReport
                            ? getEmployeePeriodMetricValue(row.employee, point, row.metric.id)
                            : 0;

                          const valueLabel = formatMetricValue(value, row.metric.type);

                          return (
                            <ValueCellButton
                              valueLabel={valueLabel}
                              key={`${row.rowId}-${point.key}`}
                              onClick={() => openDetail(row.metric, point, value, row.sectionId, row.employee)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              }

              if (row.kind === 'chart') {
                return (
                  <div className={rowClassName} key={row.rowId} role="row" data-row-id={row.rowId}>
                    <div className={leftCellClassName} role="rowheader">
                      График: {row.metric.label}
                    </div>
                    <div className="table-right-cell" role="cell">
                      <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                        <div className="row-chart-cell">
                          <RowMetricChart
                            metric={row.metric}
                            reportData={reportData}
                            threshold={rowThresholds[row.metric.id]}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }

              if (row.kind === 'source_metric') {
                // Render source_metric rows only when their parent section is expanded.
                // This check lives in the render phase (not in tableRows) to avoid a
                // circular dependency: tableRows → expandedSourceSections → tableRows.
                if (!expandedSourceSections.has(row.sourceId)) {
                  return null;
                }

                const sourceData = sourceMetrics[row.sourceId];
                const metricData = sourceData?.metrics[row.metricKey];
                const actionId = `${row.sourceId}::${row.metricKey}`;
                const rowThreshold = rowThresholds[actionId] ?? { upper: '', lower: '' };
                const periodValues = reportData.map(
                  (point) => metricData?.valuesByPeriod[point.key] ?? 0,
                );
                const rowRecommendedThreshold = calculateRecommendedThresholds(
                  periodValues,
                  row.valueType === 'money' ? 'money' : row.valueType === 'percent' ? 'percent' : 'number',
                );
                const chartOpen = expandedChartMetricIds.has(actionId);
                const valueType = row.valueType === 'money' ? 'money' : row.valueType === 'percent' ? 'percent' : 'number';
                const syntheticMetric: MetricRow = {
                  id: row.metricKey,
                  label: row.metricLabel,
                  type: valueType,
                  base: 0,
                };

                return (
                  <>
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
                          onDragStart={(event) => handleSourceMetricDragStart(row.sourceId, row.metricKey, event)}
                          onDragEnd={() => {
                            draggedSourceMetricRef.current = null;
                          }}
                        >
                          <GripVertical size={15} />
                        </button>
                        <span className="metric-name">{row.metricLabel}</span>
                        <RowActionsMenu
                          employeesOpen={false}
                          chartOpen={chartOpen}
                          threshold={rowThreshold}
                          recommendedThreshold={rowRecommendedThreshold}
                          showEmployees={false}
                          onToggleEmployees={() => undefined}
                          onToggleChart={() => toggleMetricChart(actionId)}
                          onThresholdChange={(value) => updateRowThreshold(actionId, value)}
                        />
                      </div>
                      <div className="table-right-cell" role="cell">
                        <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                          <div className="value-axis-gutter" aria-hidden="true" />
                          {reportData.map((point) => {
                            const value = metricData?.valuesByPeriod[point.key] ?? 0;
                            const valueLabel = formatMetricValue(value, valueType);
                            const thresholdClass = getThresholdClass(value, rowThreshold);
                            const detailSourceIds = sourceData?.detailSourceIds ?? [];
                            const detailMetricIds = metricData?.detailMetricIds ?? [];

                            return (
                              <ValueCellButton
                                className={thresholdClass}
                                valueLabel={valueLabel}
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
                    {chartOpen && (
                      <div
                        className="report-table-row is-chart-row"
                        key={`${row.rowId}-chart`}
                        role="row"
                        data-row-id={`${row.rowId}-chart`}
                      >
                        <div className="table-left-cell chart-left-cell" role="rowheader">
                          График: {row.metricLabel}
                        </div>
                        <div className="table-right-cell" role="cell">
                          <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                            <div className="row-chart-cell">
                              <RowMetricChart
                                metric={syntheticMetric}
                                reportData={reportData}
                                threshold={rowThreshold}
                                valuesByPeriod={metricData?.valuesByPeriod}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                );
              }

              // Fallthrough for 'metric' kind (narrowed by previous checks)
              const metricRow = row as { kind: 'metric'; rowId: string; sectionId: string; metric: MetricRow };
              const rowThreshold = rowThresholds[metricRow.metric.id] ?? { upper: '', lower: '' };
              const rowRecommendedThreshold = calculateRecommendedThresholds(
                reportData.map((point) => point.values[metricRow.metric.id]),
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
                      onDragStart={(event) => handleMetricDragStart(metricRow.sectionId, metricRow.metric.id, event)}
                      onDragEnd={() => {
                        draggedMetricRef.current = null;
                      }}
                    >
                      <GripVertical size={15} />
                    </button>
                    <span className="metric-name">{metricRow.metric.label}</span>
                    <RowActionsMenu
                      employeesOpen={employeesOpen}
                      chartOpen={chartOpen}
                      threshold={rowThreshold}
                      recommendedThreshold={rowRecommendedThreshold}
                      onToggleEmployees={() => toggleEmployeeRows(metricRow.metric.id)}
                      onToggleChart={() => toggleMetricChart(metricRow.metric.id)}
                      onThresholdChange={(value) => updateRowThreshold(metricRow.metric.id, value)}
                    />
                  </div>
                  <div className="table-right-cell" role="cell">
                    <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                      <div className="value-axis-gutter" aria-hidden="true" />
                      {reportData.map((point) => {
                        const value = point.values[metricRow.metric.id];
                        const thresholdClass = getThresholdClass(value, rowThreshold);
                        const valueLabel = formatMetricValue(value, metricRow.metric.type);

                        return (
                          <ValueCellButton
                            className={thresholdClass}
                            valueLabel={valueLabel}
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
            <button
              className="scroll-button scroll-back-button"
              type="button"
              aria-label="Прокрутить влево"
              onClick={() => handleScrollButtonClick(-1)}
              onPointerDown={(event) => handleScrollButtonPointerDown(-1, event)}
              onPointerUp={handleScrollButtonPointerUp}
              onPointerCancel={handleScrollButtonPointerUp}
              onPointerLeave={handleScrollButtonPointerUp}
              onContextMenu={(event) => event.preventDefault()}
            >
              <ChevronLeft size={24} />
            </button>
          )}

          <button
            className={`scroll-button scroll-forward-button ${canScrollForward ? '' : 'is-disabled'}`}
            type="button"
            aria-label="Прокрутить вправо"
            onClick={() => handleScrollButtonClick(1)}
            onPointerDown={(event) => handleScrollButtonPointerDown(1, event)}
            onPointerUp={handleScrollButtonPointerUp}
            onPointerCancel={handleScrollButtonPointerUp}
            onPointerLeave={handleScrollButtonPointerUp}
            onContextMenu={(event) => event.preventDefault()}
          >
            <ChevronRight size={24} />
          </button>
        </section>
        <div className="floating-layer" />
      </section>

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
          title={editingViewId ? 'Редактировать отображение' : 'Сохранить отображение'}
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
        <InstructionModal onClose={() => setIsInstructionOpen(false)} />
      )}

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
        <DetailModal context={detailContext} rows={detailRows} onClose={() => setDetailContext(null)} />
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


