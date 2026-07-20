import type { OcrBlock } from '@localocr/ocr-core';
import { normalizeConfidence } from '@localocr/ocr-core';

export type PaddleItem = {
  text: string;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
};

export function paddleItemsToBlocks(items: PaddleItem[]): OcrBlock[] {
  return items.map((item) => ({
    text: item.text.trim(),
    bbox: {
      x: item.box.x,
      y: item.box.y,
      w: item.box.width,
      h: item.box.height,
    },
    confidence: normalizeConfidence(item.confidence),
    level: 'line' as const,
  }));
}
