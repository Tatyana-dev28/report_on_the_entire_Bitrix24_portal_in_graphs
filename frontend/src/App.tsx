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
import { createPortal } from 'react-dom';
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
  defaultDateRange,
  formatMetricValue,
  formatMoney,
  formatRangeLabel,
  getMonthDateRange,
  metricSections,
  metrics,
  periodOptions,
  type DateRange,
  type MetricRow,
  type Period,
  type ReportPoint,
} from './mockData';
import { reportDataSource } from './services/report/reportDataSource';
import type { CrmSource, ReportLoadFilters } from './services/report/reportTypes';

type SelectOption<T extends string> = {
  value: T;
  label: string;
};

type TableRow =
  | {
      kind: 'section';
      rowId: string;
      sectionId: string;
      label: string;
    }
  | {
      kind: 'metric';
      rowId: string;
      sectionId: string;
      metric: MetricRow;
    }
  | {
      kind: 'employee';
      rowId: string;
      sectionId: string;
      metric: MetricRow;
      employee: MockEmployee;
      employeeIndex: number;
    }
  | {
      kind: 'chart';
      rowId: string;
      sectionId: string;
      metric: MetricRow;
    };

type MockEmployee = {
  id: string;
  userId: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
};

type ThresholdValues = {
  upper: string;
  lower: string;
  mode?: 'manual' | 'recommended' | null;
};

type RecommendedThresholdValues = {
  upper: string;
  average: string;
  lower: string;
};

type ChartDisplayMode = 'sum' | 'separate';

type ChartMetricMode = 'money' | 'count';

type ScheduleFilters = {
  workdayStart: string;
  workdayEnd: string;
  weekendDayIds: number[];
  calendarWeekStart: number;
};

type ReportFilters = {
  period: Period;
  dateRange: DateRange;
  selectedSources: string[];
  chartDisplayMode: ChartDisplayMode;
  metricMode: ChartMetricMode;
  schedule: ScheduleFilters;
  enabledSectionIds: Set<string>;
};

type BitrixEntityType =
  | 'deal'
  | 'lead'
  | 'invoice'
  | 'quote'
  | 'company'
  | 'contact'
  | 'task'
  | 'activity'
  | 'call'
  | 'email'
  | 'message'
  | 'crm_form';

type DetailContext = {
  metric: MetricRow;
  point: ReportPoint;
  value: number;
  entityType: BitrixEntityType;
  employee?: MockEmployee;
};

type DetailRow = {
  rowNumber: number;
  entityId: number;
  title: string;
  responsibleId: number;
  responsibleName: string;
  createdAt: string;
  createdAtSortValue: number;
  entityType: BitrixEntityType;
};

type DetailColumnKey = 'rowNumber' | 'entityId' | 'title' | 'responsibleName' | 'createdAt';

type DetailSort = {
  key: DetailColumnKey;
  direction: 'asc' | 'desc';
};

type SerializableReportFilters = Omit<ReportFilters, 'enabledSectionIds'> & {
  enabledSectionIds: string[];
};

type SavedReportViewState = {
  draftFilters: SerializableReportFilters;
  appliedFilters: SerializableReportFilters;
  enabledMetricIdsBySection: Record<string, string[]>;
  sectionOrder: string[];
  metricOrderBySection: Record<string, string[]>;
  expandedSections: string[];
  mainThreshold: ThresholdValues;
  rowThresholds: Record<string, ThresholdValues>;
};

type SavedReportViewOption = SelectOption<string> & {
  isSystem?: boolean;
  state?: SavedReportViewState;
};

type AppSettings = {
  reportBuilderUserIds: string[];
  moneyViewerUserIds: string[];
  viewSaverUserIds: string[];
};

const PERIOD_COLUMN_WIDTH = 96;
const MIN_PERIOD_COLUMN_WIDTH = 36;
const MAX_PERIOD_COLUMN_WIDTH = 136;
const CHART_AXIS_WIDTH = 72;
const MONTH_LABELS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];
const mockEmployees: MockEmployee[] = [
  { id: 'employee-1', userId: 104, firstName: 'Анна', lastName: 'Соколова' },
  { id: 'employee-2', userId: 117, firstName: 'Илья', lastName: 'Морозов' },
  { id: 'employee-3', userId: 126, firstName: 'Мария', lastName: 'Орлова' },
];
const LAST_AVAILABLE_MONTH_INDEX = 2026 * 12 + 5;
const isProUser = false;
const buttonLabels = {
  build: 'Построить отчет',
  download: 'Скачать Excel',
};

const chartDisplayModeOptions: SelectOption<ChartDisplayMode>[] = [
  { value: 'sum', label: 'Суммировать показатели в один график' },
  { value: 'separate', label: 'Вывести в отдельные графики' },
];

const chartMetricModeOptions: SelectOption<ChartMetricMode>[] = [
  { value: 'money', label: 'Кол-во денег' },
  { value: 'count', label: 'Кол-во элементов' },
];

const scheduleTimeOptions = Array.from({ length: 24 }, (_item, hour) =>
  `${String(hour).padStart(2, '0')}:00`,
);

const weekDayOptions = [
  { id: 0, label: 'Пн' },
  { id: 1, label: 'Вт' },
  { id: 2, label: 'Ср' },
  { id: 3, label: 'Чт' },
  { id: 4, label: 'Пт' },
  { id: 5, label: 'Сб' },
  { id: 6, label: 'Вс' },
];

const chartSeriesColors = ['#2274ff', '#34a853', '#ff9f0a', '#af52de', '#ff375f', '#00a7c7', '#6e6e73'];

const defaultSchedule: ScheduleFilters = {
  workdayStart: '',
  workdayEnd: '',
  weekendDayIds: [],
  calendarWeekStart: 0,
};

const detailColumns: Array<{ key: DetailColumnKey; label: string; minWidth: number }> = [
  { key: 'rowNumber', label: '№', minWidth: 60 },
  { key: 'entityId', label: 'ID', minWidth: 90 },
  { key: 'title', label: 'Название', minWidth: 220 },
  { key: 'responsibleName', label: 'Ответственный', minWidth: 180 },
  { key: 'createdAt', label: 'Дата создания', minWidth: 160 },
];

const defaultDetailColumnWidths: Record<DetailColumnKey, number> = {
  rowNumber: 72,
  entityId: 130,
  title: 320,
  responsibleName: 210,
  createdAt: 190,
};
const DETAIL_COLUMN_STORAGE_KEY = 'sapp24-detail-column-widths';
const SAVED_VIEWS_STORAGE_KEY = 'sapp24-saved-report-views';
const APP_SETTINGS_STORAGE_KEY = 'sapp24-app-settings';
const defaultSavedView: SavedReportViewOption = {
  value: 'default',
  label: 'Общий отчет',
  isSystem: true,
};
const defaultAppSettings: AppSettings = {
  reportBuilderUserIds: [],
  moneyViewerUserIds: [],
  viewSaverUserIds: [],
};
const detailColumnMinWidths = detailColumns.reduce<Record<DetailColumnKey, number>>((acc, column) => {
  acc[column.key] = column.minWidth;
  return acc;
}, {} as Record<DetailColumnKey, number>);
const detailColumnMinWidthSum = detailColumns.reduce((sum, column) => sum + column.minWidth, 0);

const createDefaultSchedule = (): ScheduleFilters => ({
  ...defaultSchedule,
  weekendDayIds: [...defaultSchedule.weekendDayIds],
});

const createDefaultFilters = (): ReportFilters => ({
  period: 'days',
  dateRange: defaultDateRange,
  selectedSources: ['Воронка продажи'],
  chartDisplayMode: 'sum',
  metricMode: 'money',
  schedule: createDefaultSchedule(),
  enabledSectionIds: new Set(metricSections.map((section) => section.id)),
});

const serializeFilters = (filters: ReportFilters): SerializableReportFilters => ({
  ...filters,
  selectedSources: [...filters.selectedSources],
  schedule: {
    ...filters.schedule,
    weekendDayIds: [...filters.schedule.weekendDayIds],
  },
  enabledSectionIds: [...filters.enabledSectionIds],
});

const deserializeFilters = (filters: SerializableReportFilters): ReportFilters => ({
  ...filters,
  selectedSources: [...filters.selectedSources],
  schedule: {
    ...filters.schedule,
    weekendDayIds: [...filters.schedule.weekendDayIds],
  },
  enabledSectionIds: new Set(filters.enabledSectionIds),
});

const loadSavedViews = (): SavedReportViewOption[] => {
  if (typeof window === 'undefined') {
    return [defaultSavedView];
  }

  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_STORAGE_KEY);

    if (!raw) {
      return [defaultSavedView];
    }

    const savedViews = JSON.parse(raw) as SavedReportViewOption[];
    const userViews = Array.isArray(savedViews)
      ? savedViews.filter((view) => view.value !== defaultSavedView.value)
      : [];

    return [defaultSavedView, ...userViews];
  } catch {
    return [defaultSavedView];
  }
};

const persistSavedViews = (views: SavedReportViewOption[]) => {
  window.localStorage.setItem(
    SAVED_VIEWS_STORAGE_KEY,
    JSON.stringify(views.filter((view) => !view.isSystem)),
  );
};

