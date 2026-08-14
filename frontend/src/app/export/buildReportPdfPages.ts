import type { MetricRow } from '../../services/report/reportCatalog';
import {
  MAIN_INDICATOR_DIRECTION_KEY,
  resolveMetricDirection,
  resolveMetricDirectionForIds,
  type MetricDirection,
} from '../config/metricDirections';
import { resolveDisplayedThresholdAverage, getThresholdClass, resolveInheritedThreshold } from '../utils/thresholds';
import { getEmployeeFullName } from '../utils/employees';
import { formatAxisTick, getChartDomain } from '../utils/reportCalculations';
import type { TableRow, ThresholdValues } from '../types';
import {
  buildSourceMetricActionIds,
  chunk,
  escapeHtml,
  getEmployeePeriodMetricValue,
  getPdfThresholdStyle,
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

type RowChartSpec = {
  title: string;
  values: number[];
  metricType: MetricRow['type'];
  threshold?: ThresholdValues;
  direction: MetricDirection;
};

const collectTableRowCharts = (input: ExportReportPdfInput): RowChartSpec[] => {
  const {
    tableRows,
    reportData,
    hasBuiltReport,
    rowThresholds = {},
    employeeThresholdsByMetricId = {},
    metricDirectionsById = {},
    sourceMetrics,
  } = input;

  const charts: RowChartSpec[] = [];

  // Build charts from data rows — not from on-screen expand state — so
  // «PDF с графиками» always includes every metric/employee chart in the table.
  tableRows.forEach((row: TableRow) => {
    if (row.kind === 'metric') {
      const threshold = rowThresholds[row.metric.id];
      const direction = resolveMetricDirection(row.metric.id, metricDirectionsById);
      const values = reportData.map((point) => {
        const raw = point.values[row.metric.id];
        const numeric = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(numeric) ? numeric : 0;
      });

      charts.push({
        title: row.metric.label,
        values,
        metricType: row.metric.type,
        threshold,
        direction,
      });
      return;
    }

    if (row.kind === 'source_metric') {
      const sourceData = sourceMetrics[row.sourceId];
      const metricData = sourceData?.metrics[row.metricKey];
      const actionIds = buildSourceMetricActionIds(row.sourceId, row.metricKey, sourceData);
      const threshold = resolveThresholdForIds(actionIds, rowThresholds);
      const direction = resolveMetricDirectionForIds(actionIds, metricDirectionsById);
      const valueType: MetricRow['type'] =
        row.valueType === 'money' ? 'money' : row.valueType === 'percent' ? 'percent' : 'number';
      const values = reportData.map((point) => {
        const value = readValuesByPeriod(metricData?.valuesByPeriod, point.key);
        return Number.isFinite(value) ? value : 0;
      });

      charts.push({
        title: row.metricLabel,
        values,
        metricType: valueType,
        threshold,
        direction,
      });
      return;
    }

    if (row.kind === 'employee') {
      const threshold = resolveInheritedThreshold(
        employeeThresholdsByMetricId[row.metric.id],
        rowThresholds[row.metric.id],
      );
      const direction = resolveMetricDirection(row.metric.id, metricDirectionsById);
      const values = reportData.map((point) => {
        const value = hasBuiltReport
          ? getEmployeePeriodMetricValue(row.employee, point, row.metric.id)
          : 0;
        return Number.isFinite(value) ? value : 0;
      });

      charts.push({
        title: `${row.metric.label} · ${getEmployeeFullName(row.employee)}`,
        values,
        metricType: row.metric.type,
        threshold,
        direction,
      });
    }
  });

  return charts;
};

const buildNiceYTicks = (min: number, max: number, targetCount = 5): number[] => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1];
  }

  if (max <= min) {
    return [min];
  }

  const roughStep = (max - min) / Math.max(1, targetCount - 1);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(roughStep, Number.EPSILON)));
  const residual = roughStep / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  const step = niceResidual * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];

  for (let value = niceMin; value <= niceMax + step * 0.5; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }

  return ticks.length ? ticks : [min, max];
};

