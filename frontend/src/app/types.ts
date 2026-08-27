import type { CSSProperties, RefObject } from 'react';
import type { DateRange, MetricRow, Period, ReportPoint } from '../services/report/reportCatalog';
import type { EmployeeMetricItem, SourceMetricsMetric } from '../services/report/reportTypes';
import type { MetricDirection } from './config/metricDirections';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  group?: string;
  disabled?: boolean;
  hint?: string;
};

export type MockEmployee = {
  id: string;
  userId: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  values?: Record<string, number>;
  isActive?: boolean;
  isRobot?: boolean;
  isTechnical?: boolean;
  workPosition?: string | null;
  department?: string | null;
  /** Bitrix UF_DEPARTMENT ids; used for department browse mode. */
  departmentIds?: string[];
  departments?: Array<{ id: string; name: string }>;
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
      /** Funnel/smart source block id when this employee row belongs to a source_metric. */
      sourceId?: string;
      detailSourceIds?: string[];
      detailMetricIds?: string[];
      /** Synthetic residual / unassigned rows are not removable via checkbox. */
      isSystemDetail?: boolean;
    }
  | {
      kind: 'employee_sum_hint';
      rowId: string;
      sectionId: string;
      metric: MetricRow;
      message: string;
      sourceId?: string;
    }
  | {
      kind: 'chart';
      rowId: string;
      sectionId: string;
      metric: MetricRow;
      /** Funnel/smart source block id when this chart row belongs to a source_metric. */
      sourceId?: string;
      /** Period values for source_metric charts (CRM charts use point.values[metric.id]). */
      valuesByPeriod?: Record<string, number>;
    }
  | {
      kind: 'employee_chart';
      rowId: string;
      sectionId: string;
      metric: MetricRow;
      employee: ReportEmployee;
      /** Funnel/smart source block id when this employee chart belongs to a source_metric. */
      sourceId?: string;
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
  /**
   * Formula average from system calculation (recommended mode).
   * Manual mode usually omits this; UI then shows the midpoint of upper/lower.
   */
  average?: string;
  mode?: 'manual' | 'recommended' | null;
};

export type RecommendedThresholdValues = {
  upper: string;
  average: string;
  lower: string;
};

export type ChartDisplayMode = 'sum' | 'separate';

/** F-17: table row charts — compact (numbers only) vs charts under selected rows. */
export type TableRowChartsMode = 'compact' | 'with_charts';

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
  entityRawId?: string | number;
  title: string;
  linkedElementTitle: string;
  linkedElementId?: string | number;
  linkedElementType?: BitrixEntityType;
  responsibleId: number;
  responsibleName: string;
  createdAt: string;
  createdAtSortValue: number;
  entityType: BitrixEntityType;
  sourceId?: string;
  navigationEntityId?: string | number;
  navigationEntityType?: BitrixEntityType;
  navigationEntityTypeId?: string | number;
  /** Set when the entity cannot be opened in Bitrix24 after the report was built. */
  availability?: 'ok' | 'unavailable' | 'access_denied';
};

export type DetailColumnKey =
  | 'rowNumber'
  | 'entityId'
  | 'title'
  | 'linkedElementTitle'
  | 'responsibleName'
  | 'createdAt';

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
  tableSelectedSources?: string[];
  enabledMetricIdsBySection: Record<string, string[]>;
  sectionOrder: string[];
  metricOrderBySection: Record<string, string[]>;
  /** Display order of funnel/smart source_section blocks (sourceMetrics keys). */
  sourceSectionOrder?: string[];
  /** Display order of source_metric keys within each source block. */
  sourceMetricOrderBySource?: Record<string, string[]>;
  /** Enabled source_metric keys per source block (draft/applied saved as arrays). */
  enabledMetricKeysBySource?: Record<string, string[]>;
  expandedSections: string[];
  mainThreshold: ThresholdValues;
  rowThresholds: Record<string, ThresholdValues>;
  employeeThresholdsByMetricId?: Record<string, ThresholdValues>;
  /** F-09: user overrides for metric evaluation direction by metric/action id. */
  metricDirectionsById?: Record<string, MetricDirection>;
  /** Applied employee selection per metric/action id. */
  appliedEmployeeIdsByMetricId?: Record<string, string[]>;
  /** Draft employee selection per metric/action id. */
  draftEmployeeIdsByMetricId?: Record<string, string[]>;
  /** Display order of employees within a metric/action. */
  employeeOrderByMetricId?: Record<string, string[]>;
  expandedEmployeeMetricIds?: string[];
  expandedChartMetricIds?: string[];
  expandedEmployeeChartIds?: string[];
  /** F-17: compact table vs row charts under selected metrics/employees. */
  tableRowChartsMode?: TableRowChartsMode;
  /** Hide metrics/employees where every period is 0 or «—». */
  hideZeroRows?: boolean;
  /** WEB-SET-001: corridor highlight for table build. */
  highlightDeviations?: boolean;
  /** WEB-SET-001 paid custom main indicator title. */
  mainIndicatorCustomTitle?: string;
};

export type SavedReportViewOption = SelectOption<string> & {
  isSystem?: boolean;
  state?: SavedReportViewState;
};

export type AppSettings = {
  reportBuilderUserIds: string[];
  moneyViewerUserIds: string[];
  viewSaverUserIds: string[];
  dashboardRefreshIntervalMinutes: 10 | 30 | 60 | null;
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
