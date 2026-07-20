import { describe, expect, it } from 'vitest';
import { tesseractBboxToOurs, tesseractConfidence } from './bbox.js';

describe('tesseract bbox helpers', () => {
  it('converts x0/y0/x1/y1', () => {
    expect(tesseractBboxToOurs({ x0: 10, y0: 20, x1: 40, y1: 50 })).toEqual({
      x: 10,
      y: 20,
      w: 30,
      h: 30,
    });
  });

  it('clamps negative sizes', () => {
    expect(tesseractBboxToOurs({ x0: 5, y0: 5, x1: 2, y1: 1 })).toEqual({
      x: 5,
      y: 5,
      w: 0,
      h: 0,
    });
  });

  it('maps percent confidence', () => {
    expect(tesseractConfidence(95)).toBeCloseTo(0.95);
  });
});
