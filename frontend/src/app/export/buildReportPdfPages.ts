import { formatMetricValue } from '../../services/report/reportCatalog';
import type { MetricRow } from '../../services/report/reportCatalog';
import { getThresholdAverage, getThresholdClass } from '../utils/thresholds';
import {
  buildSourceMetricActionIds,
  chunk,
  escapeHtml,
  getEmployeePeriodMetricValue,
  getValueCellDisplayLabel,
  readValuesByPeriod,
  resolveThresholdForIds,
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
  generatedAt: string;
};

export const getPdfPageStyles = (
  format: PdfPageFormat,
  pageWidth: number,
  pageHeight: number,
  pagePadding: number,
) => `
  .pdf-page { width: ${pageWidth}px; height: ${pageHeight}px; padding: ${pagePadding}px; box-sizing: border-box; background: #fff; color: #202938; font-family: Arial, sans-serif; }
  .pdf-header { display: flex; justify-content: space-between; gap: 18px; border-bottom: 1px solid #dfe7f1; padding-bottom: 14px; margin-bottom: 18px; }
  .pdf-title { font-size: 26px; font-weight: 700; line-height: 1.15; }
  .pdf-meta { margin-top: 7px; color: #5f6b7a; font-size: 14px; }
  .pdf-meta div + div { margin-top: 3px; }
  .pdf-generated { color: #5f6b7a; font-size: 13px; text-align: right; white-space: nowrap; }
  .pdf-content { height: ${pageHeight - pagePadding * 2 - 82}px; overflow: hidden; }
  .pdf-section-title { margin: 18px 0 10px; font-size: 18px; font-weight: 700; }
  .pdf-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .pdf-card { border: 1px solid #dfe7f1; border-radius: 10px; padding: 12px 14px; background: #fbfdff; }
  .pdf-card-label { color: #6a7482; font-size: 13px; margin-bottom: 7px; }
  .pdf-card-value { font-size: 18px; font-weight: 700; }
  .pdf-attention { width: 100%; border-collapse: collapse; font-size: 13px; }
  .pdf-attention td { border-bottom: 1px solid #e7edf5; padding: 7px 8px; }
  .pdf-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: ${format === 'a3' ? 13 : 12}px; }
  .pdf-table th, .pdf-table td { border: 1px solid #dfe7f1; padding: 7px 8px; text-align: center; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pdf-table th { background: #eaf4ff; color: #2f3a4a; font-weight: 700; }
  .pdf-table .pdf-label { text-align: left; width: ${format === 'a3' ? 280 : 235}px; }
  .pdf-table .pdf-section { background: #f5f7fa; font-weight: 700; text-align: left; }
  .pdf-table .pdf-employee { color: #4f5c6b; }
  .pdf-footer { margin-top: 12px; border-top: 1px solid #dfe7f1; padding-top: 8px; color: #6a7482; font-size: 12px; display: flex; justify-content: space-between; }
`;

