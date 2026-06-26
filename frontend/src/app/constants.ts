import { defaultDateRange, metricSections, type DateRange } from '../services/report/reportCatalog';

import type {
  AppSettings,
  ChartDisplayMode,
  ChartMetricMode,
  DetailColumnKey,
  ReportFilters,
  SavedReportViewOption,
  ScheduleFilters,
  SelectOption,
  SerializableReportFilters,
} from './types';

export const PERIOD_COLUMN_WIDTH = 96;
export const MIN_PERIOD_COLUMN_WIDTH = 36;
export const MAX_PERIOD_COLUMN_WIDTH = 136;
export const CHART_AXIS_WIDTH = 72;

export const MONTH_LABELS = [
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

export const LAST_AVAILABLE_MONTH_INDEX = 2026 * 12 + 5;

export const isProUser = false;

export const buttonLabels = {
  build: 'Построить отчет',
  download: 'Скачать Excel',
};

export const chartDisplayModeOptions: SelectOption<ChartDisplayMode>[] = [
  { value: 'sum', label: 'Суммировать показатели в один график' },
  { value: 'separate', label: 'Вывести в отдельные графики' },
];

export const chartMetricModeOptions: SelectOption<ChartMetricMode>[] = [
  { value: 'money', label: 'Кол-во денег' },
  { value: 'count', label: 'Кол-во элементов' },
];

export const scheduleTimeOptions = Array.from({ length: 24 }, (_item, hour) =>
  `${String(hour).padStart(2, '0')}:00`,
);

export const weekDayOptions = [
  { id: 0, label: 'Пн' },
  { id: 1, label: 'Вт' },
  { id: 2, label: 'Ср' },
  { id: 3, label: 'Чт' },
  { id: 4, label: 'Пт' },
  { id: 5, label: 'Сб' },
  { id: 6, label: 'Вс' },
];

export const chartSeriesColors = [
  '#2274ff',
  '#34a853',
  '#ff9f0a',
  '#af52de',
  '#ff375f',
  '#00a7c7',
  '#6e6e73',
];

export const defaultSchedule: ScheduleFilters = {
  workdayStart: '',
  workdayEnd: '',
  weekendDayIds: [],
  calendarWeekStart: 0,
};

export const detailColumns: Array<{
  key: DetailColumnKey;
  label: string;
  minWidth: number;
}> = [
  { key: 'rowNumber', label: '№', minWidth: 48 },
  { key: 'entityId', label: 'ID', minWidth: 78 },
  { key: 'title', label: 'Название', minWidth: 180 },
  { key: 'responsibleName', label: 'Ответственный', minWidth: 150 },
  { key: 'createdAt', label: 'Дата создания', minWidth: 132 },
];

export const defaultDetailColumnWidths: Record<DetailColumnKey, number> = {
  rowNumber: 56,
  entityId: 104,
  title: 240,
  responsibleName: 170,
  createdAt: 148,
};

export const DETAIL_COLUMN_STORAGE_KEY = 'sapp24-detail-column-widths-v2';
export const SAVED_VIEWS_STORAGE_KEY = 'sapp24-saved-report-views';
export const APP_SETTINGS_STORAGE_KEY = 'sapp24-app-settings';

export const defaultSavedView: SavedReportViewOption = {
  value: 'default',
  label: 'Общий отчет',
  isSystem: true,
};

export const defaultAppSettings: AppSettings = {
  reportBuilderUserIds: [],
  moneyViewerUserIds: [],
  viewSaverUserIds: [],
};

export const detailColumnMinWidths = detailColumns.reduce<Record<DetailColumnKey, number>>(
  (acc, column) => {
    acc[column.key] = column.minWidth;
    return acc;
  },
  {} as Record<DetailColumnKey, number>,
);

export const detailColumnMinWidthSum = detailColumns.reduce(
  (sum, column) => sum + column.minWidth,
  0,
);

export const createDefaultSchedule = (): ScheduleFilters => ({
  ...defaultSchedule,
  weekendDayIds: [...defaultSchedule.weekendDayIds],
});

/**
 * Источники по умолчанию, которые выбираются при первом запуске отчёта.
 *
 * Содержит только статические/виртуальные источники, которые есть на любом портале.
 * Конкретные deal и smart-process ID добавляются автоматически на бэкенде
 * через _default_portal_sources(), поэтому их не нужно указывать здесь.
 *
 * Это гарантирует, что при пустом selectedSources:
 * - На графике отображаются только основные источники (не все 60+)
 * - Основные метрики (сделки, звонки, задачи, email, производство) работают сразу
 */
export const DEFAULT_SOURCE_IDS: string[] = [
  'lead-default',
  'invoice-default',
  'telephony-default',
  'activity-default',
  'quote-default',
  'company-default',
  'contact-default',
  'task-default',
  'crm-form-default',
];

export const createDefaultFilters = (): ReportFilters => ({
  period: 'days',
  dateRange: defaultDateRange as DateRange,
  selectedSources: [],
  chartDisplayMode: 'sum',
  metricMode: 'money',
  schedule: createDefaultSchedule(),
  enabledSectionIds: new Set(metricSections.map((section) => section.id)),
});

export const serializeFilters = (filters: ReportFilters): SerializableReportFilters => ({
  ...filters,
  selectedSources: [...filters.selectedSources],
  schedule: {
    ...filters.schedule,
    weekendDayIds: [...filters.schedule.weekendDayIds],
  },
  enabledSectionIds: [...filters.enabledSectionIds],
});

export const deserializeFilters = (filters: SerializableReportFilters): ReportFilters => ({
  ...filters,
  selectedSources: [...filters.selectedSources],
  schedule: {
    ...filters.schedule,
    weekendDayIds: [...filters.schedule.weekendDayIds],
  },
  enabledSectionIds: new Set(filters.enabledSectionIds),
});
