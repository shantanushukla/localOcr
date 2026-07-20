import type { BBox } from './types.js';

/**
 * Max absolute error (px) across x/y/w/h between two boxes.
 * Used for AC5 (±2 px at 100% zoom).
 */
export function bboxMaxDelta(a: BBox, b: BBox): number {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.w - b.w),
    Math.abs(a.h - b.h),
  );
}

export function bboxesAligned(a: BBox, b: BBox, tolerancePx = 2): boolean {
  return bboxMaxDelta(a, b) <= tolerancePx;
}

/**
 * Compare rendered overlay rect (from DOM, page-pixel space) to source bbox.
 * `rendered` uses the same origin as image coordinates.
 */
export function overlayAlignedToBbox(
  rendered: BBox,
  source: BBox,
  tolerancePx = 2,
): boolean {
  return bboxesAligned(rendered, source, tolerancePx);
}
