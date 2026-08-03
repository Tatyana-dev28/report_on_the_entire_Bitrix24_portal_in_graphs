import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { getPdfPageStyles, type BuiltReportPdfPages } from './buildReportPdfPages';
import { drawNativeTablePage } from './drawNativeTablePage';
import { ensurePdfCyrillicFont } from './pdfFonts';
import { escapeHtml } from './pdfHelpers';
import type { ExportReportPdfOptions, PdfHtmlPageSpec } from './pdfTypes';

const getRenderScale = (htmlPageCount: number) => {
  if (htmlPageCount > 6) {
    return 1.2;
  }
  if (htmlPageCount > 3) {
    return 1.4;
  }
  return 1.6;
};

const yieldToUi = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });

const releaseCanvas = (canvas: HTMLCanvasElement) => {
  canvas.width = 0;
  canvas.height = 0;
};

const forceWhiteBackgrounds = (root: ParentNode) => {
  const elements = root.querySelectorAll<HTMLElement>('*');
  elements.forEach((element) => {
    const style = element.style;
    if (!style) {
      return;
    }

    // Prevent html2canvas from painting transparent/dark app chrome into the page.
    if (!style.backgroundColor || style.backgroundColor === 'transparent') {
      style.backgroundColor = '#ffffff';
    }
  });
};

const renderHtmlPage = async (
  pdf: jsPDF,
  pageSpec: PdfHtmlPageSpec,
  built: BuiltReportPdfPages,
  exportRoot: HTMLElement,
  pageIndex: number,
  pageCount: number,
  renderScale: number,
) => {
  const {
    pageWidth,
    pageHeight,
    currentViewLabel,
    portalLabel,
    periodOptionLabel,
    periodLabel,
    generatedAt,
  } = built;
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();

  const page = document.createElement('section');
  page.className = 'pdf-page';
  page.style.background = '#ffffff';
  page.innerHTML = `
    <div class="pdf-header">
      <div>
        <div class="pdf-title">${escapeHtml(pageSpec.title)}</div>
        <div class="pdf-meta">
          <div>Портал: ${escapeHtml(portalLabel)}</div>
          <div>${escapeHtml(periodOptionLabel)} · Период: ${escapeHtml(periodLabel)}</div>
        </div>
      </div>
      <div class="pdf-generated">Дата формирования<br><b>${escapeHtml(generatedAt)}</b></div>
    </div>
    <div class="pdf-content">${pageSpec.buildBody()}</div>
    <div class="pdf-footer">
      <span>${escapeHtml(currentViewLabel)}</span>
      <span>Страница ${pageIndex + 1} из ${pageCount}</span>
    </div>
  `;
  exportRoot.appendChild(page);

  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = await html2canvas(page, {
      backgroundColor: '#ffffff',
      scale: renderScale,
      useCORS: true,
      allowTaint: false,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      width: pageWidth,
      height: pageHeight,
      windowWidth: pageWidth,
      windowHeight: pageHeight,
      onclone: (clonedDocument) => {
        const clonedRoot = clonedDocument.body;
        clonedRoot.style.background = '#ffffff';
        clonedRoot.style.color = '#202938';
        forceWhiteBackgrounds(clonedRoot);

        clonedDocument.querySelectorAll('svg').forEach((svg) => {
          svg.setAttribute('style', `${svg.getAttribute('style') ?? ''};background:#ffffff`);
          if (!svg.getAttribute('fill')) {
            svg.setAttribute('fill', 'none');
          }
        });
      },
    });

    // PNG avoids JPEG dark/black banding artifacts on white pages with thin chart lines.
    pdf.addImage(canvas, 'PNG', 0, 0, pdfWidth, pdfHeight, `page-${pageIndex}`, 'FAST');
  } finally {
    if (canvas) {
      releaseCanvas(canvas);
    }
    page.remove();
  }
};

export const renderReportPdf = async (
  built: BuiltReportPdfPages,
  options: ExportReportPdfOptions = {},
) => {
  const {
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
    tableDisplayLabel,
  } = built;

  const htmlPageCount = pages.filter((page) => page.kind === 'html').length;
  const needsHtmlRoot = htmlPageCount > 0;
  const exportRoot = needsHtmlRoot ? document.createElement('div') : null;

  if (exportRoot) {
    exportRoot.style.position = 'fixed';
    exportRoot.style.left = '-10000px';
    exportRoot.style.top = '0';
    exportRoot.style.width = `${pageWidth}px`;
    exportRoot.style.background = '#ffffff';
    exportRoot.style.color = '#202938';
    exportRoot.setAttribute('data-pdf-export-root', 'true');
    exportRoot.innerHTML = `<style>${getPdfPageStyles(format, pageWidth, pageHeight, pagePadding)}</style>`;
    document.body.appendChild(exportRoot);
  }

  try {
    const pdf = new jsPDF('l', 'mm', format);
    await ensurePdfCyrillicFont(pdf);

    // Explicit white page fill before any drawing (guards against default dark themes).
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), 'F');

    const renderScale = getRenderScale(htmlPageCount);

    for (let index = 0; index < pages.length; index += 1) {
      options.onProgress?.(index + 1, pages.length);

      if (index > 0) {
        pdf.addPage();
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), 'F');
        await yieldToUi();
      }

      const pageSpec = pages[index];

      if (pageSpec.kind === 'table') {
        drawNativeTablePage(
          pdf,
          pageSpec,
          {
            title: pageSpec.title,
            portalLabel,
            periodOptionLabel,
            periodLabel,
            tableDisplayLabel,
            generatedAt,
            currentViewLabel,
            pageNumber: index + 1,
            pageCount: pages.length,
          },
          format,
        );
        continue;
      }

      if (!exportRoot) {
        throw new Error('HTML PDF export root is missing');
      }

      await renderHtmlPage(pdf, pageSpec, built, exportRoot, index, pages.length, renderScale);
    }

    pdf.save('bitrix24-report.pdf');
  } finally {
    exportRoot?.remove();
  }
};
