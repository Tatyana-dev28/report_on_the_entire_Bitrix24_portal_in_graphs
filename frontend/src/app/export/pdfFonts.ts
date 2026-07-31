import type { jsPDF } from 'jspdf';

import dejavuSansUrl from './fonts/DejaVuSans.ttf?url';
import dejavuSansBoldUrl from './fonts/DejaVuSans-Bold.ttf?url';

export const PDF_FONT_FAMILY = 'DejaVuSans';

let fontLoadPromise: Promise<{ regular: string; bold: string }> | null = null;

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const loadFontBase64 = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load PDF font: ${url}`);
  }

  return arrayBufferToBase64(await response.arrayBuffer());
};

const loadPdfFontPayloads = () => {
  if (!fontLoadPromise) {
    fontLoadPromise = Promise.all([
      loadFontBase64(dejavuSansUrl),
      loadFontBase64(dejavuSansBoldUrl),
    ]).then(([regular, bold]) => ({ regular, bold }));
  }

  return fontLoadPromise;
};

export const ensurePdfCyrillicFont = async (pdf: jsPDF) => {
  const { regular, bold } = await loadPdfFontPayloads();

  pdf.addFileToVFS('DejaVuSans.ttf', regular);
  pdf.addFileToVFS('DejaVuSans-Bold.ttf', bold);
  pdf.addFont('DejaVuSans.ttf', PDF_FONT_FAMILY, 'normal');
  pdf.addFont('DejaVuSans-Bold.ttf', PDF_FONT_FAMILY, 'bold');
  pdf.setFont(PDF_FONT_FAMILY, 'normal');
};
