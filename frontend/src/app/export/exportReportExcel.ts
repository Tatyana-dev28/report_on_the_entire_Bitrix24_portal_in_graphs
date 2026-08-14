import ExcelJS from 'exceljs';
import { periodOptions } from '../../services/report/reportCatalog';
import type { MetricRow, Period } from '../../services/report/reportCatalog';
import {
  resolveMetricDirection,
  resolveMetricDirectionForIds,
} from '../config/metricDirections';
import { bitrixEntityTitleRoots, buildBitrixMetricDetailUrl, buildBitrixUserUrl } from '../utils/bitrixNavigation';
import { getEmployeeFullName } from '../utils/employees';
import { getThresholdClass, resolveDisplayedThresholdAverage, resolveInheritedThreshold } from '../utils/thresholds';
import type { BitrixEntityType } from '../types';
import {
  buildSourceMetricActionIds,
  getEmployeePeriodMetricValue,
  readValuesByPeriod,
  resolveThresholdForIds,
} from './pdfHelpers';
import type { ExportReportExcelInput } from './excelTypes';

const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFE6E9EE' } },
  left: { style: 'thin', color: { argb: 'FFE6E9EE' } },
  bottom: { style: 'thin', color: { argb: 'FFE6E9EE' } },
  right: { style: 'thin', color: { argb: 'FFE6E9EE' } },
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFEAF4FF' },
};

const SECTION_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF3F5F8' },
};

const FILL_BY_THRESHOLD_CLASS: Record<string, string> = {
  'is-above-threshold': 'FFEDF9F1',
  'is-below-threshold': 'FFFFF0F0',
  'is-inside-range-threshold': 'FFEDF9F1',
  'is-outside-range-warning': 'FFFFF7ED',
  'is-outside-range-threshold': 'FFFFF0F0',
  'is-above-corridor-neutral': 'FFFFF8E8',
  'is-below-corridor-neutral': 'FFFFF8E8',
};

const FONT_BY_THRESHOLD_CLASS: Record<string, string> = {
  'is-above-threshold': 'FF22845A',
  'is-below-threshold': 'FFC93333',
  'is-inside-range-threshold': 'FF22845A',
  'is-outside-range-warning': 'FFB45309',
  'is-outside-range-threshold': 'FFC93333',
  'is-above-corridor-neutral': 'FF8A6D1D',
  'is-below-corridor-neutral': 'FF8A6D1D',
};

const DIRECTION_LABELS: Record<string, string> = {
  higher_better: 'Больше — лучше',
  lower_better: 'Меньше — лучше',
  range_normal: 'Норма в диапазоне',
  none: 'Без оценки',
};

const applyHeaderStyle = (row: ExcelJS.Row) => {
  row.font = { bold: true, color: { argb: 'FF30343B' } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.eachCell((cell) => {
    cell.border = BORDER;
  });
};

const applySheetChrome = (
  worksheet: ExcelJS.Worksheet,
  headerRowNumber: number,
  columnCount: number,
  freezeFirstColumn = false,
) => {
  worksheet.views = [{
    state: 'frozen',
    xSplit: freezeFirstColumn ? 1 : 0,
    ySplit: headerRowNumber,
    activeCell: 'A1',
    showGridLines: true,
  }];
  worksheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: Math.max(1, columnCount) },
  };
};

const setColumnWidths = (worksheet: ExcelJS.Worksheet, widths: number[]) => {
  worksheet.columns = widths.map((width) => ({ width, style: { alignment: { wrapText: true } } }));
};

const parsePeriodDate = (periodKey: string, period: Period): Date | null => {
  const iso = Date.parse(periodKey);
  if (Number.isFinite(iso)) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const dayMatch = periodKey.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!dayMatch) {
    return null;
  }

  const year = Number(dayMatch[1]);
  const month = Number(dayMatch[2]) - 1;
  const day = Number(dayMatch[3]);
  const hours = Number(dayMatch[4] ?? (period === 'hours' ? 0 : 0));
  const minutes = Number(dayMatch[5] ?? 0);
  const date = new Date(year, month, day, hours, minutes, 0, 0);

  return Number.isNaN(date.getTime()) ? null : date;
};

