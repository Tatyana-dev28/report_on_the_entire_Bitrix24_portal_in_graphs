import { buildReportData } from '../../../frontend/src/mockData';
import {
  defaultDateRange,
  formatMetricValue,
  formatRangeLabel,
  metricSections,
  metrics,
  periodOptions,
  type DateRange,
  type MetricRow,
  type Period,
  type ReportPoint,
} from '../../../frontend/src/services/report/reportCatalog';

export type DashboardReportOption = {
  id: string;
  name: string;
  isDefault: boolean;
};

export type DashboardReportSummary = {
  reports: DashboardReportOption[];
  selectedReportId: string;
  period: Period;
  range: DateRange;
  reportData: ReportPoint[];
  mainMetric: MetricRow;
  tableMetrics: MetricRow[];
  formatValue: typeof formatMetricValue;
  rangeLabel: string;
  periodLabel: string;
};

const visibleMetricIds = [
  'deals_created',
  'deals_won',
  'deals_won_sum',
  'deals_conversion',
  'leads_created',
  'invoices_won_sum',
  'calls_total',
  'tasks_done',
];

export const buildDemoDashboardReport = (
  reports: DashboardReportOption[],
  selectedReportId: string | null,
): DashboardReportSummary => {
  const period: Period = 'weeks';
  const range: DateRange = defaultDateRange;
  const reportData = buildReportData(period, range, { calendarWeekStart: 0 });
  const mainMetric = metrics.find((metric) => metric.id === 'deals_won_sum') ?? metrics[0];
  const tableMetrics = visibleMetricIds
    .map((metricId) => metrics.find((metric) => metric.id === metricId))
    .filter((metric): metric is MetricRow => Boolean(metric));
  const safeReports =
    reports.length > 0
      ? reports
      : [
          { id: 'owner-summary', name: 'Сводка руководителя', isDefault: true },
          { id: 'sales-weekly', name: 'Продажи по неделям', isDefault: false },
          { id: 'activity-control', name: 'Контроль активности', isDefault: false },
        ];

  return {
    reports: safeReports,
    selectedReportId: selectedReportId ?? safeReports[0]?.id ?? 'owner-summary',
    period,
    range,
    reportData,
    mainMetric,
    tableMetrics,
    formatValue: formatMetricValue,
    rangeLabel: formatRangeLabel(period, range),
    periodLabel: periodOptions.find((option) => option.value === period)?.label ?? 'Группировка',
  };
};

export const getMetricSectionLabel = (metricId: string) =>
  metricSections.find((section) => section.metricIds.includes(metricId))?.label ?? 'Показатели';
