import type { OcrEngine, OcrPageInput, OcrPageResult } from './types.js';

/** Deterministic engine for unit tests. */
export class MockOcrEngine implements OcrEngine {
  readonly id = 'mock';
  readonly capabilities = {
    languages: ['eng'],
    webgpu: false,
    bboxes: true,
    confidence: true,
  };

  recognizeCalls = 0;
  disposeCalls = 0;
  delayMs = 0;
  failOnPage: number | null = null;
  private pageCounter = 0;

  async init(): Promise<void> {}

  async recognize(input: OcrPageInput): Promise<OcrPageResult> {
    this.recognizeCalls += 1;
    const pageNum = this.pageCounter++;
    if (input.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (this.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, this.delayMs);
        input.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }
    if (this.failOnPage !== null && pageNum === this.failOnPage) {
      throw new Error(`mock failure page ${pageNum}`);
    }
    return {
      blocks: [
        {
          text: `mock-${pageNum}`,
          bbox: { x: 0, y: 0, w: input.width, h: 20 },
          confidence: 0.95,
          level: 'line',
        },
      ],
      fullText: `mock-${pageNum}`,
      engineId: this.id,
      durationMs: this.delayMs,
      route: 'ocr',
    };
  }

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
  }
}
