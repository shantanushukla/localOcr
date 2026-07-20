import { describe, expect, it } from 'vitest';
import { isImageFile, isPdfFile, isSupportedFile } from './file-types.js';

describe('file-types', () => {
  it('detects pdf', () => {
    expect(isPdfFile({ type: 'application/pdf', name: 'a.bin' })).toBe(true);
    expect(isPdfFile({ type: '', name: 'scan.PDF' })).toBe(true);
    expect(isPdfFile({ type: 'image/png', name: 'x.png' })).toBe(false);
  });

  it('detects images', () => {
    expect(isImageFile({ type: 'image/png', name: 'a' })).toBe(true);
    expect(isImageFile({ type: '', name: 'photo.jpeg' })).toBe(true);
    expect(isImageFile({ type: 'text/plain', name: 'a.txt' })).toBe(false);
  });

  it('supported union', () => {
    expect(isSupportedFile({ type: '', name: 'a.webp' })).toBe(true);
    expect(isSupportedFile({ type: '', name: 'a.docx' })).toBe(false);
  });
});
