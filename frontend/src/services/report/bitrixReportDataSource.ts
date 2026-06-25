import { loadReportCatalog, loadReportPreview } from '../api/reportApiClient';
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

const initialCrmSources: CrmSource[] = [
  {
    id: 'lead-default',
    type: 'lead',
    entityTypeId: 1,
    categoryId: null,
    title: 'Воронка лидов',
    sourceLabel: 'Лиды',
    isAvailable: true,
  },
  {
    id: 'deal-sales',
    type: 'deal',
    entityTypeId: 2,
    categoryId: 0,
    title: 'Продажи',
    sourceLabel: 'Продажи',
    isAvailable: true,
  },
  {
    id: 'activity-default',
    type: 'activity',
    entityTypeId: 0,
    categoryId: null,
    title: 'CRM-активности',
    sourceLabel: 'Активности',
    isAvailable: true,
  },
  {
    id: 'telephony-default',
    type: 'telephony',
    entityTypeId: 0,
    categoryId: null,
    title: 'Телефония',
    sourceLabel: 'Телефония',
    isAvailable: true,
  },
  {
    id: 'quote-default',
    type: 'quote',
    entityTypeId: 7,
    categoryId: null,
    title: 'Коммерческие предложения',
    sourceLabel: 'Коммерческие предложения',
    isAvailable: true,
  },
  {
    id: 'invoice-default',
    type: 'invoice',
    entityTypeId: 31,
    categoryId: null,
    title: 'Счета',
    sourceLabel: 'Счета',
    isAvailable: true,
  },
  {
    id: 'company-default',
    type: 'company',
    entityTypeId: 4,
    categoryId: null,
    title: 'Компании',
    sourceLabel: 'Компании',
    isAvailable: true,
  },
  {
    id: 'contact-default',
    type: 'contact',
    entityTypeId: 3,
    categoryId: null,
    title: 'Контакты',
    sourceLabel: 'Контакты',
    isAvailable: true,
  },
  {
    id: 'task-default',
    type: 'task',
    entityTypeId: 0,
    categoryId: null,
    title: 'Задачи',
    sourceLabel: 'Задачи',
    isAvailable: true,
  },
  {
    id: 'crm-form-default',
    type: 'crm_form',
    entityTypeId: 0,
    categoryId: null,
    title: 'CRM формы',
    sourceLabel: 'CRM формы',
    isAvailable: true,
  },
];

let latestPreview: ReportPreviewPayload = {
  data: [],
  employees: [],
  details: [],
};

export const bitrixReportDataSource: ReportDataSource = {
  async loadCrmSources() {
    const catalog = await loadReportCatalog();

    return catalog.sources;
  },

  async loadPeriods() {
    const catalog = await loadReportCatalog();

    return catalog.periods;
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
      employees: preview.employees ?? [],
      details: preview.details ?? [],
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

  getInitialReportData(_filters: ReportLoadFilters): ReportPoint[] {
    return [];
  },
};
