import { buildReportData } from '../../mockData';
import {
  metricSections,
  metrics,
  periodOptions,
  type ReportPoint,
} from './reportCatalog';
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
    categoryId: null,
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
    id: 'smart-production',
    type: 'smartProcess',
    entityTypeId: 128,
    categoryId: 0,
    title: 'Воронка производство',
    sourceLabel: 'Воронка производство',
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

  async loadReportData(filters: ReportLoadFilters): Promise<ReportPoint[]> {
    return buildReportData(filters.period, filters.dateRange);
  },

  async loadReportPreview(filters: ReportLoadFilters) {
    return {
      data: buildReportData(filters.period, filters.dateRange),
      employees: [],
      details: [],
    };
  },

  async loadMetricDetails(_request: MetricDetailsRequest): Promise<MetricDetailItem[]> {
    return [];
  },

  async loadEmployeesMetric(_request: MetricDetailsRequest): Promise<EmployeeMetricItem[]> {
    return [];
  },

  getInitialCrmSources() {
    return mockCrmSources;
  },

  getInitialReportData(filters: ReportLoadFilters): ReportPoint[] {
    return buildReportData(filters.period, filters.dateRange);
  },
};
