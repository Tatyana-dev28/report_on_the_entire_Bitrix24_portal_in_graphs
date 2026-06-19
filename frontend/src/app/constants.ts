import { defaultDateRange, metricSections, type DateRange } from '../services/report/reportCatalog';
import type {
  AppSettings,
  ChartDisplayMode,
  ChartMetricMode,
  DetailColumnKey,
  MockEmployee,
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
  'РЇРЅРІР°СЂСЊ',
  'Р¤РµРІСЂР°Р»СЊ',
  'РњР°СЂС‚',
  'РђРїСЂРµР»СЊ',
  'РњР°Р№',
  'РСЋРЅСЊ',
  'РСЋР»СЊ',
  'РђРІРіСѓСЃС‚',
  'РЎРµРЅС‚СЏР±СЂСЊ',
  'РћРєС‚СЏР±СЂСЊ',
  'РќРѕСЏР±СЂСЊ',
  'Р”РµРєР°Р±СЂСЊ',
];

export const mockEmployees: MockEmployee[] = [
  { id: 'employee-1', userId: 104, firstName: 'РђРЅРЅР°', lastName: 'РЎРѕРєРѕР»РѕРІР°' },
  { id: 'employee-2', userId: 117, firstName: 'РР»СЊСЏ', lastName: 'РњРѕСЂРѕР·РѕРІ' },
  { id: 'employee-3', userId: 126, firstName: 'РњР°СЂРёСЏ', lastName: 'РћСЂР»РѕРІР°' },
];

export const LAST_AVAILABLE_MONTH_INDEX = 2026 * 12 + 5;
export const isProUser = false;
export const buttonLabels = {
  build: 'РџРѕСЃС‚СЂРѕРёС‚СЊ РѕС‚С‡РµС‚',
  download: 'РЎРєР°С‡Р°С‚СЊ Excel',
};

export const chartDisplayModeOptions: SelectOption<ChartDisplayMode>[] = [
  { value: 'sum', label: 'РЎСѓРјРјРёСЂРѕРІР°С‚СЊ РїРѕРєР°Р·Р°С‚РµР»Рё РІ РѕРґРёРЅ РіСЂР°С„РёРє' },
  { value: 'separate', label: 'Р’С‹РІРµСЃС‚Рё РІ РѕС‚РґРµР»СЊРЅС‹Рµ РіСЂР°С„РёРєРё' },
];

export const chartMetricModeOptions: SelectOption<ChartMetricMode>[] = [
  { value: 'money', label: 'РљРѕР»-РІРѕ РґРµРЅРµРі' },
  { value: 'count', label: 'РљРѕР»-РІРѕ СЌР»РµРјРµРЅС‚РѕРІ' },
];

export const scheduleTimeOptions = Array.from({ length: 24 }, (_item, hour) =>
  `${String(hour).padStart(2, '0')}:00`,
);

export const weekDayOptions = [
  { id: 0, label: 'РџРЅ' },
  { id: 1, label: 'Р’С‚' },
  { id: 2, label: 'РЎСЂ' },
  { id: 3, label: 'Р§С‚' },
  { id: 4, label: 'РџС‚' },
  { id: 5, label: 'РЎР±' },
  { id: 6, label: 'Р’СЃ' },
];

export const chartSeriesColors = ['#2274ff', '#34a853', '#ff9f0a', '#af52de', '#ff375f', '#00a7c7', '#6e6e73'];

export const defaultSchedule: ScheduleFilters = {
  workdayStart: '',
  workdayEnd: '',
  weekendDayIds: [],
  calendarWeekStart: 0,
};

export const detailColumns: Array<{ key: DetailColumnKey; label: string; minWidth: number }> = [
  { key: 'rowNumber', label: 'в„–', minWidth: 60 },
  { key: 'entityId', label: 'ID', minWidth: 90 },
  { key: 'title', label: 'РќР°Р·РІР°РЅРёРµ', minWidth: 220 },
  { key: 'responsibleName', label: 'РћС‚РІРµС‚СЃС‚РІРµРЅРЅС‹Р№', minWidth: 180 },
  { key: 'createdAt', label: 'Р”Р°С‚Р° СЃРѕР·РґР°РЅРёСЏ', minWidth: 160 },
];

export const defaultDetailColumnWidths: Record<DetailColumnKey, number> = {
  rowNumber: 72,
  entityId: 130,
  title: 320,
  responsibleName: 210,
  createdAt: 190,
};

export const DETAIL_COLUMN_STORAGE_KEY = 'sapp24-detail-column-widths';
export const SAVED_VIEWS_STORAGE_KEY = 'sapp24-saved-report-views';
export const APP_SETTINGS_STORAGE_KEY = 'sapp24-app-settings';

export const defaultSavedView: SavedReportViewOption = {
  value: 'default',
  label: 'РћР±С‰РёР№ РѕС‚С‡РµС‚',
  isSystem: true,
};

export const defaultAppSettings: AppSettings = {
  reportBuilderUserIds: [],
  moneyViewerUserIds: [],
  viewSaverUserIds: [],
};

export const detailColumnMinWidths = detailColumns.reduce<Record<DetailColumnKey, number>>((acc, column) => {
  acc[column.key] = column.minWidth;
  return acc;
}, {} as Record<DetailColumnKey, number>);

export const detailColumnMinWidthSum = detailColumns.reduce((sum, column) => sum + column.minWidth, 0);

export const createDefaultSchedule = (): ScheduleFilters => ({
  ...defaultSchedule,
  weekendDayIds: [...defaultSchedule.weekendDayIds],
});

export const createDefaultFilters = (): ReportFilters => ({
  period: 'days',
  dateRange: defaultDateRange,
  selectedSources: ['Р’РѕСЂРѕРЅРєР° РїСЂРѕРґР°Р¶Рё'],
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


