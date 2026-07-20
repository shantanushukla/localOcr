import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OcrBlock, OcrEngine, OcrJob } from '@localocr/ocr-core';
import {
  JobOrchestrator,
  confidenceCssClass,
  cropCanvas,
  downloadPdfBytes,
  jobToExportDocument,
  jobToMarkdown,
  jobToPlainText,
  jobToSearchablePdf,
  loadHistory,
  makeHistoryEntry,
  saveHistoryEntry,
  clearHistory,
  type HistoryEntry,
} from '@localocr/ocr-core';
import { createTesseractEngine } from '@localocr/engine-tesseract';
import { prepareImage, preparePdf } from '@localocr/engine-digital-pdf';
import { isImageFile, isPdfFile } from './file-types';

type EngineChoice = 'tesseract' | 'paddle';
type View = 'landing' | 'workspace';
type ResultTab = 'text' | 'markdown' | 'json';
type Panel = null | 'how' | 'privacy' | 'history';

const LANGS = [
  { code: 'eng', label: 'English' },
  { code: 'spa', label: 'Spanish' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'por', label: 'Portuguese' },
  { code: 'ita', label: 'Italian' },
  { code: 'chi_sim', label: 'Chinese (Simplified)' },
  { code: 'jpn', label: 'Japanese' },
];

async function createEngine(choice: EngineChoice): Promise<OcrEngine> {
  if (choice === 'paddle') {
    const { createPaddleEngine } = await import('@localocr/engine-paddle');
    return createPaddleEngine();
  }
  return createTesseractEngine();
}

