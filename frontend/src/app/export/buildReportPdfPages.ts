import { formatMetricValue } from '../../services/report/reportCatalog';
import type { MetricRow } from '../../services/report/reportCatalog';
import { resolveDisplayedThresholdAverage } from '../utils/thresholds';
import { getEmployeeFullName } from '../utils/employees';
import {
  buildSourceMetricActionIds,
  chunk,
  escapeHtml,
  getEmployeePeriodMetricValue,
  getValueCellDisplayLabel,
  readValuesByPeriod,
} from './pdfHelpers';
import type {
  ExportReportPdfInput,
  PdfPageFormat,
  PdfPageSpec,
  PdfTableRow,
} from './pdfTypes';

export type BuiltReportPdfPages = {
  format: PdfPageFormat;
  pageWidth: number;
  pageHeight: number;
  pagePadding: number;
  pages: PdfPageSpec[];
  currentViewLabel: string;
  portalLabel: string;
  periodOptionLabel: string;
  periodLabel: string;
  tableDisplayLabel: string;
  generatedAt: string;
};

/** F-21: A4 for daily reports; A3 for hourly with employees (or dense hourly). */
const resolvePageFormat = (
  period: ExportReportPdfInput['appliedFilters']['period'],
  periodCount: number,
  hasEmployees: boolean,
  rowCount: number,
): PdfPageFormat => {
  // Daily (and coarser) → A4 landscape. Hourly with employees → A3 landscape.
  if (period === 'hours' && hasEmployees) {
    return 'a3';
  }

  if (period === 'hours' && (periodCount > 12 || rowCount > 28)) {
    return 'a3';
  }

  return 'a4';
};

const resolveMaxPeriodColumns = (format: PdfPageFormat, period: string) => {
  if (format === 'a3') {
    return period === 'hours' ? 14 : 12;
  }

  return period === 'hours' ? 10 : 8;
};

const resolveMaxRowsPerTablePage = (format: PdfPageFormat) => {
  // Keep row height readable at 100% zoom: do not pack more rows than fit at MIN height.
  // Content ≈ pageHeight − margins/chrome/footer; use conservative caps.
  return format === 'a3' ? 22 : 16;
};

export const getPdfPageStyles = (
  format: PdfPageFormat,
  pageWidth: number,
  pageHeight: number,
  pagePadding: number,
) => `
  html, body { margin: 0; padding: 0; background: #ffffff !important; }
  .pdf-page {
    width: ${pageWidth}px;
    height: ${pageHeight}px;
    padding: ${pagePadding}px;
    box-sizing: border-box;
    background: #ffffff !important;
    color: #202938;
    font-family: Arial, Helvetica, sans-serif;
    overflow: hidden;
  }
  .pdf-header {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    border-bottom: 1px solid #dfe7f1;
    padding-bottom: 12px;
    margin-bottom: 14px;
    background: #ffffff;
  }
  .pdf-title { font-size: ${format === 'a3' ? 28 : 24}px; font-weight: 700; line-height: 1.15; color: #202938; }
  .pdf-meta { margin-top: 6px; color: #5f6b7a; font-size: 13px; }
  .pdf-meta div + div { margin-top: 3px; }
  .pdf-generated { color: #5f6b7a; font-size: 12px; text-align: right; white-space: nowrap; background: #ffffff; }
  .pdf-content {
    height: ${pageHeight - pagePadding * 2 - 86}px;
    overflow: hidden;
    background: #ffffff;
  }
  .pdf-block { break-inside: avoid; page-break-inside: avoid; background: #ffffff; }
  .pdf-section-title { margin: 14px 0 8px; font-size: ${format === 'a3' ? 18 : 16}px; font-weight: 700; color: #202938; }
  .pdf-section-title:first-child { margin-top: 0; }
  .pdf-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .pdf-card {
    border: 1px solid #dfe7f1;
    border-radius: 10px;
    padding: 10px 12px;
    background: #fbfdff !important;
  }
  .pdf-card-label { color: #6a7482; font-size: 12px; margin-bottom: 6px; }
  .pdf-card-value { font-size: 16px; font-weight: 700; color: #202938; }
  .pdf-chart-wrap {
    background: #ffffff !important;
    border: 1px solid #dfe7f1;
    border-radius: 12px;
    padding: 8px;
    overflow: hidden;
  }
  .pdf-chart-wrap svg { display: block; background: #ffffff !important; }
  .pdf-footer {
    margin-top: 10px;
    border-top: 1px solid #dfe7f1;
    padding-top: 8px;
    color: #6a7482;
    font-size: 12px;
    display: flex;
    justify-content: space-between;
    background: #ffffff;
  }
`;

