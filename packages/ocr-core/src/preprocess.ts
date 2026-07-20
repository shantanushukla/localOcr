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
  /** Estimate and correct small skew (±8°) via projection profile. */
  deskew?: boolean;
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

/**
 * Estimate skew angle in degrees using a coarse horizontal projection search.
 * Returns 0 when canvas APIs are unavailable or image is empty.
 */
export function estimateSkewDegrees(data: ImageData, maxDeg = 8, step = 0.5): number {
  const { width, height } = data;
  if (width < 8 || height < 8) return 0;

  // Downsample for speed
  const scale = Math.min(1, 200 / Math.max(width, height));
  const sw = Math.max(8, Math.floor(width * scale));
  const sh = Math.max(8, Math.floor(height * scale));
  const gray = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const sx = Math.floor(x / scale);
      const sy = Math.floor(y / scale);
      const i = (sy * width + sx) * 4;
      const r = data.data[i] ?? 0;
      const g = data.data[i + 1] ?? 0;
      const b = data.data[i + 2] ?? 0;
      // Ink-ish (dark) pixels
      gray[y * sw + x] = 255 - (0.299 * r + 0.587 * g + 0.114 * b);
    }
  }

  let bestAngle = 0;
  let bestScore = -Infinity;

  for (let deg = -maxDeg; deg <= maxDeg + 1e-9; deg += step) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const proj = new Float64Array(sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const yr = Math.round(y * cos + x * sin);
        if (yr >= 0 && yr < sh) {
          proj[yr]! += gray[y * sw + x]!;
        }
      }
    }
    // Variance of projection — higher when lines align horizontally
    let mean = 0;
    for (let i = 0; i < sh; i++) mean += proj[i]!;
    mean /= sh;
    let varSum = 0;
    for (let i = 0; i < sh; i++) {
      const d = proj[i]! - mean;
      varSum += d * d;
    }
    if (varSum > bestScore) {
      bestScore = varSum;
      bestAngle = deg;
    }
  }
  // Ignore tiny angles that are mostly noise
  return Math.abs(bestAngle) < 0.25 ? 0 : bestAngle;
}

/** Rotate image data by degrees (counter-clockwise) into a new canvas-sized ImageData via canvas. */
export function rotateImageData(
  data: ImageData,
  degrees: number,
): { data: ImageData; width: number; height: number } {
  if (!degrees || typeof document === 'undefined') {
    return { data, width: data.width, height: data.height };
  }
  const src = document.createElement('canvas');
  src.width = data.width;
  src.height = data.height;
  const sctx = src.getContext('2d');
  if (!sctx) return { data, width: data.width, height: data.height };
  sctx.putImageData(data, 0, 0);

  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const nw = Math.ceil(data.width * cos + data.height * sin);
  const nh = Math.ceil(data.width * sin + data.height * cos);

  const dst = document.createElement('canvas');
  dst.width = nw;
  dst.height = nh;
  const dctx = dst.getContext('2d');
  if (!dctx) return { data, width: data.width, height: data.height };
  dctx.fillStyle = '#ffffff';
  dctx.fillRect(0, 0, nw, nh);
  dctx.translate(nw / 2, nh / 2);
  dctx.rotate(rad);
  dctx.drawImage(src, -data.width / 2, -data.height / 2);
  return {
    data: dctx.getImageData(0, 0, nw, nh),
    width: nw,
    height: nh,
  };
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
  if (
    opts &&
    (opts.grayscale !== false ||
      (opts.contrast ?? 1) !== 1 ||
      opts.brightness ||
      opts.deskew)
  ) {
    let img = ctx.getImageData(0, 0, width, height);
    if (opts.deskew) {
      const angle = estimateSkewDegrees(img);
      if (angle !== 0) {
        const rotated = rotateImageData(img, -angle);
        canvas.width = rotated.width;
        canvas.height = rotated.height;
        img = rotated.data;
        ctx.putImageData(
          applyPreprocessToImageData(img, { ...opts, deskew: false }),
          0,
          0,
        );
        return canvas;
      }
    }
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
