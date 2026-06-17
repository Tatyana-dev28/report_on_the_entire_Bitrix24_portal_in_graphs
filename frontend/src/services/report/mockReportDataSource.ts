import {
  buildReportData,
  metricSections,
  metrics,
  periodOptions,
  type ReportPoint,
} from '../../mockData';
import type {
  CrmSource,
  EmployeeMetricItem,
  MetricDetailsRequest,
  MetricDetailItem,
  ReportDataSource,
  ReportLoadFilters,
} from './reportTypes';

const mockCrmSources: CrmSource[] = [
  {
    id: 'lead-default',
    type: 'lead',
    entityTypeId: 1,
    title: 'Воронка лидов',
    sourceLabel: 'Воронка лидов',
    isAvailable: true,
  },
  {
    id: 'deal-sales',
    type: 'deal',
    entityTypeId: 2,
    categoryId: 0,
    title: 'Воронка продажи',
    sourceLabel: 'Воронка продажи',
    isAvailable: true,
  },
  {
    id: 'deal-production',
    type: 'deal',
    entityTypeId: 2,
    categoryId: 1,
    title: 'Воронка производство',
    sourceLabel: 'Воронка производство',
    isAvailable: true,
  },
  {
    id: 'invoice-default',
    type: 'invoice',
    entityTypeId: 31,
    title: 'Счета',
    sourceLabel: 'Счета',
    isAvailable: true,
  },
  {
    id: 'smart-requests',
    type: 'smartProcess',
    entityTypeId: 180,
    categoryId: 0,
    title: 'Смарт-процесс заявки',
    sourceLabel: 'Смарт-процесс заявки',
    isAvailable: true,
  },
  {
    id: 'smart-production',
    type: 'smartProcess',
    entityTypeId: 181,
    categoryId: 0,
    title: 'Смарт-процесс производство',
    sourceLabel: 'Смарт-процесс производство',
    isAvailable: true,
  },
  {
    id: 'smart-delivery',
    type: 'smartProcess',
    entityTypeId: 182,
    categoryId: 0,
    title: 'Смарт-процесс доставка',
    sourceLabel: 'Смарт-процесс доставка',
    isAvailable: true,
  },
];

export const mockReportDataSource: ReportDataSource = {
  async loadCrmSources() {
    return mockCrmSources;
  },

  async loadPeriods() {
    return periodOptions;
  },

  async loadMetricSections() {
    return metricSections;
  },

  async loadMetrics() {
    return metrics;
  },

  async loadReportData(filters: ReportLoadFilters) {
    return buildReportData(filters.period, filters.dateRange);
  },

  async loadMetricDetails(_request: MetricDetailsRequest): Promise<MetricDetailItem[]> {
    // Здесь позже будет детализация сущностей Битрикс24 по выбранному показателю и периоду.
    return [];
  },

  async loadEmployeesMetric(_request: MetricDetailsRequest): Promise<EmployeeMetricItem[]> {
    // Здесь позже будет загрузка сотрудников, значений по ним и аватарок.
    return [];
  },

  getInitialCrmSources() {
    return mockCrmSources;
  },

  getInitialReportData(filters: ReportLoadFilters): ReportPoint[] {
    return buildReportData(filters.period, filters.dateRange);
  },
};
