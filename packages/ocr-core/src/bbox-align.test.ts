import { describe, expect, it } from 'vitest';
import { bboxMaxDelta, bboxesAligned, overlayAlignedToBbox } from './bbox-align.js';

describe('bbox alignment (AC5 ±2px)', () => {
  it('exact match', () => {
    const b = { x: 10, y: 20, w: 100, h: 14 };
    expect(bboxMaxDelta(b, b)).toBe(0);
    expect(bboxesAligned(b, b, 2)).toBe(true);
  });

  it('within 2px tolerance', () => {
    const a = { x: 10, y: 20, w: 100, h: 14 };
    const b = { x: 11.5, y: 18.5, w: 101, h: 15 };
    expect(bboxMaxDelta(a, b)).toBeLessThanOrEqual(2);
    expect(overlayAlignedToBbox(a, b, 2)).toBe(true);
  });

  it('outside tolerance', () => {
    const a = { x: 10, y: 20, w: 100, h: 14 };
    const b = { x: 15, y: 20, w: 100, h: 14 };
    expect(bboxesAligned(a, b, 2)).toBe(false);
  });
});
