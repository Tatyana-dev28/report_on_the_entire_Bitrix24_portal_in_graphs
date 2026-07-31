import type { jsPDF } from 'jspdf';
import { PDF_FONT_FAMILY } from './pdfFonts';
import type { PdfPageChrome, PdfPageFormat, PdfTablePageSpec } from './pdfTypes';

const COLORS = {
  text: [32, 41, 56] as const,
  meta: [95, 107, 122] as const,
  footer: [106, 116, 130] as const,
  border: [223, 231, 241] as const,
  headerBg: [234, 244, 255] as const,
  headerText: [47, 58, 74] as const,
  sectionBg: [245, 247, 250] as const,
  employee: [79, 92, 107] as const,
  white: [255, 255, 255] as const,
};

const fitText = (pdf: jsPDF, text: string, maxWidth: number) => {
  const value = String(text ?? '');
  if (!value || pdf.getTextWidth(value) <= maxWidth) {
    return value;
  }

  let truncated = value;
  while (truncated.length > 1 && pdf.getTextWidth(`${truncated}…`) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }

  return `${truncated}…`;
};

const drawPageChrome = (pdf: jsPDF, chrome: PdfPageChrome, format: PdfPageFormat) => {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = format === 'a3' ? 10 : 9;
  const contentWidth = pageWidth - margin * 2;

  pdf.setFillColor(...COLORS.white);
  pdf.rect(0, 0, pageWidth, pageHeight, 'F');

  pdf.setFont(PDF_FONT_FAMILY, 'bold');
  pdf.setFontSize(format === 'a3' ? 16 : 14);
  pdf.setTextColor(...COLORS.text);
  pdf.text(fitText(pdf, chrome.title, contentWidth * 0.72), margin, margin + 5);

  pdf.setFont(PDF_FONT_FAMILY, 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(...COLORS.meta);
  pdf.text(`Портал: ${chrome.portalLabel}`, margin, margin + 11);
  pdf.text(`${chrome.periodOptionLabel} · Период: ${chrome.periodLabel}`, margin, margin + 16);

  pdf.setFontSize(8.5);
  const generatedLabel = 'Дата формирования';
  const generatedWidth = Math.max(
    pdf.getTextWidth(generatedLabel),
    pdf.getTextWidth(chrome.generatedAt),
  );
  const generatedX = pageWidth - margin - generatedWidth;
  pdf.text(generatedLabel, generatedX, margin + 5, { align: 'left' });
  pdf.setFont(PDF_FONT_FAMILY, 'bold');
  pdf.text(chrome.generatedAt, generatedX, margin + 10, { align: 'left' });

  pdf.setDrawColor(...COLORS.border);
  pdf.setLineWidth(0.2);
  pdf.line(margin, margin + 20, pageWidth - margin, margin + 20);

  const footerY = pageHeight - margin;
  pdf.setDrawColor(...COLORS.border);
  pdf.line(margin, footerY - 6, pageWidth - margin, footerY - 6);
  pdf.setFont(PDF_FONT_FAMILY, 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(...COLORS.footer);
  pdf.text(fitText(pdf, chrome.currentViewLabel, contentWidth * 0.65), margin, footerY - 1.5);
  pdf.text(`Страница ${chrome.pageNumber} из ${chrome.pageCount}`, pageWidth - margin, footerY - 1.5, {
    align: 'right',
  });

  return {
    margin,
    contentTop: margin + 24,
    contentBottom: footerY - 10,
    contentWidth,
  };
};

export const drawNativeTablePage = (
  pdf: jsPDF,
  page: PdfTablePageSpec,
  chrome: PdfPageChrome,
  format: PdfPageFormat,
) => {
  const { margin, contentTop, contentBottom, contentWidth } = drawPageChrome(pdf, chrome, format);
  const tableTop = contentTop;
  const availableHeight = Math.max(20, contentBottom - tableTop);
  const columnCount = page.headers.length + 1;
  const labelWidth = format === 'a3' ? 74 : 62;
  const valueWidth = Math.max(12, (contentWidth - labelWidth) / Math.max(1, page.headers.length));
  const fontSize = format === 'a3' ? 9 : 8.5;
  const rowCount = page.rows.length + 1;
  const rowHeight = Math.min(9.5, availableHeight / rowCount);

  const columnX = (columnIndex: number) => {
    if (columnIndex === 0) {
      return margin;
    }
    return margin + labelWidth + (columnIndex - 1) * valueWidth;
  };

  const columnWidth = (columnIndex: number) => (columnIndex === 0 ? labelWidth : valueWidth);

  const drawCell = (
    columnIndex: number,
    rowIndex: number,
    text: string,
    options: {
      fill?: readonly [number, number, number];
      textColor?: readonly [number, number, number];
      bold?: boolean;
      align?: 'left' | 'center';
      colspan?: number;
    } = {},
  ) => {
    const x = columnX(columnIndex);
    const y = tableTop + rowIndex * rowHeight;
    const span = options.colspan ?? 1;
    let width = 0;
    for (let index = 0; index < span; index += 1) {
      width += columnWidth(columnIndex + index);
    }

    pdf.setFillColor(...(options.fill ?? COLORS.white));
    pdf.setDrawColor(...COLORS.border);
    pdf.setLineWidth(0.15);
    pdf.rect(x, y, width, rowHeight, 'FD');

    pdf.setFont(PDF_FONT_FAMILY, options.bold ? 'bold' : 'normal');
    pdf.setFontSize(fontSize);
    pdf.setTextColor(...(options.textColor ?? COLORS.text));

    const paddingX = 1.6;
    const maxTextWidth = Math.max(4, width - paddingX * 2);
    const fitted = fitText(pdf, text, maxTextWidth);
    const textY = y + rowHeight / 2 + fontSize * 0.28;

    if (options.align === 'center') {
      pdf.text(fitted, x + width / 2, textY, { align: 'center' });
    } else {
      pdf.text(fitted, x + paddingX, textY);
    }
  };

  drawCell(0, 0, 'Показатели', {
    fill: COLORS.headerBg,
    textColor: COLORS.headerText,
    bold: true,
    align: 'left',
  });
  page.headers.forEach((header, index) => {
    drawCell(index + 1, 0, header, {
      fill: COLORS.headerBg,
      textColor: COLORS.headerText,
      bold: true,
      align: 'center',
    });
  });

  page.rows.forEach((row, rowIndex) => {
    const tableRowIndex = rowIndex + 1;

    if (row.kind === 'section') {
      drawCell(0, tableRowIndex, row.label, {
        fill: COLORS.sectionBg,
        textColor: COLORS.text,
        bold: true,
        align: 'left',
        colspan: columnCount,
      });
      return;
    }

    drawCell(0, tableRowIndex, row.label, {
      textColor: row.kind === 'employee' ? COLORS.employee : COLORS.text,
      align: 'left',
    });

    row.cells.forEach((cell, cellIndex) => {
      drawCell(cellIndex + 1, tableRowIndex, cell, {
        align: 'center',
      });
    });
  });
};