const makeSeriesChartSvg = ({
  values,
  labels,
  width,
  height,
  metricType,
  threshold,
  direction,
}: {
  values: number[];
  labels: string[];
  width: number;
  height: number;
  metricType: MetricRow['type'];
  threshold?: ThresholdValues;
  direction: MetricDirection;
}) => {
  const left = 58;
  const right = 16;
  const top = 14;
  const bottom = 30;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const upperRaw = String(threshold?.upper ?? '').trim();
  const lowerRaw = String(threshold?.lower ?? '').trim();
  const averageRaw = String(threshold?.average ?? '').trim();
  const boundCandidates = [upperRaw, lowerRaw, averageRaw]
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  const [domainMin, domainMax] = getChartDomain([...values, ...boundCandidates]);
  const yTicks = buildNiceYTicks(domainMin, domainMax, 5);
  const chartMin = yTicks[0] ?? domainMin;
  const chartMax = yTicks[yTicks.length - 1] ?? domainMax;
  const ySpan = Math.max(chartMax - chartMin, 1);
  const yFor = (value: number) =>
    top + innerHeight - ((value - chartMin) / ySpan) * innerHeight;
  const xFor = (index: number) =>
    left + (values.length <= 1 ? innerWidth / 2 : (index / (values.length - 1)) * innerWidth);
  const points = values.map((value, index) => `${xFor(index)},${yFor(value)}`).join(' ');

  const upperBound = upperRaw ? Number(upperRaw) : Number.NaN;
  const lowerBound = lowerRaw ? Number(lowerRaw) : Number.NaN;
  const hasCorridorBand = Number.isFinite(upperBound) && Number.isFinite(lowerBound);
  const corridorBand = hasCorridorBand
    ? (() => {
        const yTop = yFor(Math.max(upperBound, lowerBound));
        const yBottom = yFor(Math.min(upperBound, lowerBound));
        return `<rect x="${left}" y="${yTop}" width="${innerWidth}" height="${Math.max(0, yBottom - yTop)}" fill="#edf9f1" fill-opacity="0.55" />`;
      })()
    : '';

  const thresholdLines = [
    { value: upperRaw, color: '#1f9d55' },
    { value: averageRaw, color: '#d89a00' },
    { value: lowerRaw, color: '#d64545' },
  ]
    .filter((item) => item.value !== '' && Number.isFinite(Number(item.value)))
    .map((item) => {
      const y = yFor(Number(item.value));
      return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="${item.color}" stroke-width="1.4" stroke-dasharray="6 5" />`;
    })
    .join('');

  const gridLines = yTicks
    .map((tick) => {
      const y = yFor(tick);
      return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#edf0f4" stroke-width="1" />`;
    })
    .join('');

  const yAxisLabels = yTicks
    .map((tick) => {
      const y = yFor(tick);
      return `<text x="${left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#707782">${escapeHtml(formatAxisTick(tick, metricType))}</text>`;
    })
    .join('');

  const labelStep = Math.max(1, Math.ceil(labels.length / 8));
  const axisLabels = labels
    .map((label, index) => ({ label, index }))
    .filter(({ index }) => index === 0 || index === labels.length - 1 || index % labelStep === 0)
    .map(({ label, index }, labelIndex, items) => {
      const x = xFor(index);
      const anchor = labelIndex === 0 ? 'start' : labelIndex === items.length - 1 ? 'end' : 'middle';
      return `<text x="${x}" y="${height - 8}" text-anchor="${anchor}" font-size="11" fill="#5f6b7a">${escapeHtml(label)}</text>`;
    })
    .join('');

  const chartDots = values.map((value, index) => {
    const style = getPdfThresholdStyle(getThresholdClass(value, threshold, direction));
    const stroke = style?.stroke ?? '#2274ff';
    const fill = style?.fillHex ?? '#ffffff';
    return `<circle cx="${xFor(index)}" cy="${yFor(value)}" r="3.2" fill="${fill}" stroke="${stroke}" stroke-width="2.2" />`;
  }).join('');

  return `
    <div class="pdf-chart-wrap pdf-block">
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="background:#ffffff">
        <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#ffffff" stroke="#dfe7f1" />
        ${gridLines}
        <line x1="${left}" y1="${top}" x2="${left}" y2="${height - bottom}" stroke="#dfe7f1" />
        <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="#dfe7f1" />
        ${yAxisLabels}
        ${corridorBand}
        ${thresholdLines}
        <polyline points="${points}" fill="none" stroke="#2274ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        ${chartDots}
        ${axisLabels}
      </svg>
    </div>
  `;
};

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
  .pdf-chart-caption {
    margin: 0 0 4px;
    color: #111827;
    font-size: ${format === 'a3' ? 15 : 14}px;
    font-weight: 700;
    line-height: 1.25;
  }
  .pdf-generated { color: #5f6b7a; font-size: 12px; text-align: right; white-space: nowrap; background: #ffffff; }
  .pdf-content {
    height: ${pageHeight - pagePadding * 2 - 86}px;
    overflow: hidden;
    background: #ffffff;
  }
  .pdf-page.is-charts-chrome .pdf-content {
    height: ${pageHeight - pagePadding * 2 - 42}px;
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
    rowThresholds = {},
    employeeThresholdsByMetricId = {},
    metricDirectionsById = {},
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
        const threshold = resolveInheritedThreshold(
          employeeThresholdsByMetricId[row.metric.id],
          rowThresholds[row.metric.id],
        );
        const direction = resolveMetricDirection(row.metric.id, metricDirectionsById);
        const values = reportData.map((point) => {
          const value = hasBuiltReport ? getEmployeePeriodMetricValue(row.employee, point, row.metric.id) : 0;
          return getValueCellDisplayLabel(value, row.metric.type, valueStates[point.key]?.[row.metric.id]);
        });
        const thresholdClasses = reportData.map((point) => {
          const value = hasBuiltReport ? getEmployeePeriodMetricValue(row.employee, point, row.metric.id) : Number.NaN;
          return getThresholdClass(value, threshold, direction);
        });

        return {
          label: `  ${getEmployeeFullName(row.employee)}`.trim(),
          values,
          thresholdClasses,
          kind: 'employee' as const,
        };
      }

      if (row.kind === 'source_metric') {
        const sourceData = sourceMetrics[row.sourceId];
        const metricData = sourceData?.metrics[row.metricKey];
        const valueType = row.valueType === 'money' ? 'money' : row.valueType === 'percent' ? 'percent' : 'number';
        const actionIds = buildSourceMetricActionIds(row.sourceId, row.metricKey, sourceData);
        const threshold = resolveThresholdForIds(actionIds, rowThresholds);
        const direction = resolveMetricDirectionForIds(actionIds, metricDirectionsById);
        const values = reportData.map((point) => {
          const value = readValuesByPeriod(metricData?.valuesByPeriod, point.key);
          return getValueCellDisplayLabel(value, valueType, getSourceMetricState(point.key, actionIds));
        });
        const thresholdClasses = reportData.map((point) => {
          const value = readValuesByPeriod(metricData?.valuesByPeriod, point.key);
          return getThresholdClass(value, threshold, direction);
        });

        return {
          label: `  ${row.metricLabel}`.trim(),
          values,
          thresholdClasses,
          kind: 'metric' as const,
        };
      }

      const threshold = rowThresholds[row.metric.id];
      const direction = resolveMetricDirection(row.metric.id, metricDirectionsById);
      const values = reportData.map((point) =>
        getValueCellDisplayLabel(
          point.values[row.metric.id],
          row.metric.type,
          valueStates[point.key]?.[row.metric.id],
        ),
      );
      const thresholdClasses = reportData.map((point) =>
        getThresholdClass(point.values[row.metric.id], threshold, direction),
      );

      return {
        label: row.metric.label,
        values,
        thresholdClasses,
        kind: 'metric' as const,
      };
    });

  const displayedAverage = resolveDisplayedThresholdAverage(mainThreshold);
  const mainDirection = resolveMetricDirection(MAIN_INDICATOR_DIRECTION_KEY, metricDirectionsById);
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

  const makeChartSvg = () => makeSeriesChartSvg({
    values: chartValues,
    labels: reportData.map((point) => point.label),
    width: contentWidth - 18,
    height: format === 'a3' ? 280 : 210,
    metricType: chartMetricType,
    threshold: {
      ...mainThreshold,
      average: displayedAverage !== null ? String(displayedAverage) : (mainThreshold.average ?? ''),
    },
    direction: mainDirection,
  });

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
            thresholdClasses: periodChunk.map(({ index }) => row.thresholdClasses?.[index] ?? ''),
          };
        }),
      });
    });
  });

  if (tableRowChartsMode === 'with_charts') {
    const rowChartSpecs = collectTableRowCharts(input);
    const chartsPerPage = format === 'a3' ? 4 : 3;
    const chartChunks = chunk(rowChartSpecs, chartsPerPage);

    if (chartChunks.length === 0) {
      pages.push({
        kind: 'html',
        title: 'Графики по строкам',
        chrome: 'charts',
        buildBody: () => `
          <div class="pdf-block">
            <div class="pdf-meta">
              В таблице нет показателей или сотрудников для графиков — в PDF только главный график и числа.
            </div>
          </div>
        `,
      });
    } else {
      chartChunks.forEach((chartChunk, chunkIndex) => {
        pages.push({
          kind: 'html',
          title: `Графики по строкам`,
          chrome: 'charts',
          buildBody: () => `
            <div class="pdf-block">
              ${chartChunk
                .map((spec, specIndex) => {
                  const miniWidth = contentWidth - 18;
                  const miniHeight = format === 'a3' ? 168 : 142;
                  const topGap = specIndex === 0 ? '0' : '12px';
                  return `
                    <div class="pdf-block" style="margin-top:${topGap}">
                      <div class="pdf-chart-caption">${escapeHtml(spec.title)}</div>
                      ${makeSeriesChartSvg({
                        values: spec.values,
                        labels: reportData.map((point) => point.label),
                        width: miniWidth,
                        height: miniHeight,
                        metricType: spec.metricType,
                        threshold: spec.threshold,
                        direction: spec.direction,
                      })}
                    </div>
                  `;
                })
                .join('')}
            </div>
          `,
        });
      });
    }
  }

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
