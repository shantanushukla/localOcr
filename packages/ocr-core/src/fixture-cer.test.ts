import { describe, expect, it } from 'vitest';
import { characterErrorRate } from './cer.js';

/**
 * Golden transcript for apps/web/e2e/fixtures/invoice-sample.png
 * OCR quality gate (plan ≤5% CER on receipt-like samples).
 * Real e2e asserts keywords; this unit gate documents expected CER math.
 */
const INVOICE_REFERENCE = `
ACME CORP
INVOICE
Invoice #1842
TOTAL 453.00
`.trim();

describe('fixture CER quality gate', () => {
  it('perfect OCR is under 5%', () => {
    expect(characterErrorRate(INVOICE_REFERENCE, INVOICE_REFERENCE)).toBeLessThanOrEqual(0.05);
  });

  it('minor OCR noise still under 5%', () => {
    // common OCR confusions: 0/O, missing punctuation
    const hyp = `
ACME CORP
INVOICE
Invoice 1842
TOTAL 453.00
`.trim();
    expect(characterErrorRate(hyp, INVOICE_REFERENCE)).toBeLessThanOrEqual(0.05);
  });

  it('garbage OCR fails gate', () => {
    expect(characterErrorRate('lorem ipsum dolor', INVOICE_REFERENCE)).toBeGreaterThan(0.5);
  });
});