const writeTypedMetricValue = (
  cell: ExcelJS.Cell,
  value: number | undefined,
  metricType: MetricRow['type'],
  hasState: boolean,
) => {
  if (hasState || typeof value !== 'number' || !Number.isFinite(value)) {
    cell.value = '—';
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    return;
  }

  if (metricType === 'percent') {
    // App stores percents as 42 for 42%; Excel percent format expects 0.42.
    cell.value = value / 100;
    cell.numFmt = '0.00%';
  } else if (metricType === 'money') {
    cell.value = value;
    cell.numFmt = '#,##0.00" RUB"';
  } else {
    cell.value = value;
    cell.numFmt = Number.isInteger(value) ? '0' : '0.##';
  }

  cell.alignment = { vertical: 'middle', horizontal: 'center' };
};

const applyThresholdStyle = (cell: ExcelJS.Cell, thresholdClass: string) => {
  if (!thresholdClass) {
    return;
  }

  const fill = FILL_BY_THRESHOLD_CLASS[thresholdClass];
  const fontColor = FONT_BY_THRESHOLD_CLASS[thresholdClass];
  if (fill) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: fill },
    };
  }
  if (fontColor) {
    cell.font = { ...(cell.font ?? {}), color: { argb: fontColor }, bold: true };
  }
};