export const buildReportPdfPages = (input: ExportReportPdfInput): BuiltReportPdfPages => {
  const {
    hasBuiltReport,
    reportData,
    tableRows,
    chartData,
    appliedFilters,
    mainThreshold,
    rowThresholds,
    sourceMetrics,
    valueStates,
    currentViewLabel,
    portalLabel,
    periodOptionLabel,
    periodLabel,
  } = input;

  const generatedAt = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date());
  const format: PdfPageFormat =
    appliedFilters.period === 'hours' && (reportData.length > 12 || tableRows.length > 24) ? 'a3' : 'a4';
  const pageWidth = format === 'a3' ? 1587 : 1123;
  const pageHeight = format === 'a3' ? 1123 : 794;
  const maxPeriodColumns = format === 'a3' ? 12 : 8;
  const maxRowsPerTablePage = format === 'a3' ? 24 : 17;
  const pagePadding = 34;
  const contentWidth = pageWidth - pagePadding * 2;

  const getSourceMetricState = (pointKey: string, actionIds: string[]) =>
    actionIds.map((id) => valueStates[pointKey]?.[id]).find(Boolean);

  const tablePdfRows: PdfTableRow[] = tableRows
    .filter((row) => row.kind !== 'chart' && row.kind !== 'employee_chart')
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
          label: `  ${row.employee.firstName} ${row.employee.lastName}`.trim(),
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

  const thresholdSummary = [
    { label: 'Верхняя граница', value: mainThreshold.upper },
    { label: 'Средний уровень', value: getThresholdAverage(mainThreshold) ?? '' },
    { label: 'Нижняя граница', value: mainThreshold.lower },
  ];
  const chartMetricType: MetricRow['type'] = appliedFilters.metricMode === 'money' ? 'money' : 'number';
  const chartValues = chartData.map((point) => Number(point.indicator) || 0);
  const chartMax = Math.max(1, ...chartValues, ...thresholdSummary.map((item) => Number(item.value) || 0));
  const chartMin = Math.min(0, ...chartValues);

  const makeChartSvg = () => {
    const width = contentWidth - 18;
    const height = format === 'a3' ? 300 : 230;
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
      .map((item) => Number(item.value))
      .filter((value) => Number.isFinite(value))
      .map((value) => {
        const y = yFor(value);
        return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#d89a00" stroke-width="1.5" stroke-dasharray="7 7" />`;
      })
      .join('');
    const labels = reportData
      .filter((_point, index) => index === 0 || index === reportData.length - 1 || reportData.length <= 8)
      .map((point, index, items) => {
        const sourceIndex = reportData.findIndex((item) => item.key === point.key);
        const x = xFor(sourceIndex);
        const anchor = index === 0 ? 'start' : index === items.length - 1 ? 'end' : 'middle';
        return `<text x="${x}" y="${height - 10}" text-anchor="${anchor}" font-size="13" fill="#5f6b7a">${escapeHtml(point.label)}</text>`;
      })
      .join('');

    return `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="${width}" height="${height}" rx="12" fill="#ffffff" stroke="#dfe7f1" />
        <line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" stroke="#dfe7f1" />
        <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="#dfe7f1" />
        <text x="18" y="${top + 6}" font-size="12" fill="#7b8794">${escapeHtml(formatMetricValue(chartMax, chartMetricType))}</text>
        <text x="18" y="${height - bottom}" font-size="12" fill="#7b8794">${escapeHtml(formatMetricValue(chartMin, chartMetricType))}</text>
        ${thresholdLines}
        <polyline points="${points}" fill="none" stroke="#2274ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
        ${chartValues.map((value, index) => `<circle cx="${xFor(index)}" cy="${yFor(value)}" r="4" fill="#ffffff" stroke="#2274ff" stroke-width="3" />`).join('')}
        ${labels}
      </svg>
    `;
  };

  const attentionRows: Array<{
    label: string;
    period: string;
    value: number;
    type: MetricRow['type'];
  }> = tableRows
    .filter((row) => row.kind === 'metric' || row.kind === 'source_metric')
    .flatMap((row) => {
      if (row.kind === 'source_metric') {
        const sourceData = sourceMetrics[row.sourceId];
        const metricData = sourceData?.metrics[row.metricKey];
        const actionIds = buildSourceMetricActionIds(row.sourceId, row.metricKey, sourceData);
        const threshold = resolveThresholdForIds(actionIds, rowThresholds);
        const valueType: MetricRow['type'] =
          row.valueType === 'money' ? 'money' : row.valueType === 'percent' ? 'percent' : 'number';

        if (!threshold.mode && !threshold.upper && !threshold.lower) {
          return [];
        }

        return reportData
          .map((point) => ({
            label: row.metricLabel,
            period: point.label,
            value: readValuesByPeriod(metricData?.valuesByPeriod, point.key),
            type: valueType,
            threshold,
          }))
          .filter((item) => getThresholdClass(item.value, item.threshold));
      }

      const threshold = rowThresholds[row.metric.id];
      if (!threshold?.mode && !threshold?.upper && !threshold?.lower) {
        return [];
      }

      return reportData
        .map((point) => ({
          label: row.metric.label,
          period: point.label,
          value: point.values[row.metric.id],
          type: row.metric.type,
          threshold,
        }))
        .filter((item) => getThresholdClass(item.value, item.threshold));
    })
    .slice(0, 12);

  const pages: PdfPageSpec[] = [];

  pages.push({
    kind: 'html',
    title: currentViewLabel,
    buildBody: () => `
      <div class="pdf-section-title">Главный показатель и основной график</div>
      ${makeChartSvg()}
      <div class="pdf-section-title">Текущий коридор</div>
      <div class="pdf-grid">
        ${thresholdSummary
          .map(
            (item) => `
          <div class="pdf-card">
            <div class="pdf-card-label">${escapeHtml(item.label)}</div>
            <div class="pdf-card-value">${escapeHtml(item.value || '—')}</div>
          </div>
        `,
          )
          .join('')}
      </div>
    `,
  });

  if (attentionRows.length) {
    const attentionChunks = chunk(attentionRows, format === 'a3' ? 26 : 20);
    attentionChunks.forEach((attentionChunk, attentionChunkIndex) => {
      pages.push({
        kind: 'html',
        title: `Показатели, требующие внимания${attentionChunks.length > 1 ? ` · ${attentionChunkIndex + 1}/${attentionChunks.length}` : ''}`,
        buildBody: () => `
          <div class="pdf-section-title">Показатели, требующие внимания</div>
          <table class="pdf-attention">
            <tbody>
              ${attentionChunk
                .map(
                  (row) => `
                <tr>
                  <td>${escapeHtml(row.label)}</td>
                  <td>${escapeHtml(row.period)}</td>
                  <td><b>${escapeHtml(formatMetricValue(row.value, row.type))}</b></td>
                </tr>
              `,
                )
                .join('')}
            </tbody>
          </table>
        `,
      });
    });
  } else {
    pages.push({
      kind: 'html',
      title: 'Показатели, требующие внимания',
      buildBody: () => `
        <div class="pdf-section-title">Показатели, требующие внимания</div>
        <div class="pdf-card">Показателей, требующих внимания, нет.</div>
      `,
    });
  }

  const periodChunks = chunk(
    reportData.map((point, index) => ({ point, index })),
    maxPeriodColumns,
  );
  const rowChunks = chunk(tablePdfRows, maxRowsPerTablePage);

  periodChunks.forEach((periodChunk, periodChunkIndex) => {
    rowChunks.forEach((rowChunk) => {
      pages.push({
        kind: 'table',
        title: `Таблица выбранных показателей${periodChunks.length > 1 ? ` · ${periodChunkIndex + 1}/${periodChunks.length}` : ''}`,
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
    generatedAt,
  };
};
