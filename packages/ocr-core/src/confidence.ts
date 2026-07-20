/** Confidence UI / filtering helpers (0–1 scale). */

export type ConfidenceTier = 'high' | 'mid' | 'low';

export function confidenceTier(c: number): ConfidenceTier {
  if (c >= 0.9) return 'high';
  if (c >= 0.75) return 'mid';
  return 'low';
}

export function confidenceCssClass(c: number): string {
  const tier = confidenceTier(c);
  if (tier === 'high') return 'conf';
  if (tier === 'mid') return 'conf mid';
  return 'conf low';
}

/** Clamp arbitrary engine scores into 0–1. Tesseract often uses 0–100. */
export function normalizeConfidence(raw: number, assumesPercent = false): number {
  if (!Number.isFinite(raw)) return 0;
  let v = raw;
  if (assumesPercent || raw > 1) v = raw / 100;
  return Math.min(1, Math.max(0, v));
}

export function averageConfidence(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