export const buildReportPdfPages = (input: ExportReportPdfInput): BuiltReportPdfPages => {
  const {
    hasBuiltReport,
    reportData,
    tableRows,
    chartData,
    appliedFilters,
    mainThreshold,
    sourceMetrics,
    valueStates,
    currentViewLabel,
    portalLabel,
    periodOptionLabel,
    periodLabel,
    tableRowChartsMode = 'compact',
    mainChartSourcesLabel = '',
  } = input;

  const generatedAt = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date());
  const tableDisplayLabel =
    tableRowChartsMode === 'with_charts'
      ? 'Отображение таблицы: с графиками'
      : 'Отображение таблицы: компактное';

  const hasEmployees = tableRows.some((row) => row.kind === 'employee');
  const format = resolvePageFormat(
    appliedFilters.period,
    reportData.length,
    hasEmployees,
    tableRows.length,
  );
  const pageWidth = format === 'a3' ? 1587 : 1123;
  const pageHeight = format === 'a3' ? 1123 : 794;
  const maxPeriodColumns = resolveMaxPeriodColumns(format, appliedFilters.period);
  const maxRowsPerTablePage = resolveMaxRowsPerTablePage(format);
  const pagePadding = format === 'a3' ? 36 : 32;
  const contentWidth = pageWidth - pagePadding * 2;

  const getSourceMetricState = (pointKey: string, actionIds: string[]) =>
    actionIds.map((id) => valueStates[pointKey]?.[id]).find(Boolean);

  // Charts are rendered on the owner/cover pages — skip empty chart stubs in the numbers table.
  const tablePdfRows: PdfTableRow[] = tableRows
    .filter((row) => (
      row.kind !== 'employee_sum_hint'
      && row.kind !== 'chart'
      && row.kind !== 'employee_chart'
    ))
    .map((row) => {
      if (row.kind === 'section' || row.kind === 'source_section') {
        return {
          label: row.label,
          values: reportData.map(() => ''),
          kind: 'section' as const,
        };
      }

      if (row.kind === 'employee') {
        return {
          label: `  ${getEmployeeFullName(row.employee)}`.trim(),
          values: reportData.map((point) => {
            const value = hasBuiltReport ? getEmployeePeriodMetricValue(row.employee, point, row.metric.id) : 0;
            return getValueCellDisplayLabel(value, row.metric.type, valueStates[point.key]?.[row.metric.id]);
          }),
          kind: 'employee' as const,
        };
      }

      if (row.kind === 'source_metric') {
        const sourceData = sourceMetrics[row.sourceId];
        const metricData = sourceData?.metrics[row.metricKey];
        const valueType = row.valueType === 'money' ? 'money' : row.valueType === 'percent' ? 'percent' : 'number';
        const actionIds = buildSourceMetricActionIds(row.sourceId, row.metricKey, sourceData);

        return {
          label: `  ${row.metricLabel}`.trim(),
          values: reportData.map((point) => {
            const value = readValuesByPeriod(metricData?.valuesByPeriod, point.key);
            return getValueCellDisplayLabel(value, valueType, getSourceMetricState(point.key, actionIds));
          }),
          kind: 'metric' as const,
        };
      }

      return {
        label: row.metric.label,
        values: reportData.map((point) =>
          getValueCellDisplayLabel(
            point.values[row.metric.id],
            row.metric.type,
            valueStates[point.key]?.[row.metric.id],
          ),
        ),
        kind: 'metric' as const,
      };
    });

  const displayedAverage = resolveDisplayedThresholdAverage(mainThreshold);
  const thresholdSummary = [
    { label: 'Верхняя граница', value: mainThreshold.upper, color: '#1f9d55' },
    {
      label: 'Средний уровень',
      value: displayedAverage !== null ? String(displayedAverage) : '',
      color: '#d89a00',
    },
    { label: 'Нижняя граница', value: mainThreshold.lower, color: '#d64545' },
  ];
  const chartMetricType: MetricRow['type'] = appliedFilters.metricMode === 'money' ? 'money' : 'number';
  const chartValues = chartData.map((point) => Number(point.indicator) || 0);
  const chartMax = Math.max(1, ...chartValues, ...thresholdSummary.map((item) => Number(item.value) || 0));
  const chartMin = Math.min(0, ...chartValues);

  const makeChartSvg = () => {
    const width = contentWidth - 18;
    const height = format === 'a3' ? 280 : 210;
    const left = 62;
    const right = 20;
    const top = 18;
    const bottom = 38;
    const innerWidth = width - left - right;
    const innerHeight = height - top - bottom;
    const yFor = (value: number) =>
      top + innerHeight - ((value - chartMin) / Math.max(1, chartMax - chartMin)) * innerHeight;
    const xFor = (index: number) =>
      left + (chartValues.length <= 1 ? innerWidth / 2 : (index / (chartValues.length - 1)) * innerWidth);
    const points = chartValues.map((value, index) => `${xFor(index)},${yFor(value)}`).join(' ');

    const thresholdLines = thresholdSummary
      .map((item) => ({ value: Number(item.value), color: item.color }))
      .filter((item) => Number.isFinite(item.value))
      .map((item) => {
        const y = yFor(item.value);
        return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="${item.color}" stroke-width="1.6" stroke-dasharray="7 6" />`;
      })
      .join('');

    const labelStep = Math.max(1, Math.ceil(reportData.length / (format === 'a3' ? 10 : 8)));
    const labels = reportData
      .map((point, index) => ({ point, index }))
      .filter(({ index }) => index === 0 || index === reportData.length - 1 || index % labelStep === 0)
      .map(({ point, index }, labelIndex, items) => {
        const x = xFor(index);
        const anchor = labelIndex === 0 ? 'start' : labelIndex === items.length - 1 ? 'end' : 'middle';
        return `<text x="${x}" y="${height - 10}" text-anchor="${anchor}" font-size="12" fill="#5f6b7a">${escapeHtml(point.label)}</text>`;
      })
      .join('');

    return `
      <div class="pdf-chart-wrap pdf-block">
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff">
          <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#ffffff" stroke="#dfe7f1" />
          <line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" stroke="#dfe7f1" />
          <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="#dfe7f1" />
          <text x="18" y="${top + 6}" font-size="12" fill="#7b8794">${escapeHtml(formatMetricValue(chartMax, chartMetricType))}</text>
          <text x="18" y="${height - bottom}" font-size="12" fill="#7b8794">${escapeHtml(formatMetricValue(chartMin, chartMetricType))}</text>
          ${thresholdLines}
          <polyline points="${points}" fill="none" stroke="#2274ff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
          ${chartValues.map((value, index) => `<circle cx="${xFor(index)}" cy="${yFor(value)}" r="3.5" fill="#ffffff" stroke="#2274ff" stroke-width="2.5" />`).join('')}
          ${labels}
        </svg>
      </div>
    `;
  };

  const pages: PdfPageSpec[] = [];

  // F-21 owner brief: page 1 = main indicator chart + corridor summary.
  const chartSourcesMeta = mainChartSourcesLabel.trim()
    ? `<div class="pdf-meta" style="margin-bottom:4px">Источник: ${escapeHtml(mainChartSourcesLabel.trim())}</div>`
    : '';

  pages.push({
    kind: 'html',
    title: currentViewLabel,
    buildBody: () => `
      <div class="pdf-block">
        <div class="pdf-section-title">Главный показатель и основной график</div>
        ${chartSourcesMeta}
        <div class="pdf-meta" style="margin-bottom:8px">${escapeHtml(tableDisplayLabel)}</div>
        ${makeChartSvg()}
      </div>
      <div class="pdf-block">
        <div class="pdf-section-title">Текущий коридор</div>
        <div class="pdf-grid">
          ${thresholdSummary
            .map(
              (item) => `
            <div class="pdf-card">
              <div class="pdf-card-label">${escapeHtml(item.label)}</div>
              <div class="pdf-card-value" style="color:${item.color}">${escapeHtml(item.value || '—')}</div>
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `,
  });

  // Full PDF body: selected metrics/employees with repeating timeline headers per page.
  const periodChunks = chunk(
    reportData.map((point, index) => ({ point, index })),
    maxPeriodColumns,
  );
  const rowChunks = chunk(tablePdfRows, maxRowsPerTablePage);

  periodChunks.forEach((periodChunk, periodChunkIndex) => {
    rowChunks.forEach((rowChunk, rowChunkIndex) => {
      const periodPart =
        periodChunks.length > 1 ? ` · шкала ${periodChunkIndex + 1}/${periodChunks.length}` : '';
      const rowPart = rowChunks.length > 1 ? ` · блок ${rowChunkIndex + 1}/${rowChunks.length}` : '';

      pages.push({
        kind: 'table',
        title: `Таблица показателей${periodPart}${rowPart}`,
        headers: periodChunk.map(({ point }) => point.label),
        rows: rowChunk.map((row) => {
          if (row.kind === 'section') {
            return {
              kind: 'section' as const,
              label: row.label,
              cells: [],
            };
          }

          return {
            kind: row.kind,
            label: row.label,
            cells: periodChunk.map(({ index }) => row.values[index] ?? ''),
          };
        }),
      });
    });
  });

  return {
    format,
    pageWidth,
    pageHeight,
    pagePadding,
    pages,
    currentViewLabel,
    portalLabel,
    periodOptionLabel,
    periodLabel,
    tableDisplayLabel,
    generatedAt,
  };
};
