import type {
  EngineInitOptions,
  OcrBlock,
  OcrEngine,
  OcrPageInput,
  OcrPageResult,
} from '@localocr/ocr-core';

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

async function toCanvas(
  image: OcrPageInput['image'],
  width: number,
  height: number,
): Promise<HTMLCanvasElement> {
  if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    return image;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  if (image instanceof ImageData) {
    ctx.putImageData(image, 0, 0);
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

  if (image instanceof Blob) {
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

  // ImageBitmap | HTMLImageElement | HTMLVideoElement | OffscreenCanvas | SVGImageElement
  const src = image as CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  const w = src.naturalWidth ?? src.width ?? width;
  const h = src.naturalHeight ?? src.height ?? height;
  canvas.width = w || width;
  canvas.height = h || height;
  ctx.drawImage(src, 0, 0);
  return canvas;
}

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

  async init(opts: EngineInitOptions = {}): Promise<void> {
    this.preferWebGpu = opts.preferWebGpu !== false;
    if (this.service) return;

    // Load ORT WASM from CDN so Cloudflare Pages never ships >25 MiB assets.
    const ort = await import('onnxruntime-web');
    const ver = (ort as { env?: { wasm?: { wasmPaths?: string } } }).env;
    if (ver?.wasm) {
      ver.wasm.wasmPaths =
        opts.baseUrl?.replace(/\/?$/, '/') ??
        'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
    }

    // Dynamic import keeps the default Tesseract path free of ORT.
    const mod = await import('ppu-paddle-ocr/web');
    const PaddleOcrService = (mod as { PaddleOcrService: new (o?: unknown) => PaddleService })
      .PaddleOcrService;

    const session = this.preferWebGpu
      ? undefined
      : { executionProviders: ['wasm'] as const, graphOptimizationLevel: 'all' as const };

    this.service = new PaddleOcrService(session ? { session } : undefined);
    await this.service.initialize();
  }

  async recognize(input: OcrPageInput): Promise<OcrPageResult> {
    if (!this.service) await this.init();
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const t0 = performance.now();
    const canvas = await toCanvas(input.image, input.width, input.height);
    const result = await this.service!.recognize(canvas, { flatten: true });

    const items = result.results ?? result.lines?.flat() ?? [];
    const blocks: OcrBlock[] = items.map((item) => ({
      text: item.text.trim(),
      bbox: {
        x: item.box.x,
        y: item.box.y,
        w: item.box.width,
        h: item.box.height,
      },
      confidence: Math.min(1, Math.max(0, item.confidence ?? 0)),
      level: 'line' as const,
    }));

    return {
      blocks,
      fullText: result.text?.trim() ?? blocks.map((b) => b.text).join('\n'),
      engineId: this.id,
      durationMs: Math.round(performance.now() - t0),
      route: 'ocr',
    };
  }

  async dispose(): Promise<void> {
    if (this.service) {
      await this.service.destroy();
      this.service = null;
    }
  }
}

export function createPaddleEngine(): OcrEngine {
  return new PaddleEngine();
}
