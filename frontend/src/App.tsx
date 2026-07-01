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
import LoadingAnimation from './app/components/loadingAnimation';
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
import type { CrmSource, MetricDetailItem, ReportLoadFilters } from './services/report/reportTypes';
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
  DEFAULT_SOURCE_IDS,
  detailColumnMinWidthSum,
  detailColumns,
  scheduleTimeOptions,
  serializeFilters,
  deserializeFilters,
  weekDayOptions,
} from './app/constants';
import {
  loadAppSettings,
  loadDetailColumnWidths,
  loadSavedViews,
  persistSavedViews,
} from './app/storage';
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
      if (detail.metricId && detail.metricId !== context.metric.id) {
        return false;
      }

      if (detail.periodKey && detail.periodKey !== context.point.key) {
        return false;
      }

      if (context.employee && detail.employeeId && detail.employeeId !== context.employee.id) {
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

function App() {
  const [savedViews, setSavedViews] = useState<SavedReportViewOption[]>(() => loadSavedViews());
  const [selectedView, setSelectedView] = useState('default');
  const [draftFilters, setDraftFilters] = useState<ReportFilters>(() => createDefaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<ReportFilters>(() => createDefaultFilters());
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
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportElapsed, setReportElapsed] = useState('');
  const [animationProgress, setAnimationProgress] = useState(0);
  const [reportError, setReportError] = useState('');
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [isProOpen, setIsProOpen] = useState(false);
  const [isInstructionOpen, setIsInstructionOpen] = useState(false);
  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false);
  const [isFreeLimitOpen, setIsFreeLimitOpen] = useState(false);
  const [billingHasPro, setBillingHasPro] = useState(false);
  const [billingValidUntil, setBillingValidUntil] = useState<string | null>(null);
  const [billingIsLifetime, setBillingIsLifetime] = useState(false);
  const [billingPlan, setBillingPlan] = useState<BillingPlan | null>(null);
  const [billingError, setBillingError] = useState('');
  const [billingCustomerEmail, setBillingCustomerEmail] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [deleteViewId, setDeleteViewId] = useState<string | null>(null);
  const [notification, setNotification] = useState('');
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadAppSettings());
  const [newViewName, setNewViewName] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [hasBuiltReport, setHasBuiltReport] = useState(false);
  const [buildMoment, setBuildMoment] = useState(0);
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
        acc[section.id] = new Set(section.metricIds);
        return acc;
      }, {}),
  );
  const [appliedEnabledMetricIdsBySection, setAppliedEnabledMetricIdsBySection] = useState<Record<string, Set<string>>>(
    () =>
      metricSections.reduce<Record<string, Set<string>>>((acc, section) => {
        acc[section.id] = new Set(section.metricIds);
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
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(metricSections.map((section) => section.id)),
  );
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
  const canScrollBackRef = useRef(false);
  const canScrollForwardRef = useRef(false);
  const draggedMetricRef = useRef<{ sectionId: string; metricId: string } | null>(null);
  const draggedSectionRef = useRef<string | null>(null);
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
      setAnimationProgress(0);
      return undefined;
    }

    const startTime = Date.now();
    const DURATION = 12000;

    const tick = () => {
      const elapsed = Date.now() - reportStartTimeRef.current;
      const totalSeconds = Math.floor(elapsed / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const padded = (n: number) => String(n).padStart(2, '0');
      setReportElapsed(`${padded(hours)}:${padded(minutes)}:${padded(seconds)}`);

      const animProgress = Math.min((Date.now() - startTime) / DURATION, 1);
      setAnimationProgress(animProgress);
    };

    tick();
    const intervalId = window.setInterval(tick, 500);
    return () => window.clearInterval(intervalId);
  }, [reportLoading]);

  const refreshBillingState = useCallback(() => {
    setBillingError('');

    return loadBillingState()
      .then((state) => {
        setBillingHasPro(Boolean(state.access?.hasPro));
        setBillingValidUntil(state.access?.validUntil ?? null);
        setBillingIsLifetime(Boolean(state.access?.isLifetime));
        setBillingPlan(state.plans.find((plan) => plan.code === 'pro_monthly') ?? null);
        return state;
      })
      .catch((error) => {
        console.warn('[Billing] state was not loaded', error);
        setBillingError(error instanceof Error ? error.message : 'Не удалось загрузить статус подписки.');
        return null;
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
        setSectionOrder(sections.map((section) => section.id));
        setMetricOrderBySection(
          sections.reduce<Record<string, string[]>>((acc, section) => {
            acc[section.id] = section.metricIds;
            return acc;
          }, {}),
        );
        setEnabledMetricIdsBySection(
          sections.reduce<Record<string, Set<string>>>((acc, section) => {
            acc[section.id] = new Set(section.metricIds);
            return acc;
          }, {}),
        );
        setExpandedSections(new Set(sections.map((section) => section.id)));
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

      const enabledMetricIds = appliedEnabledMetricIdsBySection[section.id] ?? new Set(section.metricIds);
      return section.metricIds.filter((metricId) => enabledMetricIds.has(metricId));
    });
    const filters: ReportLoadFilters = {
      period: appliedFilters.period,
      dateRange: appliedFilters.dateRange,
      selectedSources: appliedFilters.selectedSources,
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
    appliedFilters.chartDisplayMode,
    appliedFilters.dateRange,
    appliedFilters.metricMode,
    appliedFilters.period,
    appliedFilters.selectedSources,
    appliedFilters.enabledSectionIds,
    buildMoment,
    appliedEnabledMetricIdsBySection,
    hasBuiltReport,
    metricSections,
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
      crmSources
        .filter((source) => source.isAvailable)
        .map((source) => ({
          value: source.id,
          label: source.sourceLabel || source.title || source.id,
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

  const normalizeSelectedSources = useCallback(
    (sources: string[]) => {
      if (!crmSourceIds.length) {
        return sources;
      }

      const allowedSourceIds = new Set(crmSourceIds);

      // Если пользователь явно выбрал источники — фильтруем по доступным
      if (sources.length > 0) {
        const selectedSources = sources.filter((source) => allowedSourceIds.has(source));
        return selectedSources.length ? selectedSources : crmSourceIds;
      }

      // Если источники не выбраны — подставляем разумный набор по умолчанию
      // (пересечение DEFAULT_SOURCE_IDS с реально доступными на портале источниками)
      const defaultSources = DEFAULT_SOURCE_IDS.filter((id) => allowedSourceIds.has(id));
      return defaultSources.length > 0 ? defaultSources : crmSourceIds;
    },
    [crmSourceIds],
  );

  useEffect(() => {
    if (!crmSourceIds.length) {
      return;
    }

    setDraftFilters((current) => {
      const selectedSources = normalizeSelectedSources(current.selectedSources);

      if (areStringArraysEqual(selectedSources, current.selectedSources)) {
        return current;
      }

      return {
        ...current,
        selectedSources,
      };
    });

    setAppliedFilters((current) => {
      const selectedSources = normalizeSelectedSources(current.selectedSources);

      if (areStringArraysEqual(selectedSources, current.selectedSources)) {
        return current;
      }

      return {
        ...current,
        selectedSources,
      };
    });
  }, [crmSourceIds, normalizeSelectedSources]);
  const selectedChartSources = useMemo(
    () =>
      appliedFilters.selectedSources.length
        ? appliedFilters.selectedSources
        : crmSourceIds,
    [appliedFilters.selectedSources, crmSourceIds],
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
      reportData.map((point) => {
        if (!isSeparateChart) {
          return point.indicator;
        }

        return selectedChartSources.reduce(
          (sum, source) => sum + getChartSeriesValue(point, source, appliedFilters.metricMode),
          0,
        );
      }),
    [appliedFilters.metricMode, isSeparateChart, reportData, selectedChartSources],
  );
  const mainThresholdRecommendationValues = useMemo(
    () =>
      isSeparateChart
        ? reportData.flatMap((point) =>
            selectedChartSources.map((source) =>
              getChartSeriesValue(point, source, appliedFilters.metricMode),
            ),
          )
        : chartBaseValues,
    [appliedFilters.metricMode, chartBaseValues, isSeparateChart, reportData, selectedChartSources],
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
              acc[`series_${sourceIndex}`] = getChartSeriesValue(point, source, appliedFilters.metricMode);
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
              getChartSeriesValue(point, source, appliedFilters.metricMode),
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

  const visibleMetricIdsBySection = hasBuiltReport
    ? appliedEnabledMetricIdsBySection
    : enabledMetricIdsBySection;

  const visibleSections = useMemo(
    () => orderedSections.filter((section) => visibleSectionIds.has(section.id)),
    [orderedSections, visibleSectionIds],
  );
  const availableEmployees = useMemo<ReportEmployee[]>(
    () => reportEmployees,
    [reportEmployees],
  );
  const tableRows = useMemo<TableRow[]>(
    () =>
      visibleSections.flatMap((section) => {
        const rows: TableRow[] = [
          { kind: 'section', rowId: `section-${section.id}`, sectionId: section.id, label: section.label },
        ];

        if (!expandedSections.has(section.id)) {
          return rows;
        }

        const orderedMetricIds = metricOrderBySection[section.id] ?? section.metricIds;

        const enabledMetricIds = visibleMetricIdsBySection[section.id] ?? new Set(section.metricIds);

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
      }),
    [
      visibleSections,
      expandedSections,
      enabledMetricIdsBySection,
      availableEmployees,
      metricMap,
      metricOrderBySection,
      expandedEmployeeMetricIds,
      expandedChartMetricIds,
    ],
  );

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

  const handlePeriodChange = useCallback((nextPeriod: Period) => {
    setDraftFilters((current) => ({
      ...current,
      period: nextPeriod,
      dateRange:
        nextPeriod === 'hours'
          ? getYesterdayRange()
          : constrainRangeForPeriod(nextPeriod, current.dateRange),
    }));
  }, []);

  const handleDateRangeChange = useCallback((nextRange: DateRange) => {
    setDraftFilters((current) => ({
      ...current,
      dateRange: constrainRangeForPeriod(current.period, nextRange),
    }));
  }, []);

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

  const toggleEnabledSection = (sectionId: string) => {
    setDraftFilters((current) => {
      const nextSectionIds = new Set(current.enabledSectionIds);

      if (nextSectionIds.has(sectionId)) {
        nextSectionIds.delete(sectionId);
      } else {
        nextSectionIds.add(sectionId);
      }

      return {
        ...current,
        enabledSectionIds: nextSectionIds,
      };
    });
  };

  const enableAllTableSettings = useCallback(() => {
    setDraftFilters((current) => ({
      ...current,
      enabledSectionIds: new Set(metricSections.map((section) => section.id)),
    }));
    setEnabledMetricIdsBySection(
      metricSections.reduce<Record<string, Set<string>>>((acc, section) => {
        acc[section.id] = new Set(section.metricIds);
        return acc;
      }, {}),
    );
  }, []);

  const resetTableSettings = useCallback(() => {
    setDraftFilters((current) => ({
      ...current,
      enabledSectionIds: new Set(),
    }));
  }, []);

  const toggleEnabledMetric = useCallback((sectionId: string, metricId: string) => {
    setEnabledMetricIdsBySection((current) => {
      const currentMetricIds =
        current[sectionId] ??
        new Set(metricSections.find((section) => section.id === sectionId)?.metricIds ?? []);
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
  }, []);

  const selectAllSectionMetrics = useCallback((sectionId: string) => {
    const section = metricSections.find((item) => item.id === sectionId);

    if (!section) {
      return;
    }

    setEnabledMetricIdsBySection((current) => ({
      ...current,
      [sectionId]: new Set(section.metricIds),
    }));
  }, []);

  const resetSectionMetrics = useCallback((sectionId: string) => {
    setEnabledMetricIdsBySection((current) => ({
      ...current,
      [sectionId]: new Set(),
    }));
  }, []);

  const handleSelectedSourcesChange = useCallback((values: string[]) => {
    setDraftFilters((current) => ({
      ...current,
      selectedSources: values,
    }));
  }, []);

  const handleChartDisplayModeChange = useCallback((value: ChartDisplayMode) => {
    setDraftFilters((current) => ({
      ...current,
      chartDisplayMode: value,
    }));
  }, []);

  const handleMetricModeChange = useCallback((value: ChartMetricMode) => {
    setDraftFilters((current) => ({
      ...current,
      metricMode: value,
    }));
  }, []);

  const handleScheduleChange = useCallback((schedule: ScheduleFilters) => {
    setDraftFilters((current) => ({
      ...current,
      schedule: {
        ...schedule,
        weekendDayIds: [...schedule.weekendDayIds],
      },
    }));
  }, []);

  const applyChartDraftSettings = useCallback((settings: ChartDraftSettings) => {
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
  }, []);

  const applyTableSettings = useCallback(() => {
    setAppliedFilters((current) => ({
      ...current,
      enabledSectionIds: new Set(draftFilters.enabledSectionIds),
    }));
    setAppliedEnabledMetricIdsBySection(
      Object.entries(enabledMetricIdsBySection).reduce<Record<string, Set<string>>>((acc, [sectionId, metricIds]) => {
        acc[sectionId] = new Set(metricIds);
        return acc;
      }, {}),
    );
  }, [draftFilters.enabledSectionIds, enabledMetricIdsBySection]);

  const applySectionMetrics = useCallback((sectionId: string) => {
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
  }, [enabledMetricIdsBySection]);

  const applyReportBuild = useCallback((selectedSources: string[]) => {
    setHasBuiltReport(true);
    setDraftFilters((current) => ({
      ...current,
      selectedSources,
    }));
    setAppliedFilters({
      period: draftFilters.period,
      dateRange: draftFilters.dateRange,
      selectedSources,
      chartDisplayMode: draftFilters.chartDisplayMode,
      metricMode: draftFilters.metricMode,
      schedule: {
        ...draftFilters.schedule,
        weekendDayIds: [...draftFilters.schedule.weekendDayIds],
      },
      enabledSectionIds: new Set(draftFilters.enabledSectionIds),
    });
    setAppliedEnabledMetricIdsBySection(
      Object.entries(enabledMetricIdsBySection).reduce<Record<string, Set<string>>>((acc, [sectionId, metricIds]) => {
        acc[sectionId] = new Set(metricIds);
        return acc;
      }, {}),
    );
    setBuildMoment(Date.now());
  }, [draftFilters, enabledMetricIdsBySection]);

  const buildReport = useCallback(() => {
    applyReportBuild(normalizeSelectedSources(draftFilters.selectedSources));
  }, [applyReportBuild, draftFilters.selectedSources, normalizeSelectedSources]);

  const buildAutomaticReport = useCallback(() => {
    const selectedSourceIds = new Set(draftFilters.selectedSources);
    const selectedDealSources = crmSources
      .filter((source) => source.isAvailable && source.type === 'deal' && selectedSourceIds.has(source.id))
      .map((source) => source.id);
    const fallbackDealSources = crmSources
      .filter((source) => source.isAvailable && source.type === 'deal')
      .map((source) => source.id);
    const automaticSources = selectedDealSources.length > 0 ? selectedDealSources : fallbackDealSources;

    if (automaticSources.length === 0) {
      setNotification('В каталоге отчета нет доступных воронок продаж.');
      return;
    }

    applyReportBuild(normalizeSelectedSources(automaticSources));
  }, [applyReportBuild, crmSources, draftFilters.selectedSources, normalizeSelectedSources]);

  const openDetail = useCallback((
    metric: MetricRow,
    point: ReportPoint,
    value: number,
    sectionId: string,
    employee?: ReportEmployee,
  ) => {
    setDetailContext({
      metric,
      point,
      value,
      employee,
      entityType: getEntityTypeForMetric(metric, sectionId),
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
    setRowThresholds((current) => ({
      ...current,
      [metricId]: value,
    }));
  }, []);

  const moveMetricWithinSection = useCallback((sectionId: string, sourceMetricId: string, targetMetricId: string) => {
    if (sourceMetricId === targetMetricId) {
      return;
    }

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
  }, []);

  const moveSection = useCallback((sourceSectionId: string, targetSectionId: string) => {
    if (sourceSectionId === targetSectionId) {
      return;
    }

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
  }, []);

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

  const captureCurrentViewState = useCallback(
    (): SavedReportViewState => ({
      draftFilters: serializeFilters(draftFilters),
      appliedFilters: serializeFilters(appliedFilters),
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
      expandedSections: [...expandedSections],
      mainThreshold: { ...mainThreshold },
      rowThresholds: { ...rowThresholds },
    }),
    [
      appliedFilters,
      draftFilters,
      enabledMetricIdsBySection,
      expandedSections,
      mainThreshold,
      metricOrderBySection,
      rowThresholds,
      sectionOrder,
    ],
  );

  const saveViews = useCallback((views: SavedReportViewOption[]) => {
    setSavedViews(views);
    persistSavedViews(views);
  }, []);

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
    setDraftFilters(deserializeFilters(state.draftFilters));
    setAppliedFilters(deserializeFilters(state.appliedFilters));
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
    setExpandedSections(new Set(state.expandedSections));
    setMainThreshold({ ...state.mainThreshold });
    setRowThresholds({ ...state.rowThresholds });
    setHasBuiltReport(true);
    setBuildMoment(Date.now());
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
    window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
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
        setBillingError(error instanceof Error ? error.message : 'Не удалось создать платеж.');
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
  }, [appliedFilters.dateRange, appliedFilters.period, downloadBlob, hasBuiltReport, reportData, tableRows]);

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
              enabledSectionIds={draftFilters.enabledSectionIds}
              onToggleSection={toggleEnabledSection}
              onSelectAll={enableAllTableSettings}
              onReset={resetTableSettings}
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
                  onApply={applyChartDraftSettings}
                  onDraftChange={applyChartDraftSettings}
                  onThresholdApply={setMainThreshold}
                  onThresholdReset={() => {
                    setMainThreshold({ upper: '', lower: '', mode: null });
                  }}
                />
                <TableSettingsMenu
                  enabledSectionIds={draftFilters.enabledSectionIds}
                  onToggleSection={toggleEnabledSection}
                  onSelectAll={enableAllTableSettings}
                  onReset={resetTableSettings}
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
              <div className="sync-content chart-sync-content" style={syncedContentStyle} ref={chartContentRef}>
                <div className="chart-wrap" ref={mainChartWrapRef}>
                  {reportLoading && (
                    <div className="chart-loading-overlay">
                      <LoadingAnimation
                        isLoading={reportLoading}
                        targetProgress={animationProgress}
                      />
                    </div>
                  )}
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
                row.kind === 'metric' ? 'is-metric-row' : '',
                row.kind === 'employee' ? 'is-employee-row' : '',
                row.kind === 'chart' ? 'is-chart-row' : '',
              ].filter(Boolean).join(' ');
              const leftCellClassName = [
                'table-left-cell',
                row.kind === 'section' ? 'section-left-cell' : '',
                row.kind === 'metric' ? 'metric-left-cell' : '',
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

              const rowThreshold = rowThresholds[row.metric.id] ?? { upper: '', lower: '' };
              const rowRecommendedThreshold = calculateRecommendedThresholds(
                reportData.map((point) => point.values[row.metric.id]),
                row.metric.type,
              );
              const employeesOpen = expandedEmployeeMetricIds.has(row.metric.id);
              const chartOpen = expandedChartMetricIds.has(row.metric.id);

              return (
                <div
                  className={rowClassName}
                  key={row.rowId}
                  role="row"
                  data-row-id={row.rowId}
                  onDragOver={(event) => handleMetricDragOver(row.sectionId, event)}
                  onDrop={(event) => handleMetricDrop(row.sectionId, row.metric.id, event)}
                >
                  <div className={leftCellClassName} role="rowheader">
                    <button
                      className="drag-handle-button"
                      type="button"
                      draggable
                      aria-label="Перетащить строку"
                      onDragStart={(event) => handleMetricDragStart(row.sectionId, row.metric.id, event)}
                      onDragEnd={() => {
                        draggedMetricRef.current = null;
                      }}
                    >
                      <GripVertical size={15} />
                    </button>
                    <span className="metric-name">{row.metric.label}</span>
                    <RowActionsMenu
                      employeesOpen={employeesOpen}
                      chartOpen={chartOpen}
                      threshold={rowThreshold}
                      recommendedThreshold={rowRecommendedThreshold}
                      onToggleEmployees={() => toggleEmployeeRows(row.metric.id)}
                      onToggleChart={() => toggleMetricChart(row.metric.id)}
                      onThresholdChange={(value) => updateRowThreshold(row.metric.id, value)}
                    />
                  </div>
                  <div className="table-right-cell" role="cell">
                    <div className="table-row-grid" style={{ ...syncedContentStyle, ...gridStyle }}>
                      <div className="value-axis-gutter" aria-hidden="true" />
                      {reportData.map((point) => {
                        const value = point.values[row.metric.id];
                        const thresholdClass = getThresholdClass(value, rowThreshold);
                        const valueLabel = formatMetricValue(value, row.metric.type);

                        return (
                          <ValueCellButton
                            className={thresholdClass}
                            valueLabel={valueLabel}
                            key={`${row.rowId}-${point.key}`}
                            onClick={() => openDetail(row.metric, point, value, row.sectionId)}
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
          plan={billingPlan}
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


