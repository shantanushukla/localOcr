import { describe, expect, it } from 'vitest';
import { jobToSearchablePdf, toWinAnsiSafe } from './searchable-pdf.js';
import type { ExportDocument } from './types.js';

const sample: ExportDocument = {
  version: 1,
  engine: 'mock',
  fileName: 'sample.png',
  pages: [
    {
      index: 0,
      width: 400,
      height: 300,
      fullText: 'Hello searchable world',
      blocks: [
        {
          text: 'Hello',
          bbox: { x: 10, y: 20, w: 80, h: 16 },
          confidence: 0.99,
          level: 'line',
        },
        {
          text: 'searchable world',
          bbox: { x: 10, y: 50, w: 160, h: 16 },
          confidence: 0.95,
          level: 'line',
        },
      ],
    },
  ],
};

describe('toWinAnsiSafe', () => {
  it('replaces arrow and punctuation that break Helvetica', () => {
    expect(toWinAnsiSafe('A → B')).toBe('A -> B');
    expect(toWinAnsiSafe('“quoted”')).toBe('"quoted"');
    expect(toWinAnsiSafe('cost ≤ $5')).toMatch(/cost <=/);
  });

  it('keeps plain ASCII', () => {
    expect(toWinAnsiSafe('Invoice #1842')).toBe('Invoice #1842');
  });
});

describe('jobToSearchablePdf', () => {
  it('produces a non-empty PDF with header', async () => {
    const bytes = await jobToSearchablePdf(sample);
    expect(bytes.byteLength).toBeGreaterThan(200);
    const head = new TextDecoder().decode(bytes.slice(0, 8));
    expect(head.startsWith('%PDF')).toBe(true);
  });

  it('handles empty pages list', async () => {
    const bytes = await jobToSearchablePdf({
      ...sample,
      pages: [],
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('does not throw on Unicode arrows (WinAnsi)', async () => {
    const doc: ExportDocument = {
      ...sample,
      pages: [
        {
          index: 0,
          width: 400,
          height: 300,
          fullText: 'A → B ≤ C “hi”',
          blocks: [
            {
              text: 'A → B ≤ C “hi”',
              bbox: { x: 10, y: 20, w: 200, h: 16 },
              confidence: 0.9,
              level: 'line',
            },
          ],
        },
      ],
    };
    const bytes = await jobToSearchablePdf(doc);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(200);
  });
});
