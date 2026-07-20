import { describe, expect, it, vi } from 'vitest';
import { JobOrchestrator, type PageSource } from './orchestrator.js';
import { MockOcrEngine } from './mock-engine.js';
import type { OcrEngine, OcrPageInput, OcrPageResult } from './types.js';

function pages(n: number): PageSource[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    width: 100,
    height: 50,
    image: `page-${i}`,
  }));
}

/** Engine that blocks until `release()` is called. */
class BlockingEngine implements OcrEngine {
  readonly id = 'blocking';
  readonly capabilities = {
    languages: ['eng'],
    webgpu: false,
    bboxes: true,
    confidence: true,
  };
  recognizeCalls = 0;
  private resolvers: Array<() => void> = [];

  releaseOne() {
    this.resolvers.shift()?.();
  }

  async init(): Promise<void> {}
  async dispose(): Promise<void> {}

  async recognize(input: OcrPageInput): Promise<OcrPageResult> {
    this.recognizeCalls += 1;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      input.signal?.addEventListener('abort', onAbort, { once: true });
      this.resolvers.push(() => {
        input.signal?.removeEventListener('abort', onAbort);
        resolve();
      });
    });
    return {
      blocks: [{ text: 'ok', bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1, level: 'line' }],
      fullText: 'ok',
      engineId: this.id,
      durationMs: 1,
      route: 'ocr',
    };
  }
}

describe('JobOrchestrator', () => {
  it('processes pages sequentially and skips digital OCR', async () => {
    const engine = new MockOcrEngine();
    const orch = new JobOrchestrator(engine);
    const sources: PageSource[] = [
      {
        index: 0,
        width: 10,
        height: 10,
        image: 'x',
        digitalResult: {
          blocks: [
            { text: 'digital', bbox: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1, level: 'page' },
          ],
          fullText: 'digital',
          engineId: 'pdfjs-text',
          durationMs: 0,
          route: 'digital',
        },
      },
      { index: 1, width: 10, height: 10, image: 'y' },
    ];
    const job = await orch.run('doc.pdf', sources);
    expect(job.status).toBe('done');
    expect(engine.recognizeCalls).toBe(1);
    expect(job.pages[0]!.result?.route).toBe('digital');
    expect(job.pages[0]!.result?.fullText).toBe('digital');
    expect(job.pages[1]!.result?.fullText).toBe('mock-0');
  });

  it('cancels remaining pages', async () => {
    const engine = new BlockingEngine();
    const orch = new JobOrchestrator(engine);
    const runPromise = orch.run('slow.pdf', pages(3));
    // Wait until first recognize is blocked
    await vi.waitFor(() => expect(engine.recognizeCalls).toBe(1));
    orch.cancel();
    engine.releaseOne();
    const job = await runPromise;
    expect(job.status).toBe('cancelled');
    expect(job.pages.filter((p) => p.status === 'cancelled').length).toBeGreaterThan(0);
    expect(engine.recognizeCalls).toBe(1);
  });

  it('marks failed pages but continues', async () => {
    const engine = new MockOcrEngine();
    engine.failOnPage = 0;
    const onErr = vi.fn();
    const orch = new JobOrchestrator(engine, { onPageError: onErr });
    const job = await orch.run('mix.pdf', pages(2));
    expect(job.pages[0]!.status).toBe('failed');
    expect(job.pages[1]!.status).toBe('done');
    expect(job.status).toBe('done');
    expect(onErr).toHaveBeenCalledOnce();
  });

  it('fails job when all pages fail', async () => {
    const engine = new MockOcrEngine();
    engine.failOnPage = 0;
    const orch = new JobOrchestrator(engine);
    const job = await orch.run('bad.pdf', pages(1));
    expect(job.status).toBe('failed');
  });
});
