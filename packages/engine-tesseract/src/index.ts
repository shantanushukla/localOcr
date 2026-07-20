import type {
  EngineInitOptions,
  OcrBlock,
  OcrEngine,
  OcrPageInput,
  OcrPageResult,
} from '@localocr/ocr-core';
import { createWorker, type Worker } from 'tesseract.js';

function tesseractBboxToOurs(b: { x0: number; y0: number; x1: number; y1: number }) {
  return {
    x: b.x0,
    y: b.y0,
    w: Math.max(0, b.x1 - b.x0),
    h: Math.max(0, b.y1 - b.y0),
  };
}

export class TesseractEngine implements OcrEngine {
  readonly id = 'tesseract.js';
  readonly capabilities = {
    languages: ['eng', 'osd'], // extended at runtime via lang packs
    webgpu: false,
    bboxes: true,
    confidence: true,
  };

  private worker: Worker | null = null;
  private language = 'eng';

  async init(opts: EngineInitOptions = {}): Promise<void> {
    this.language = opts.language ?? 'eng';
    if (this.worker) {
      await this.worker.reinitialize(this.language);
      return;
    }
    this.worker = await createWorker(this.language, 1, {
      // CDN defaults work; override via workerPath if self-hosting
      logger: () => {},
    });
  }

  async recognize(input: OcrPageInput): Promise<OcrPageResult> {
    if (!this.worker) await this.init({ language: this.language });
    const worker = this.worker!;
    const t0 = performance.now();

    if (input.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const image = input.image as Parameters<Worker['recognize']>[0];
    const { data } = await worker.recognize(image, undefined, {
      text: true,
      blocks: true,
    });

    const blocks: OcrBlock[] = [];
    const pageBlocks = data.blocks ?? [];
    for (const block of pageBlocks) {
      for (const para of block.paragraphs ?? []) {
        for (const line of para.lines ?? []) {
          blocks.push({
            text: line.text.trim(),
            bbox: tesseractBboxToOurs(line.bbox),
            confidence: Math.min(1, Math.max(0, (line.confidence ?? 0) / 100)),
            level: 'line',
          });
        }
      }
    }

    // Fallback if blocks empty but text present
    if (blocks.length === 0 && data.text?.trim()) {
      blocks.push({
        text: data.text.trim(),
        bbox: { x: 0, y: 0, w: input.width, h: input.height },
        confidence: Math.min(1, Math.max(0, (data.confidence ?? 0) / 100)),
        level: 'page',
      });
    }

    return {
      blocks,
      fullText: data.text?.trim() ?? blocks.map((b) => b.text).join('\n'),
      engineId: this.id,
      durationMs: Math.round(performance.now() - t0),
      route: 'ocr',
    };
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

export function createTesseractEngine(): OcrEngine {
  return new TesseractEngine();
}
