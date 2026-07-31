import { buildReportPdfPages } from './buildReportPdfPages';
import { renderReportPdf } from './renderReportPdf';
import type { ExportReportPdfInput, ExportReportPdfOptions } from './pdfTypes';

export type { ExportReportPdfInput, ExportReportPdfOptions } from './pdfTypes';

export const exportReportPdf = async (
  input: ExportReportPdfInput,
  options: ExportReportPdfOptions = {},
) => {
  if (!input.hasBuiltReport || !input.reportData.length) {
    return;
  }

  const built = buildReportPdfPages(input);
  await renderReportPdf(built, options);
};