const loadAppSettings = (): AppSettings => {
  if (typeof window === 'undefined') {
    return defaultAppSettings;
  }

  try {
    return {
      ...defaultAppSettings,
      ...(JSON.parse(window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Partial<AppSettings>),
    };
  } catch {
    return defaultAppSettings;
  }
};

const sumDetailColumnWidths = (widths: Record<DetailColumnKey, number>) =>
  detailColumns.reduce((sum, column) => sum + widths[column.key], 0);

const sanitizeDetailColumnWidths = (
  widths: Partial<Record<DetailColumnKey, number>>,
): Record<DetailColumnKey, number> =>
  detailColumns.reduce<Record<DetailColumnKey, number>>((acc, column) => {
    const value = Number(widths[column.key]);
    acc[column.key] = Number.isFinite(value)
      ? Math.max(column.minWidth, Math.round(value))
      : defaultDetailColumnWidths[column.key];
    return acc;
  }, {} as Record<DetailColumnKey, number>);

const loadDetailColumnWidths = () => {
  if (typeof window === 'undefined') {
    return defaultDetailColumnWidths;
  }

  try {
    const raw = window.localStorage.getItem(DETAIL_COLUMN_STORAGE_KEY);

    if (!raw) {
      return defaultDetailColumnWidths;
    }

    return sanitizeDetailColumnWidths(JSON.parse(raw) as Partial<Record<DetailColumnKey, number>>);
  } catch {
    return defaultDetailColumnWidths;
  }
};

const shrinkDetailColumns = (
  widths: Record<DetailColumnKey, number>,
  excludedKey: DetailColumnKey | null,
  amount: number,
) => {
  let remaining = Math.max(0, amount);
  const nextWidths = { ...widths };

  for (const column of detailColumns) {
    if (remaining <= 0 || column.key === excludedKey) {
      continue;
    }

    const available = Math.max(0, nextWidths[column.key] - column.minWidth);
    const shrink = Math.min(available, remaining);
    nextWidths[column.key] -= shrink;
    remaining -= shrink;
  }

  return {
    widths: nextWidths,
    applied: amount - remaining,
  };
};

const normalizeDetailColumnWidths = (
  widths: Record<DetailColumnKey, number>,
  containerWidth: number,
) => {
  const safeWidths = sanitizeDetailColumnWidths(widths);
  const targetWidth = Math.max(detailColumnMinWidthSum, Math.floor(containerWidth || 0));
  const currentSum = sumDetailColumnWidths(safeWidths);

  if (currentSum === targetWidth) {
    return safeWidths;
  }

  if (currentSum < targetWidth) {
    return {
      ...safeWidths,
      title: safeWidths.title + targetWidth - currentSum,
    };
  }

  const { widths: reducedWidths } = shrinkDetailColumns(safeWidths, null, currentSum - targetWidth);
  return reducedWidths;
};

const resizeDetailColumnWidths = (
  startWidths: Record<DetailColumnKey, number>,
  activeKey: DetailColumnKey,
  delta: number,
  containerWidth: number,
) => {
  const baseWidths = normalizeDetailColumnWidths(startWidths, containerWidth);
  const direction = Math.sign(delta);

  if (direction === 0) {
    return baseWidths;
  }

  if (direction > 0) {
    const { widths: reducedWidths, applied } = shrinkDetailColumns(baseWidths, activeKey, Math.round(delta));

    return {
      ...reducedWidths,
      [activeKey]: reducedWidths[activeKey] + applied,
    };
  }

  const activeAvailable = Math.max(0, baseWidths[activeKey] - detailColumnMinWidths[activeKey]);
  const applied = Math.min(activeAvailable, Math.abs(Math.round(delta)));
  const activeIndex = detailColumns.findIndex((column) => column.key === activeKey);
  const receiver =
    detailColumns[(activeIndex + 1) % detailColumns.length]?.key === activeKey
      ? 'title'
      : detailColumns[(activeIndex + 1) % detailColumns.length]?.key ?? 'title';

  return {
    ...baseWidths,
    [activeKey]: baseWidths[activeKey] - applied,
    [receiver]: baseWidths[receiver] + applied,
  };
};

type BX24Api = {
  openPath?: (path: string) => void;
  slider?: {
    open?: (path: string) => void;
  };
};

const bitrixEntityLabels: Record<BitrixEntityType, string> = {
  deal: 'сделки',
  lead: 'лиды',
  invoice: 'счета',
  quote: 'предложения',
  company: 'компании',
  contact: 'контакты',
  task: 'задачи',
  activity: 'дела',
  call: 'звонки',
  email: 'письма',
  message: 'сообщения',
  crm_form: 'CRM формы',
};

const bitrixEntityTitleRoots: Record<BitrixEntityType, string> = {
  deal: 'Сделка',
  lead: 'Лид',
  invoice: 'Счет',
  quote: 'Предложение',
  company: 'Компания',
  contact: 'Контакт',
  task: 'Задача',
  activity: 'Дело',
  call: 'Звонок',
  email: 'Письмо',
  message: 'Сообщение',
  crm_form: 'CRM форма',
};

const getBitrixEntityPath = (entityType: BitrixEntityType, id: string | number) => {
  const paths: Record<BitrixEntityType, string> = {
    deal: `/crm/deal/details/${id}/`,
    lead: `/crm/lead/details/${id}/`,
    invoice: `/crm/type/31/details/${id}/`,
    quote: `/crm/quote/details/${id}/`,
    company: `/crm/company/details/${id}/`,
    contact: `/crm/contact/details/${id}/`,
    task: `/company/personal/user/0/tasks/task/view/${id}/`,
    activity: `/crm/activity/?ID=${id}`,
    call: `/crm/activity/?ID=${id}`,
    email: `/crm/activity/?ID=${id}`,
    message: `/crm/activity/?ID=${id}`,
    crm_form: `/crm/webform/result/${id}/`,
  };

  return paths[entityType];
};

export function openBitrixEntity(entityType: BitrixEntityType, id: string | number) {
  const path = getBitrixEntityPath(entityType, id);
  const bx24 = (window as Window & { BX24?: BX24Api }).BX24;

  if (bx24?.openPath) {
    bx24.openPath(path);
    return;
  }

  if (bx24?.slider?.open) {
    bx24.slider.open(path);
    return;
  }

  console.info('[mock Bitrix24] open entity', { entityType, id, path });
}

export function openBitrixUser(userId: string | number) {
  const path = `/company/personal/user/${userId}/`;
  const bx24 = (window as Window & { BX24?: BX24Api }).BX24;

  if (bx24?.openPath) {
    bx24.openPath(path);
    return;
  }

  if (bx24?.slider?.open) {
    bx24.slider.open(path);
    return;
  }

  console.info('[mock Bitrix24] open user', { userId, path });
}

const getEntityTypeForMetric = (metric: MetricRow, sectionId?: string): BitrixEntityType => {
  if (metric.id.startsWith('deals_') || metric.id.startsWith('sales_') || sectionId === 'sales_funnel') {
    return 'deal';
  }

  if (metric.id.startsWith('leads_') || metric.id.startsWith('lead_') || sectionId === 'lead_funnel') {
    return 'lead';
  }

  if (metric.id.startsWith('invoices_')) {
    return 'invoice';
  }

  if (metric.id.startsWith('quotes_')) {
    return 'quote';
  }

  if (metric.id === 'companies_new') {
    return 'company';
  }

  if (metric.id === 'contacts_new') {
    return 'contact';
  }

  if (metric.id.startsWith('tasks_')) {
    return 'task';
  }

  if (metric.id.startsWith('activities_') || metric.id.startsWith('production_') || sectionId === 'production_funnel') {
    return 'activity';
  }

  if (metric.id.startsWith('calls_')) {
    return 'call';
  }

  if (metric.id.startsWith('email_')) {
    return 'email';
  }

  if (metric.id.startsWith('messages_')) {
    return 'message';
  }

  return 'crm_form';
};

const toDateInputValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const getYesterdayRange = (): DateRange => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const value = toDateInputValue(date);

  return {
    start: value,
    end: value,
  };
};

const toMonthInputValue = (dateValue: string) => dateValue.slice(0, 7);

const monthIndex = (monthValue: string) => {
  const [year, month] = monthValue.split('-').map(Number);
  return year * 12 + month - 1;
};

const monthValueFromIndex = (index: number) => {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
};

const getRangeFromMonthIndexes = (startIndex: number, endIndex: number): DateRange => {
  const startRange = getMonthDateRange(monthValueFromIndex(Math.min(startIndex, endIndex)));
  const endRange = getMonthDateRange(monthValueFromIndex(Math.max(startIndex, endIndex)));

  return {
    start: startRange.start,
    end: endRange.end,
  };
};

const addMonthsToDateValue = (value: string, monthsToAdd: number) => {
  const [year, month, day] = value.split('-').map(Number);
  const targetMonthIndex = month - 1 + monthsToAdd;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const date = new Date(targetYear, targetMonth, Math.min(day, lastDayOfTargetMonth));

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const constrainRangeForPeriod = (period: Period, range: DateRange): DateRange => {
  if (period === 'hours') {
    return {
      start: range.start,
      end: range.start,
    };
  }

  if (period !== 'days') {
    return range;
  }

  const maxEnd = addMonthsToDateValue(range.start, 3);
  let end = range.end;

  if (end < range.start) {
    end = range.start;
  }

  if (end > maxEnd) {
    end = maxEnd;
  }

  return {
    start: range.start,
    end,
  };
};

function useOutsideClose<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  extraRefs: Array<RefObject<HTMLElement | null>> = [],
) {
  const ref = useRef<T>(null);
  const extraRefsRef = useRef(extraRefs);

  extraRefsRef.current = extraRefs;

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const clickedInsideMain = ref.current?.contains(target);
      const clickedInsideExtra = extraRefsRef.current.some((extraRef) =>
        extraRef.current?.contains(target),
      );
      const clickedInsideFloatingPopover =
        target instanceof Element && Boolean(target.closest('.floating-popover'));

      if (!clickedInsideMain && !clickedInsideExtra && !clickedInsideFloatingPopover) {
        onClose();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, onClose]);

  return ref;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

function useBoundedPopoverPosition<T extends HTMLElement>(
  ref: RefObject<T | null>,
  open: boolean,
  expectedWidth: number,
  expectedHeight: number,
) {
  const [style, setStyle] = useState<CSSProperties>({ width: expectedWidth });

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const update = () => {
      const shell = ref.current;

      if (!shell) {
        return;
      }

      const shellRect = shell.getBoundingClientRect();
      const appRect = shell.closest('.report-card')?.getBoundingClientRect();
      const boundary = appRect ?? {
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        left: 0,
        width: window.innerWidth,
      };
      const gap = 8;
      const padding = 12;
      const width = Math.min(expectedWidth, Math.max(180, boundary.width - padding * 2));
      const minLeft = boundary.left + padding - shellRect.left;
      const maxLeft = boundary.right - padding - shellRect.left - width;
      const preferredLeft = shellRect.width - width;
      const minTop = boundary.top + padding - shellRect.top;
      const maxTop = boundary.bottom - padding - shellRect.top - expectedHeight;
      const preferredTop =
        shellRect.bottom + gap + expectedHeight <= boundary.bottom - padding
          ? shellRect.height + gap
          : -expectedHeight - gap;

      setStyle({
        width,
        left: maxLeft < minLeft ? minLeft : clamp(preferredLeft, minLeft, maxLeft),
        top: maxTop < minTop ? minTop : clamp(preferredTop, minTop, maxTop),
      });
    };

    const frame = requestAnimationFrame(update);
    window.addEventListener('resize', update);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
    };
  }, [expectedHeight, expectedWidth, open, ref]);

  return style;
}

function FloatingPopover({
  anchorRef,
  popoverRef,
  open,
  className,
  expectedWidth,
  expectedHeight,
  children,
  role,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  popoverRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  className: string;
  expectedWidth: number;
  expectedHeight: number;
  children: ReactNode;
  role?: string;
}) {
  const [layer, setLayer] = useState<HTMLElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>({
    width: expectedWidth,
    left: 0,
    top: 0,
    visibility: 'hidden',
  });

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const anchor = anchorRef.current;

    if (!anchor) {
      return undefined;
    }

    const app = anchor.closest('.report-card') as HTMLElement | null;
    const nextLayer = app?.querySelector('.floating-layer') as HTMLElement | null;
    const targetLayer = nextLayer ?? app ?? document.body;
    setLayer(targetLayer);

    let frame = 0;
    const update = () => {
      const currentAnchor = anchorRef.current;

      if (!currentAnchor) {
        return;
      }

      const appElement = currentAnchor.closest('.report-card') as HTMLElement | null;
      const appRect = appElement?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const anchorRect = currentAnchor.getBoundingClientRect();
      const padding = 12;
      const gap = 8;
      const visibleLeft = Math.max(appRect.left, 0);
      const visibleRight = Math.min(appRect.right, window.innerWidth);
      const visibleTop = Math.max(appRect.top, 0);
      const visibleBottom = Math.min(appRect.bottom, window.innerHeight);
      const boundaryWidth = Math.max(180, visibleRight - visibleLeft - padding * 2);
      const desiredWidth = Math.max(expectedWidth, anchorRect.width);
      const width = Math.min(desiredWidth, boundaryWidth);
      const minViewportLeft = visibleLeft + padding;
      const maxViewportLeft = visibleRight - padding - width;
      const preferredViewportLeft = anchorRect.right - width;
      const minViewportTop = visibleTop + padding;
      const maxViewportTop = visibleBottom - padding - expectedHeight;
      const preferredViewportTop =
        anchorRect.bottom + gap + expectedHeight <= visibleBottom - padding
          ? anchorRect.bottom + gap
          : anchorRect.top - expectedHeight - gap;
      const viewportLeft =
        maxViewportLeft < minViewportLeft
          ? minViewportLeft
          : clamp(preferredViewportLeft, minViewportLeft, maxViewportLeft);
      const viewportTop =
        maxViewportTop < minViewportTop
          ? minViewportTop
          : clamp(preferredViewportTop, minViewportTop, maxViewportTop);

      setStyle({
        width,
        left: viewportLeft - appRect.left,
        top: viewportTop - appRect.top,
        visibility: 'visible',
      });
    };

    frame = requestAnimationFrame(update);
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, [anchorRef, expectedHeight, expectedWidth, open]);

  if (!open || !layer) {
    return null;
  }

  return createPortal(
    <div
      className={`${className} floating-popover`}
      ref={popoverRef}
      role={role}
      style={style}
    >
      {children}
    </div>,
    layer,
  );
}

