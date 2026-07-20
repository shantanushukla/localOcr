import { describe, expect, it } from 'vitest';
import {
  averageConfidence,
  confidenceCssClass,
  confidenceTier,
  normalizeConfidence,
} from './confidence.js';

describe('confidence', () => {
  it('tiers', () => {
    expect(confidenceTier(0.95)).toBe('high');
    expect(confidenceTier(0.8)).toBe('mid');
    expect(confidenceTier(0.5)).toBe('low');
  });

  it('css classes', () => {
    expect(confidenceCssClass(0.99)).toBe('conf');
    expect(confidenceCssClass(0.8)).toBe('conf mid');
    expect(confidenceCssClass(0.2)).toBe('conf low');
  });

  it('normalizes percent and unit scales', () => {
    expect(normalizeConfidence(0.9)).toBeCloseTo(0.9);
    expect(normalizeConfidence(90, true)).toBeCloseTo(0.9);
    expect(normalizeConfidence(90)).toBeCloseTo(0.9);
    expect(normalizeConfidence(-1)).toBe(0);
    expect(normalizeConfidence(NaN)).toBe(0);
  });

  it('averages', () => {
    expect(averageConfidence([])).toBe(0);
    expect(averageConfidence([1, 0.5])).toBeCloseTo(0.75);
  });
});
