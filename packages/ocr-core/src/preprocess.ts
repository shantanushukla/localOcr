/**
 * Lightweight canvas preprocess for OCR quality.
 * Pure functions operating on ImageData / canvas — no OCR deps.
 */

export type PreprocessOptions = {
  /** 0 = none, 1 = full grayscale */
  grayscale?: boolean;
  /** Contrast multiplier around mid-gray (1 = no change, 1.2 = stronger) */
  contrast?: number;
  /** Brightness offset -255..255 */
  brightness?: number;
};

export function applyPreprocessToImageData(
  data: ImageData,
  opts: PreprocessOptions = {},
): ImageData {
  const grayscale = opts.grayscale !== false;
  const contrast = opts.contrast ?? 1.15;
  const brightness = opts.brightness ?? 0;
  const out =
    typeof ImageData !== 'undefined'
      ? new ImageData(data.width, data.height)
      : ({
          width: data.width,
          height: data.height,
          data: new Uint8ClampedArray(data.width * data.height * 4),
          colorSpace: 'srgb',
        } as ImageData);
  const src = data.data;
  const dst = out.data;
  const factor = contrast;

  for (let i = 0; i < src.length; i += 4) {
    let r = src[i]!;
    let g = src[i + 1]!;
    let b = src[i + 2]!;
    const a = src[i + 3]!;

    if (grayscale) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = y;
    }

    r = clampByte((r - 128) * factor + 128 + brightness);
    g = clampByte((g - 128) * factor + 128 + brightness);
    b = clampByte((b - 128) * factor + 128 + brightness);

    dst[i] = r;
    dst[i + 1] = g;
    dst[i + 2] = b;
    dst[i + 3] = a;
  }
  return out;
}

function clampByte(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

/** Draw source into a new canvas and optionally preprocess pixels. */
export function canvasFromSource(
  source: CanvasImageSource,
  width: number,
  height: number,
  opts?: PreprocessOptions,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.drawImage(source, 0, 0, width, height);
  if (opts && (opts.grayscale !== false || (opts.contrast ?? 1) !== 1 || opts.brightness)) {
    const img = ctx.getImageData(0, 0, width, height);
    ctx.putImageData(applyPreprocessToImageData(img, opts), 0, 0);
  }
  return canvas;
}

/** Crop a rectangular region (pixel coords) into a new canvas. */
export function cropCanvas(
  source: HTMLCanvasElement | OffscreenCanvas | HTMLImageElement | ImageBitmap,
  region: { x: number; y: number; w: number; h: number },
): HTMLCanvasElement {
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const w = Math.max(1, Math.floor(region.w));
  const h = Math.max(1, Math.floor(region.h));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.drawImage(source as CanvasImageSource, x, y, w, h, 0, 0, w, h);
  return canvas;
}
