/**
 * Build a searchable PDF (image + invisible text layer) entirely client-side.
 * Uses pdf-lib; Helvetica is WinAnsi-only — OCR Unicode (→, CJK, etc.) must never
 * reach widthOfTextAtSize / drawText or pdf-lib throws.
 */

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ExportDocument, OcrBlock } from './types.js';

export type SearchablePdfOptions = {
  /** Page images as PNG/JPEG bytes, keyed by page index. Missing pages get text-only. */
  pageImages?: Map<number, Uint8Array> | Record<number, Uint8Array>;
  /** Opacity of text layer (0 = fully invisible but selectable). Default 0. */
  textOpacity?: number;
  title?: string;
};

/** Common Unicode → ASCII substitutions for OCR / PDF text layer. */
const UNICODE_REPLACEMENTS: Record<string, string> = {
  '\u2010': '-',
  '\u2011': '-',
  '\u2012': '-',
  '\u2013': '-',
  '\u2014': '--',
  '\u2015': '--',
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': ',',
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u2022': '*',
  '\u2026': '...',
  '\u2032': "'",
  '\u2033': '"',
  '\u00A0': ' ',
  '\u00AD': '-',
  '\u2190': '<-',
  '\u2192': '->', // → — the char that was throwing WinAnsi
  '\u2191': '^',
  '\u2193': 'v',
  '\u21D0': '<=',
  '\u21D2': '=>',
  '\u00B7': '.',
  '\u2212': '-',
  '\u00D7': 'x',
  '\u00F7': '/',
  '\u2264': '<=',
  '\u2265': '>=',
  '\u2260': '!=',
  '\u2020': '+',
  '\u2021': '++',
  '\u2122': '(TM)',
  '\u00AE': '(R)',
  '\u00A9': '(C)',
  '\u20AC': 'EUR',
  '\u00A3': 'GBP',
  '\u00A5': 'Y',
  '\u00B0': ' deg',
  '\u202F': ' ',
  '\u2009': ' ',
  '\u200A': ' ',
  '\u200B': '',
  '\uFEFF': '',
};

/**
 * Strict WinAnsi-safe text for Helvetica.
 * Only printable ASCII (0x20–0x7E) remains after replacements — never throws in pdf-lib.
 */
export function toWinAnsiSafe(text: string): string {
  let out = '';
  for (const ch of text) {
    if (Object.prototype.hasOwnProperty.call(UNICODE_REPLACEMENTS, ch)) {
      out += UNICODE_REPLACEMENTS[ch]!;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += ' ';
      continue;
    }
    // Strict: only printable ASCII. Latin-1 is NOT fully WinAnsi-safe.
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
      continue;
    }
    out += ' ';
  }
  return out.replace(/[ \t]+/g, ' ').trim();
}

function measureTextWidth(font: PDFFont, text: string, size: number): number {
  // text is already ASCII-only; still guard so UI never crashes
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return Math.max(0, text.length * size * 0.5);
  }
}

function getImage(
  map: SearchablePdfOptions['pageImages'],
  index: number,
): Uint8Array | undefined {
  if (!map) return undefined;
  if (map instanceof Map) return map.get(index);
  return map[index];
}

function drawSafeText(
  pdfPage: PDFPage,
  font: PDFFont,
  raw: string,
  opts: {
    x: number;
    y: number;
    size: number;
    opacity: number;
    maxWidth?: number;
    lineHeight?: number;
    color?: ReturnType<typeof rgb>;
  },
): void {
  const text = toWinAnsiSafe(raw);
  if (!text) return;
  try {
    pdfPage.drawText(text, {
      x: opts.x,
      y: opts.y,
      size: opts.size,
      font,
      color: opts.color ?? rgb(0, 0, 0),
      opacity: opts.opacity,
      maxWidth: opts.maxWidth,
      lineHeight: opts.lineHeight,
    });
  } catch {
    /* never surface WinAnsi errors to the UI */
  }
}

/**
 * Embed OCR blocks as text at approx bbox positions over optional page images.
 */
export async function jobToSearchablePdf(
  doc: ExportDocument,
  opts: SearchablePdfOptions = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(toWinAnsiSafe(opts.title ?? doc.fileName) || 'OCR export');
  pdf.setProducer('localOCR (browser-local)');
  pdf.setCreator('localOCR');

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const opacity = opts.textOpacity ?? 0;
  const textOpacity = opacity === 0 ? 0.0001 : opacity;

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
      const raw = block.text?.trim();
      if (!raw) continue;
      const text = toWinAnsiSafe(raw);
      if (!text) continue;
      const { x, y, w, h } = block.bbox;
      const fontSize = Math.max(6, Math.min(h * 0.85, 48));
      const drawY = height - y - h;
      let size = fontSize;
      const textWidth = measureTextWidth(font, text, size);
      if (w > 0 && textWidth > w * 1.05) {
        size = Math.max(4, size * (w / textWidth));
      }
      drawSafeText(pdfPage, font, text, {
        x: Math.max(0, x),
        y: Math.max(0, drawY),
        size,
        opacity: textOpacity,
        maxWidth: w > 0 ? w : undefined,
      });
    }

    if (blocks.length === 0 && page.fullText?.trim()) {
      drawSafeText(pdfPage, font, page.fullText.slice(0, 2000), {
        x: 24,
        y: height - 40,
        size: 10,
        opacity: textOpacity,
        maxWidth: width - 48,
        lineHeight: 12,
      });
    }
  }

  if (doc.pages.length === 0) {
    const empty = pdf.addPage([612, 792]);
    drawSafeText(empty, font, 'No OCR pages', {
      x: 50,
      y: 700,
      size: 12,
      opacity: 1,
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
