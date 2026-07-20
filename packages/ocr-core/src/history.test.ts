import { describe, expect, it } from 'vitest';
import { clearHistory, loadHistory, makeHistoryEntry, saveHistoryEntry } from './history.js';
import type { ExportDocument } from './types.js';

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}

const doc: ExportDocument = {
  version: 1,
  engine: 'mock',
  fileName: 'a.pdf',
  pages: [
    {
      index: 0,
      width: 10,
      height: 10,
      fullText: 'hello world',
      blocks: [],
    },
  ],
};

describe('history', () => {
  it('saves and loads entries newest first', () => {
    const store = memStore();
    const e1 = makeHistoryEntry(doc, '1');
    const e2 = makeHistoryEntry({ ...doc, fileName: 'b.pdf' }, '2');
    saveHistoryEntry(e1, store);
    saveHistoryEntry(e2, store);
    const list = loadHistory(store);
    expect(list[0]!.id).toBe('2');
    expect(list[1]!.id).toBe('1');
    expect(list[0]!.previewText).toContain('hello');
  });

  it('clears', () => {
    const store = memStore();
    saveHistoryEntry(makeHistoryEntry(doc, '1'), store);
    clearHistory(store);
    expect(loadHistory(store)).toEqual([]);
  });

  it('caps entries', () => {
    const store = memStore();
    for (let i = 0; i < 30; i++) {
      saveHistoryEntry(makeHistoryEntry(doc, String(i)), store, 5);
    }
    expect(loadHistory(store)).toHaveLength(5);
  });
});
