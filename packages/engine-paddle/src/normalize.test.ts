import { describe, expect, it } from 'vitest';
import { paddleItemsToBlocks } from './normalize.js';

describe('paddleItemsToBlocks', () => {
  it('maps box width/height to w/h', () => {
    const blocks = paddleItemsToBlocks([
      { text: ' Hi ', confidence: 0.91, box: { x: 1, y: 2, width: 30, height: 12 } },
    ]);
    expect(blocks[0]).toEqual({
      text: 'Hi',
      bbox: { x: 1, y: 2, w: 30, h: 12 },
      confidence: 0.91,
      level: 'line',
    });
  });
});
