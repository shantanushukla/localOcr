/**
 * Paddle OCR Web Worker — keeps ONNX Runtime / model inference off the UI thread.
 * Protocol: request/response messages with id correlation.
 */

import { paddleItemsToBlocks } from './normalize.js';

export type WorkerRequest =
  | { id: number; type: 'init'; preferWebGpu: boolean; baseUrl?: string }
  | {
      id: number;
      type: 'recognize';
      width: number;
      height: number;
      /** Transferable ImageBitmap or ImageData-like payload */
      bitmap?: ImageBitmap;
      imageData?: { data: Uint8ClampedArray; width: number; height: number };
    }
  | { id: number; type: 'dispose' };

export type WorkerResponse =
  | { id: number; type: 'ok'; payload?: unknown }
  | { id: number; type: 'error'; message: string };

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

let service: PaddleService | null = null;

async function ensureCanvas(
  width: number,
  height: number,
  bitmap?: ImageBitmap,
  imageData?: { data: Uint8ClampedArray; width: number; height: number },
): Promise<OffscreenCanvas> {
  // Dedicated workers always have OffscreenCanvas in modern browsers.
  const OC = (
    self as DedicatedWorkerGlobalScope & {
      OffscreenCanvas: typeof OffscreenCanvas;
    }
  ).OffscreenCanvas;
  if (typeof OC !== 'function') {
    throw new Error('OffscreenCanvas unavailable in worker');
  }
  const canvas = new OC(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D unavailable');
  if (bitmap) {
    canvas.width = bitmap.width || width;
    canvas.height = bitmap.height || height;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  } else if (imageData) {
    const id = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height,
    );
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    ctx.putImageData(id, 0, 0);
  }
  return canvas;
}

async function handleInit(preferWebGpu: boolean, baseUrl?: string): Promise<void> {
  if (service) return;

  const ort = await import('onnxruntime-web');
  const env = (ort as { env?: { wasm?: { wasmPaths?: string } } }).env;
  if (env?.wasm) {
    env.wasm.wasmPaths =
      baseUrl?.replace(/\/?$/, '/') ??
      'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
  }

  const mod = await import('ppu-paddle-ocr/web');
  const PaddleOcrService = (mod as { PaddleOcrService: new (o?: unknown) => PaddleService })
    .PaddleOcrService;

  const session = preferWebGpu
    ? undefined
    : { executionProviders: ['wasm'] as const, graphOptimizationLevel: 'all' as const };

  service = new PaddleOcrService(session ? { session } : undefined);
  await service.initialize();
}

async function handleRecognize(
  width: number,
  height: number,
  bitmap?: ImageBitmap,
  imageData?: { data: Uint8ClampedArray; width: number; height: number },
) {
  if (!service) throw new Error('Paddle worker not initialized');
  const canvas = await ensureCanvas(width, height, bitmap, imageData);
  const t0 = performance.now();
  const result = await service.recognize(canvas, { flatten: true });
  const items = result.results ?? result.lines?.flat() ?? [];
  const blocks = paddleItemsToBlocks(items);
  return {
    blocks,
    fullText: result.text?.trim() ?? blocks.map((b) => b.text).join('\n'),
    engineId: 'ppu-paddle-ocr',
    durationMs: Math.round(performance.now() - t0),
    route: 'ocr' as const,
  };
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init':
        await handleInit(msg.preferWebGpu, msg.baseUrl);
        (self as DedicatedWorkerGlobalScope).postMessage({
          id: msg.id,
          type: 'ok',
        } satisfies WorkerResponse);
        break;
      case 'recognize': {
        const payload = await handleRecognize(
          msg.width,
          msg.height,
          msg.bitmap,
          msg.imageData,
        );
        (self as DedicatedWorkerGlobalScope).postMessage({
          id: msg.id,
          type: 'ok',
          payload,
        } satisfies WorkerResponse);
        break;
      }
      case 'dispose':
        if (service) {
          await service.destroy();
          service = null;
        }
        (self as DedicatedWorkerGlobalScope).postMessage({
          id: msg.id,
          type: 'ok',
        } satisfies WorkerResponse);
        break;
      default:
        throw new Error('Unknown worker message');
    }
  } catch (e) {
    (self as DedicatedWorkerGlobalScope).postMessage({
      id: msg.id,
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    } satisfies WorkerResponse);
  }
};
