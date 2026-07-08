import type { CSSProperties, RefObject } from 'react';
import type { DateRange, MetricRow, Period, ReportPoint } from '../services/report/reportCatalog';
import type { EmployeeMetricItem, SourceMetricsMetric } from '../services/report/reportTypes';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  group?: string;
};

export type MockEmployee = {
  id: string;
  userId: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  values?: Record<string, number>;
};

export type ReportEmployee = MockEmployee & EmployeeMetricItem;

export type TableRow =
  | {
      kind: 'section';
      rowId: string;
      sectionId: string;
      label: string;
    }
  | {
      kind: 'metric';
      rowId: string;
      sectionId: string;
      metric: MetricRow;
    }
  | {
      kind: 'employee';
      rowId: string;
      sectionId: string;
      metric: MetricRow;
      employee: ReportEmployee;
      employeeIndex: number;
    }
  | {
      kind: 'chart';
      rowId: string;
      sectionId: string;
      metric: MetricRow;
    }
  | {
      kind: 'source_section';
      rowId: string;
      sourceId: string;
      label: string;
    }
  | {
      kind: 'source_metric';
      rowId: string;
      sourceId: string;
      metricKey: string;
      metricLabel: string;
      valueType: SourceMetricsMetric['valueType'];
    };

export type ThresholdValues = {
  upper: string;
  lower: string;
  mode?: 'manual' | 'recommended' | null;
};

export type RecommendedThresholdValues = {
  upper: string;
  average: string;
  lower: string;
};

export type ChartDisplayMode = 'sum' | 'separate';

export type ChartMetricMode = 'money' | 'count';

export type ScheduleFilters = {
  workdayStart: string;
  workdayEnd: string;
  weekendDayIds: number[];
  calendarWeekStart: number;
};

export type ReportFilters = {
  period: Period;
  dateRange: DateRange;
  selectedSources: string[];
  chartDisplayMode: ChartDisplayMode;
  metricMode: ChartMetricMode;
  schedule: ScheduleFilters;
  enabledSectionIds: Set<string>;
};

export type BitrixEntityType =
  | 'deal'
  | 'lead'
  | 'invoice'
  | 'quote'
  | 'company'
  | 'contact'
  | 'task'
  | 'activity'
  | 'call'
  | 'email'
  | 'message'
  | 'crm_form';

export type DetailContext = {
  metric: MetricRow;
  point: ReportPoint;
  value: number;
  entityType: BitrixEntityType;
  employee?: ReportEmployee;
  sourceId?: string;
  /** Real source IDs from reportDetails (e.g. ["deal-2-0"]) used for source_metric filtering */
  detailSourceIds?: string[];
  /** Metric IDs from reportDetails (e.g. ["deals_won"]) used for source_metric filtering */
  detailMetricIds?: string[];
};

export type DetailRow = {
  rowNumber: number;
  entityId: number;
  title: string;
  responsibleId: number;
  responsibleName: string;
  createdAt: string;
  createdAtSortValue: number;
  entityType: BitrixEntityType;
};

export type DetailColumnKey = 'rowNumber' | 'entityId' | 'title' | 'responsibleName' | 'createdAt';

export type DetailSort = {
  key: DetailColumnKey;
  direction: 'asc' | 'desc';
};

export type SerializableReportFilters = Omit<ReportFilters, 'enabledSectionIds'> & {
  enabledSectionIds: string[];
};

export type SavedReportViewState = {
  draftFilters: SerializableReportFilters;
  appliedFilters: SerializableReportFilters;
  enabledMetricIdsBySection: Record<string, string[]>;
  sectionOrder: string[];
  metricOrderBySection: Record<string, string[]>;
  expandedSections: string[];
  mainThreshold: ThresholdValues;
  rowThresholds: Record<string, ThresholdValues>;
};

export type SavedReportViewOption = SelectOption<string> & {
  isSystem?: boolean;
  state?: SavedReportViewState;
};

export type AppSettings = {
  reportBuilderUserIds: string[];
  moneyViewerUserIds: string[];
  viewSaverUserIds: string[];
};

export type ChartDraftSettings = {
  selectedSources: string[];
  chartDisplayMode: ChartDisplayMode;
  metricMode: ChartMetricMode;
  schedule: ScheduleFilters;
};

export type ChartDotPayloadProps = {
  cx?: number | string;
  cy?: number | string;
  stroke?: string;
  index?: number;
};

export type ActiveChartPoint = {
  index: number;
  x: number;
  y: number;
};

export type ChartTooltipItem = {
  label: string;
  value: string;
  color: string;
};

export type HoverChartDotProps = ChartDotPayloadProps & {
  radius?: number;
  onActivate: (point: ActiveChartPoint) => void;
  onDeactivate: () => void;
};

export type ChartTooltipStyleArgs = {
  point: ActiveChartPoint;
  container: HTMLElement | null;
};

export type ChartTooltipProps = {
  point: ActiveChartPoint;
  title: string;
  items: ChartTooltipItem[];
  thresholdItems: Array<{
    key: string;
    label: string;
    value: number;
    color: string;
  }>;
  containerRef: RefObject<HTMLDivElement | null>;
  valueFormatter: (value: number) => string;
};

export type StyleRecord = CSSProperties;