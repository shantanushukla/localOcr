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
 * Encode a canvas as PNG data URL for Tesseract.js.
 *
 * Do NOT pass HTMLCanvasElement into tesseract.recognize — its browser
 * loadImage uses canvas.toBlob() without handling null blobs, which surfaces
 * as "Error attempting to read image." Data URLs are a first-class, reliable path.
 */
export function canvasToPngDataUrl(canvas: HTMLCanvasElement): string {
  if (canvas.width < 1 || canvas.height < 1) {
    throw new Error('Cannot OCR an empty image (0×0 canvas).');
  }
  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to encode image for OCR: ${msg}`);
  }
  if (!dataUrl || !dataUrl.startsWith('data:image/png') || dataUrl.length < 32) {
    throw new Error('Failed to encode image for OCR (empty PNG data URL).');
  }
  return dataUrl;
}

/**
 * Convert any OcrPageInput image into a Tesseract-safe payload (PNG data URL,
 * Blob, File, or existing data URL). Never returns raw ImageData/ImageBitmap/canvas.
 */
export async function toTesseractImage(
  image: OcrPageInput['image'],
  width: number,
  height: number,
): Promise<string | Blob | File> {
  if (typeof image === 'string') {
    if (image.startsWith('data:image/') || image.startsWith('blob:') || /^https?:/i.test(image)) {
      return image;
    }
    // bare base64? wrap as png data url best-effort
    return image;
  }
  if (typeof File !== 'undefined' && image instanceof File) return image;
  if (typeof Blob !== 'undefined' && image instanceof Blob) return image;

  // Canvas / img can encode directly without allocating a second surface first
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    return canvasToPngDataUrl(image);
  }

  // Build a canvas from every other input type, then encode as PNG data URL.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable for Tesseract image convert');

  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
    canvas.width = image.naturalWidth || image.width || width;
    canvas.height = image.naturalHeight || image.height || height;
    ctx.drawImage(image, 0, 0);
    return canvasToPngDataUrl(canvas);
  }

  if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
    canvas.width = image.width || width;
    canvas.height = image.height || height;
    ctx.drawImage(image, 0, 0);
    return canvasToPngDataUrl(canvas);
  }

  if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
    canvas.width = image.width || width;
    canvas.height = image.height || height;
    ctx.putImageData(image, 0, 0);
    return canvasToPngDataUrl(canvas);
  }

  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    canvas.width = image.width || width;
    canvas.height = image.height || height;
    ctx.drawImage(image, 0, 0);
    return canvasToPngDataUrl(canvas);
  }

  const src = image as CanvasImageSource & {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
  };
  canvas.width = Math.max(1, src.naturalWidth ?? src.width ?? width);
  canvas.height = Math.max(1, src.naturalHeight ?? src.height ?? height);
  ctx.drawImage(src, 0, 0);
  return canvasToPngDataUrl(canvas);
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
      // Always encode to PNG data URL / Blob — never pass raw canvas/ImageData
      const image = await toTesseractImage(input.image, input.width, input.height);

      let data: Awaited<ReturnType<Worker['recognize']>>['data'];
      try {
        ({ data } = await worker.recognize(image, undefined, {
          text: true,
          blocks: true,
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // One retry via Blob if data-url path glitches in some browsers
        if (/read image|invalid|decode/i.test(msg) && typeof image === 'string' && image.startsWith('data:')) {
          const blob = await (await fetch(image)).blob();
          ({ data } = await worker.recognize(blob, undefined, {
            text: true,
            blocks: true,
          }));
        } else {
          throw e;
        }
      }

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
