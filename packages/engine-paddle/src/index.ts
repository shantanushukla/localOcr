import type {
  EngineInitOptions,
  OcrEngine,
  OcrPageInput,
  OcrPageResult,
} from '@localocr/ocr-core';
import type { WorkerRequest, WorkerResponse } from './worker.js';

export { paddleItemsToBlocks } from './normalize.js';

/**
 * Convert page image input to ImageBitmap (preferred) or ImageData for the worker.
 */
async function toTransferable(
  image: OcrPageInput['image'],
  width: number,
  height: number,
): Promise<
  | { kind: 'bitmap'; bitmap: ImageBitmap; width: number; height: number }
  | {
      kind: 'imageData';
      imageData: { data: Uint8ClampedArray; width: number; height: number };
      width: number;
      height: number;
    }
> {
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
    return { kind: 'bitmap', bitmap: image, width: image.width || width, height: image.height || height };
  }

  // Build a canvas, then transfer as ImageBitmap when possible
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  if (image instanceof ImageData) {
    canvas.width = image.width || width;
    canvas.height = image.height || height;
    ctx.putImageData(image, 0, 0);
  } else if (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) {
    canvas.width = image.width || width;
    canvas.height = image.height || height;
    ctx.drawImage(image, 0, 0);
  } else if (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) {
    canvas.width = image.width || width;
    canvas.height = image.height || height;
    ctx.drawImage(image, 0, 0);
  } else if (typeof image === 'string') {
    const img = new Image();
    img.decoding = 'async';
    img.src = image;
    await img.decode();
    canvas.width = img.naturalWidth || width;
    canvas.height = img.naturalHeight || height;
    ctx.drawImage(img, 0, 0);
  } else if (image instanceof Blob) {
    const url = URL.createObjectURL(image);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      canvas.width = img.naturalWidth || width;
      canvas.height = img.naturalHeight || height;
      ctx.drawImage(img, 0, 0);
    } finally {
      URL.revokeObjectURL(url);
    }
  } else {
    const src = image as CanvasImageSource & {
      width?: number;
      height?: number;
      naturalWidth?: number;
      naturalHeight?: number;
    };
    const w = src.naturalWidth ?? src.width ?? width;
    const h = src.naturalHeight ?? src.height ?? height;
    canvas.width = w || width;
    canvas.height = h || height;
    ctx.drawImage(src, 0, 0);
  }

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(canvas);
    return {
      kind: 'bitmap',
      bitmap,
      width: canvas.width,
      height: canvas.height,
    };
  }

  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    kind: 'imageData',
    imageData: {
      data: id.data,
      width: id.width,
      height: id.height,
    },
    width: canvas.width,
    height: canvas.height,
  };
}

/**
 * Main-thread proxy: all heavy Paddle/ORT work runs in a dedicated Web Worker.
 */
export class PaddleEngine implements OcrEngine {
  readonly id = 'ppu-paddle-ocr';
  readonly capabilities = {
    languages: ['en', 'multi'],
    webgpu: true,
    bboxes: true,
    confidence: true,
  };

  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private preferWebGpu = true;
  private baseUrl?: string;
  private ready = false;

  private nextId(): number {
    this.seq += 1;
    return this.seq;
  }

  private call(msg: WorkerRequest, transfer: Transferable[] = []): Promise<unknown> {
    if (!this.worker) return Promise.reject(new Error('Paddle worker not started'));
    return new Promise((resolve, reject) => {
      this.pending.set(msg.id, { resolve, reject });
      this.worker!.postMessage(msg, transfer);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    // Vite resolves ?worker&url / new Worker(new URL(...), { type: 'module' })
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const res = ev.data;
      const p = this.pending.get(res.id);
      if (!p) return;
      this.pending.delete(res.id);
      if (res.type === 'error') p.reject(new Error(res.message));
      else p.resolve(res.payload);
    };
    this.worker.onerror = (ev) => {
      for (const [, p] of this.pending) {
        p.reject(new Error(ev.message || 'Paddle worker error'));
      }
      this.pending.clear();
    };
    return this.worker;
  }

  async init(opts: EngineInitOptions = {}): Promise<void> {
    this.preferWebGpu = opts.preferWebGpu !== false;
    this.baseUrl = opts.baseUrl;
    if (this.ready) return;
    this.ensureWorker();
    await this.call({
      id: this.nextId(),
      type: 'init',
      preferWebGpu: this.preferWebGpu,
      baseUrl: this.baseUrl,
    });
    this.ready = true;
  }

  async recognize(input: OcrPageInput): Promise<OcrPageResult> {
    if (!this.ready) await this.init();
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const transferred = await toTransferable(input.image, input.width, input.height);
    const id = this.nextId();

    const onAbort = () => {
      /* mid-recognize abort: worker finishes; we discard if aborted after */
    };
    input.signal?.addEventListener('abort', onAbort);

    try {
      let result: OcrPageResult;
      if (transferred.kind === 'bitmap') {
        result = (await this.call(
          {
            id,
            type: 'recognize',
            width: transferred.width,
            height: transferred.height,
            bitmap: transferred.bitmap,
          },
          [transferred.bitmap],
        )) as OcrPageResult;
      } else {
        result = (await this.call({
          id,
          type: 'recognize',
          width: transferred.width,
          height: transferred.height,
          imageData: transferred.imageData,
        })) as OcrPageResult;
      }

      if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return result;
    } finally {
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      try {
        await this.call({ id: this.nextId(), type: 'dispose' });
      } catch {
        /* ignore */
      }
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
    this.pending.clear();
  }
}

export function createPaddleEngine(): OcrEngine {
  return new PaddleEngine();
}
