import type { BBox } from '@localocr/ocr-core';
import { normalizeConfidence } from '@localocr/ocr-core';

export type TessBbox = { x0: number; y0: number; x1: number; y1: number };

export function tesseractBboxToOurs(b: TessBbox): BBox {
  return {
    x: b.x0,
    y: b.y0,
    w: Math.max(0, b.x1 - b.x0),
    h: Math.max(0, b.y1 - b.y0),
  };
}

export function tesseractConfidence(raw: number): number {
  return normalizeConfidence(raw, true);
}
