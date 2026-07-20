import type { OcrBlock, OcrPageResult, PageSource } from '@localocr/ocr-core';
import * as pdfjs from 'pdfjs-dist';

// Vite will rewrite this worker import
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export type PreparedPdf = {
  fileName: string;
  pageCount: number;
  pages: PageSource[];
};

const MIN_TEXT_CHARS = 20;

/**
 * Load a PDF, extract digital text when rich enough, else rasterize for OCR.
 */
export async function preparePdf(
  file: File | ArrayBuffer,
  opts: { scale?: number; fileName?: string } = {},
): Promise<PreparedPdf> {
  const scale = opts.scale ?? 2;
  const data = file instanceof File ? await file.arrayBuffer() : file;
  const fileName =
    opts.fileName ?? (file instanceof File ? file.name : 'document.pdf');

  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: PageSource[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const width = Math.floor(viewport.width);
    const height = Math.floor(viewport.height);

    // Digital text attempt
    const textContent = await page.getTextContent();
    const strings = textContent.items
      .map((it) => ('str' in it ? String(it.str) : ''))
      .filter(Boolean);
    const fullText = strings.join(' ').replace(/\s+/g, ' ').trim();

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const previewUrl = canvas.toDataURL('image/png');

    if (fullText.length >= MIN_TEXT_CHARS) {
      const blocks: OcrBlock[] = [];
      // Build rough line boxes from text items when transform present
      for (const item of textContent.items) {
        if (!('str' in item) || !item.str?.trim()) continue;
        const t = 'transform' in item ? (item.transform as number[]) : null;
        if (t && t.length >= 6) {
          const x = t[4]! * scale;
          const y = height - t[5]! * scale;
          const w = (('width' in item ? Number(item.width) : 40) || 40) * scale;
          const h = Math.abs(t[3] || t[0] || 12) * scale;
          blocks.push({
            text: String(item.str).trim(),
            bbox: { x, y: y - h, w, h: Math.max(h, 8) },
            confidence: 1,
            level: 'word',
          });
        }
      }

      const digitalResult: OcrPageResult = {
        blocks:
          blocks.length > 0
            ? blocks
            : [
                {
                  text: fullText,
                  bbox: { x: 0, y: 0, w: width, h: height },
                  confidence: 1,
                  level: 'page',
                },
              ],
        fullText,
        engineId: 'pdfjs-text',
        durationMs: 0,
        route: 'digital',
      };

      pages.push({
        index: i - 1,
        width,
        height,
        image: canvas,
        previewUrl,
        digitalResult,
      });
    } else {
      pages.push({
        index: i - 1,
        width,
        height,
        image: canvas,
        previewUrl,
      });
    }
  }

  return { fileName, pageCount: doc.numPages, pages };
}

export async function prepareImage(file: File): Promise<PageSource> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return {
    index: 0,
    width,
    height,
    image: canvas,
    previewUrl: url,
  };
}
