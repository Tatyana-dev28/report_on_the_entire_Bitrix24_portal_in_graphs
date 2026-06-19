import type { DateRange, MetricRow, MetricSection, Period, ReportPoint } from './reportCatalog';

export type CrmSourceType = 'lead' | 'deal' | 'smartProcess' | 'invoice';

export type CrmSource = {
  id: string;
  type: CrmSourceType;
  entityTypeId?: number;
  categoryId?: number | null;
  title: string;
  sourceLabel: string;
  isAvailable: boolean;
};

export type ReportLoadFilters = {
  period: Period;
  dateRange: DateRange;
  selectedSources: string[];
  metricMode?: 'money' | 'count';
  chartDisplayMode?: 'sum' | 'separate';
};

export type MetricDetailsRequest = {
  metricId: string;
  period: ReportPoint;
};

export type EmployeeMetricRequest = {
  metricId: string;
  period: ReportPoint;
};

export type MetricDetailItem = {
  id: string | number;
  title: string;
  responsibleName?: string;
  createdAt?: string;
  entityType?: string;
};

export type EmployeeMetricItem = {
  id: string;
  userId: number;
  name: string;
  avatarUrl?: string;
  value: number;
};

export type ReportDataSource = {
  loadCrmSources: () => Promise<CrmSource[]>;
  loadPeriods: () => Promise<Array<{ value: Period; label: string }>>;
  loadMetricSections: () => Promise<MetricSection[]>;
  loadMetrics: () => Promise<MetricRow[]>;
  loadReportData: (filters: ReportLoadFilters) => Promise<ReportPoint[]>;
  loadMetricDetails: (request: MetricDetailsRequest) => Promise<MetricDetailItem[]>;
  loadEmployeesMetric: (request: EmployeeMetricRequest) => Promise<EmployeeMetricItem[]>;
  getInitialCrmSources: () => CrmSource[];
  getInitialReportData: (filters: ReportLoadFilters) => ReportPoint[];
};

