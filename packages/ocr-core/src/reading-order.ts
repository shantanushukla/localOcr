import type { OcrBlock } from './types.js';

/** Sort blocks roughly top-to-bottom, then left-to-right. */
export function sortReadingOrder(blocks: OcrBlock[]): OcrBlock[] {
  const lineThreshold = 12;
  return [...blocks].sort((a, b) => {
    const dy = a.bbox.y - b.bbox.y;
    if (Math.abs(dy) > lineThreshold) return dy;
    return a.bbox.x - b.bbox.x;
  });
}

export function blocksToFullText(blocks: OcrBlock[]): string {
  if (blocks.length === 0) return '';
  const sorted = sortReadingOrder(blocks);
  const lines: string[] = [];
  let currentY = sorted[0]!.bbox.y;
  let buf: string[] = [];

  const flush = () => {
    if (buf.length) {
      lines.push(buf.join(' '));
      buf = [];
    }
  };

  for (const b of sorted) {
    if (Math.abs(b.bbox.y - currentY) > 12) {
      flush();
      currentY = b.bbox.y;
    }
    buf.push(b.text.trim());
  }
  flush();
  return lines.join('\n');
}
