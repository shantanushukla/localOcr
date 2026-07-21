import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasToPngDataUrl, toTesseractImage } from './index.js';

/**
 * Tesseract rejects raw ImageData and is unreliable with bare canvas.toBlob;
 * region OCR must send PNG data URLs / Blobs.
 */
describe('toTesseractImage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes through PNG data URL strings', async () => {
    const url = 'data:image/png;base64,abc';
    expect(await toTesseractImage(url, 1, 1)).toBe(url);
  });

  it('passes through Blob / File', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    expect(await toTesseractImage(blob, 1, 1)).toBe(blob);
    const file = new File([blob], 'x.png', { type: 'image/png' });
    expect(await toTesseractImage(file, 1, 1)).toBe(file);
  });

  it('encodes HTMLCanvasElement as a PNG data URL (never returns the canvas)', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 6;
    // happy-dom may not implement toDataURL fully — mock it
    canvas.toDataURL = vi.fn(() => 'data:image/png;base64,iVBORw0KGgo=');
    const out = await toTesseractImage(canvas, 8, 6);
    expect(typeof out).toBe('string');
    expect(out).toMatch(/^data:image\/png/);
    expect(out).not.toBe(canvas);
  });

  it('converts ImageData into a PNG data URL via putImageData', async () => {
    const w = 4;
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    data[0] = 10;
    data[1] = 20;
    data[2] = 30;
    data[3] = 255;

    const putImageData = vi.fn();
    const toDataURL = vi.fn(() => 'data:image/png;base64,iVBORw0KGgo=');
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ putImageData, drawImage: vi.fn() })),
      toDataURL,
    } as unknown as HTMLCanvasElement;

    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return mockCanvas;
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement;
    });

    const origImageData = globalThis.ImageData;
    class FakeImageData {
      width: number;
      height: number;
      data: Uint8ClampedArray;
      colorSpace = 'srgb' as const;
      constructor(d: Uint8ClampedArray, width: number, height?: number) {
        this.data = d;
        this.width = width;
        this.height = height ?? 0;
      }
    }
    // @ts-expect-error test double
    globalThis.ImageData = FakeImageData;
    const realImageData = new FakeImageData(data, w, h) as unknown as ImageData;

    try {
      const out = await toTesseractImage(realImageData, w, h);
      expect(out).toMatch(/^data:image\/png/);
      expect(putImageData).toHaveBeenCalledWith(realImageData, 0, 0);
      expect(toDataURL).toHaveBeenCalled();
    } finally {
      globalThis.ImageData = origImageData;
    }
  });
});

describe('canvasToPngDataUrl', () => {
  it('rejects zero-size canvases', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 0;
    canvas.height = 0;
    expect(() => canvasToPngDataUrl(canvas)).toThrow(/empty image/i);
  });
});