function parseThreshold(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function buildTrend(values: number[]) {
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

const getEmployeeInitials = (employee: MockEmployee) =>
  `${employee.firstName.charAt(0)}${employee.lastName.charAt(0)}`;

const getEmployeeMetricValue = (
  value: number,
  metric: MetricRow,
  employeeIndex: number,
  pointIndex: number,
) => {
  const shares = [0.42, 0.34, 0.24];
  const wave = 1 + Math.sin((pointIndex + employeeIndex + metric.base) / 3) * 0.08;

  if (metric.type === 'percent') {
    return Math.max(0, Math.min(100, Math.round((value + (employeeIndex - 1) * 3 + Math.sin(pointIndex) * 2) * 10) / 10));
  }

  return Math.max(0, Math.round(value * (shares[employeeIndex] ?? 0.2) * wave));
};

const getThresholdAverage = (threshold: ThresholdValues) => {
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

const calculateRecommendedThresholds = (
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

const getThresholdLineLabel = (
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

const thresholdLineColors = {
  upper: '#2fb36f',
  average: '#eab308',
  lower: '#ef4444',
} as const;

type ThresholdTooltipItem = {
  key: keyof typeof thresholdLineColors;
  label: string;
  value: number;
  color: string;
};

const getAppliedThresholdItems = (threshold?: ThresholdValues) => {
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

const getThresholdClass = (value: number, threshold?: ThresholdValues) => {
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

const zeroMetricValues = metrics.reduce<Record<string, number>>((acc, metric) => {
  acc[metric.id] = 0;
  return acc;
}, {});

const createZeroReportData = (data: ReportPoint[]) =>
  data.map((point) => ({
    ...point,
    indicator: 0,
    values: { ...zeroMetricValues },
  }));

const numberFormatter = new Intl.NumberFormat('ru-RU');

const parseTimeToMinutes = (value: string) => {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

const getMondayBasedDayId = (date: Date) => {
  const day = date.getDay();

  return day === 0 ? 6 : day - 1;
};

const applyScheduleToReportData = (
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

const getChartSeriesValue = (
  point: ReportPoint,
  source: string,
  metricMode: ChartMetricMode,
) => {
  const values = point.values;
  const normalizedSource = source.toLowerCase();
  const isLeadSource = source === 'Воронка лидов' || source === 'Лиды' || normalizedSource.includes('лид');
  const isDealSource =
    source === 'Воронка продажи' ||
    normalizedSource.includes('сдел') ||
    normalizedSource.includes('продаж');
  const isProductionSource =
    source === 'Воронка производство' ||
    normalizedSource.includes('производ');
  const isInvoiceSource = source === 'Счета' || normalizedSource.includes('счет');

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
      case 'Смарт-процесс заявки':
        return values.crm_forms;
      case 'Смарт-процесс производство':
        return values.activities_created + values.production_work;
      case 'Смарт-процесс доставка':
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
    case 'Смарт-процесс заявки':
      return values.crm_forms * 42000;
    case 'Смарт-процесс производство':
      return (values.activities_created + values.production_work) * 36000;
    case 'Смарт-процесс доставка':
      return (values.tasks_done + values.activities_done) * 18000;
    default:
      return values.deals_won_sum;
  }
};

const formatMainChartValue = (value: number, metricMode: ChartMetricMode) => {
  if (metricMode === 'money') {
    return formatMoney(value);
  }

  return numberFormatter.format(Math.round(value));
};

const formatMainAxisTick = (value: number | string, metricMode: ChartMetricMode) => {
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

const detailDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const buildMockDetailRows = (context: DetailContext): DetailRow[] => {
  const baseDate = new Date(context.point.key);
  const safeBaseTime = Number.isFinite(baseDate.getTime()) ? baseDate.getTime() : Date.now();
  const seed = context.metric.id
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), context.point.key.length);
  const count = 10 + (seed % 11);
  const entityTitleRoot = bitrixEntityTitleRoots[context.entityType];

  return Array.from({ length: count }, (_item, index) => {
    const employee = context.employee ?? mockEmployees[(seed + index) % mockEmployees.length];
    const createdAtDate = new Date(safeBaseTime + index * 37 * 60 * 1000);
    const entityId = 10000 + seed * 17 + index + 1;

    return {
      rowNumber: index + 1,
      entityId,
      title: `${entityTitleRoot} ${context.metric.label.toLowerCase()} ${index + 1}`,
      responsibleId: employee.userId,
      responsibleName: `${employee.firstName} ${employee.lastName}`,
      createdAt: detailDateFormatter.format(createdAtDate),
      createdAtSortValue: createdAtDate.getTime(),
      entityType: context.entityType,
    };
  });
};

const compareDetailValues = (a: DetailRow, b: DetailRow, key: DetailColumnKey) => {
  if (key === 'createdAt') {
    return a.createdAtSortValue - b.createdAtSortValue;
  }

  if (key === 'rowNumber' || key === 'entityId') {
    return a[key] - b[key];
  }

  return a[key].localeCompare(b[key], 'ru');
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

const formatAxisTick = (value: number | string, type: MetricRow['type']) => {
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

function BrandLogo() {
  const [logoAvailable, setLogoAvailable] = useState(true);

  return (
    <a
      className="brand-mark"
      href="https://sapp24.com/?utm_source=app-b24"
      target="_blank"
      rel="noreferrer"
      aria-label="Открыть сайт САПП"
    >
      {logoAvailable && (
        <img
          src="/sapp-logo.svg"
          alt="САПП"
          onError={() => setLogoAvailable(false)}
        />
      )}
      {!logoAvailable && <span>САПП</span>}
    </a>
  );
}

function TooltipPortal({
  label,
  style,
}: {
  label: string;
  style: CSSProperties;
}) {
  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <span className="tooltip-bubble" style={style}>
      {label}
    </span>,
    document.body,
  );
}

function TooltipButton({
  label,
  children,
  className = '',
  onClick,
  ariaPressed,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  onClick: () => void;
  ariaPressed?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);

  const showTooltip = () => {
    const button = buttonRef.current;

    if (!button) {
      return;
    }

    const buttonRect = button.getBoundingClientRect();
    const appRect = button.closest('.report-card')?.getBoundingClientRect();
    const boundary = appRect ?? {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    };
    const maxWidth = Math.max(120, Math.min(260, boundary.width - 24));
    const estimatedWidth = Math.min(maxWidth, Math.max(148, label.length * 6.8 + 24));
    const estimatedLines = Math.max(1, Math.ceil((label.length * 6.8) / Math.max(80, estimatedWidth - 24)));
    const estimatedHeight = Math.max(36, estimatedLines * 17 + 18);
    const left = Math.min(
      Math.max(buttonRect.left + buttonRect.width / 2 - estimatedWidth / 2, boundary.left + 12),
      boundary.right - estimatedWidth - 12,
    );
    const hasTopSpace = buttonRect.top - boundary.top > estimatedHeight + 12;
    const preferredTop = hasTopSpace ? buttonRect.top - 10 : buttonRect.bottom + 10;
    const top = Math.min(
      Math.max(preferredTop, boundary.top + 12),
      boundary.bottom - estimatedHeight - 12,
    );

    setTooltipStyle({
      left,
      top,
      maxWidth,
      transform: hasTopSpace && top === preferredTop ? 'translateY(-100%)' : 'translateY(0)',
    });
  };

  return (
    <button
      className={`icon-button tooltip-host ${className}`}
      type="button"
      onClick={onClick}
      onFocus={showTooltip}
      onBlur={() => setTooltipStyle(null)}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltipStyle(null)}
      aria-label={label}
      aria-pressed={ariaPressed}
      ref={buttonRef}
    >
      {children}
      {tooltipStyle && (
        <TooltipPortal label={label} style={tooltipStyle} />
      )}
    </button>
  );
}

function TooltipLink({
  label,
  href,
  children,
  className = '',
}: {
  label: string;
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);

  const showTooltip = () => {
    const link = linkRef.current;

    if (!link) {
      return;
    }

    const linkRect = link.getBoundingClientRect();
    const appRect = link.closest('.report-card')?.getBoundingClientRect();
    const boundary = appRect ?? {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    };
    const maxWidth = Math.max(120, Math.min(260, boundary.width - 24));
    const estimatedWidth = Math.min(maxWidth, Math.max(148, label.length * 6.8 + 24));
    const estimatedLines = Math.max(1, Math.ceil((label.length * 6.8) / Math.max(80, estimatedWidth - 24)));
    const estimatedHeight = Math.max(36, estimatedLines * 17 + 18);
    const left = Math.min(
      Math.max(linkRect.left + linkRect.width / 2 - estimatedWidth / 2, boundary.left + 12),
      boundary.right - estimatedWidth - 12,
    );
    const hasTopSpace = linkRect.top - boundary.top > estimatedHeight + 12;
    const preferredTop = hasTopSpace ? linkRect.top - 10 : linkRect.bottom + 10;
    const top = Math.min(
      Math.max(preferredTop, boundary.top + 12),
      boundary.bottom - estimatedHeight - 12,
    );

    setTooltipStyle({
      left,
      top,
      maxWidth,
      transform: hasTopSpace && top === preferredTop ? 'translateY(-100%)' : 'translateY(0)',
    });
  };

  return (
    <a
      className={`icon-button tooltip-host ${className}`}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      onFocus={showTooltip}
      onBlur={() => setTooltipStyle(null)}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltipStyle(null)}
      ref={linkRef}
    >
      {children}
      {tooltipStyle && (
        <TooltipPortal label={label} style={tooltipStyle} />
      )}
    </a>
  );
}

function ValueCellButton({
  className = '',
  valueLabel,
  onClick,
}: {
  className?: string;
  valueLabel: string;
  onClick: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);

  const showTooltip = () => {
    const button = buttonRef.current;

    if (!button) {
      return;
    }

    const buttonRect = button.getBoundingClientRect();
    const appRect = button.closest('.report-card')?.getBoundingClientRect();
    const boundary = appRect ?? {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    };
    const maxWidth = Math.max(120, Math.min(280, boundary.width - 24));
    const estimatedWidth = Math.min(maxWidth, Math.max(112, valueLabel.length * 7 + 24));
    const estimatedHeight = 36;
    const left = Math.min(
      Math.max(buttonRect.left + buttonRect.width / 2, boundary.left + estimatedWidth / 2 + 12),
      boundary.right - estimatedWidth / 2 - 12,
    );
    const preferredTop = buttonRect.top - 10;
    const top = Math.min(
      Math.max(preferredTop, boundary.top + estimatedHeight + 12),
      boundary.bottom - 12,
    );

    setTooltipStyle({
      left,
      top,
      maxWidth,
      transform: 'translate(-50%, -100%)',
    });
  };

  return (
    <button
      className={`value-cell value-cell-button ${className}`.trim()}
      type="button"
      onClick={onClick}
      onFocus={showTooltip}
      onBlur={() => setTooltipStyle(null)}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltipStyle(null)}
      ref={buttonRef}
    >
      <span className="value-cell-badge">{valueLabel}</span>
      <span className="value-cell-corner-arrow" aria-hidden="true">
        ↗
      </span>
      {tooltipStyle && <TooltipPortal label={valueLabel} style={tooltipStyle} />}
    </button>
  );
}

function CustomSelect<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: {
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className={`select-shell ${className} ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="select-trigger"
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected.label}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="select-menu"
          expectedWidth={220}
          expectedHeight={280}
          role="listbox"
        >
          {options.map((option) => (
            <button
              className="select-option"
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={15} />}
            </button>
          ))}
        </FloatingPopover>
      )}
    </div>
  );
}

function SavedViewLabel({ label }: { label: string }) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);

  const showTooltip = () => {
    const labelElement = labelRef.current;

    if (!labelElement) {
      return;
    }

    const labelRect = labelElement.getBoundingClientRect();
    const appRect = labelElement.closest('.report-card')?.getBoundingClientRect();
    const boundary = appRect ?? {
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    };
    const maxWidth = Math.max(160, Math.min(420, boundary.width - 24));
    const estimatedWidth = Math.min(maxWidth, Math.max(140, label.length * 7 + 24));
    const estimatedHeight = 36;
    const left = Math.min(
      Math.max(labelRect.left + labelRect.width / 2 - estimatedWidth / 2, boundary.left + 12),
      boundary.right - estimatedWidth - 12,
    );
    const top = Math.max(labelRect.top - 10, boundary.top + estimatedHeight + 12);

    setTooltipStyle({
      left,
      top,
      maxWidth,
      transform: 'translateY(-100%)',
    });
  };

  return (
    <span
      className="saved-view-label"
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltipStyle(null)}
      onFocus={showTooltip}
      onBlur={() => setTooltipStyle(null)}
      ref={labelRef}
      tabIndex={0}
    >
      {label}
      {tooltipStyle && <TooltipPortal label={label} style={tooltipStyle} />}
    </span>
  );
}

function SavedViewsSelect({
  options,
  value,
  onChange,
  onSaveClick,
  onEdit,
  onDelete,
}: {
  options: SavedReportViewOption[];
  value: string;
  onChange: (value: string) => void;
  onSaveClick: () => void;
  onEdit: (value: string) => void;
  onDelete: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [actionsOpenFor, setActionsOpenFor] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const maxLabelLength = options.reduce((max, option) => Math.max(max, option.label.length), 0);
  const expectedWidth =
    typeof window === 'undefined'
      ? 320
      : Math.min(Math.max(300, maxLabelLength * 7 + 104), window.innerWidth * 0.75);

  return (
    <div className={`select-shell view-select ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="select-trigger"
        type="button"
        aria-label="Сохраненные отображения отчета"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected.label}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="select-menu saved-view-menu"
          expectedWidth={expectedWidth}
          expectedHeight={320}
          role="listbox"
        >
          <div className="saved-view-list">
            {options.map((option) => (
              <div
                className={`saved-view-row ${option.value === value ? 'is-selected' : ''}`}
                key={option.value}
                role="option"
                aria-selected={option.value === value}
              >
                <button
                  className="select-option saved-view-select-button"
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <SavedViewLabel label={option.label} />
                  {option.value === value && <Check size={15} />}
                </button>
                {!option.isSystem && (
                  <div className="saved-view-actions">
                    <button
                      className="saved-view-more-button"
                      type="button"
                      aria-label="Действия отображения"
                      onClick={(event) => {
                        event.stopPropagation();
                        setActionsOpenFor((current) => (current === option.value ? null : option.value));
                      }}
                    >
                      <MoreVertical size={15} />
                    </button>
                    {actionsOpenFor === option.value && (
                      <div className="saved-view-actions-menu">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setActionsOpenFor(null);
                            setOpen(false);
                            onEdit(option.value);
                          }}
                        >
                          Редактировать
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setActionsOpenFor(null);
                            setOpen(false);
                            onDelete(option.value);
                          }}
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="saved-view-action">
            <button
              className="select-option save-view-option"
              type="button"
              onClick={() => {
                setOpen(false);
                onSaveClick();
              }}
            >
              <span>Сохранить текущее отображение отчета</span>
            </button>
          </div>
        </FloatingPopover>
      )}
    </div>
  );
}

function DateRangePicker({
  period,
  range,
  onChange,
}: {
  period: Period;
  range: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);
  const isMonthMode = period === 'months';
  const [visibleYear, setVisibleYear] = useState(() => Number(range.start.slice(0, 4)));
  const [monthAnchor, setMonthAnchor] = useState<number | null>(null);

  useEffect(() => {
    if (open && isMonthMode) {
      setVisibleYear(Number(range.start.slice(0, 4)));
    }
  }, [isMonthMode, open, range.start]);

  const updateDate = (field: keyof DateRange, value: string) => {
    if (!value) {
      return;
    }

    onChange({ ...range, [field]: value });
  };

  const selectMonth = (index: number) => {
    if (index > LAST_AVAILABLE_MONTH_INDEX) {
      return;
    }

    if (monthAnchor === null) {
      setMonthAnchor(index);
      onChange(getRangeFromMonthIndexes(index, index));
      return;
    }

    onChange(getRangeFromMonthIndexes(monthAnchor, index));
    setMonthAnchor(null);
  };

  const selectedStartMonth = monthIndex(toMonthInputValue(range.start));
  const selectedEndMonth = monthIndex(toMonthInputValue(range.end));
  const selectedMonthMin = Math.min(selectedStartMonth, selectedEndMonth);
  const selectedMonthMax = Math.max(selectedStartMonth, selectedEndMonth);

  return (
    <div className={`date-picker-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="date-trigger"
        type="button"
        aria-label="Выбор диапазона периода"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarDays size={17} />
        <span>{formatRangeLabel(period, range)}</span>
        <ChevronDown size={16} />
      </button>

      {open && !isMonthMode && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="date-popover"
          expectedWidth={360}
          expectedHeight={150}
        >
          <p>Период отчета</p>
          <div className={`date-fields ${period === 'hours' ? 'single-field' : ''}`}>
            <label>
              <span>{period === 'hours' ? 'Дата' : 'Дата начала'}</span>
              <input
                type="date"
                value={range.start}
                onChange={(event) =>
                  period === 'hours'
                    ? onChange({ start: event.target.value, end: event.target.value })
                    : updateDate('start', event.target.value)
                }
              />
            </label>
            {period !== 'hours' && (
              <label>
                <span>Дата окончания</span>
                <input
                  type="date"
                  value={range.end}
                  onChange={(event) => updateDate('end', event.target.value)}
                />
              </label>
            )}
          </div>
        </FloatingPopover>
      )}

      {open && isMonthMode && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="date-popover month-popover"
          expectedWidth={330}
          expectedHeight={260}
        >
          <div className="month-head">
            <button type="button" aria-label="Предыдущий год" onClick={() => setVisibleYear((year) => year - 1)}>
              <ChevronDown size={16} />
            </button>
            <p>{visibleYear}</p>
            <button type="button" aria-label="Следующий год" onClick={() => setVisibleYear((year) => year + 1)}>
              <ChevronDown size={16} />
            </button>
          </div>
          <div className="month-grid">
            {MONTH_LABELS.map((label, month) => {
              const index = visibleYear * 12 + month;
              const selected = index >= selectedMonthMin && index <= selectedMonthMax;
              const disabled = index > LAST_AVAILABLE_MONTH_INDEX;

              return (
                <button
                  className={`month-option ${selected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}
                  type="button"
                  key={label}
                  disabled={disabled}
                  onClick={() => selectMonth(index)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </FloatingPopover>
      )}
    </div>
  );
}

function MultiSelect({
  values,
  options,
  onChange,
}: {
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);
  const label =
    values.length === options.length
      ? 'Все источники'
      : values.length
        ? values.join(', ')
        : 'Не выбрано';

  const toggleValue = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((item) => item !== value));
      return;
    }

    onChange([...values, value]);
  };

  return (
    <div className={`select-shell multi-select ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="select-trigger"
        type="button"
        aria-label="Выбор источников отчета"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="select-menu multi-menu"
          expectedWidth={260}
          expectedHeight={220}
        >
          {options.map((option) => (
            <label className="multi-option" key={option}>
              <input
                type="checkbox"
                checked={values.includes(option)}
                onChange={() => toggleValue(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </FloatingPopover>
      )}
    </div>
  );
}

function SectionMetricsMenu({
  section,
  metricMap,
  enabledMetricIds,
  onToggleMetric,
  onSelectAll,
  onReset,
}: {
  section: (typeof metricSections)[number];
  metricMap: Map<string, MetricRow>;
  enabledMetricIds: Set<string>;
  onToggleMetric: (metricId: string) => void;
  onSelectAll: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);

  return (
    <div className={`section-metrics-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <TooltipButton
        label="Настройка показателей раздела"
        onClick={() => setOpen((current) => !current)}
        className={`section-settings-button ${open ? 'active-pin' : ''}`}
      >
        <Settings2 size={14} />
      </TooltipButton>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover section-metrics-popover"
          expectedWidth={320}
          expectedHeight={360}
        >
          <div className="section-metrics-head">
            <p>{section.label}</p>
            <button
              className="row-menu-close"
              type="button"
              aria-label="Закрыть настройку показателей"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="table-settings-actions section-metrics-actions">
            <button type="button" onClick={onSelectAll}>
              Выбрать все
            </button>
            <button type="button" onClick={onReset}>
              Сбросить
            </button>
          </div>
          <div className="settings-list section-metrics-list">
            {section.metricIds.map((metricId) => {
              const metric = metricMap.get(metricId);

              if (!metric) {
                return null;
              }

              return (
                <label className="settings-option" key={metric.id}>
                  <input
                    type="checkbox"
                    checked={enabledMetricIds.has(metric.id)}
                    onChange={() => onToggleMetric(metric.id)}
                  />
                  <span>{metric.label}</span>
                </label>
              );
            })}
          </div>
        </FloatingPopover>
      )}
    </div>
  );
}

function TableSettingsMenu({
  enabledSectionIds,
  onToggleSection,
  onSelectAll,
  onReset,
  trigger = 'icon',
}: {
  enabledSectionIds: Set<string>;
  onToggleSection: (sectionId: string) => void;
  onSelectAll: () => void;
  onReset: () => void;
  trigger?: 'icon' | 'text';
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);

  return (
    <div className={`menu-button-shell ${open ? 'is-open' : ''}`} ref={ref}>
      {trigger === 'icon' ? (
        <TooltipButton
          label="Настройка таблицы"
          onClick={() => setOpen((current) => !current)}
          className={open ? 'active-pin' : ''}
        >
          <Settings2 size={18} />
        </TooltipButton>
      ) : (
        <button
          className={`left-panel-action-button ${open ? 'active-pin' : ''}`}
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Settings2 size={16} />
          <span>Настройка таблицы</span>
        </button>
      )}
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover table-settings-popover"
          expectedWidth={300}
          expectedHeight={620}
        >
          <div className="table-settings-head">
            <p>Настройка таблицы</p>
            <button
              className="row-menu-close"
              type="button"
              aria-label="Закрыть настройку таблицы"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="table-settings-actions">
            <button type="button" onClick={onSelectAll}>
              Выбрать все
            </button>
            <button type="button" onClick={onReset}>
              Сбросить
            </button>
          </div>
          <div className="settings-list">
            {metricSections.map((section) => (
              <label className="settings-option" key={section.id}>
                <input
                  type="checkbox"
                  checked={enabledSectionIds.has(section.id)}
                  onChange={() => onToggleSection(section.id)}
                />
                <span>{section.label}</span>
              </label>
            ))}
          </div>
        </FloatingPopover>
      )}
    </div>
  );
}

