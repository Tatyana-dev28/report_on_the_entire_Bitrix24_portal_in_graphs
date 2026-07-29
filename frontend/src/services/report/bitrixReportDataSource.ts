import { loadPortalEmployees, loadReportCatalog, loadReportPreview } from '../api/reportApiClient';
import type { PortalEmployeeItem } from '../api/reportApiClient';
import { periodOptions, type ReportPoint } from './reportCatalog';
import type {
  CrmSource,
  EmployeeMetricItem,
  EmployeeMetricRequest,
  MetricDetailsRequest,
  MetricDetailItem,
  ReportDataSource,
  ReportLoadFilters,
  ReportPreviewPayload,
} from './reportTypes';

const initialCrmSources: CrmSource[] = [];

let latestPreview: ReportPreviewPayload = {
  data: [],
  employees: [],
  details: [],
  sourceMetrics: {},
};

export const bitrixReportDataSource: ReportDataSource = {
  async loadCrmSources() {
    const catalog = await loadReportCatalog();

    return catalog.sources;
  },

  async loadPeriods() {
    const catalog = await loadReportCatalog();
    const labelByPeriod = new Map(periodOptions.map((option) => [option.value, option.label]));

    return catalog.periods.map((option) => ({
      ...option,
      label: labelByPeriod.get(option.value) ?? option.label,
    }));
  },

  async loadMetricSections() {
    const catalog = await loadReportCatalog();

    return catalog.metricSections;
  },

  async loadMetrics() {
    const catalog = await loadReportCatalog();

    return catalog.metrics;
  },

  async loadReportData(filters: ReportLoadFilters): Promise<ReportPoint[]> {
    const preview = await loadReportPreview(filters);

    return preview.data;
  },

  async loadReportPreview(filters: ReportLoadFilters) {
    const preview = await loadReportPreview(filters);

    latestPreview = {
      data: preview.data,
      chartData: preview.chart_data ?? preview.data,
      employees: preview.employees ?? [],
      details: preview.details ?? [],
      sourceMetrics: preview.source_metrics ?? {},
      chartSourceMetrics: preview.chart_source_metrics ?? preview.source_metrics ?? {},
    };

    return latestPreview;
  },

  async loadMetricDetails(request: MetricDetailsRequest): Promise<MetricDetailItem[]> {
    return latestPreview.details.filter((detail) => {
      if (detail.metricId && detail.metricId !== request.metricId) {
        return false;
      }

      if (detail.periodKey && detail.periodKey !== request.period.key) {
        return false;
      }

      return true;
    });
  },

  async loadEmployeesMetric(request: EmployeeMetricRequest): Promise<EmployeeMetricItem[]> {
    return latestPreview.employees
      .map((employee) => {
        const value =
          employee.valuesByPeriod?.[request.period.key]?.[request.metricId] ??
          employee.values?.[request.metricId] ??
          0;

        return {
          ...employee,
          value,
        };
      })
      .filter((employee) => (employee.value ?? 0) !== 0);
  },

  getInitialCrmSources() {
    return initialCrmSources;
  },

  async loadPortalEmployees(): Promise<PortalEmployeeItem[]> {
    return loadPortalEmployees();
  },

  getInitialReportData(_filters: ReportLoadFilters): ReportPoint[] {
    return [];
  },
};
