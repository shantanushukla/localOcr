import type { ExportDocument } from './types.js';

export type HistoryEntry = {
  id: string;
  savedAt: number;
  fileName: string;
  engine: string;
  pageCount: number;
  previewText: string;
  /** Full export payload (text/blocks) — may be large; cap storage externally */
  document: ExportDocument;
};

const KEY = 'localocr.history.v1';
const MAX_ENTRIES = 20;

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function storage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadHistory(store: StorageLike | null = storage()): HistoryEntry[] {
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistoryEntry(
  entry: HistoryEntry,
  store: StorageLike | null = storage(),
  max = MAX_ENTRIES,
): HistoryEntry[] {
  if (!store) return [entry];
  const prev = loadHistory(store).filter((e) => e.id !== entry.id);
  const next = [entry, ...prev].slice(0, max);
  try {
    store.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded — drop oldest half and retry once
    const trimmed = next.slice(0, Math.max(1, Math.floor(max / 2)));
    try {
      store.setItem(KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch {
      return next;
    }
  }
  return next;
}

export function clearHistory(store: StorageLike | null = storage()): void {
  store?.removeItem(KEY);
}

export function makeHistoryEntry(doc: ExportDocument, id?: string): HistoryEntry {
  const full = doc.pages.map((p) => p.fullText).join('\n');
  return {
    id: id ?? (crypto.randomUUID?.() ?? `h-${Date.now()}`),
    savedAt: Date.now(),
    fileName: doc.fileName,
    engine: doc.engine,
    pageCount: doc.pages.length,
    previewText: full.slice(0, 160),
    document: doc,
  };
}