export function App() {
  const [view, setView] = useState<View>('landing');
  const [engineChoice, setEngineChoice] = useState<EngineChoice>('tesseract');
  const [language, setLanguage] = useState('eng');
  const [preprocess, setPreprocess] = useState(true);
  const [deskew, setDeskew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [runtimeMode, setRuntimeMode] = useState<'webgpu' | 'wasm' | 'unknown'>('unknown');
  const [job, setJob] = useState<OcrJob | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [tab, setTab] = useState<ResultTab>('text');
  const [dragOver, setDragOver] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [regionMode, setRegionMode] = useState(false);
  const [region, setRegion] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  const [drawing, setDrawing] = useState(false);

  const engineRef = useRef<OcrEngine | null>(null);
  const orchRef = useRef<JobOrchestrator | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasSources = useRef<Map<number, HTMLCanvasElement>>(new Map());

  const page = job?.pages[pageIndex];
  const blocks: OcrBlock[] = page?.result?.blocks ?? [];
  const doneCount =
    job?.pages.filter((p) => p.status === 'done' || p.status === 'failed').length ?? 0;
  const progress = job ? doneCount / Math.max(job.pages.length, 1) : 0;

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    // Detect WebGPU once for honest status chip (AC6).
    const hasGpu =
      typeof navigator !== 'undefined' &&
      'gpu' in navigator &&
      typeof (navigator as Navigator & { gpu?: unknown }).gpu !== 'undefined';
    setRuntimeMode(hasGpu ? 'webgpu' : 'wasm');
  }, []);

  const ensureEngine = useCallback(async (choice: EngineChoice, lang: string) => {
    const matchId = choice === 'paddle' ? 'ppu' : 'tesseract';
    const preferWebGpu = runtimeMode !== 'wasm';
    if (engineRef.current?.id.startsWith(matchId) && choice === 'tesseract') {
      // re-init language if changed
      await engineRef.current.init({ language: lang, preferWebGpu });
      return engineRef.current;
    }
    if (engineRef.current?.id.startsWith(matchId) && choice === 'paddle') {
      return engineRef.current;
    }
    if (engineRef.current) await engineRef.current.dispose();
    setStatus(
      choice === 'paddle'
        ? `Loading Paddle OCR (${preferWebGpu ? 'WebGPU preferred' : 'WASM mode'})…`
        : `Loading Tesseract (${lang})…`,
    );
    const engine = await createEngine(choice);
    await engine.init({ preferWebGpu, language: lang });
    engineRef.current = engine;
    orchRef.current = new JobOrchestrator(engine, {
      onJobUpdate: (j) => setJob(j),
    });
    return engine;
  }, [runtimeMode]);

  const persistJob = useCallback((j: OcrJob) => {
    if (j.status !== 'done') return;
    const doc = jobToExportDocument(j);
    if (doc.pages.length === 0) return;
    const next = saveHistoryEntry(makeHistoryEntry(doc));
    setHistory(next);
  }, []);

  const runFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      const file = list[0]!;
      setError(null);
      setBusy(true);
      setSelectedBlock(null);
      setPageIndex(0);
      setRegion(null);
      canvasSources.current.clear();

      try {
        await ensureEngine(engineChoice, language);
        const orch = orchRef.current!;
        setView('workspace');

        let pages;
        let fileName = file.name;

        if (isPdfFile(file)) {
          setStatus('Reading PDF…');
          const prepared = await preparePdf(file, { scale: 2 });
          pages = prepared.pages;
          fileName = prepared.fileName;
          for (const p of pages) {
            if (p.image instanceof HTMLCanvasElement) {
              canvasSources.current.set(p.index, p.image);
            }
          }
          const digital = pages.filter((p) => p.digitalResult).length;
          setStatus(
            digital === pages.length
              ? 'Digital PDF — extracting text layer…'
              : `PDF ready (${digital} digital / ${pages.length - digital} OCR)…`,
          );
        } else if (isImageFile(file)) {
          setStatus('Preparing image…');
          pages = [await prepareImage(file, { preprocess, deskew })];
          if (pages[0]?.image instanceof HTMLCanvasElement) {
            canvasSources.current.set(0, pages[0].image);
          }
        } else {
          throw new Error(`Unsupported file type: ${file.type || file.name}`);
        }

        setStatus('Running recognition…');
        const finished = await orch.run(fileName, pages);
        persistJob(finished);
        setStatus('Done — files never left this device.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStatus('');
      } finally {
        setBusy(false);
      }
    },
    [engineChoice, language, preprocess, deskew, ensureEngine, persistJob],
  );

  const runRegionOcr = useCallback(async () => {
    if (!region || !job) return;
    const src = canvasSources.current.get(pageIndex);
    if (!src) {
      setError('Page canvas unavailable for region OCR');
      return;
    }
    const x = Math.min(region.x0, region.x1);
    const y = Math.min(region.y0, region.y1);
    const w = Math.abs(region.x1 - region.x0);
    const h = Math.abs(region.y1 - region.y0);
    if (w < 4 || h < 4) return;

    setBusy(true);
    setError(null);
    try {
      await ensureEngine(engineChoice, language);
      const crop = cropCanvas(src, { x, y, w, h });
      setStatus('Recognizing region…');
      const result = await engineRef.current!.recognize({
        width: crop.width,
        height: crop.height,
        image: crop,
      });
      // Offset bboxes back into page space
      const offsetBlocks = result.blocks.map((b) => ({
        ...b,
        bbox: { ...b.bbox, x: b.bbox.x + x, y: b.bbox.y + y },
      }));
      setJob((prev) => {
        if (!prev) return prev;
        const pages = [...prev.pages];
        const p = { ...pages[pageIndex]! };
        p.result = {
          ...result,
          blocks: offsetBlocks,
          fullText: result.fullText,
        };
        p.status = 'done';
        pages[pageIndex] = p;
        return { ...prev, pages, status: 'done' };
      });
      setStatus('Region OCR complete.');
      setRegionMode(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [region, job, pageIndex, engineChoice, language, ensureEngine]);

  const onCancel = () => {
    orchRef.current?.cancel();
    setBusy(false);
    setStatus('Cancelled');
  };

  const exportText = useMemo(() => (job ? jobToPlainText(job) : ''), [job]);
  const exportMd = useMemo(() => (job ? jobToMarkdown(job) : ''), [job]);
  const exportJson = useMemo(
    () => (job ? JSON.stringify(jobToExportDocument(job), null, 2) : ''),
    [job],
  );

  const copyActive = async () => {
    const text = tab === 'markdown' ? exportMd : tab === 'json' ? exportJson : exportText;
    await navigator.clipboard.writeText(text);
    setStatus('Copied to clipboard');
  };

  const downloadActive = () => {
    const text = tab === 'markdown' ? exportMd : tab === 'json' ? exportJson : exportText;
    const ext = tab === 'markdown' ? 'md' : tab === 'json' ? 'json' : 'txt';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${job?.fileName ?? 'ocr'}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadSearchablePdf = async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    setStatus('Building searchable PDF…');
    try {
      const exportDoc = jobToExportDocument(job);
      const pageImages = new Map<number, Uint8Array>();
      for (const [idx, canvas] of canvasSources.current) {
        try {
          const dataUrl = canvas.toDataURL('image/png');
          const bin = atob(dataUrl.split(',')[1] ?? '');
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          pageImages.set(idx, bytes);
        } catch {
          /* skip broken page canvas */
        }
      }
      // jobToSearchablePdf sanitizes Unicode (→ etc.) for Helvetica/WinAnsi
      const pdfBytes = await jobToSearchablePdf(exportDoc, { pageImages });
      const base = (job.fileName || 'ocr').replace(/\.[^.]+$/, '');
      downloadPdfBytes(pdfBytes, `${base}-searchable.pdf`);
      setStatus('Searchable PDF downloaded.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Never show raw pdf-lib encoding errors; retry text-only path
      if (/WinAnsi|cannot encode/i.test(msg)) {
        try {
          const exportDoc = jobToExportDocument(job);
          // Strip non-ascii from blocks as last resort
          const scrubbed = {
            ...exportDoc,
            pages: exportDoc.pages.map((p) => ({
              ...p,
              fullText: p.fullText.replace(/[^\x20-\x7e\n\r\t]/g, ' '),
              blocks: p.blocks.map((b) => ({
                ...b,
                text: b.text.replace(/[^\x20-\x7e\n\r\t]/g, ' '),
              })),
            })),
          };
          const pdfBytes = await jobToSearchablePdf(scrubbed, {});
          const base = (job.fileName || 'ocr').replace(/\.[^.]+$/, '');
          downloadPdfBytes(pdfBytes, `${base}-searchable.pdf`);
          setStatus('Searchable PDF downloaded (ASCII text layer).');
          return;
        } catch {
          /* fall through */
        }
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const pointerToImage = (clientX: number, clientY: number) => {
    const el = stageRef.current;
    if (!el || !page?.width || !page.height) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * page.width;
    const y = ((clientY - rect.top) / rect.height) * page.height;
    return { x, y };
  };

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">
          <div className="logo-mark" aria-hidden="true">
            lO
          </div>
          <div>
            <div className="brand-name">localOCR</div>
            <div className="brand-tag">
              {job ? `${job.fileName} · ${job.pages.length} page(s)` : 'On-device document text'}
            </div>
          </div>
        </div>
        <div className="top-actions">
          <span className="pill soft" title="Processing stays in this browser tab" data-testid="on-device-badge">
            <span className="dot" /> On-device
          </span>
          <span
            className="pill ghost"
            title={
              runtimeMode === 'webgpu'
                ? 'WebGPU available — Paddle will prefer GPU acceleration'
                : 'WebGPU unavailable — engines use WASM (slower but works)'
            }
            data-testid="runtime-mode"
          >
            {runtimeMode === 'webgpu' ? 'WebGPU ready' : runtimeMode === 'wasm' ? 'WASM mode' : '…'}
          </span>
          <select
            className="engine-select"
            value={engineChoice}
            disabled={busy}
            onChange={(e) => {
              setEngineChoice(e.target.value as EngineChoice);
              engineRef.current = null;
            }}
            aria-label="OCR engine"
          >
            <option value="tesseract">Tesseract</option>
            <option value="paddle">Paddle ONNX</option>
          </select>
          <select
            className="engine-select"
            value={language}
            disabled={busy || engineChoice === 'paddle'}
            onChange={(e) => {
              setLanguage(e.target.value);
              engineRef.current = null;
            }}
            aria-label="Language"
            title={engineChoice === 'paddle' ? 'Paddle uses bundled multi-lang models' : 'Tesseract language pack'}
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <button type="button" className="pill ghost" onClick={() => setPanel('how')}>
            How it works
          </button>
          <button type="button" className="pill ghost" onClick={() => setPanel('privacy')}>
            Privacy
          </button>
          <button type="button" className="pill ghost" onClick={() => setPanel('history')}>
            History
          </button>
          {view === 'workspace' && (
            <button
              type="button"
              className="pill ghost"
              onClick={() => {
                setView('landing');
                setJob(null);
              }}
            >
              New file
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {panel && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setPanel(null)}
          onKeyDown={(e) => e.key === 'Escape' && setPanel(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-h">
              <h2 id="modal-title">
                {panel === 'how' ? 'How it works' : panel === 'privacy' ? 'Privacy' : 'History'}
              </h2>
              <button type="button" className="pill ghost" onClick={() => setPanel(null)}>
                Close
              </button>
            </div>
            <div className="modal-body">
              {panel === 'how' && (
                <ol>
                  <li>You drop a PDF or image — it never uploads to our servers.</li>
                  <li>Digital PDFs use the embedded text layer (fast, exact).</li>
                  <li>Scans run OCR in a local engine (Tesseract or Paddle ONNX).</li>
                  <li>Review bounding boxes + confidence, then export TXT / MD / JSON.</li>
                </ol>
              )}
              {panel === 'privacy' && (
                <>
                  <p>
                    <strong>Your documents stay on your device.</strong> Recognition runs in your
                    browser. We do not receive your files for OCR.
                  </p>
                  <p>
                    Model weights (Tesseract language data or ONNX models) may download from a CDN
                    on first use, like any static website asset — not your document pixels.
                  </p>
                  <p>
                    Optional session history is stored only in this browser&apos;s{' '}
                    <code>localStorage</code>. Clear it anytime below.
                  </p>
                  <p>
                    Analytics are off by default. No first-party document upload endpoint exists —
                    network activity is limited to static assets and model weights from the CDN.
                  </p>
                </>
              )}
              {panel === 'history' && (
                <>
                  {history.length === 0 ? (
                    <p className="muted">No saved results yet.</p>
                  ) : (
                    <ul className="history-list">
                      {history.map((h) => (
                        <li key={h.id}>
                          <strong>{h.fileName}</strong>
                          <span className="muted">
                            {' '}
                            · {h.pageCount}p · {h.engine} ·{' '}
                            {new Date(h.savedAt).toLocaleString()}
                          </span>
                          <div className="muted small">{h.previewText}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginTop: '1rem' }}
                    onClick={() => {
                      clearHistory();
                      setHistory([]);
                    }}
                  >
                    Clear history
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {view === 'landing' && (
        <main className="landing" id="main">
          <div className="hero">
            <h1>OCR that never leaves your browser</h1>
            <p>
              Drop a PDF or image. Models run locally with bounding boxes and confidence scores —
              no account, no upload.
            </p>
          </div>
          <div className="drop-card">
            <div
              className={`dropzone${dragOver ? ' active' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files?.length) void runFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              aria-label="Drop PDF or image to OCR"
            >
              <h2>Drop PDF or image here</h2>
              <p>Digital PDFs extract instantly; scans use on-device OCR.</p>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  Choose files
                </button>
              </div>
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={preprocess}
                onChange={(e) => setPreprocess(e.target.checked)}
              />
              Enhance images (contrast / grayscale) before OCR
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={deskew}
                onChange={(e) => setDeskew(e.target.checked)}
              />
              Auto-deskew (small rotation correction)
            </label>
            <div className="formats">
              Supports <span>PDF</span>
              <span>PNG</span>
              <span>JPEG</span>
              <span>WebP</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void runFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          {status && (
            <p className="status-msg" role="status" aria-live="polite">
              {status}
            </p>
          )}
          <div className="trust-row">
            <div className="trust">
              <strong>Private by default</strong>
              <span>Pixels stay in your tab. Only model weights download from the CDN.</span>
            </div>
            <div className="trust">
              <strong>Smart PDF path</strong>
              <span>Text-layer pages skip OCR for speed and perfect fidelity.</span>
            </div>
            <div className="trust">
              <strong>Structured export</strong>
              <span>TXT, Markdown, and JSON with boxes for downstream tools.</span>
            </div>
          </div>
        </main>
      )}

      {view === 'workspace' && job && (
        <main className="workspace" id="main">
          {status && (
            <p className="status-msg" style={{ margin: '0 0 0.5rem' }} role="status" aria-live="polite">
              {status}
            </p>
          )}
          <div className="ws-body">
            <aside className="ws-side" aria-label="Pages">
              <div className="ws-side-h">Pages</div>
              {job.pages.map((p) => (
                <button
                  key={p.index}
                  type="button"
                  className={`thumb${p.index === pageIndex ? ' active' : ''}`}
                  onClick={() => {
                    setPageIndex(p.index);
                    setSelectedBlock(null);
                    setRegion(null);
                  }}
                >
                  {p.previewUrl ? (
                    <img src={p.previewUrl} alt={`Page ${p.index + 1}`} />
                  ) : (
                    <div style={{ height: 90, background: '#e2e8f0' }} />
                  )}
                  <div className="thumb-meta">
                    <span>Page {p.index + 1}</span>
                    <span
                      style={{
                        color:
                          p.status === 'done'
                            ? 'var(--color-success)'
                            : p.status === 'running'
                              ? 'var(--color-primary)'
                              : p.status === 'failed'
                                ? '#b91c1c'
                                : undefined,
                      }}
                    >
                      {p.status}
                    </span>
                  </div>
                </button>
              ))}
            </aside>

            <section className="ws-center">
              <div className="ws-toolbar" role="toolbar" aria-label="Canvas tools">
                <button
                  type="button"
                  className={`tool${regionMode ? ' active' : ''}`}
                  onClick={() => setRegionMode((v) => !v)}
                  title="Region OCR"
                >
                  ▭ Region
                </button>
                {regionMode && region && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                    disabled={busy}
                    onClick={() => void runRegionOcr()}
                  >
                    OCR selection
                  </button>
                )}
              </div>
              <div className="ws-canvas-wrap">
                {page?.previewUrl && (
                  <div
                    className="doc-stage"
                    ref={stageRef}
                    onPointerDown={(e) => {
                      if (!regionMode) return;
                      const p = pointerToImage(e.clientX, e.clientY);
                      setDrawing(true);
                      setRegion({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
                      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      if (!drawing || !region) return;
                      const p = pointerToImage(e.clientX, e.clientY);
                      setRegion({ ...region, x1: p.x, y1: p.y });
                    }}
                    onPointerUp={() => setDrawing(false)}
                  >
                    <img
                      src={page.previewUrl}
                      alt={`Document page ${pageIndex + 1}`}
                      style={{ width: page.width, maxWidth: '100%' }}
                      draggable={false}
                    />
                    <div className="bbox-layer">
                      {blocks.map((b, i) => (
                        <div
                          key={i}
                          className={`bbox${selectedBlock === i ? ' hi' : ''}`}
                          style={{
                            left: `${(b.bbox.x / (page.width || 1)) * 100}%`,
                            top: `${(b.bbox.y / (page.height || 1)) * 100}%`,
                            width: `${(b.bbox.w / (page.width || 1)) * 100}%`,
                            height: `${(b.bbox.h / (page.height || 1)) * 100}%`,
                          }}
                        />
                      ))}
                      {region && page.width && page.height && (
                        <div
                          className="bbox hi"
                          style={{
                            left: `${(Math.min(region.x0, region.x1) / page.width) * 100}%`,
                            top: `${(Math.min(region.y0, region.y1) / page.height) * 100}%`,
                            width: `${(Math.abs(region.x1 - region.x0) / page.width) * 100}%`,
                            height: `${(Math.abs(region.y1 - region.y0) / page.height) * 100}%`,
                          }}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="ws-status">
                <span>
                  {busy
                    ? `Processing… page ${Math.min(doneCount + 1, job.pages.length)} of ${job.pages.length}`
                    : page?.result
                      ? `${page.result.engineId} · ${page.result.durationMs}ms · ${page.result.route ?? 'ocr'}`
                      : (page?.status ?? '')}
                </span>
                <div
                  className="progress"
                  role="progressbar"
                  aria-valuenow={Math.round(progress * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <i style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                {busy ? (
                  <button type="button" className="pill ghost" onClick={onCancel}>
                    Cancel
                  </button>
                ) : (
                  <span className="pill soft">{Math.round(progress * 100)}%</span>
                )}
              </div>
            </section>

            <aside className="ws-results" aria-label="Results">
              <div className="tabs" role="tablist">
                {(['text', 'markdown', 'json'] as ResultTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    className={`tab${tab === t ? ' active' : ''}`}
                    onClick={() => setTab(t)}
                  >
                    {t === 'text' ? 'Text' : t === 'markdown' ? 'Markdown' : 'JSON'}
                  </button>
                ))}
              </div>
              <div className="result-scroll" role="tabpanel">
                {tab === 'text' &&
                  (blocks.length ? (
                    blocks.map((b, i) => (
                      <div
                        key={i}
                        className={`result-line${selectedBlock === i ? ' selected' : ''}`}
                        onClick={() => setSelectedBlock(i)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setSelectedBlock(i);
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <span>{b.text}</span>
                        <span className={confidenceCssClass(b.confidence)}>
                          {b.confidence.toFixed(2)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="muted">
                      {page?.status === 'running' || busy
                        ? 'Recognizing…'
                        : (page?.error ?? 'No text yet.')}
                    </p>
                  ))}
                {tab === 'markdown' && (
                  <pre className="export-pre">{exportMd || '—'}</pre>
                )}
                {tab === 'json' && <pre className="export-pre json">{exportJson || '—'}</pre>}
              </div>
              <div className="result-footer">
                <button type="button" className="btn btn-secondary" onClick={() => void copyActive()}>
                  Copy
                </button>
                <button type="button" className="btn btn-primary" onClick={downloadActive}>
                  Download
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || !job}
                  onClick={() => void downloadSearchablePdf()}
                  title="Image pages + invisible text layer for search/select"
                  data-testid="download-searchable-pdf"
                >
                  PDF
                </button>
              </div>
            </aside>
          </div>
        </main>
      )}
    </div>
  );
}
