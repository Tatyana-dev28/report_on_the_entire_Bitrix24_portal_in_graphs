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
  | 'email'
  | 'message'
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
  unavailableReason?: string | null;
};

export type ReportLoadFilters = {
  period: Period;
  dateRange: DateRange;
  selectedSources: string[];
  chartSelectedSources?: string[];
  selectedMetricIds?: string[];
  metricMode?: 'money' | 'count';
  chartDisplayMode?: 'sum' | 'separate';
  schedule?: {
    workdayStart?: string;
    workdayEnd?: string;
    weekendDayIds?: number[];
    calendarWeekStart?: number;
  };
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
  sourceId?: string;
  navigationEntityId?: string | number;
  navigationEntityType?: string;
  navigationEntityTypeId?: string | number;
};

export type EmployeeMetricPeriodValue = {
  key: string;
  label: string;
  tooltipLabel?: string;
  values: Record<string, number>;
};

export type ValueStateReason = 'no_data' | 'load_error' | 'access_denied' | 'not_applicable';

export type ValueState = {
  reason: ValueStateReason;
  message?: string;
};

export type ValueStateMap = Record<string, Record<string, ValueState>>;

export type EmployeeMetricItem = {
  id: string;
  userId?: number;
  name: string;
  avatarUrl?: string;
  value?: number;
  values?: Record<string, number>;
  valuesByPeriod?: Record<string, Record<string, number>>;
  periodValues?: EmployeeMetricPeriodValue[];
  isActive?: boolean;
  isRobot?: boolean;
  isTechnical?: boolean;
  workPosition?: string | null;
  department?: string | null;
};

export type ReportPreviewPayload = {
  data: ReportPoint[];
  chartData?: ReportPoint[];
  employees: EmployeeMetricItem[];
  details: MetricDetailItem[];
  sourceMetrics?: Record<string, SourceMetricsData>;
  chartSourceMetrics?: Record<string, SourceMetricsData>;
  valueStates?: ValueStateMap;
};

/** A single metric inside a source (deal pipeline or smart process) */
export type SourceMetricsMetric = {
  label: string;
  valueType: 'count' | 'money' | 'percent';
  valuesByPeriod: Record<string, number>;
  /** Metric IDs from reportDetails that correspond to this source metric (e.g. ["deals_won"]) */
  detailMetricIds?: string[];
};

/** Metrics for one source (deal pipeline or smart process) */
export type SourceMetricsData = {
  id: string;
  label: string;
  entityTypeId: number;
  categoryId: number | null;
  type: string;
  sourceId: string;
  /** Real source IDs from reportDetails (e.g. ["deal-2-0"]) used for detail filtering */
  detailSourceIds?: string[];
  metrics: Record<string, SourceMetricsMetric>;
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
