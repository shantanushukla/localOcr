import type { PageSource } from '@localocr/ocr-core';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  buildDigitalPageResult,
  joinTextItems,
  shouldUseDigitalPath,
  textItemsToBlocks,
  type PdfTextItem,
} from './text.js';

export * from './text.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export type PreparedPdf = {
  fileName: string;
  pageCount: number;
  pages: PageSource[];
};

/**
 * Load a PDF, extract digital text when rich enough, else rasterize for OCR.
 */
export async function preparePdf(
  file: File | ArrayBuffer,
  opts: { scale?: number; fileName?: string; minTextChars?: number } = {},
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

    const textContent = await page.getTextContent();
    const items = textContent.items as PdfTextItem[];
    const fullText = joinTextItems(items);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');

    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const previewUrl = canvas.toDataURL('image/png');

    if (shouldUseDigitalPath(fullText, opts.minTextChars)) {
      const blocks = textItemsToBlocks(items, scale, height);
      pages.push({
        index: i - 1,
        width,
        height,
        image: canvas,
        previewUrl,
        digitalResult: buildDigitalPageResult(fullText, blocks, width, height),
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

export async function prepareImage(
  file: File | Blob,
  opts: { preprocess?: boolean; deskew?: boolean } = {},
): Promise<PageSource> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let width = img.naturalWidth;
    let height = img.naturalHeight;
    let canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.drawImage(img, 0, 0);

    if (opts.preprocess || opts.deskew) {
      const { canvasFromSource } = await import('@localocr/ocr-core');
      canvas = canvasFromSource(canvas, width, height, {
        grayscale: Boolean(opts.preprocess),
        contrast: opts.preprocess ? 1.15 : 1,
        deskew: Boolean(opts.deskew),
      });
      width = canvas.width;
      height = canvas.height;
    }

    const previewUrl = canvas.toDataURL('image/png');
    return {
      index: 0,
      width,
      height,
      image: canvas,
      previewUrl,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
