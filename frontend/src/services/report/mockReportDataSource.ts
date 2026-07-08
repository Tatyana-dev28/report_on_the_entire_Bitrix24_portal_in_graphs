import { buildReportData } from '../../mockData';
import {
  metricSections,
  metrics,
  periodOptions,
  type ReportPoint,
} from './reportCatalog';
import type { PortalEmployeeItem } from '../api/reportApiClient';
import type {
  CrmSource,
  EmployeeMetricItem,
  MetricDetailsRequest,
  MetricDetailItem,
  ReportDataSource,
  ReportLoadFilters,
} from './reportTypes';

const mockCrmSources: CrmSource[] = [];

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

  async loadPortalEmployees(): Promise<PortalEmployeeItem[]> {
    return [];
  },

  getInitialCrmSources() {
    return mockCrmSources;
  },

  getInitialReportData(filters: ReportLoadFilters): ReportPoint[] {
    return buildReportData(filters.period, filters.dateRange);
  },
};
