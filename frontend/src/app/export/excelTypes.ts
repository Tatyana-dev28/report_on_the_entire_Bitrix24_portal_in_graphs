import type { DateRange, MetricRow, Period, ReportPoint } from '../../services/report/reportCatalog';
import type { CrmSource, MetricDetailItem, SourceMetricsData, ValueStateMap } from '../../services/report/reportTypes';
import type { MetricDirection } from '../config/metricDirections';
import type { TableRow, ThresholdValues } from '../types';

export type ExportReportExcelInput = {
  hasBuiltReport: boolean;
  reportData: ReportPoint[];
  chartData: Array<{ key?: string; label?: string; indicator?: number | string }>;
  tableRows: TableRow[];
  reportDetails: MetricDetailItem[];
  sourceMetrics: Record<string, SourceMetricsData>;
  valueStates: ValueStateMap;
  appliedFilters: {
    period: Period;
    dateRange: DateRange;
    metricMode: string;
    chartDisplayMode?: string;
    selectedSources?: string[];
    enabledSectionIds?: Set<string>;
    schedule?: {
      workdayStart?: string;
      workdayEnd?: string;
      weekendDayIds?: number[];
      calendarWeekStart?: number;
    };
  };
  mainThreshold: ThresholdValues;
  rowThresholds: Record<string, ThresholdValues>;
  employeeThresholdsByMetricId?: Record<string, ThresholdValues>;
  metricDirectionsById: Record<string, MetricDirection>;
  crmSources: CrmSource[];
  tableSelectedSources: string[];
  tableEntitySourceIds: string[];
  currentViewLabel: string;
  portalLabel: string;
  periodOptionLabel: string;
  periodLabel: string;
  tableRowChartsMode: 'compact' | 'with_charts';
  generatedAt?: Date;
};

export type ExcelMetricType = MetricRow['type'];
