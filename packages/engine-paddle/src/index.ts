import type {
  EngineInitOptions,
  OcrEngine,
  OcrPageInput,
  OcrPageResult,
} from '@localocr/ocr-core';
import { paddleItemsToBlocks } from './normalize.js';

export { paddleItemsToBlocks } from './normalize.js';

type PaddleService = {
  initialize: () => Promise<void>;
  destroy: () => Promise<void>;
  recognize: (
    image: unknown,
    opts?: { flatten?: boolean },
  ) => Promise<{
    text: string;
    confidence: number;
    results?: Array<{
      text: string;
      confidence: number;
      box: { x: number; y: number; width: number; height: number };
    }>;
    lines?: Array<
      Array<{
        text: string;
        confidence: number;
        box: { x: number; y: number; width: number; height: number };
      }>
    >;
  }>;
};

/**
 * Draw any supported page input onto an HTMLCanvasElement for ppu-paddle-ocr.
 *
 * Runs on the main thread: the web build of ppu-paddle-ocr uses
 * document.createElement('canvas') / HTMLCanvasElement and is not worker-safe.
 */
export async function toHtmlCanvas(
  image: OcrPageInput['image'],
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    return image;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

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

  if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
    canvas.width = image.width || width;
    canvas.height = image.height || height;
    ctx.drawImage(image, 0, 0);
    return canvas;
  }

  if (typeof image === 'string') {
    const img = new Image();
    img.decoding = 'async';
    img.src = image;
    await img.decode();
    canvas.width = img.naturalWidth || width;
    canvas.height = img.naturalHeight || height;
    ctx.drawImage(img, 0, 0);
    return canvas;
  }

  if (typeof Blob !== 'undefined' && image instanceof Blob) {
    const url = URL.createObjectURL(image);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      canvas.width = img.naturalWidth || width;
      canvas.height = img.naturalHeight || height;
      ctx.drawImage(img, 0, 0);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

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

/**
 * Paddle OCR on the main thread (DOM canvas required by ppu-paddle-ocr/web).
 */
export class PaddleEngine implements OcrEngine {
  readonly id = 'ppu-paddle-ocr';
  readonly capabilities = {
    languages: ['en', 'multi'],
    webgpu: true,
    bboxes: true,
    confidence: true,
  };

  private service: PaddleService | null = null;
  private preferWebGpu = true;
  private baseUrl?: string;
  private ready = false;

  async init(opts: EngineInitOptions = {}): Promise<void> {
    this.preferWebGpu = opts.preferWebGpu !== false;
    this.baseUrl = opts.baseUrl;
    if (this.ready && this.service) return;

    const ort = await import('onnxruntime-web');
    const env = (ort as { env?: { wasm?: { wasmPaths?: string } } }).env;
    if (env?.wasm) {
      env.wasm.wasmPaths =
        this.baseUrl?.replace(/\/?$/, '/') ??
        'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
    }

    const mod = await import('ppu-paddle-ocr/web');
    const PaddleOcrService = (
      mod as { PaddleOcrService: new (o?: unknown) => PaddleService }
    ).PaddleOcrService;

    const session = this.preferWebGpu
      ? undefined
      : { executionProviders: ['wasm'] as const, graphOptimizationLevel: 'all' as const };

    this.service = new PaddleOcrService(session ? { session } : undefined);
    await this.service.initialize();
    this.ready = true;
  }

  async recognize(input: OcrPageInput): Promise<OcrPageResult> {
    if (!this.ready || !this.service) await this.init();
    if (!this.service) throw new Error('Paddle OCR failed to initialize');
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const canvas = await toHtmlCanvas(input.image, input.width, input.height);
    const t0 = performance.now();
    const result = await this.service.recognize(canvas, { flatten: true });

    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const items = result.results ?? result.lines?.flat() ?? [];
    const blocks = paddleItemsToBlocks(items);
    const fullText =
      result.text?.trim() ||
      blocks
        .map((b) => b.text)
        .filter(Boolean)
        .join('\n');

    return {
      blocks,
      fullText,
      engineId: this.id,
      durationMs: Math.round(performance.now() - t0),
      route: 'ocr',
    };
  }

  async dispose(): Promise<void> {
    if (this.service) {
      try {
        await this.service.destroy();
      } catch {
        /* ignore */
      }
      this.service = null;
    }
    this.ready = false;
  }
}

export function createPaddleEngine(): OcrEngine {
  return new PaddleEngine();
}