type ChartDraftSettings = {
  selectedSources: string[];
  chartDisplayMode: ChartDisplayMode;
  metricMode: ChartMetricMode;
  schedule: ScheduleFilters;
};

function ConfigureChartMenu({
  filters,
  crmSourceOptions,
  mainThreshold,
  mainRecommendedThreshold,
  onApply,
  onThresholdApply,
  onThresholdReset,
}: {
  filters: ReportFilters;
  crmSourceOptions: string[];
  mainThreshold: ThresholdValues;
  mainRecommendedThreshold: RecommendedThresholdValues;
  onApply: (settings: ChartDraftSettings) => void;
  onThresholdApply: (value: ThresholdValues) => void;
  onThresholdReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftSettings, setDraftSettings] = useState<ChartDraftSettings>(() => ({
    selectedSources: [...filters.selectedSources],
    chartDisplayMode: filters.chartDisplayMode,
    metricMode: filters.metricMode,
    schedule: {
      ...filters.schedule,
      weekendDayIds: [...filters.schedule.weekendDayIds],
    },
  }));
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);

  const openMenu = () => {
    setDraftSettings({
      selectedSources: [...filters.selectedSources],
      chartDisplayMode: filters.chartDisplayMode,
      metricMode: filters.metricMode,
      schedule: {
        ...filters.schedule,
        weekendDayIds: [...filters.schedule.weekendDayIds],
      },
    });
    setOpen(true);
  };

  const applySettings = () => {
    onApply({
      selectedSources: [...draftSettings.selectedSources],
      chartDisplayMode: draftSettings.chartDisplayMode,
      metricMode: draftSettings.metricMode,
      schedule: {
        ...draftSettings.schedule,
        weekendDayIds: [...draftSettings.schedule.weekendDayIds],
      },
    });
    setOpen(false);
  };

  return (
    <div className={`menu-button-shell configure-chart-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className={`left-panel-action-button ${open ? 'active-pin' : ''}`}
        type="button"
        aria-expanded={open}
        onClick={open ? () => setOpen(false) : openMenu}
      >
        <SlidersHorizontal size={16} />
        <span>Настроить график</span>
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover configure-chart-popover"
          expectedWidth={360}
          expectedHeight={560}
        >
          <div className="configure-chart-head">
            <p>Настроить график</p>
            <button
              className="row-menu-close"
              type="button"
              aria-label="Закрыть настройки графика"
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div className="configure-chart-fields">
            <MultiSelect
              values={draftSettings.selectedSources}
              options={crmSourceOptions}
              onChange={(selectedSources) =>
                setDraftSettings((current) => ({
                  ...current,
                  selectedSources,
                }))
              }
            />
            {draftSettings.selectedSources.length > 1 && (
              <CustomSelect
                options={chartDisplayModeOptions}
                value={draftSettings.chartDisplayMode}
                onChange={(chartDisplayMode) =>
                  setDraftSettings((current) => ({
                    ...current,
                    chartDisplayMode,
                  }))
                }
                ariaLabel="Режим отображения CRM-разделов"
                className="chart-mode-select"
              />
            )}
            <CustomSelect
              options={chartMetricModeOptions}
              value={draftSettings.metricMode}
              onChange={(metricMode) =>
                setDraftSettings((current) => ({
                  ...current,
                  metricMode,
                }))
              }
              ariaLabel="Что считаем"
              className="chart-mode-select"
            />
            <ThresholdMenu
              value={mainThreshold}
              recommended={mainRecommendedThreshold}
              onApply={onThresholdApply}
              onReset={onThresholdReset}
            />
            <ScheduleMenu
              schedule={draftSettings.schedule}
              onChange={(schedule) =>
                setDraftSettings((current) => ({
                  ...current,
                  schedule,
                }))
              }
            />
          </div>
          <button className="configure-chart-apply blue-button" type="button" onClick={applySettings}>
            Применить
          </button>
        </FloatingPopover>
      )}
    </div>
  );
}

function ThresholdEditor({
  threshold,
  recommended,
  onApply,
  onReset,
  onClose,
}: {
  threshold: ThresholdValues;
  recommended: RecommendedThresholdValues;
  onApply: (value: ThresholdValues) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [manualUpper, setManualUpper] = useState(threshold.upper);
  const [manualLower, setManualLower] = useState(threshold.lower);
  const manualAverage = getThresholdAverage({ upper: manualUpper, lower: manualLower });
  const canApplyManual = parseThreshold(manualUpper) !== null && parseThreshold(manualLower) !== null;
  const canApplyRecommended =
    parseThreshold(recommended.upper) !== null && parseThreshold(recommended.lower) !== null;
  const resetValues = () => {
    setManualUpper('');
    setManualLower('');
    onReset();
  };

  return (
    <div className="threshold-editor">
      <div className="threshold-popover-head">
        <p>Пороговые значения</p>
        <button className="popover-reset-button compact-reset-button" type="button" onClick={resetValues}>
          Сбросить
        </button>
      </div>
      <div className="threshold-editor-grid">
        <div className="threshold-column">
          <p>Ручные значения</p>
          <label className="threshold-field compact-threshold-field">
            <span>Верхнее значение</span>
            <input
              type="number"
              value={manualUpper}
              onChange={(event) => setManualUpper(event.target.value)}
              placeholder="1200000"
            />
          </label>
          <label className="threshold-field compact-threshold-field">
            <span>Нижнее значение</span>
            <input
              type="number"
              value={manualLower}
              onChange={(event) => setManualLower(event.target.value)}
              placeholder="800000"
            />
          </label>
          <label className="threshold-field compact-threshold-field">
            <span>Среднее значение</span>
            <input value={manualAverage === null ? '' : manualAverage} readOnly />
          </label>
          <button
            className="threshold-apply-button manual-apply-button"
            type="button"
            disabled={!canApplyManual}
            onClick={() => {
              onApply({ upper: manualUpper, lower: manualLower, mode: 'manual' });
              onClose();
            }}
          >
            Применить
          </button>
        </div>
        <div className="threshold-column">
          <p>Рекомендованные значения</p>
          <label className="threshold-field compact-threshold-field">
            <span>Рекомендованное верхнее значение</span>
            <input value={recommended.upper} readOnly />
          </label>
          <label className="threshold-field compact-threshold-field">
            <span>Рекомендованное нижнее значение</span>
            <input value={recommended.lower} readOnly />
          </label>
          <label className="threshold-field compact-threshold-field">
            <span>Рекомендованное среднее значение</span>
            <input value={recommended.average} readOnly />
          </label>
          <button
            className="threshold-apply-button recommended-apply-button"
            type="button"
            disabled={!canApplyRecommended}
            onClick={() => {
              onApply({ upper: recommended.upper, lower: recommended.lower, mode: 'recommended' });
              onClose();
            }}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}

function ThresholdMenu({
  value,
  recommended,
  onApply,
  onReset,
}: {
  value: ThresholdValues;
  recommended: RecommendedThresholdValues;
  onApply: (value: ThresholdValues) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);

  return (
    <div className={`threshold-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="threshold-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal size={17} />
        <span>Пороговые значения</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover threshold-popover"
          expectedWidth={520}
          expectedHeight={330}
        >
          <ThresholdEditor
            threshold={value}
            recommended={recommended}
            onApply={onApply}
            onReset={onReset}
            onClose={() => setOpen(false)}
          />
        </FloatingPopover>
      )}
    </div>
  );
}

