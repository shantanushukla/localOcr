import type {
  EngineInitOptions,
  OcrBlock,
  OcrEngine,
  OcrPageInput,
  OcrPageResult,
} from '@localocr/ocr-core';
import { createWorker, type Worker } from 'tesseract.js';
import { tesseractBboxToOurs, tesseractConfidence } from './bbox.js';

export { tesseractBboxToOurs, tesseractConfidence } from './bbox.js';

/**
 * Tesseract.js only accepts encoded images / canvas / img / File / Blob —
 * not raw ImageData or ImageBitmap. Normalize so callers (e.g. region OCR)
 * never hit "Error attempting to read image."
 */
export function toTesseractImage(
  image: OcrPageInput['image'],
  width: number,
  height: number,
): HTMLCanvasElement | HTMLImageElement | Blob | File | string {
  if (typeof image === 'string') return image;
  if (typeof File !== 'undefined' && image instanceof File) return image;
  if (typeof Blob !== 'undefined' && image instanceof Blob) return image;
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    return image;
  }
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
    return image;
  }
  if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width || width;
    canvas.height = image.height || height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable for OffscreenCanvas convert');
    ctx.drawImage(image, 0, 0);
    return canvas;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable for Tesseract image convert');

  if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
    canvas.width = image.width || width;
    canvas.height = image.height || height;
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    canvas.width = image.width || width;
    canvas.height = image.height || height;
    ctx.drawImage(image, 0, 0);
    return canvas;
  }

  // Last resort: try as CanvasImageSource
  const src = image as CanvasImageSource & {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
  };
  canvas.width = src.naturalWidth ?? src.width ?? width;
  canvas.height = src.naturalHeight ?? src.height ?? height;
  ctx.drawImage(src, 0, 0);
  return canvas;
}

export class TesseractEngine implements OcrEngine {
  readonly id = 'tesseract.js';
  readonly capabilities = {
    languages: ['eng', 'osd'],
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

    const onAbort = () => {
      /* tesseract.js has no mid-recognize cancel; surface abort after */
    };
    input.signal?.addEventListener('abort', onAbort);

    try {
      const image = toTesseractImage(input.image, input.width, input.height) as Parameters<
        Worker['recognize']
      >[0];
      const { data } = await worker.recognize(image, undefined, {
        text: true,
        blocks: true,
      });

      if (input.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const blocks: OcrBlock[] = [];
      const pageBlocks = data.blocks ?? [];
      for (const block of pageBlocks) {
        for (const para of block.paragraphs ?? []) {
          for (const line of para.lines ?? []) {
            blocks.push({
              text: line.text.trim(),
              bbox: tesseractBboxToOurs(line.bbox),
              confidence: tesseractConfidence(line.confidence ?? 0),
              level: 'line',
            });
          }
        }
      }

      if (blocks.length === 0 && data.text?.trim()) {
        blocks.push({
          text: data.text.trim(),
          bbox: { x: 0, y: 0, w: input.width, h: input.height },
          confidence: tesseractConfidence(data.confidence ?? 0),
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
    } finally {
      input.signal?.removeEventListener('abort', onAbort);
    }
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
