import type { OcrBlock, OcrPageResult } from '@localocr/ocr-core';

/** Minimum characters to treat a PDF page as digital (skip OCR). */
export const MIN_TEXT_CHARS = 20;

export type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
};

export function joinTextItems(items: PdfTextItem[]): string {
  return items
    .map((it) => (it.str ? String(it.str) : ''))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shouldUseDigitalPath(fullText: string, minChars = MIN_TEXT_CHARS): boolean {
  return fullText.length >= minChars;
}

/**
 * Convert pdf.js text items + viewport scale into OcrBlocks.
 * PDF user space y grows up; canvas y grows down.
 */
export function textItemsToBlocks(
  items: PdfTextItem[],
  scale: number,
  pageHeightPx: number,
): OcrBlock[] {
  const blocks: OcrBlock[] = [];
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const t = item.transform;
    if (!t || t.length < 6) continue;
    const x = t[4]! * scale;
    const yPdf = t[5]! * scale;
    const w = ((item.width ?? 40) || 40) * scale;
    const h = Math.abs(t[3] || t[0] || 12) * scale;
    const y = pageHeightPx - yPdf - h;
    blocks.push({
      text: String(item.str).trim(),
      bbox: { x, y: Math.max(0, y), w, h: Math.max(h, 8) },
      confidence: 1,
      level: 'word',
    });
  }
  return blocks;
}

export function buildDigitalPageResult(
  fullText: string,
  blocks: OcrBlock[],
  width: number,
  height: number,
): OcrPageResult {
  return {
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
}
