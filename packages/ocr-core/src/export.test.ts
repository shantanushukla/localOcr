import { describe, expect, it } from 'vitest';
import { jobToExportDocument, jobToMarkdown, jobToPlainText } from './export.js';
import type { OcrJob } from './types.js';

function sampleJob(): OcrJob {
  return {
    id: 'j1',
    fileName: 'invoice.pdf',
    status: 'done',
    engineId: 'mock',
    createdAt: 1,
    pages: [
      {
        index: 0,
        status: 'done',
        width: 100,
        height: 200,
        result: {
          fullText: 'Hello',
          engineId: 'mock',
          durationMs: 10,
          blocks: [
            {
              text: 'Hello',
              bbox: { x: 1, y: 2, w: 30, h: 12 },
              confidence: 0.99,
              level: 'line',
            },
          ],
        },
      },
      {
        index: 1,
        status: 'done',
        width: 100,
        height: 200,
        result: {
          fullText: 'World',
          engineId: 'mock',
          durationMs: 8,
          blocks: [
            {
              text: 'World',
              bbox: { x: 0, y: 0, w: 40, h: 10 },
              confidence: 0.9,
              level: 'line',
            },
          ],
        },
      },
      { index: 2, status: 'failed', error: 'x' },
    ],
  };
}

describe('export', () => {
  it('jobToPlainText joins pages', () => {
    expect(jobToPlainText(sampleJob())).toContain('Hello');
    expect(jobToPlainText(sampleJob())).toContain('World');
    expect(jobToPlainText(sampleJob())).toContain('---');
  });

  it('jobToMarkdown includes headings', () => {
    const md = jobToMarkdown(sampleJob());
    expect(md).toContain('# invoice.pdf');
    expect(md).toContain('## Page 1');
    expect(md).toContain('Hello');
  });

  it('jobToExportDocument schema v1', () => {
    const doc = jobToExportDocument(sampleJob());
    expect(doc.version).toBe(1);
    expect(doc.engine).toBe('mock');
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages[0]!.blocks[0]!.bbox).toEqual({ x: 1, y: 2, w: 30, h: 12 });
    expect(doc.pages[0]!.blocks[0]!.confidence).toBe(0.99);
  });
});
