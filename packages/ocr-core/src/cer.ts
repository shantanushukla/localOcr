/**
 * Character Error Rate (Levenshtein / ref length).
 * Used for fixture quality gates — not production path.
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j] ?? 0;
  }
  return prev[b.length] ?? 0;
}

/** Normalize whitespace / case for OCR comparison. */
export function normalizeOcrText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * CER = editDistance / max(refLength, 1).
 * Lower is better; 0 = perfect match after normalization.
 */
export function characterErrorRate(hypothesis: string, reference: string): number {
  const h = normalizeOcrText(hypothesis);
  const r = normalizeOcrText(reference);
  if (!r.length) return h.length === 0 ? 0 : 1;
  return levenshtein(h, r) / r.length;
}
