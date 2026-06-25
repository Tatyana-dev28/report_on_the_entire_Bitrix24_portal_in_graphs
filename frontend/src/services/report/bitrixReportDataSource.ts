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
    id: 'calls-default',
    type: 'call',
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

    return {
      data: preview.data,
      employees: preview.employees ?? [],
      details: preview.details ?? [],
    };
  },

  async loadMetricDetails(_request: MetricDetailsRequest): Promise<MetricDetailItem[]> {
    // Детализация будет подключена после появления backend report session/details API.
    return [];
  },

  async loadEmployeesMetric(_request: EmployeeMetricRequest): Promise<EmployeeMetricItem[]> {
    // Разбивка по сотрудникам будет подключена после появления backend report session/employees API.
    return [];
  },

  getInitialCrmSources() {
    return initialCrmSources;
  },

  getInitialReportData(_filters: ReportLoadFilters): ReportPoint[] {
    return [];
  },
};
