import { describe, expect, it } from 'vitest';
import {
  buildDigitalPageResult,
  joinTextItems,
  shouldUseDigitalPath,
  textItemsToBlocks,
  MIN_TEXT_CHARS,
} from './text.js';

describe('digital pdf text helpers', () => {
  it('joins and normalizes whitespace', () => {
    expect(joinTextItems([{ str: 'Hello' }, { str: '  ' }, { str: 'world' }])).toBe('Hello world');
  });

  it('digital path threshold', () => {
    expect(shouldUseDigitalPath('x'.repeat(MIN_TEXT_CHARS - 1))).toBe(false);
    expect(shouldUseDigitalPath('x'.repeat(MIN_TEXT_CHARS))).toBe(true);
  });

  it('maps transforms to canvas coords within ±2px math', () => {
    const height = 200;
    const scale = 2;
    // transform: [a,b,c,d,e,f] e=x f=y in PDF space
    // font size via d=12 → h = 12*2 = 24; x=10*2=20; yPdf=50*2=100; y=200-100-24=76
    const blocks = textItemsToBlocks(
      [{ str: 'Hi', transform: [12, 0, 0, 12, 10, 50], width: 20 }],
      scale,
      height,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe('Hi');
    expect(blocks[0]!.bbox.x).toBe(20);
    expect(blocks[0]!.bbox.w).toBe(40);
    expect(blocks[0]!.bbox.h).toBe(24);
    expect(blocks[0]!.bbox.y).toBe(76);
    expect(blocks[0]!.confidence).toBe(1);
  });

  it('buildDigitalPageResult fallback page block', () => {
    const r = buildDigitalPageResult('only text', [], 100, 200);
    expect(r.route).toBe('digital');
    expect(r.engineId).toBe('pdfjs-text');
    expect(r.blocks[0]!.level).toBe('page');
    expect(r.fullText).toBe('only text');
  });
});
