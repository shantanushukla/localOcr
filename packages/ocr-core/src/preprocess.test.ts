import { describe, expect, it } from 'vitest';
import {
  applyPreprocessToImageData,
  estimateSkewDegrees,
} from './preprocess.js';

/** Minimal ImageData stand-in for Node vitest. */
function makeImageData(w: number, h: number): ImageData {
  if (typeof ImageData !== 'undefined') {
    return new ImageData(w, h);
  }
  return {
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4),
    colorSpace: 'srgb',
  } as ImageData;
}

describe('applyPreprocessToImageData', () => {
  it('grayscale converts rgb', () => {
    const data = makeImageData(1, 1);
    data.data[0] = 255;
    data.data[1] = 0;
    data.data[2] = 0;
    data.data[3] = 255;
    const out = applyPreprocessToImageData(data, { grayscale: true, contrast: 1, brightness: 0 });
    expect(out.data[0]).toBe(out.data[1]);
    expect(out.data[1]).toBe(out.data[2]);
    expect(out.data[0]).toBeGreaterThan(0);
  });

  it('brightness shifts values', () => {
    const data = makeImageData(1, 1);
    data.data[0] = data.data[1] = data.data[2] = 100;
    data.data[3] = 255;
    const out = applyPreprocessToImageData(data, {
      grayscale: false,
      contrast: 1,
      brightness: 50,
    });
    expect(out.data[0]).toBe(150);
  });
});

describe('estimateSkewDegrees', () => {
  it('returns near-zero for upright horizontal bars', () => {
    const w = 80;
    const h = 40;
    const data = makeImageData(w, h);
    // white bg
    data.data.fill(255);
    // dark horizontal line mid page
    for (let x = 10; x < 70; x++) {
      for (let y = 18; y < 22; y++) {
        const i = (y * w + x) * 4;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = 0;
      }
    }
    const angle = estimateSkewDegrees(data, 5, 1);
    expect(Math.abs(angle)).toBeLessThanOrEqual(1);
  });
});
