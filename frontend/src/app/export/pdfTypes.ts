import type { MetricRow, Period, ReportPoint, DateRange } from '../../services/report/reportCatalog';
import type { SourceMetricsData, ValueStateMap } from '../../services/report/reportTypes';
import type { TableRow, ThresholdValues } from '../types';

export type PdfPageFormat = 'a4' | 'a3';

export type PdfTableRow = {
  label: string;
  values: string[];
  kind: 'section' | 'metric' | 'employee';
};

export type PdfNativeTableRow = {
  kind: 'section' | 'metric' | 'employee';
  label: string;
  cells: string[];
};

export type PdfHtmlPageSpec = {
  kind: 'html';
  title: string;
  buildBody: () => string;
};

export type PdfTablePageSpec = {
  kind: 'table';
  title: string;
  headers: string[];
  rows: PdfNativeTableRow[];
};

export type PdfPageSpec = PdfHtmlPageSpec | PdfTablePageSpec;

export type ExportReportPdfInput = {
  hasBuiltReport: boolean;
  reportData: ReportPoint[];
  tableRows: TableRow[];
  chartData: Array<{ indicator?: number | string }>;
  appliedFilters: {
    period: Period;
    dateRange: DateRange;
    metricMode: 'money' | 'number' | string;
  };
  mainThreshold: ThresholdValues;
  sourceMetrics: Record<string, SourceMetricsData>;
  valueStates: ValueStateMap;
  currentViewLabel: string;
  portalLabel: string;
  periodOptionLabel: string;
  periodLabel: string;
  /** F-17: export notes compact vs with_charts table display. */
  tableRowChartsMode?: 'compact' | 'with_charts';
  /** Chart sources caption (same meaning as on-screen main indicator title). */
  mainChartSourcesLabel?: string;
};

export type ExportReportPdfOptions = {
  onProgress?: (current: number, total: number) => void;
};

export type PdfMetricType = MetricRow['type'];

export type PdfPageChrome = {
  title: string;
  portalLabel: string;
  periodOptionLabel: string;
  periodLabel: string;
  tableDisplayLabel?: string;
  generatedAt: string;
  currentViewLabel: string;
  pageNumber: number;
  pageCount: number;
};
