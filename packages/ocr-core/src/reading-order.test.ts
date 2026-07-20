import { describe, expect, it } from 'vitest';
import { blocksToFullText, sortReadingOrder } from './reading-order.js';
import type { OcrBlock } from './types.js';

const b = (text: string, x: number, y: number): OcrBlock => ({
  text,
  bbox: { x, y, w: 40, h: 12 },
  confidence: 0.9,
  level: 'word',
});

describe('sortReadingOrder', () => {
  it('orders top-to-bottom then left-to-right', () => {
    const sorted = sortReadingOrder([b('B', 50, 0), b('A', 0, 0), b('C', 0, 40)]);
    expect(sorted.map((x) => x.text)).toEqual(['A', 'B', 'C']);
  });
});

describe('blocksToFullText', () => {
  it('joins same-line words', () => {
    const text = blocksToFullText([b('Hello', 0, 0), b('world', 50, 2)]);
    expect(text).toBe('Hello world');
  });
});