const entityTypeLabel = (entityType: string | undefined) => {
  if (!entityType) {
    return 'Сущность';
  }

  const normalized = entityType.trim().toLowerCase() as BitrixEntityType;
  return bitrixEntityTitleRoots[normalized] ?? entityType;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const buildOverviewSheet = (workbook: ExcelJS.Workbook, input: ExportReportExcelInput) => {
  const sheet = workbook.addWorksheet('Обзор', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.addRow(['Параметр', 'Значение']);
  applyHeaderStyle(sheet.getRow(1));

  const average = resolveDisplayedThresholdAverage(input.mainThreshold);
  const metaRows: Array<[string, string | number | Date]> = [
    ['Представление', input.currentViewLabel],
    ['Портал', input.portalLabel],
    ['Группировка', input.periodOptionLabel],
    ['Период', input.periodLabel],
    ['Дата формирования', input.generatedAt ?? new Date()],
    ['Режим таблицы', input.tableRowChartsMode === 'with_charts' ? 'С графиками' : 'Компактный'],
    ['Режим главного показателя', input.appliedFilters.metricMode === 'money' ? 'Деньги' : 'Количество'],
    ['Отображение графика', input.appliedFilters.chartDisplayMode === 'separate' ? 'Раздельно' : 'Сумма'],
    ['Коридор: верх', input.mainThreshold.upper || '—'],
    ['Коридор: среднее', average !== null ? average : '—'],
    ['Коридор: низ', input.mainThreshold.lower || '—'],
  ];

  metaRows.forEach(([label, value]) => {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.eachCell((cell) => {
      cell.border = BORDER;
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    if (value instanceof Date) {
      row.getCell(2).numFmt = 'dd.mm.yyyy hh:mm';
    }
  });

  sheet.addRow([]);
  const chartHeader = sheet.addRow(['Главный показатель по периодам', 'Дата/час', 'Значение']);
  applyHeaderStyle(chartHeader);

  input.chartData.forEach((point, index) => {
    const reportPoint = input.reportData[index];
    const periodKey = point.key ?? reportPoint?.key ?? '';
    const periodDate = periodKey ? parsePeriodDate(periodKey, input.appliedFilters.period) : null;
    const value = Number(point.indicator);
    const row = sheet.addRow([
      point.label ?? reportPoint?.label ?? '',
      periodDate ?? (point.label ?? reportPoint?.label ?? ''),
      Number.isFinite(value) ? value : '—',
    ]);
    row.eachCell((cell) => {
      cell.border = BORDER;
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    if (periodDate) {
      row.getCell(2).numFmt = input.appliedFilters.period === 'hours' ? 'dd.mm.yyyy hh:mm' : 'dd.mm.yyyy';
    }
    if (Number.isFinite(value)) {
      row.getCell(3).numFmt = input.appliedFilters.metricMode === 'money' ? '#,##0.00" RUB"' : '0.##';
    }
  });

  setColumnWidths(sheet, [42, 28, 18]);
  sheet.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A1', showGridLines: true }];
};

const buildMetricsSheet = (workbook: ExcelJS.Workbook, input: ExportReportExcelInput) => {
  const sheet = workbook.addWorksheet('Показатели');
  const header = ['Показатель', ...input.reportData.map((point) => point.label)];
  const headerRow = sheet.addRow(header);
  applyHeaderStyle(headerRow);

  input.tableRows
    .filter((row) => row.kind !== 'chart' && row.kind !== 'employee_chart' && row.kind !== 'employee_sum_hint')
    .forEach((row) => {
      if (row.kind === 'section' || row.kind === 'source_section') {
        const sectionRow = sheet.addRow([row.label, ...input.reportData.map(() => '')]);
        sectionRow.font = { bold: true, color: { argb: 'FF30343B' } };
        sectionRow.fill = SECTION_FILL;
        sectionRow.eachCell((cell) => {
          cell.border = BORDER;
          cell.alignment = { vertical: 'middle', wrapText: true };
        });
        return;
      }

      if (row.kind === 'employee') {
        // Employees belong on «Сотрудники»; keep metrics sheet focused on indicators.
        return;
      }

      if (row.kind === 'source_metric') {
        const sourceData = input.sourceMetrics[row.sourceId];
        const metricData = sourceData?.metrics[row.metricKey];
        const valueType: MetricRow['type'] =
          row.valueType === 'money' ? 'money' : row.valueType === 'percent' ? 'percent' : 'number';
        const actionIds = buildSourceMetricActionIds(row.sourceId, row.metricKey, sourceData);
        const threshold = resolveThresholdForIds(actionIds, input.rowThresholds);
        const direction = resolveMetricDirectionForIds(actionIds, input.metricDirectionsById);
        const excelRow = sheet.addRow([row.metricLabel, ...input.reportData.map(() => null)]);
        excelRow.getCell(1).font = { bold: true, color: { argb: 'FF4D5866' } };
        excelRow.getCell(1).alignment = { vertical: 'middle', wrapText: true };
        excelRow.getCell(1).border = BORDER;

        input.reportData.forEach((point, index) => {
          const cell = excelRow.getCell(index + 2);
          const value = readValuesByPeriod(metricData?.valuesByPeriod, point.key);
          const state = actionIds.map((id) => input.valueStates[point.key]?.[id]).find(Boolean);
          writeTypedMetricValue(cell, value, valueType, Boolean(state));
          cell.border = BORDER;
          if (!state) {
            applyThresholdStyle(cell, getThresholdClass(value, threshold, direction));
          }
        });
        return;
      }

      const threshold = input.rowThresholds[row.metric.id];
      const direction = resolveMetricDirection(row.metric.id, input.metricDirectionsById);
      const excelRow = sheet.addRow([row.metric.label, ...input.reportData.map(() => null)]);
      excelRow.getCell(1).font = { bold: true, color: { argb: 'FF30343B' } };
      excelRow.getCell(1).alignment = { vertical: 'middle', wrapText: true };
      excelRow.getCell(1).border = BORDER;

      input.reportData.forEach((point, index) => {
        const cell = excelRow.getCell(index + 2);
        const value = point.values[row.metric.id];
        const state = input.valueStates[point.key]?.[row.metric.id];
        writeTypedMetricValue(cell, value, row.metric.type, Boolean(state));
        cell.border = BORDER;
        if (!state) {
          applyThresholdStyle(cell, getThresholdClass(value, threshold, direction));
        }
      });
    });

  setColumnWidths(sheet, [36, ...input.reportData.map(() => 14)]);
  applySheetChrome(sheet, 1, header.length, true);
};

const buildEmployeesSheet = (workbook: ExcelJS.Workbook, input: ExportReportExcelInput) => {
  const sheet = workbook.addWorksheet('Сотрудники');
  const headers = ['Сотрудник', 'Показатель', 'Дата/час', 'Период (подпись)', 'Значение', 'Тип'];
  const headerRow = sheet.addRow(headers);
  applyHeaderStyle(headerRow);

  const employeeRows = input.tableRows.filter((row) => row.kind === 'employee');

  if (!employeeRows.length) {
    const note = sheet.addRow([
      'Детализация по сотрудникам не включена в текущем отчёте.',
      '',
      '',
      '',
      '',
      '',
    ]);
    note.getCell(1).font = { italic: true, color: { argb: 'FF69707D' } };
    note.getCell(1).alignment = { wrapText: true, vertical: 'middle' };
    sheet.mergeCells(2, 1, 2, headers.length);
    setColumnWidths(sheet, [40, 28, 20, 18, 14, 12]);
    applySheetChrome(sheet, 1, headers.length);
    return;
  }

  employeeRows.forEach((row) => {
    if (row.kind !== 'employee') {
      return;
    }

    const employeeName = getEmployeeFullName(row.employee);
    const direction = resolveMetricDirection(row.metric.id, input.metricDirectionsById);
    const threshold = resolveInheritedThreshold(
      input.employeeThresholdsByMetricId?.[row.metric.id],
      input.rowThresholds[row.metric.id],
    );
    const userUrl = row.employee.userId ? buildBitrixUserUrl(row.employee.userId) : null;

    input.reportData.forEach((point) => {
      const value = input.hasBuiltReport
        ? getEmployeePeriodMetricValue(row.employee, point, row.metric.id)
        : 0;
      const state = input.valueStates[point.key]?.[row.metric.id];
      const periodDate = parsePeriodDate(point.key, input.appliedFilters.period);
      const excelRow = sheet.addRow([
        employeeName,
        row.metric.label,
        periodDate ?? point.label,
        point.label,
        null,
        row.metric.type === 'money' ? 'деньги' : row.metric.type === 'percent' ? 'процент' : 'число',
      ]);

      const nameCell = excelRow.getCell(1);
      if (userUrl) {
        nameCell.value = { text: employeeName, hyperlink: userUrl };
        nameCell.font = { color: { argb: 'FF0563C1' }, underline: true };
      } else {
        nameCell.value = employeeName;
      }
      nameCell.alignment = { vertical: 'middle', wrapText: true };

      excelRow.getCell(2).alignment = { vertical: 'middle', wrapText: true };
      if (periodDate) {
        excelRow.getCell(3).numFmt = input.appliedFilters.period === 'hours' ? 'dd.mm.yyyy hh:mm' : 'dd.mm.yyyy';
      }
      writeTypedMetricValue(excelRow.getCell(5), value, row.metric.type, Boolean(state));
      if (!state) {
        applyThresholdStyle(excelRow.getCell(5), getThresholdClass(value, threshold, direction));
      }

      excelRow.eachCell((cell) => {
        cell.border = BORDER;
        if (!cell.alignment) {
          cell.alignment = { vertical: 'middle', wrapText: true };
        }
      });
    });
  });

  setColumnWidths(sheet, [32, 30, 20, 18, 14, 12]);
  applySheetChrome(sheet, 1, headers.length);
};

const buildEntitiesSheet = (workbook: ExcelJS.Workbook, input: ExportReportExcelInput) => {
  const sheet = workbook.addWorksheet('Сущности');
  const headers = ['Тип', 'ID', 'Название', 'Время', 'Ответственный', 'Ссылка', 'Показатель', 'Период'];
  const headerRow = sheet.addRow(headers);
  applyHeaderStyle(headerRow);

  if (!input.reportDetails.length) {
    const note = sheet.addRow([
      'Сущности для выбранного периода и фильтров отсутствуют либо детализация ещё не загружена.',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
    note.getCell(1).font = { italic: true, color: { argb: 'FF69707D' } };
    note.getCell(1).alignment = { wrapText: true };
    sheet.mergeCells(2, 1, 2, headers.length);
    setColumnWidths(sheet, [14, 14, 48, 20, 24, 40, 24, 16]);
    applySheetChrome(sheet, 1, headers.length);
    return;
  }

  const seen = new Set<string>();

  input.reportDetails.forEach((detail) => {
    const entityId = detail.entityId ?? detail.id;
    const dedupeKey = `${detail.entityType ?? ''}:${entityId}:${detail.periodKey ?? ''}:${detail.metricId ?? ''}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);

    const link = buildBitrixMetricDetailUrl(detail);
    const createdAtDate = detail.createdAt ? parsePeriodDate(detail.createdAt, 'hours') : null;
    const title = detail.title || '—';
    const excelRow = sheet.addRow([
      entityTypeLabel(detail.entityType ?? detail.navigationEntityType),
      entityId ?? '',
      title,
      createdAtDate ?? (detail.createdAt || ''),
      detail.responsibleName || '',
      link ?? '',
      detail.metricLabel || detail.metricId || '',
      detail.periodKey || '',
    ]);

    excelRow.getCell(3).alignment = { wrapText: true, vertical: 'middle' };
    if (createdAtDate) {
      excelRow.getCell(4).numFmt = 'dd.mm.yyyy hh:mm';
    }
    if (link) {
      excelRow.getCell(6).value = { text: link, hyperlink: link };
      excelRow.getCell(6).font = { color: { argb: 'FF0563C1' }, underline: true };
    }

    excelRow.eachCell((cell) => {
      cell.border = BORDER;
      cell.alignment = { ...(cell.alignment ?? {}), vertical: 'middle', wrapText: true };
    });
  });

  setColumnWidths(sheet, [14, 14, 48, 20, 24, 42, 24, 18]);
  applySheetChrome(sheet, 1, headers.length);
};

const buildSettingsSheet = (workbook: ExcelJS.Workbook, input: ExportReportExcelInput) => {
  const sheet = workbook.addWorksheet('Настройки');
  sheet.addRow(['Параметр', 'Значение']);
  applyHeaderStyle(sheet.getRow(1));

  const sourceIds = [
    ...input.tableEntitySourceIds,
    ...input.tableSelectedSources,
    ...(input.appliedFilters.selectedSources ?? []),
  ];
  const uniqueSourceIds = Array.from(new Set(sourceIds));
  const sourceTitles = uniqueSourceIds.map((sourceId) => {
    const source = input.crmSources.find((item) => item.id === sourceId);
    return source ? `${source.title} (${sourceId})` : sourceId;
  });

  const weekendLabels = (input.appliedFilters.schedule?.weekendDayIds ?? [])
    .map((dayId) => ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][dayId] ?? String(dayId))
    .join(', ');

  const rows: Array<[string, string]> = [
    ['Представление', input.currentViewLabel],
    ['Портал', input.portalLabel],
    ['Группировка', periodOptions.find((option) => option.value === input.appliedFilters.period)?.label
      ?? input.periodOptionLabel],
    ['Период', input.periodLabel],
    ['Дата начала', input.appliedFilters.dateRange.start],
    ['Дата окончания', input.appliedFilters.dateRange.end],
    ['Источники (таблица)', sourceTitles.join('; ') || '—'],
    ['Режим главного показателя', input.appliedFilters.metricMode === 'money' ? 'Деньги' : 'Количество'],
    ['Отображение графика', input.appliedFilters.chartDisplayMode === 'separate' ? 'Раздельно' : 'Сумма'],
    ['Отображение таблицы', input.tableRowChartsMode === 'with_charts' ? 'С графиками' : 'Компактное'],
    ['Рабочий день', `${input.appliedFilters.schedule?.workdayStart ?? '—'} – ${input.appliedFilters.schedule?.workdayEnd ?? '—'}`],
    ['Выходные', weekendLabels || '—'],
    ['Коридор главного: верх', input.mainThreshold.upper || '—'],
    ['Коридор главного: среднее', input.mainThreshold.average || '—'],
    ['Коридор главного: низ', input.mainThreshold.lower || '—'],
    ['Режим коридора главного', input.mainThreshold.mode || '—'],
  ];

  Object.entries(input.metricDirectionsById).forEach(([metricId, direction]) => {
    rows.push([`Направление: ${metricId}`, DIRECTION_LABELS[direction] ?? direction]);
  });

  rows.forEach(([label, value]) => {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.eachCell((cell) => {
      cell.border = BORDER;
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
  });

  setColumnWidths(sheet, [40, 80]);
  applySheetChrome(sheet, 1, 2);
};

export const exportReportExcel = async (input: ExportReportExcelInput) => {
  if (!input.hasBuiltReport || !input.reportData.length) {
    return;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'САПП';
  workbook.created = input.generatedAt ?? new Date();
  workbook.modified = input.generatedAt ?? new Date();

  buildOverviewSheet(workbook, input);
  buildMetricsSheet(workbook, input);
  buildEmployeesSheet(workbook, input);
  buildEntitiesSheet(workbook, input);
  buildSettingsSheet(workbook, input);

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'bitrix24-report.xlsx',
  );
};