function ScheduleMenu({
  schedule,
  onChange,
}: {
  schedule: ScheduleFilters;
  onChange: (schedule: ScheduleFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);

  const updateSchedule = (nextSchedule: ScheduleFilters) => {
    onChange({
      ...nextSchedule,
      weekendDayIds: [...nextSchedule.weekendDayIds],
    });
  };

  const toggleWeekendDay = (dayId: number) => {
    const weekendDayIds = schedule.weekendDayIds.includes(dayId)
      ? schedule.weekendDayIds.filter((currentDayId) => currentDayId !== dayId)
      : [...schedule.weekendDayIds, dayId];

    updateSchedule({
      ...schedule,
      weekendDayIds,
    });
  };

  return (
    <div className={`threshold-shell schedule-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="threshold-trigger schedule-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarClock size={17} />
        <span>Расписание</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover schedule-popover"
          expectedWidth={320}
          expectedHeight={430}
        >
          <p>Расписание</p>
          <div className="schedule-form">
            <label className="schedule-field">
              <span>Начало рабочего дня</span>
              <select
                value={schedule.workdayStart}
                onChange={(event) =>
                  updateSchedule({
                    ...schedule,
                    workdayStart: event.target.value,
                  })
                }
              >
                <option value="">00:00</option>
                {scheduleTimeOptions.filter((time) => time !== '00:00').map((time) => (
                  <option value={time} key={time}>
                    {time}
                  </option>
                ))}
              </select>
            </label>
            <label className="schedule-field">
              <span>Конец рабочего дня</span>
              <select
                value={schedule.workdayEnd}
                onChange={(event) =>
                  updateSchedule({
                    ...schedule,
                    workdayEnd: event.target.value,
                  })
                }
              >
                <option value="">00:00</option>
                {scheduleTimeOptions.filter((time) => time !== '00:00').map((time) => (
                  <option value={time} key={time}>
                    {time}
                  </option>
                ))}
              </select>
            </label>
            <div className="schedule-field">
              <span>Выходные дни</span>
              <div className="schedule-day-grid">
                {weekDayOptions.map((day) => {
                  const selected = schedule.weekendDayIds.includes(day.id);

                  return (
                    <button
                      className={`schedule-day-button ${selected ? 'is-selected' : ''}`}
                      type="button"
                      key={day.id}
                      onClick={() => toggleWeekendDay(day.id)}
                    >
                      <span>{day.label}</span>
                      {selected && <Check size={13} />}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="schedule-field">
              <span>Первый день недели</span>
              <div className="schedule-day-grid">
                {weekDayOptions.map((day) => {
                  const selected = schedule.calendarWeekStart === day.id;

                  return (
                    <button
                      className={`schedule-day-button ${selected ? 'is-selected' : ''}`}
                      type="button"
                      key={day.id}
                      onClick={() =>
                        updateSchedule({
                          ...schedule,
                          calendarWeekStart: day.id,
                        })
                      }
                    >
                      <span>{day.label}</span>
                      {selected && <Check size={13} />}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              className="popover-reset-button"
              type="button"
              onClick={() => updateSchedule(createDefaultSchedule())}
            >
              Сбросить
            </button>
          </div>
        </FloatingPopover>
      )}
    </div>
  );
}

function RowThresholdMenu({
  value,
  onChange,
}: {
  value: ThresholdValues;
  onChange: (value: ThresholdValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false));
  const average = getThresholdAverage(value);

  return (
    <div className={`row-threshold-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <TooltipButton
        label="Пороговые значения"
        className={`row-action-button ${open ? 'active-pin' : ''}`}
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal size={14} />
      </TooltipButton>
      {open && (
        <div className="settings-popover row-threshold-popover">
          <p>Пороговые значения</p>
          <label className="threshold-field">
            <span>Верхнее значение</span>
            <input
              type="number"
              value={value.upper}
              onChange={(event) => onChange({ ...value, upper: event.target.value })}
              placeholder="Например, 80"
            />
          </label>
          <label className="threshold-field">
            <span>Нижнее значение</span>
            <input
              type="number"
              value={value.lower}
              onChange={(event) => onChange({ ...value, lower: event.target.value })}
              placeholder="Например, 30"
            />
          </label>
          <label className="threshold-field">
            <span>Среднее значение</span>
            <input value={average === null ? '' : average} readOnly />
          </label>
          <button
            className="popover-reset-button"
            type="button"
            onClick={() => onChange({ upper: '', lower: '' })}
          >
            Сбросить
          </button>
        </div>
      )}
    </div>
  );
}

function RowActionsMenu({
  employeesOpen,
  chartOpen,
  threshold,
  recommendedThreshold,
  onToggleEmployees,
  onToggleChart,
  onThresholdChange,
}: {
  employeesOpen: boolean;
  chartOpen: boolean;
  threshold: ThresholdValues;
  recommendedThreshold: RecommendedThresholdValues;
  onToggleEmployees: () => void;
  onToggleChart: () => void;
  onThresholdChange: (value: ThresholdValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'actions' | 'thresholds'>('actions');
  const popoverRef = useRef<HTMLDivElement>(null);
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false), [popoverRef]);

  const openActions = () => {
    setMode('actions');
    setOpen((current) => !current);
  };

  return (
    <div className={`row-actions-shell ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        className="more-menu-button"
        type="button"
        aria-label="Действия показателя"
        aria-expanded={open}
        onClick={openActions}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <FloatingPopover
          anchorRef={ref}
          popoverRef={popoverRef}
          open={open}
          className="settings-popover row-actions-popover"
          expectedWidth={mode === 'actions' ? 280 : 520}
          expectedHeight={mode === 'actions' ? 158 : 330}
        >
          {mode === 'actions' ? (
            <div className="row-actions-list">
              <div className="row-actions-menu-head">
                <p>Действия</p>
                <button
                  className="row-menu-close"
                  type="button"
                  aria-label="Закрыть меню"
                  onClick={() => setOpen(false)}
                >
                  <X size={14} />
                </button>
              </div>
              <button
                className={`row-action-menu-item ${employeesOpen ? 'is-active' : ''}`}
                type="button"
                onClick={() => {
                  onToggleEmployees();
                  setOpen(false);
                }}
              >
                <span>{employeesOpen ? 'Скрыть сотрудников' : 'Показать сотрудников'}</span>
                {employeesOpen && <Check size={14} />}
              </button>
              <button
                className={`row-action-menu-item ${chartOpen ? 'is-active' : ''}`}
                type="button"
                onClick={() => {
                  onToggleChart();
                  setOpen(false);
                }}
              >
                <span>{chartOpen ? 'Скрыть график' : 'Показать график'}</span>
                {chartOpen && <Check size={14} />}
              </button>
              <button
                className="row-action-menu-item"
                type="button"
                onClick={() => setMode('thresholds')}
              >
                <span>Пороговые значения</span>
              </button>
            </div>
          ) : (
            <div className="row-threshold-fields">
              <div className="row-popover-head">
                <button type="button" onClick={() => setMode('actions')}>
                  Назад
                </button>
                <button
                  className="row-menu-close"
                  type="button"
                  aria-label="Закрыть меню"
                  onClick={() => setOpen(false)}
                >
                  <X size={14} />
                </button>
              </div>
              <ThresholdEditor
                threshold={threshold}
                recommended={recommendedThreshold}
                onApply={onThresholdChange}
                onReset={() => onThresholdChange({ upper: '', lower: '', mode: null })}
                onClose={() => setOpen(false)}
              />
            </div>
          )}
        </FloatingPopover>
      )}
    </div>
  );
}

function RowMetricChart({
  metric,
  reportData,
  threshold,
}: {
  metric: MetricRow;
  reportData: ReportPoint[];
  threshold?: ThresholdValues;
}) {
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [activePoint, setActivePoint] = useState<ActiveChartPoint | null>(null);
  const chartData = useMemo(
    () =>
      reportData.map((point, index) => ({
        label: point.label,
        tooltipLabel: point.tooltipLabel,
        value: point.values[metric.id],
        chartIndex: index,
        xIndex: index + 0.5,
      })),
    [metric.id, reportData],
  );
  const thresholdValues = useMemo(
    () =>
      [
        parseThreshold(threshold?.upper ?? ''),
        parseThreshold(threshold?.lower ?? ''),
        threshold ? getThresholdAverage(threshold) : null,
      ].filter((item): item is number => item !== null),
    [threshold],
  );
  const domain = useMemo(
    () => getChartDomain([...chartData.map((point) => point.value), ...thresholdValues]),
    [chartData, thresholdValues],
  );
  const upper = parseThreshold(threshold?.upper ?? '');
  const lower = parseThreshold(threshold?.lower ?? '');
  const average = threshold ? getThresholdAverage(threshold) : null;
  const activeDataPoint = activePoint ? chartData[activePoint.index] : null;
  const thresholdItems = getAppliedThresholdItems(threshold);

  return (
    <div className="row-chart-wrap" ref={chartWrapRef}>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart
          data={chartData}
          margin={{ top: 20, right: 0, left: 0, bottom: 8 }}
          onMouseLeave={() => setActivePoint(null)}
        >
          <CartesianGrid stroke="#edf0f4" vertical={false} />
          <XAxis dataKey="xIndex" type="number" domain={[0, reportData.length]} hide />
          <YAxis
            width={CHART_AXIS_WIDTH}
            domain={domain}
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#707782', fontSize: 11 }}
            tickFormatter={(value) => formatAxisTick(value, metric.type)}
          />
          {upper !== null && (
            <ReferenceLine
              y={upper}
              stroke={thresholdLineColors.upper}
              strokeDasharray="6 6"
              label={{ value: getThresholdLineLabel(threshold, 'upper'), position: 'insideTopLeft', fill: '#218454', fontSize: 10, dx: 4, dy: -4 }}
            />
          )}
          {average !== null && (
            <ReferenceLine
              y={average}
              stroke={thresholdLineColors.average}
              strokeDasharray="6 6"
              label={{ value: getThresholdLineLabel(threshold, 'average'), position: 'insideTopLeft', fill: '#9a6b00', fontSize: 10, dx: 4, dy: -4 }}
            />
          )}
          {lower !== null && (
            <ReferenceLine
              y={lower}
              stroke={thresholdLineColors.lower}
              strokeDasharray="6 6"
              label={{ value: getThresholdLineLabel(threshold, 'lower'), position: 'insideTopLeft', fill: '#b42323', fontSize: 10, dx: 4, dy: -4 }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke="#2274ff"
            strokeWidth={2}
            dot={(props: ChartDotPayloadProps) => (
              <HoverChartDot
                {...props}
                stroke="#2274ff"
                radius={2.5}
                onActivate={setActivePoint}
                onDeactivate={() => setActivePoint(null)}
              />
            )}
            activeDot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {activePoint && activeDataPoint && (
        <ChartPointTooltip
          point={activePoint}
          title={activeDataPoint.tooltipLabel}
          items={[
            {
              label: metric.label,
              value: formatMetricValue(activeDataPoint.value, metric.type),
              color: '#2274ff',
            },
          ]}
          thresholdItems={thresholdItems}
          containerRef={chartWrapRef}
          valueFormatter={(value) => formatMetricValue(value, metric.type)}
        />
      )}
    </div>
  );
}

function SaveViewModal({
  value,
  onValueChange,
  onClose,
  onSave,
  title = 'Сохранить отображение',
}: {
  value: string;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  title?: string;
}) {
  const panelRef = useOutsideClose<HTMLDivElement>(true, onClose);

  return (
    <div className="modal-layer" role="presentation">
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-view-title"
        ref={panelRef}
      >
        <div className="modal-head">
          <p id="save-view-title">{title}</p>
          <button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field-label">
          <span>Название</span>
          <input
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder="Например, отчет продаж"
            autoFocus
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary-button" type="button" onClick={onSave}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteViewModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useOutsideClose<HTMLDivElement>(true, onCancel);

  return (
    <div className="modal-layer" role="presentation">
      <div className="modal-panel compact-modal-panel" role="dialog" aria-modal="true" ref={panelRef}>
        <div className="modal-head">
          <p>Удалить отображение</p>
          <button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <p className="modal-text">Точно удалить отображение отчета?</p>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Отмена
          </button>
          <button className="danger-button" type="button" onClick={onConfirm}>
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}

function FreeSaveLimitModal({
  onClose,
  onOpenPro,
}: {
  onClose: () => void;
  onOpenPro: () => void;
}) {
  const panelRef = useOutsideClose<HTMLDivElement>(true, onClose);

  return (
    <div className="modal-layer" role="presentation">
      <div className="modal-panel compact-modal-panel" role="dialog" aria-modal="true" ref={panelRef}>
        <div className="modal-head">
          <p>Ограничение бесплатной версии</p>
          <button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="modal-text">В бесплатной версии возможно сохранить только одно отображение отчета.</p>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary-button" type="button" onClick={onOpenPro}>
            Активировать ПРО версию
          </button>
        </div>
      </div>
    </div>
  );
}

function ProVersionModal({ onClose }: { onClose: () => void }) {
  const panelRef = useOutsideClose<HTMLDivElement>(true, onClose);

  return (
    <div className="modal-layer pro-modal-layer" role="presentation">
      <div
        className="modal-panel pro-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-modal-title"
        ref={panelRef}
      >
        <div className="modal-head">
          <p id="pro-modal-title">ПРО версия</p>
          <button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="pro-modal-body">
          <p>Здесь будет описание тарифа, возможностей и подключение оплаты.</p>
          <p>ПРО версия позволяет:</p>
          <ol>
            <li>Сохранять множество вариантов отображений отчета.</li>
            <li>Дать права сотрудникам к различным показателям отчета.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function InstructionModal({ onClose }: { onClose: () => void }) {
  const panelRef = useOutsideClose<HTMLDivElement>(true, onClose);

  return (
    <div className="modal-layer instruction-modal-layer" role="presentation">
      <div className="modal-panel instruction-modal-panel" role="dialog" aria-modal="true" ref={panelRef}>
        <div className="modal-head">
          <p>Инструкция</p>
          <button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="instruction-content">
          <nav className="instruction-nav" aria-label="Разделы инструкции">
            <a href="#instruction-about">Что делает приложение</a>
            <a href="#instruction-build">Как построить отчет</a>
            <a href="#instruction-crm">Почему у всех разные воронки</a>
            <a href="#instruction-chart">Как читать график</a>
            <a href="#instruction-thresholds">Пороговые значения</a>
            <a href="#instruction-table">Как пользоваться таблицей</a>
            <a href="#instruction-settings">Настройка таблицы</a>
            <a href="#instruction-views">Сохраненные отображения</a>
            <a href="#instruction-export">Excel и PDF</a>
            <a href="#instruction-pro">ПРО версия</a>
            <a href="#instruction-faq">Частые вопросы</a>
          </nav>

          <section className="instruction-section" id="instruction-about">
            <h2>Что делает приложение</h2>
            <p>
              Приложение помогает смотреть показатели Битрикс24 в графиках и таблицах. Вы выбираете период,
              CRM-разделы и нужный вид расчета, а приложение показывает динамику по датам.
            </p>
            <p>
              Отчет можно скачать в Excel или PDF. Также можно сохранить удобные варианты отображения отчета,
              чтобы быстро возвращаться к ним позже.
            </p>
            <div className="instruction-demo demo-toolbar">
              <span className="demo-select">Общий отчет</span>
              <span className="demo-button demo-blue">Построить отчет</span>
              <span className="demo-button demo-green">Скачать Excel</span>
              <span className="demo-button demo-purple">Скачать PDF</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-build">
            <h2>Как построить отчет</h2>
            <ol>
              <li>Выберите период в верхней панели.</li>
              <li>Нажмите кнопку <b>Настроить график</b>.</li>
              <li>Выберите нужные воронки, лиды, счета или смарт-процессы.</li>
              <li>Выберите, что считать: деньги или количество.</li>
              <li>Нажмите <b>Применить</b>.</li>
              <li>Нажмите <b>Построить отчет</b>.</li>
            </ol>
            <div className="instruction-demo demo-card">
              <span className="demo-button demo-soft">Настроить график</span>
              <span className="demo-select">Воронка продажи</span>
              <span className="demo-select">Кол-во денег</span>
              <span className="demo-button demo-blue">Применить</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-crm">
            <h2>Почему у всех разные воронки</h2>
            <p>
              Приложение берет разделы CRM из вашего портала Битрикс24. Поэтому названия могут отличаться от
              примеров в инструкции. У одного портала может быть воронка <b>Продажи</b>, у другого — <b>Производство</b>.
            </p>
            <p>
              Лиды и смарт-процессы тоже могут называться по-разному. Это нормально: выбирайте те разделы,
              которые нужны именно вашему отчету.
            </p>
          </section>

          <section className="instruction-section" id="instruction-chart">
            <h2>Как читать главный график</h2>
            <p>
              Точки на графике показывают значения по датам или периодам. Наведите курсор на точку, чтобы увидеть
              подсказку с датой и суммой. Линия тренда помогает понять, растут показатели или снижаются.
            </p>
            <div className="instruction-demo demo-chart">
              <span className="demo-chart-line" />
              <span className="demo-dot demo-dot-one" />
              <span className="demo-dot demo-dot-two" />
              <span className="demo-dot demo-dot-three" />
              <span className="demo-tooltip">15 мая · 840 000 ₽</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-thresholds">
            <h2>Пороговые значения</h2>
            <p>
              Верхнее значение показывает хороший результат. Нижнее значение помогает быстро увидеть слабые места.
              Среднее значение находится между ними. Значения можно ввести вручную или применить рекомендованные.
            </p>
            <p>
              Рекомендованные значения считаются автоматически по данным текущего графика или строки таблицы.
            </p>
            <div className="instruction-demo demo-thresholds">
              <div>
                <span>Ручные значения</span>
                <i>Верхнее значение</i>
                <i>Нижнее значение</i>
                <i>Среднее значение</i>
                <b>Применить</b>
              </div>
              <div>
                <span>Рекомендованные</span>
                <i>Рекомендованное верхнее</i>
                <i>Рекомендованное нижнее</i>
                <i>Рекомендованное среднее</i>
                <b className="demo-green-text">Применить</b>
              </div>
            </div>
          </section>

          <section className="instruction-section" id="instruction-table">
            <h2>Как пользоваться таблицей</h2>
            <p>
              Слева находится список показателей, справа — значения по датам. Через меню с тремя точками можно
              показать сотрудников, раскрыть график строки или настроить пороги.
            </p>
            <p>
              Нажмите на цифру, чтобы открыть детализацию. Если значение обрезано, наведите курсор — появится
              подсказка с полным значением.
            </p>
            <div className="instruction-demo demo-table-row">
              <span>Сумма успешных сделок</span>
              <b>812 000 ₽</b>
              <b>940 000 ₽</b>
              <button type="button" aria-label="Меню строки">⋮</button>
            </div>
          </section>

          <section className="instruction-section" id="instruction-settings">
            <h2>Настройка таблицы</h2>
            <p>
              В настройке таблицы можно скрыть лишние разделы. В настройке показателей раздела можно оставить
              только нужные строки. Скрытые показатели не попадут в Excel.
            </p>
            <p>
              Кнопка <b>Выбрать все</b> включает все пункты. Кнопка <b>Сбросить</b> очищает выбор.
            </p>
            <div className="instruction-demo demo-card">
              <span className="demo-button demo-soft">Настройка таблицы</span>
              <span className="demo-pill">Выбрать все</span>
              <span className="demo-pill">Сбросить</span>
              <span className="demo-check">✓ Сделки</span>
              <span className="demo-check">✓ Лиды</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-views">
            <h2>Сохраненные отображения</h2>
            <p>
              Если вы часто смотрите отчет в одном и том же виде, сохраните отображение. В бесплатной версии можно
              сохранить одно отображение. В ПРО версии можно сохранять много вариантов.
            </p>
            <p>
              Чтобы переименовать или удалить отображение, откройте поле <b>Общий отчет</b> и нажмите три точки
              рядом с сохраненным названием.
            </p>
            <div className="instruction-demo demo-card">
              <span className="demo-select">Общий отчет</span>
              <span className="demo-select">Продажи за месяц · ⋮</span>
              <span className="demo-menu-item">Редактировать</span>
              <span className="demo-menu-item">Удалить</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-export">
            <h2>Excel и PDF</h2>
            <p>
              Excel выгружает таблицу с видимыми разделами и показателями. Если вы скрыли раздел или показатель,
              он не попадет в файл.
            </p>
            <p>
              PDF выгружает визуальный отчет: верхнюю панель, главный график и таблицу. Если таблица большая,
              PDF должен включить ее полностью.
            </p>
          </section>

          <section className="instruction-section" id="instruction-pro">
            <h2>ПРО версия</h2>
            <p>
              ПРО версия позволит сохранять много вариантов отображений отчета. Позже здесь появятся права
              сотрудников на разные показатели и дополнительные настройки доступа.
            </p>
          </section>

          <section className="instruction-section" id="instruction-faq">
            <h2>Частые вопросы</h2>
            <h3>Почему я не вижу нужную воронку?</h3>
            <p>Проверьте, есть ли эта воронка в вашем Битрикс24 и доступна ли она вашему пользователю.</p>
            <h3>Почему названия отличаются от инструкции?</h3>
            <p>Инструкция показывает примеры. В вашем портале воронки, лиды и смарт-процессы могут называться иначе.</p>
            <h3>Почему отчет пустой?</h3>
            <p>Сначала выберите настройки и нажмите <b>Построить отчет</b>. Также проверьте выбранный период.</p>
            <h3>Как скачать отчет?</h3>
            <p>Нажмите <b>Скачать Excel</b> для таблицы или <b>Скачать PDF</b> для визуального отчета.</p>
            <h3>Как открыть детализацию?</h3>
            <p>Нажмите на любую цифру в таблице. Откроется окно со списком элементов.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

function EmployeeMultiSelect({
  label,
  selectedIds,
  onChange,
}: {
  label: string;
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false));
  const selectedEmployees = mockEmployees.filter((employee) => selectedIds.includes(employee.id));
  const normalizedQuery = query.trim().toLowerCase();
  // TODO: заменить mockEmployees на загрузку активных сотрудников портала через Bitrix24 user.get.
  const filteredEmployees = mockEmployees.filter((employee) => {
    if (!normalizedQuery) {
      return true;
    }

    return (
      employee.firstName.toLowerCase().startsWith(normalizedQuery) ||
      employee.lastName.toLowerCase().startsWith(normalizedQuery) ||
      `${employee.firstName} ${employee.lastName}`.toLowerCase().startsWith(normalizedQuery)
    );
  });

  const toggleEmployee = (employeeId: string) => {
    onChange(
      selectedIds.includes(employeeId)
        ? selectedIds.filter((id) => id !== employeeId)
        : [...selectedIds, employeeId],
    );
  };

  return (
    <div className={`employee-multi-field ${open ? 'is-open' : ''}`} ref={ref}>
      <span>{label}</span>
      <button
        className="employee-multi-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="employee-chip-list">
          {selectedEmployees.length ? (
            selectedEmployees.map((employee) => (
              <span className="employee-chip" key={employee.id}>
                {employee.firstName} {employee.lastName}
              </span>
            ))
          ) : (
            <span className="employee-placeholder">Не выбрано</span>
          )}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="employee-multi-popover">
          <div className="employee-multi-head">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск сотрудника"
            />
            <button className="row-menu-close" type="button" aria-label="Закрыть список" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <div className="employee-multi-list">
            {filteredEmployees.map((employee) => (
              <label className="employee-multi-option" key={employee.id}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(employee.id)}
                  onChange={() => toggleEmployee(employee.id)}
                />
                <span>{employee.firstName} {employee.lastName}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AppSettingsModal({
  settings,
  onSave,
  onClose,
  onOpenPro,
}: {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
  onOpenPro: () => void;
}) {
  const [draftSettings, setDraftSettings] = useState<AppSettings>(() => ({
    reportBuilderUserIds: [...settings.reportBuilderUserIds],
    moneyViewerUserIds: [...settings.moneyViewerUserIds],
    viewSaverUserIds: [...settings.viewSaverUserIds],
  }));
  const panelRef = useOutsideClose<HTMLDivElement>(true, onClose);

  const updateField = (field: keyof AppSettings, values: string[]) => {
    setDraftSettings((current) => ({
      ...current,
      [field]: values,
    }));
  };

  return (
    <div className="modal-layer app-settings-modal-layer" role="presentation">
      <div className="modal-panel app-settings-modal-panel" role="dialog" aria-modal="true" ref={panelRef}>
        <div className="modal-head">
          <div>
            <p>Настройки приложения</p>
            <span>Настраивать приложение может только администратор портала.</span>
          </div>
          <button className="icon-button" type="button" aria-label="Закрыть окно" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="modal-text">
          Настройки возможны при активной подписке{' '}
          <button className="pro-inline-link" type="button" onClick={onOpenPro}>
            ПРО версии
          </button>.
        </p>
        <div className="app-settings-fields">
          <EmployeeMultiSelect
            label="Сотрудники, которым разрешено строить отчеты:"
            selectedIds={draftSettings.reportBuilderUserIds}
            onChange={(values) => updateField('reportBuilderUserIds', values)}
          />
          <EmployeeMultiSelect
            label="Сотрудники, которым разрешено видеть показатели с деньгами:"
            selectedIds={draftSettings.moneyViewerUserIds}
            onChange={(values) => updateField('moneyViewerUserIds', values)}
          />
          <EmployeeMultiSelect
            label="Сотрудники, которым разрешено сохранять отображения отчета:"
            selectedIds={draftSettings.viewSaverUserIds}
            onChange={(values) => updateField('viewSaverUserIds', values)}
          />
        </div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary-button" type="button" onClick={() => onSave(draftSettings)}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailModal({
  context,
  onClose,
}: {
  context: DetailContext;
  onClose: () => void;
}) {
  const [sort, setSort] = useState<DetailSort>({ key: 'rowNumber', direction: 'asc' });
  const [columnWidths, setColumnWidths] = useState<Record<DetailColumnKey, number>>(
    () => loadDetailColumnWidths(),
  );
  const resizeStateRef = useRef<{
    key: DetailColumnKey;
    startX: number;
    startWidths: Record<DetailColumnKey, number>;
    containerWidth: number;
  } | null>(null);
  const detailTableWrapRef = useRef<HTMLDivElement>(null);
  const [detailTableViewportWidth, setDetailTableViewportWidth] = useState(0);
  const rows = useMemo(() => buildMockDetailRows(context), [context]);
  const sortedRows = useMemo(() => {
    const nextRows = [...rows].sort((a, b) => compareDetailValues(a, b, sort.key));

    return sort.direction === 'asc' ? nextRows : nextRows.reverse();
  }, [rows, sort]);
  const detailColumnWidthSum = useMemo(
    () => detailColumns.reduce((sum, column) => sum + columnWidths[column.key], 0),
    [columnWidths],
  );
  const detailTableWidth =
    detailTableViewportWidth > 0
      ? Math.max(detailColumnMinWidthSum, detailTableViewportWidth)
      : detailColumnWidthSum;
  const detailFillerWidth = Math.max(0, detailTableWidth - detailColumnWidthSum);
  const detailTableStyle = useMemo<CSSProperties>(
    () => ({
      gridTemplateColumns: [
        ...detailColumns.map((column) => `${columnWidths[column.key]}px`),
        `${detailFillerWidth}px`,
      ].join(' '),
      width: `${detailTableWidth}px`,
      minWidth: '100%',
    }),
    [columnWidths, detailFillerWidth, detailTableWidth],
  );

  useEffect(() => {
    const node = detailTableWrapRef.current;

    if (!node) {
      return undefined;
    }

    const update = () => {
      setDetailTableViewportWidth(Math.floor(node.clientWidth));
    };

    update();
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;

    resizeObserver?.observe(node);
    window.addEventListener('resize', update);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    if (detailTableViewportWidth <= 0) {
      return;
    }

    setColumnWidths((current) => {
      const normalized = normalizeDetailColumnWidths(current, detailTableViewportWidth);
      return sumDetailColumnWidths(normalized) === sumDetailColumnWidths(current) &&
        detailColumns.every((column) => normalized[column.key] === current[column.key])
        ? current
        : normalized;
    });
  }, [detailTableViewportWidth]);

  useEffect(() => {
    if (detailTableViewportWidth <= 0 || typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(DETAIL_COLUMN_STORAGE_KEY, JSON.stringify(columnWidths));
    } catch {
      // localStorage может быть недоступен в приватном режиме, resize при этом должен работать.
    }
  }, [columnWidths, detailTableViewportWidth]);

  useEffect(
    () => () => {
      document.body.classList.remove('is-detail-resizing');
    },
    [],
  );

  const toggleSort = (key: DetailColumnKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const startColumnResize = (
    column: { key: DetailColumnKey; minWidth: number },
    event: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      key: column.key,
      startX: event.clientX,
      startWidths: normalizeDetailColumnWidths(columnWidths, detailTableViewportWidth),
      containerWidth: detailTableViewportWidth,
    };
    document.body.classList.add('is-detail-resizing');

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const state = resizeStateRef.current;

      if (!state) {
        return;
      }

      const nextWidths = resizeDetailColumnWidths(
        state.startWidths,
        state.key,
        moveEvent.clientX - state.startX,
        state.containerWidth,
      );

      setColumnWidths(nextWidths);
    };

    const handlePointerUp = () => {
      resizeStateRef.current = null;
      document.body.classList.remove('is-detail-resizing');
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <div
      className="detail-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div className="detail-head">
          <div>
            <p id="detail-title">Детализация: {context.metric.label}</p>
            <span>
              {context.point.label} · {formatMetricValue(context.value, context.metric.type)} · {bitrixEntityLabels[context.entityType]}
              {context.employee ? ` · ${context.employee.firstName} ${context.employee.lastName}` : ''}
            </span>
          </div>
          <button className="icon-button" type="button" aria-label="Закрыть детализацию" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="details-table-scroll detail-table-wrap" ref={detailTableWrapRef}>
          <div className="detail-table" role="table" style={detailTableStyle}>
            {detailColumns.map((column) => (
              <button
                className="detail-header-cell"
                type="button"
                role="columnheader"
                key={column.key}
                onClick={() => toggleSort(column.key)}
              >
                <span>{column.label}</span>
                {sort.key === column.key && (
                  <span className="sort-indicator">{sort.direction === 'asc' ? '↑' : '↓'}</span>
                )}
                <span
                  className="column-resizer"
                  role="separator"
                  aria-label={`Изменить ширину: ${column.label}`}
                  onPointerDown={(event) => startColumnResize(column, event)}
                />
              </button>
            ))}
            <div className="detail-filler-cell detail-header-filler" aria-hidden="true" />

            {sortedRows.map((row) => (
              <div className="detail-row-contents" role="row" key={row.entityId}>
                <div className="detail-cell">{row.rowNumber}</div>
                <button
                  className="detail-cell detail-action-cell"
                  type="button"
                  onClick={() => openBitrixEntity(row.entityType, row.entityId)}
                >
                  {row.entityId}
                </button>
                <button
                  className="detail-cell detail-action-cell detail-title-cell"
                  type="button"
                  onClick={() => openBitrixEntity(row.entityType, row.entityId)}
                >
                  {row.title}
                </button>
                <button
                  className="detail-cell detail-action-cell"
                  type="button"
                  onClick={() => openBitrixUser(row.responsibleId)}
                >
                  {row.responsibleName}
                </button>
                <div className="detail-cell">{row.createdAt}</div>
                <div className="detail-filler-cell" aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

type ChartDotPayloadProps = {
  cx?: number | string;
  cy?: number | string;
  stroke?: string;
  index?: number;
};

type ActiveChartPoint = {
  index: number;
  x: number;
  y: number;
};

type ChartTooltipItem = {
  label: string;
  value: string;
  color: string;
};

type HoverChartDotProps = ChartDotPayloadProps & {
  radius?: number;
  onActivate: (point: ActiveChartPoint) => void;
  onDeactivate: () => void;
};

const getChartTooltipStyle = (
  point: ActiveChartPoint,
  container: HTMLElement | null,
): CSSProperties => {
  if (typeof window === 'undefined') {
    return {};
  }

  const containerRect = container?.getBoundingClientRect();
  const pointX = (containerRect?.left ?? 0) + point.x;
  const pointY = (containerRect?.top ?? 0) + point.y;
  const appRect = container?.closest('.report-card')?.getBoundingClientRect();
  const boundary = appRect ?? {
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  const width = Math.min(280, Math.max(180, (container?.clientWidth ?? 280) - 24));
  const estimatedHeight = 116;
  const minLeft = boundary.left + width / 2 + 12;
  const maxLeft = Math.max(minLeft, boundary.right - width / 2 - 12);
  const hasTopSpace = pointY - boundary.top > estimatedHeight + 14;
  const preferredTop = hasTopSpace ? pointY - 10 : pointY + 10;
  const top = hasTopSpace
    ? Math.max(preferredTop, boundary.top + estimatedHeight + 12)
    : Math.min(Math.max(preferredTop, boundary.top + 12), boundary.bottom - estimatedHeight - 12);

  return {
    width,
    left: clamp(pointX, minLeft, maxLeft),
    top,
    transform: hasTopSpace ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
  };
};

function ChartPointTooltip({
  point,
  title,
  items,
  thresholdItems,
  containerRef,
  valueFormatter,
}: {
  point: ActiveChartPoint;
  title: string;
  items: ChartTooltipItem[];
  thresholdItems: ReturnType<typeof getAppliedThresholdItems>;
  containerRef: RefObject<HTMLDivElement | null>;
  valueFormatter: (value: number) => string;
}) {
  if (typeof document === 'undefined') {
    return null;
  }

  return (
    createPortal(<div className="chart-point-tooltip chart-tooltip" style={getChartTooltipStyle(point, containerRef.current)}>
      <p>{title}</p>
      <div className="chart-tooltip-list">
        {items.map((item) => (
          <span className="chart-tooltip-row" key={item.label}>
            <i style={{ background: item.color }} />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </span>
        ))}
        {thresholdItems.map((item) => (
          <span
            className="chart-tooltip-row threshold-tooltip-row"
            style={{ color: item.color }}
            key={item.label}
          >
            <i style={{ borderColor: item.color, background: item.color }} />
            <span>{item.label}</span>
            <strong style={{ color: item.color }}>{valueFormatter(item.value)}</strong>
          </span>
        ))}
      </div>
    </div>, document.body)
  );
}

function HoverChartDot({
  cx,
  cy,
  stroke = '#2274ff',
  index = 0,
  radius = 3,
  onActivate,
  onDeactivate,
}: HoverChartDotProps) {
  const x = Number(cx);
  const y = Number(cy);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return (
    <g
      className="chart-hover-dot"
      onMouseEnter={() => onActivate({ index, x, y })}
      onMouseLeave={onDeactivate}
      onFocus={() => onActivate({ index, x, y })}
      onBlur={onDeactivate}
      tabIndex={0}
    >
      <circle cx={x} cy={y} r={Math.max(radius + 6, 9)} fill="transparent" pointerEvents="all" />
      <circle cx={x} cy={y} r={radius} fill="#ffffff" stroke={stroke} strokeWidth={2} />
    </g>
  );
}

const getChartDomain = (values: number[]): [number, number] => {
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

function App() {
  const [savedViews, setSavedViews] = useState<SavedReportViewOption[]>(() => loadSavedViews());
  const [selectedView, setSelectedView] = useState('default');
  const [draftFilters, setDraftFilters] = useState<ReportFilters>(() => createDefaultFilters());
  const [appliedFilters, setAppliedFilters] = useState<ReportFilters>(() => createDefaultFilters());
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
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [isProOpen, setIsProOpen] = useState(false);
  const [isInstructionOpen, setIsInstructionOpen] = useState(false);
  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false);
  const [isFreeLimitOpen, setIsFreeLimitOpen] = useState(false);
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

    const timeoutId = window.setTimeout(() => setNotification(''), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [notification]);

  useEffect(() => {
    let isActive = true;

    reportDataSource
      .loadCrmSources()
      .then((sources) => {
        if (isActive) {
          setCrmSources(sources);
        }
      })
      .catch((error) => {
        console.warn('[Report data source] CRM sources were not loaded', error);
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    const filters: ReportLoadFilters = {
      period: appliedFilters.period,
      dateRange: appliedFilters.dateRange,
      selectedSources: appliedFilters.selectedSources,
      metricMode: appliedFilters.metricMode,
      chartDisplayMode: appliedFilters.chartDisplayMode,
    };

    reportDataSource
      .loadReportData(filters)
      .then((data) => {
        if (isActive) {
          setRawReportData(data);
        }
      })
      .catch((error) => {
        console.warn('[Report data source] report data were not loaded', error);
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
    buildMoment,
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
        .map((source) => source.sourceLabel),
    [crmSources],
  );

  useEffect(() => {
    if (!crmSourceOptions.length) {
      return;
    }

    setDraftFilters((current) => {
      const selectedSources = current.selectedSources.filter((source) =>
        crmSourceOptions.includes(source),
      );

      if (selectedSources.length) {
        return current;
      }

      return {
        ...current,
        selectedSources: [crmSourceOptions[0]],
      };
    });
  }, [crmSourceOptions]);
  const selectedChartSources = useMemo(
    () =>
      appliedFilters.selectedSources.length
        ? appliedFilters.selectedSources
        : ['Воронка продажи'],
    [appliedFilters.selectedSources],
  );
  const isSeparateChart = selectedChartSources.length > 1 && appliedFilters.chartDisplayMode === 'separate';
  const chartSeries = useMemo(
    () =>
      isSeparateChart
        ? selectedChartSources.map((source, index) => ({
            key: `series_${index}`,
            label: source,
            color: chartSeriesColors[index % chartSeriesColors.length],
          }))
        : [
            {
              key: 'indicator',
              label: selectedChartSources.length > 1 ? 'Сумма' : selectedChartSources[0],
              color: '#2274ff',
            },
          ],
    [isSeparateChart, selectedChartSources],
  );
  const chartBaseValues = useMemo(
    () =>
      reportData.map((point) =>
        selectedChartSources.reduce(
          (sum, source) => sum + getChartSeriesValue(point, source, appliedFilters.metricMode),
          0,
        ),
      ),
    [appliedFilters.metricMode, reportData, selectedChartSources],
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
    [],
  );
  const sectionMap = useMemo(
    () => new Map(metricSections.map((section) => [section.id, section])),
    [],
  );
  const orderedSections = useMemo(
    () =>
      sectionOrder
        .map((sectionId) => sectionMap.get(sectionId))
        .filter((section): section is (typeof metricSections)[number] => Boolean(section)),
    [sectionMap, sectionOrder],
  );
  const visibleSections = useMemo(
    () => orderedSections.filter((section) => draftFilters.enabledSectionIds.has(section.id)),
    [draftFilters.enabledSectionIds, orderedSections],
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

        const enabledMetricIds = enabledMetricIdsBySection[section.id] ?? new Set(section.metricIds);

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
            mockEmployees.forEach((employee, employeeIndex) => {
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

  const buildReport = useCallback(() => {
    setHasBuiltReport(true);
    setAppliedFilters({
      period: draftFilters.period,
      dateRange: draftFilters.dateRange,
      selectedSources: [...draftFilters.selectedSources],
      chartDisplayMode: draftFilters.chartDisplayMode,
      metricMode: draftFilters.metricMode,
      schedule: {
        ...draftFilters.schedule,
        weekendDayIds: [...draftFilters.schedule.weekendDayIds],
      },
      enabledSectionIds: new Set(draftFilters.enabledSectionIds),
    });
    setBuildMoment(Date.now());
  }, [draftFilters]);

  const openDetail = useCallback((
    metric: MetricRow,
    point: ReportPoint,
    value: number,
    sectionId: string,
    employee?: MockEmployee,
  ) => {
    setDetailContext({
      metric,
      point,
      value,
      employee,
      entityType: getEntityTypeForMetric(metric, sectionId),
    });
  }, []);

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
  }, [savedViews]);

  const applySavedViewState = useCallback((state: SavedReportViewState) => {
    setDraftFilters(deserializeFilters(state.draftFilters));
    setAppliedFilters(deserializeFilters(state.appliedFilters));
    setEnabledMetricIdsBySection(
      Object.fromEntries(
        Object.entries(state.enabledMetricIdsBySection).map(([sectionId, metricIds]) => [
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
            ...reportData.map((point, pointIndex) =>
              formatMetricValue(
                hasBuiltReport
                  ? getEmployeeMetricValue(
                      point.values[row.metric.id],
                      row.metric,
                      row.employeeIndex,
                      pointIndex,
                    )
                  : 0,
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
            />
            <TooltipButton
              label="Настроить приложение"
              onClick={() => setIsAppSettingsOpen(true)}
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
              label="Активировать ПРО версию чтобы сохранять разные отображения отчета"
              onClick={() => setIsProOpen(true)}
            >
              <Crown size={18} />
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
                  trigger="text"
                />
                <button className="left-panel-action-button left-build-button" type="button" onClick={buildReport}>
                  <Play size={16} />
                  <span>{buttonLabels.build}</span>
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
                        {reportData.map((point, pointIndex) => {
                          const value = hasBuiltReport
                            ? getEmployeeMetricValue(
                                point.values[row.metric.id],
                                row.metric,
                                row.employeeIndex,
                                pointIndex,
                              )
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
          onSave={saveAppSettings}
          onClose={() => setIsAppSettingsOpen(false)}
          onOpenPro={() => setIsProOpen(true)}
        />
      )}

      {isProOpen && (
        <ProVersionModal onClose={() => setIsProOpen(false)} />
      )}

      {detailContext && (
        <DetailModal context={detailContext} onClose={() => setDetailContext(null)} />
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
