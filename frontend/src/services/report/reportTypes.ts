import type { DateRange, MetricRow, MetricSection, Period, ReportPoint } from './reportCatalog';
import type { PortalEmployeeItem } from '../api/reportApiClient';

export type CrmSourceType =
  | 'lead'
  | 'deal'
  | 'smartProcess'
  | 'invoice'
  | 'telephony'
  | 'call'
  | 'activity'
  | 'quote'
  | 'company'
  | 'contact'
  | 'task'
  | 'crm_form'
  | 'other';

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
  selectedMetricIds?: string[];
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
  entityId?: string | number;
  periodKey?: string;
  employeeId?: string;
  employeeName?: string;
  metricId?: string;
  metricLabel?: string;
  metricType?: MetricRow['type'];
  value?: number;
  title: string;
  responsibleName?: string;
  createdAt?: string;
  entityType?: string;
};

export type EmployeeMetricPeriodValue = {
  key: string;
  label: string;
  tooltipLabel?: string;
  values: Record<string, number>;
};

export type EmployeeMetricItem = {
  id: string;
  userId?: number;
  name: string;
  avatarUrl?: string;
  value?: number;
  values?: Record<string, number>;
  valuesByPeriod?: Record<string, Record<string, number>>;
  periodValues?: EmployeeMetricPeriodValue[];
};

export type ReportPreviewPayload = {
  data: ReportPoint[];
  employees: EmployeeMetricItem[];
  details: MetricDetailItem[];
};

export type ReportDataSource = {
  loadCrmSources: () => Promise<CrmSource[]>;
  loadPeriods: () => Promise<Array<{ value: Period; label: string }>>;
  loadMetricSections: () => Promise<MetricSection[]>;
  loadMetrics: () => Promise<MetricRow[]>;
  loadReportData: (filters: ReportLoadFilters) => Promise<ReportPoint[]>;
  loadReportPreview: (filters: ReportLoadFilters) => Promise<ReportPreviewPayload>;
  loadMetricDetails: (request: MetricDetailsRequest) => Promise<MetricDetailItem[]>;
  loadEmployeesMetric: (request: EmployeeMetricRequest) => Promise<EmployeeMetricItem[]>;
  loadPortalEmployees: () => Promise<PortalEmployeeItem[]>;
  getInitialCrmSources: () => CrmSource[];
  getInitialReportData: (filters: ReportLoadFilters) => ReportPoint[];
};

