import { describe, expect, it } from 'vitest';
import { characterErrorRate, levenshtein, normalizeOcrText } from './cer.js';

describe('cer', () => {
  it('levenshtein basic', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('', 'ab')).toBe(2);
  });

  it('normalize collapses punctuation/case', () => {
    expect(normalizeOcrText('  Hello, World!  ')).toBe('hello world');
  });

  it('CER is 0 for equivalent text', () => {
    expect(characterErrorRate('Invoice #1842', 'INVOICE 1842')).toBe(0);
  });

  it('CER penalizes errors', () => {
    const cer = characterErrorRate('inv0ice 1842', 'invoice 1842');
    expect(cer).toBeGreaterThan(0);
    expect(cer).toBeLessThan(0.3);
  });

  it('receipt-like sample under 5% when near-perfect', () => {
    const ref = 'ACME CORP INVOICE 1842 TOTAL 453.00';
    const hyp = 'ACME CORP INVOICE 1842 TOTAL 453.00';
    expect(characterErrorRate(hyp, ref)).toBeLessThanOrEqual(0.05);
  });
});
