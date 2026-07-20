/**
 * Build a searchable PDF (image + invisible text layer) entirely client-side.
 * Uses pdf-lib; call only from browser or Node with canvas-free pure PDF path.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { ExportDocument, OcrBlock } from './types.js';

export type SearchablePdfOptions = {
  /** Page images as PNG/JPEG bytes, keyed by page index. Missing pages get text-only. */
  pageImages?: Map<number, Uint8Array> | Record<number, Uint8Array>;
  /** Opacity of text layer (0 = fully invisible but selectable). Default 0. */
  textOpacity?: number;
  title?: string;
};

function getImage(
  map: SearchablePdfOptions['pageImages'],
  index: number,
): Uint8Array | undefined {
  if (!map) return undefined;
  if (map instanceof Map) return map.get(index);
  return map[index];
}

/**
 * Embed OCR blocks as text at approx bbox positions over optional page images.
 */
export async function jobToSearchablePdf(
  doc: ExportDocument,
  opts: SearchablePdfOptions = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(opts.title ?? doc.fileName);
  pdf.setProducer('localOCR (browser-local)');
  pdf.setCreator('localOCR');

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const opacity = opts.textOpacity ?? 0;

  for (const page of doc.pages) {
    const imgBytes = getImage(opts.pageImages, page.index);
    let width = page.width || 612;
    let height = page.height || 792;
    let embedded;

    if (imgBytes) {
      try {
        embedded = await pdf.embedPng(imgBytes);
      } catch {
        try {
          embedded = await pdf.embedJpg(imgBytes);
        } catch {
          embedded = undefined;
        }
      }
      if (embedded) {
        width = embedded.width;
        height = embedded.height;
      }
    }

    const pdfPage = pdf.addPage([width, height]);
    if (embedded) {
      pdfPage.drawImage(embedded, { x: 0, y: 0, width, height });
    }

    const blocks: OcrBlock[] = page.blocks ?? [];
    for (const block of blocks) {
      const text = block.text?.trim();
      if (!text) continue;
      const { x, y, w, h } = block.bbox;
      // PDF origin is bottom-left; OCR bbox origin is top-left.
      const fontSize = Math.max(6, Math.min(h * 0.85, 48));
      const drawY = height - y - h;
      // Scale font to roughly fit width
      let size = fontSize;
      const textWidth = font.widthOfTextAtSize(text, size);
      if (w > 0 && textWidth > w * 1.05) {
        size = Math.max(4, size * (w / textWidth));
      }
      try {
        pdfPage.drawText(text, {
          x: Math.max(0, x),
          y: Math.max(0, drawY),
          size,
          font,
          color: rgb(0, 0, 0),
          opacity: opacity === 0 ? 0.0001 : opacity, // fully 0 can be stripped by some viewers
          maxWidth: w > 0 ? w : undefined,
        });
      } catch {
        // Skip glyphs Helvetica can't encode (non-latin)
      }
    }

    // Fallback: if no blocks, place fullText at top
    if (blocks.length === 0 && page.fullText?.trim()) {
      try {
        pdfPage.drawText(page.fullText.slice(0, 2000), {
          x: 24,
          y: height - 40,
          size: 10,
          font,
          color: rgb(0, 0, 0),
          opacity: opacity === 0 ? 0.0001 : opacity,
          maxWidth: width - 48,
          lineHeight: 12,
        });
      } catch {
        /* ignore */
      }
    }
  }

  if (doc.pages.length === 0) {
    const empty = pdf.addPage([612, 792]);
    empty.drawText('No OCR pages', {
      x: 50,
      y: 700,
      size: 12,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
  }

  return pdf.save();
}

/** Trigger a browser download of PDF bytes. */
export function downloadPdfBytes(bytes: Uint8Array, fileName: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}
