import { afterEach, describe, expect, it, vi } from 'vitest';
import { toTesseractImage } from './index.js';

/**
 * Tesseract rejects raw ImageData; region OCR previously hit
 * "Error attempting to read image." — normalize to canvas.
 */
describe('toTesseractImage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes through HTMLCanvasElement', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 20;
    expect(toTesseractImage(canvas, 40, 20)).toBe(canvas);
  });

  it('passes through data URL strings', () => {
    const url = 'data:image/png;base64,abc';
    expect(toTesseractImage(url, 1, 1)).toBe(url);
  });

  it('passes through Blob / File', () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    expect(toTesseractImage(blob, 1, 1)).toBe(blob);
    const file = new File([blob], 'x.png', { type: 'image/png' });
    expect(toTesseractImage(file, 1, 1)).toBe(file);
  });

  it('converts ImageData into a canvas via putImageData', () => {
    const w = 4;
    const h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    data[0] = 10;
    data[1] = 20;
    data[2] = 30;
    data[3] = 255;

    const putImageData = vi.fn();
    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ putImageData, drawImage: vi.fn() })),
    } as unknown as HTMLCanvasElement;

    const createEl = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return mockCanvas;
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement;
    });

    // Force ImageData branch: instanceof may fail for plain object — patch
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
      const out = toTesseractImage(realImageData, w, h);
      expect(out).toBe(mockCanvas);
      expect(mockCanvas.width).toBe(w);
      expect(mockCanvas.height).toBe(h);
      expect(putImageData).toHaveBeenCalledWith(realImageData, 0, 0);
      expect(createEl).toHaveBeenCalledWith('canvas');
    } finally {
      globalThis.ImageData = origImageData;
    }
  });
});
