/**
 * Build a searchable PDF (image + invisible text layer) entirely client-side.
 * Uses pdf-lib; call only from browser or Node with canvas-free pure PDF path.
 *
 * StandardFonts.Helvetica is WinAnsi-only. OCR often emits Unicode (→, curly
 * quotes, CJK). We sanitize to WinAnsi before measure/draw so export never throws.
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

/** Common Unicode → WinAnsi/ASCII substitutions for OCR text. */
const UNICODE_REPLACEMENTS: Record<string, string> = {
  '\u2010': '-', // hyphen
  '\u2011': '-', // non-breaking hyphen
  '\u2012': '-', // figure dash
  '\u2013': '-', // en dash
  '\u2014': '--', // em dash
  '\u2015': '--', // horizontal bar
  '\u2018': "'", // left single quote
  '\u2019': "'", // right single quote
  '\u201A': ',', // single low-9 quote
  '\u201C': '"', // left double quote
  '\u201D': '"', // right double quote
  '\u201E': '"', // double low-9 quote
  '\u2022': '*', // bullet
  '\u2026': '...', // ellipsis
  '\u2032': "'", // prime
  '\u2033': '"', // double prime
  '\u00A0': ' ', // nbsp
  '\u00AD': '-', // soft hyphen
  '\u2190': '<-', // ←
  '\u2192': '->', // →
  '\u2191': '^', // ↑
  '\u2193': 'v', // ↓
  '\u21D2': '=>', // ⇒
  '\u21D0': '<=', // ⇐
  '\u00B7': '.', // middle dot
  '\u2212': '-', // minus
  '\u00D7': 'x', // multiplication
  '\u00F7': '/', // division
  '\u2264': '<=', // ≤
  '\u2265': '>=', // ≥
  '\u2260': '!=', // ≠
  '\u2020': '+', // dagger
  '\u2021': '++', // double dagger
  '\u2122': '(TM)',
  '\u00AE': '(R)',
  '\u00A9': '(C)',
  '\u20AC': 'EUR', // euro (WinAnsi has it in some encodings; keep safe)
  '\u00A3': 'GBP',
  '\u00A5': 'Y',
};

/**
 * Make text safe for Helvetica / WinAnsi encoding used by pdf-lib StandardFonts.
 * Replaces common symbols; drops remaining non-encodable code points.
 */
export function toWinAnsiSafe(text: string): string {
  let out = '';
  for (const ch of text) {
    if (Object.prototype.hasOwnProperty.call(UNICODE_REPLACEMENTS, ch)) {
      out += UNICODE_REPLACEMENTS[ch]!;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    // Printable ASCII + Latin-1 supplement that WinAnsi covers (rough filter)
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += ' ';
      continue;
    }
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
      continue;
    }
    // Latin-1 / common WinAnsi range (0xA0–0xFF excluding a few holes)
    if (code >= 0xa0 && code <= 0xff) {
      out += ch;
      continue;
    }
    // Drop unencodable glyphs (CJK, emoji, etc.) rather than throw
    out += ' ';
  }
  return out.replace(/[ \t]+/g, ' ').trim();
}

function safeWidthOfTextAtSize(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    // Final guard: strip to pure ASCII if font still rejects
    const ascii = text.replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!ascii) return 0;
    try {
      return font.widthOfTextAtSize(ascii, size);
    } catch {
      return ascii.length * size * 0.5;
    }
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
    // Last resort: ASCII-only
    const ascii = text.replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!ascii) return;
    try {
      pdfPage.drawText(ascii, {
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
      /* skip unencodable run */
    }
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
  // Titles can also contain Unicode; pdf-lib metadata is more tolerant but keep clean
  pdf.setTitle(toWinAnsiSafe(opts.title ?? doc.fileName) || 'OCR export');
  pdf.setProducer('localOCR (browser-local)');
  pdf.setCreator('localOCR');

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const opacity = opts.textOpacity ?? 0;
  const textOpacity = opacity === 0 ? 0.0001 : opacity; // fully 0 can be stripped by some viewers

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
      // PDF origin is bottom-left; OCR bbox origin is top-left.
      const fontSize = Math.max(6, Math.min(h * 0.85, 48));
      const drawY = height - y - h;
      let size = fontSize;
      const textWidth = safeWidthOfTextAtSize(font, text, size);
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

    // Fallback: if no blocks, place fullText at top
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
