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
  type HistoryEntry,
} from '@localocr/ocr-core';
import { createTesseractEngine } from '@localocr/engine-tesseract';
import { prepareImage, preparePdf } from '@localocr/engine-digital-pdf';
import { isImageFile, isPdfFile } from './file-types';

type EngineChoice = 'tesseract' | 'paddle';
type View = 'landing' | 'workspace' | 'export';
type ResultTab = 'text' | 'markdown' | 'json';
type Panel = null | 'how' | 'privacy' | 'terms' | 'about' | 'engines';

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

/** Paddle det models struggle on tiny crops — upscale so recognition can run. */
const REGION_MIN_SIDE = 64;

async function createEngine(choice: EngineChoice): Promise<OcrEngine> {
  if (choice === 'paddle') {
    const { createPaddleEngine } = await import('@localocr/engine-paddle');
    return createPaddleEngine();
  }
  return createTesseractEngine();
}

/** Upscale a crop canvas when too small for detection models; returns scale applied. */
function prepareRegionCrop(source: HTMLCanvasElement): { canvas: HTMLCanvasElement; scale: number } {
  const minSide = Math.min(source.width, source.height);
  if (minSide >= REGION_MIN_SIDE) {
    return { canvas: source, scale: 1 };
  }
  const scale = REGION_MIN_SIDE / Math.max(minSide, 1);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(source.width * scale));
  out.height = Math.max(1, Math.round(source.height * scale));
  const ctx = out.getContext('2d');
  if (!ctx) return { canvas: source, scale: 1 };
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return { canvas: out, scale };
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
  const [showBoxes, setShowBoxes] = useState(true);
  const [showConf, setShowConf] = useState(true);

  const engineRef = useRef<OcrEngine | null>(null);
  const orchRef = useRef<JobOrchestrator | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasSources = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const runGeneration = useRef(0);
  /** Refs so region drag works without waiting for React re-render mid-gesture. */
  const drawingRef = useRef(false);
  const regionRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

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
      setJob(null);
      canvasSources.current.clear();
      const gen = ++runGeneration.current;
      // Enter workspace immediately so cancel / progress chrome is available
      setView('workspace');
      setStatus('Loading engine…');

      try {
        await ensureEngine(engineChoice, language);
        if (gen !== runGeneration.current) return;
        const orch = orchRef.current!;

        let pages;
        let fileName = file.name;

        if (isPdfFile(file)) {
          setStatus('Reading PDF…');
          const prepared = await preparePdf(file, { scale: 2 });
          if (gen !== runGeneration.current) return;
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
          if (gen !== runGeneration.current) return;
          if (pages[0]?.image instanceof HTMLCanvasElement) {
            canvasSources.current.set(0, pages[0].image);
          }
        } else {
          throw new Error(`Unsupported file type: ${file.type || file.name}`);
        }

        setStatus('Running recognition…');
        const finished = await orch.run(fileName, pages);
        if (gen !== runGeneration.current) return;
        persistJob(finished);
        setStatus('Done — files never left this device.');
      } catch (e) {
        if (gen !== runGeneration.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStatus('');
      } finally {
        if (gen === runGeneration.current) setBusy(false);
      }
    },
    [engineChoice, language, preprocess, deskew, ensureEngine, persistJob],
  );

  const runRegionOcr = useCallback(async () => {
    const activeRegion = regionRef.current ?? region;
    if (!activeRegion || !job) return;
    const src = canvasSources.current.get(pageIndex);
    if (!src) {
      setError('Page canvas unavailable for region OCR. Re-open the file and try again.');
      return;
    }
    const x = Math.min(activeRegion.x0, activeRegion.x1);
    const y = Math.min(activeRegion.y0, activeRegion.y1);
    const w = Math.abs(activeRegion.x1 - activeRegion.x0);
    const h = Math.abs(activeRegion.y1 - activeRegion.y0);
    if (w < 4 || h < 4) {
      setError('Draw a larger region, then click OCR selection.');
      return;
    }

    // Clamp to source canvas bounds
    const cx = Math.max(0, Math.min(Math.floor(x), src.width - 1));
    const cy = Math.max(0, Math.min(Math.floor(y), src.height - 1));
    const cw = Math.max(1, Math.min(Math.ceil(w), src.width - cx));
    const ch = Math.max(1, Math.min(Math.ceil(h), src.height - cy));

    setBusy(true);
    setError(null);
    try {
      await ensureEngine(engineChoice, language);
      const engine = engineRef.current;
      if (!engine) throw new Error('OCR engine failed to load');

      const rawCrop = cropCanvas(src, { x: cx, y: cy, w: cw, h: ch });
      // Paddle (and small Tesseract crops) benefit from a minimum side length
      const { canvas: crop, scale } = prepareRegionCrop(rawCrop);
      setStatus(
        engineChoice === 'paddle'
          ? 'Recognizing region with Paddle ONNX…'
          : 'Recognizing region with Tesseract…',
      );

      // Pass HTMLCanvasElement — Tesseract.js cannot read raw ImageData
      // ("Error attempting to read image."). Paddle engine accepts canvas too
      // and converts to ImageBitmap/ImageData inside the worker path.
      const result = await engine.recognize({
        width: crop.width,
        height: crop.height,
        image: crop,
      });

      // Map bboxes from upscaled crop space → page space
      const inv = scale !== 0 ? 1 / scale : 1;
      const offsetBlocks = result.blocks.map((b) => ({
        ...b,
        bbox: {
          x: b.bbox.x * inv + cx,
          y: b.bbox.y * inv + cy,
          w: b.bbox.w * inv,
          h: b.bbox.h * inv,
        },
      }));

      setJob((prev) => {
        if (!prev) return prev;
        const pages = [...prev.pages];
        const p = { ...pages[pageIndex]! };
        p.result = {
          ...result,
          blocks: offsetBlocks,
          fullText: result.fullText,
          engineId: result.engineId,
        };
        p.status = 'done';
        pages[pageIndex] = p;
        return { ...prev, pages, status: 'done', engineId: result.engineId };
      });
      setStatus('Region OCR complete.');
      setRegionMode(false);
      regionRef.current = null;
      setRegion(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        engineChoice === 'paddle'
          ? `Paddle region OCR failed: ${msg}. Try a larger selection, or switch to Tesseract.`
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }, [region, job, pageIndex, engineChoice, language, ensureEngine]);

  const onCancel = () => {
    runGeneration.current += 1;
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

  const pasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        const ext = type.split('/')[1] || 'png';
        const file = new File([blob], `clipboard.${ext}`, { type });
        void runFiles([file]);
        return;
      }
      setError('No image found on the clipboard.');
    } catch {
      setError('Clipboard access denied. Use Choose files instead.');
    }
  };

  const downloadNamed = (kind: 'txt' | 'md' | 'json') => {
    if (!job) return;
    const text = kind === 'md' ? exportMd : kind === 'json' ? exportJson : exportText;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${job.fileName || 'ocr'}.${kind === 'md' ? 'md' : kind}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const engineLabel =
    engineChoice === 'paddle'
      ? runtimeMode === 'webgpu'
        ? 'Paddle · WebGPU'
        : 'Paddle · WASM'
      : 'Tesseract';

  const langShort = LANGS.find((l) => l.code === language)?.code.slice(0, 2).toUpperCase() ?? 'EN';

  const statusLabel = (s: string) => {
    if (s === 'done') return 'Done';
    if (s === 'running') return 'Running';
    if (s === 'failed') return 'Failed';
    if (s === 'queued') return 'Queued';
    if (s === 'cancelled') return 'Cancelled';
    return s;
  };

  const lastHistory = history[0];

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
          <div className="brand-text">
            <div className="brand-name">
              {view === 'export' ? 'Export results' : 'localOCR'}
            </div>
            <div className="brand-tag">
              {view === 'export'
                ? 'Nothing left this device'
                : job
                  ? `${job.fileName} · ${job.pages.length} page${job.pages.length === 1 ? '' : 's'}`
                  : 'On-device document text'}
            </div>
          </div>
        </div>
        <div className="top-actions">
          {view === 'export' ? (
            <>
              <button type="button" className="pill ghost" onClick={() => setView('workspace')}>
                ← Back to workspace
              </button>
              <span className="pill soft" data-testid="on-device-badge">
                <span className="dot" /> On-device
              </span>
            </>
          ) : view === 'landing' ? (
            <>
              <span
                className="pill soft"
                title="Processing stays in this browser tab"
                data-testid="on-device-badge"
              >
                <span className="dot" /> On-device
              </span>
              <span
                className="pill ghost hide-on-mobile"
                title={
                  runtimeMode === 'webgpu'
                    ? 'WebGPU available — Paddle will prefer GPU acceleration'
                    : 'WebGPU unavailable — engines use WASM (slower but works)'
                }
                data-testid="runtime-mode"
              >
                {runtimeMode === 'webgpu' ? 'WebGPU ready' : runtimeMode === 'wasm' ? 'WASM mode' : '…'}
              </span>
              <button type="button" className="pill ghost" onClick={() => setPanel('how')}>
                How it works
              </button>
            </>
          ) : (
            <>
              <span className="pill soft" data-testid="on-device-badge">
                <span className="dot" /> On-device
              </span>
              <select
                className="engine-select"
                value={engineChoice}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value as EngineChoice;
                  setEngineChoice(next);
                  // Tear down previous engine so region OCR loads the newly selected one
                  const prev = engineRef.current;
                  engineRef.current = null;
                  void prev?.dispose().catch(() => {
                    /* ignore dispose races */
                  });
                }}
                aria-label="OCR engine"
                title={`${engineLabel} — region OCR and new runs use this engine`}
              >
                <option value="tesseract">Tesseract</option>
                <option value="paddle">Paddle ONNX</option>
              </select>
              <button
                type="button"
                className="pill ghost hide-on-mobile"
                onClick={() => setPanel('engines')}
                title="When to use Tesseract vs Paddle"
              >
                Engines
              </button>
              <span className="pill ghost hide-on-mobile" title={engineLabel}>
                {engineLabel}
              </span>
              <select
                className="engine-select hide-on-mobile"
                value={language}
                disabled={busy || engineChoice === 'paddle'}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  engineRef.current = null;
                }}
                aria-label="Language"
                title={
                  engineChoice === 'paddle'
                    ? 'Paddle uses bundled multi-lang models'
                    : 'Tesseract language pack'
                }
              >
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.code === 'eng' ? 'EN' : l.label}
                  </option>
                ))}
              </select>
              <span className="pill ghost hide-on-mobile">{langShort}</span>
              <button
                type="button"
                className="pill primary"
                disabled={!job || job.status === 'running' || busy}
                onClick={() => setView('export')}
              >
                Export
              </button>
              <button
                type="button"
                className="pill ghost hide-on-mobile"
                onClick={() => {
                  runGeneration.current += 1;
                  orchRef.current?.cancel();
                  setBusy(false);
                  setView('landing');
                  setJob(null);
                  setStatus('');
                  setError(null);
                }}
              >
                New file
              </button>
            </>
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
                {panel === 'how'
                  ? 'How it works'
                  : panel === 'engines'
                    ? 'OCR engines'
                    : panel === 'privacy'
                      ? 'Privacy'
                      : panel === 'terms'
                        ? 'Terms of use'
                        : 'About us'}
              </h2>
              <button type="button" className="pill ghost" onClick={() => setPanel(null)}>
                Close
              </button>
            </div>
            <div className="modal-body">
              {panel === 'how' && (
                <>
                  <ol>
                    <li>You drop a PDF or image — it never uploads to our servers.</li>
                    <li>Digital PDFs use the embedded text layer (fast, exact).</li>
                    <li>Scans run OCR in a local engine (Tesseract or Paddle ONNX).</li>
                    <li>Review bounding boxes + confidence, then export TXT / MD / JSON.</li>
                  </ol>
                  <p className="muted small" style={{ marginTop: '1rem' }}>
                    Need help choosing an engine?{' '}
                    <button
                      type="button"
                      className="footer-link"
                      style={{ display: 'inline', padding: 0 }}
                      onClick={() => setPanel('engines')}
                    >
                      Compare Tesseract vs Paddle
                    </button>
                  </p>
                </>
              )}
              {panel === 'engines' && (
                <div className="engine-guide">
                  <section>
                    <h3>Tesseract (default)</h3>
                    <p>
                      Classic open-source OCR via <code>tesseract.js</code>. Best default for most
                      documents: printed invoices, letters, screenshots, and multi-language packs
                      you can pick explicitly.
                    </p>
                    <ul>
                      <li>
                        <strong>Use when:</strong> you need a specific language pack, stable line
                        boxes, or lighter first-run downloads.
                      </li>
                      <li>
                        <strong>Strengths:</strong> many languages, predictable behavior, good on
                        clean scans and digital-looking pages.
                      </li>
                      <li>
                        <strong>Trade-offs:</strong> can struggle on heavy noise, odd layouts, or
                        dense multi-column tables; runs on CPU/WASM (no WebGPU).
                      </li>
                    </ul>
                  </section>
                  <section>
                    <h3>Paddle ONNX</h3>
                    <p>
                      Detection + recognition models from PaddleOCR, run with ONNX Runtime in a
                      Web Worker. Prefers <strong>WebGPU</strong> when available, otherwise WASM.
                    </p>
                    <ul>
                      <li>
                        <strong>Use when:</strong> complex layouts, mixed scripts, or you want
                        GPU-accelerated recognition on supported browsers.
                      </li>
                      <li>
                        <strong>Strengths:</strong> often stronger detection on photos and messy
                        scans; worker keeps the UI responsive.
                      </li>
                      <li>
                        <strong>Trade-offs:</strong> larger model download on first use; language
                        is multi/bundled (no per-pack selector); first load is slower.
                      </li>
                    </ul>
                  </section>
                  <section>
                    <h3>Digital PDF path</h3>
                    <p>
                      Neither engine is needed when a PDF already has a text layer — we extract it
                      instantly for perfect fidelity. Scanned PDF pages still go through the
                      selected OCR engine.
                    </p>
                  </section>
                  <section>
                    <h3>Region OCR tip</h3>
                    <p>
                      Use the ▭ tool, drag a box on the page, then <strong>OCR selection</strong>.
                      Works with both engines; small boxes are upscaled automatically for Paddle.
                    </p>
                  </section>
                </div>
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
                    A short “last result” preview may be stored in this browser&apos;s{' '}
                    <code>localStorage</code> so mobile can show recent text. Document images are
                    never uploaded or retained on a server.
                  </p>
                  <p>
                    Analytics are off by default. No first-party document upload endpoint exists —
                    network activity is limited to static assets and model weights from the CDN.
                  </p>
                </>
              )}
              {panel === 'terms' && (
                <>
                  <p>
                    localOCR is provided as-is for personal and professional document text
                    extraction that runs entirely in your browser.
                  </p>
                  <p>
                    You are responsible for the documents you process and for complying with any
                    rights or laws that apply to that content. Do not use the tool for unlawful
                    purposes.
                  </p>
                  <p>
                    Results from OCR engines can contain mistakes. Always verify critical text
                    before relying on exports in legal, medical, financial, or other high-stakes
                    contexts.
                  </p>
                  <p>
                    The service may change, pause, or discontinue features without notice. We are
                    not liable for loss of data that never leaves your device, or for decisions
                    made from OCR output.
                  </p>
                </>
              )}
              {panel === 'about' && (
                <>
                  <p>
                    <strong>localOCR</strong> is a privacy-first OCR app: PDFs and images are
                    recognized on-device with open engines (Tesseract, optional Paddle ONNX) and a
                    fast digital PDF text-layer path.
                  </p>
                  <p>
                    The product UI follows a calm utility pattern (setcalculators-inspired): clear
                    drop zone, honest status chips, and structured export — without accounts or
                    document uploads.
                  </p>
                  <p className="muted small">
                    Design source: <code>docs/ui</code> · On-device by default.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {view === 'landing' && (
        <main className="landing" id="main">
          <div className="hero desktop-only">
            <h1>OCR that never leaves your browser</h1>
            <p>
              Drop a PDF or image. Models run locally with bounding boxes and confidence scores —
              no account, no upload.
            </p>
          </div>
          <div className="hero mobile-only">
            <h1>Scan or import</h1>
            <p>OCR runs on this device. Nothing is uploaded.</p>
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
              <div className="drop-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 16V4" />
                  <path d="M7 9l5-5 5 5" />
                  <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                </svg>
              </div>
              <h2 className="desktop-only">Drop PDF or image here</h2>
              <h2 className="mobile-only">Tap to capture</h2>
              <p className="desktop-only">Digital PDFs extract instantly; scans use on-device OCR.</p>
              <p className="mobile-only">Camera or photo library</p>
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
                  <span className="desktop-only">Choose files</span>
                  <span className="mobile-only">Choose photo</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary hide-on-mobile"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void pasteFromClipboard();
                  }}
                >
                  Paste from clipboard
                </button>
              </div>
            </div>
            <div className="formats">
              Supports <span>PDF</span>
              <span>PNG</span>
              <span>JPEG</span>
              <span>WebP</span>
            </div>
            <div className="options-row hide-on-mobile">
              <label className="toggle-row">
                <span className="opt-label">Engine</span>
                <select
                  className="engine-select"
                  value={engineChoice}
                  disabled={busy}
                  onChange={(e) => {
                    setEngineChoice(e.target.value as EngineChoice);
                    void engineRef.current?.dispose();
                    engineRef.current = null;
                  }}
                  aria-label="OCR engine"
                >
                  <option value="tesseract">Tesseract — general docs</option>
                  <option value="paddle">Paddle ONNX — complex / GPU</option>
                </select>
              </label>
              <label className="toggle-row">
                <span className="opt-label">Language</span>
                <select
                  className="engine-select"
                  value={language}
                  disabled={busy || engineChoice === 'paddle'}
                  onChange={(e) => {
                    setLanguage(e.target.value);
                    void engineRef.current?.dispose();
                    engineRef.current = null;
                  }}
                  aria-label="Language"
                  title={
                    engineChoice === 'paddle'
                      ? 'Paddle uses bundled multi-language models'
                      : 'Tesseract language pack'
                  }
                >
                  {LANGS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={preprocess}
                  onChange={(e) => setPreprocess(e.target.checked)}
                />
                Enhance images
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={deskew}
                  onChange={(e) => setDeskew(e.target.checked)}
                />
                Auto-deskew
              </label>
              <button
                type="button"
                className="footer-link"
                onClick={() => setPanel('engines')}
              >
                Which engine?
              </button>
            </div>
            <p className="engine-hint hide-on-mobile">
              {engineChoice === 'paddle'
                ? 'Paddle ONNX: better on complex layouts & photos; WebGPU when available; larger first download.'
                : 'Tesseract: solid default for clean scans & multi-language packs; lighter first load.'}
            </p>
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
          {lastHistory && (
            <div className="mobile-last mobile-only">
              <h3>Last result</h3>
              <p>
                <strong>{lastHistory.fileName}</strong>
                <br />
                {lastHistory.previewText}
              </p>
            </div>
          )}
          {lastHistory && (
            <div className="mobile-bottom-bar mobile-only">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void navigator.clipboard.writeText(lastHistory.previewText)}
              >
                Copy
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (navigator.share) {
                    void navigator.share({ text: lastHistory.previewText }).catch(() => undefined);
                  } else {
                    void navigator.clipboard.writeText(lastHistory.previewText);
                    setStatus('Copied — share sheet unavailable');
                  }
                }}
              >
                Share text
              </button>
            </div>
          )}
          <div className="trust-row desktop-only">
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

      {view === 'workspace' && (
        <main className="workspace" id="main">
          <div className="ws-body">
            <aside className="ws-side" aria-label="Pages">
              <div className="ws-side-h">Pages</div>
              <div className="thumb-list">
                {job ? (
                  job.pages.map((p) => (
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
                        <div className="thumb-placeholder" />
                      )}
                      <div className="thumb-meta">
                        <span>Page {p.index + 1}</span>
                        <span
                          className={
                            p.status === 'done'
                              ? 'badge-ok'
                              : p.status === 'running'
                                ? 'badge-run'
                                : p.status === 'failed'
                                  ? 'badge-fail'
                                  : 'badge-queued'
                          }
                        >
                          {statusLabel(p.status)}
                        </span>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="thumb placeholder-thumb">
                    <div className="thumb-placeholder" />
                    <div className="thumb-meta">
                      <span>Page 1</span>
                      <span className="badge-run">Loading</span>
                    </div>
                  </div>
                )}
              </div>
            </aside>

            <section className="ws-center">
              <div className="ws-toolbar" role="toolbar" aria-label="Canvas tools">
                <div className="tool-group">
                  <button
                    type="button"
                    className={`tool${!regionMode ? ' active' : ''}`}
                    onClick={() => setRegionMode(false)}
                    title="Select"
                    aria-label="Select tool"
                  >
                    ↖
                  </button>
                  <button
                    type="button"
                    className={`tool${regionMode ? ' active' : ''}`}
                    onClick={() => setRegionMode((v) => !v)}
                    title="Region OCR"
                    aria-label="Region OCR"
                    data-testid="tool-region"
                  >
                    ▭
                  </button>
                  {regionMode && region && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                      disabled={busy}
                      onClick={() => void runRegionOcr()}
                      data-testid="ocr-selection"
                    >
                      OCR selection
                    </button>
                  )}
                </div>
                <div className="tool-group">
                  <button
                    type="button"
                    className={`tool tool-pill${showBoxes ? ' active' : ''}`}
                    onClick={() => setShowBoxes((v) => !v)}
                  >
                    Boxes {showBoxes ? 'on' : 'off'}
                  </button>
                  <button
                    type="button"
                    className={`tool tool-pill${showConf ? ' active' : ''}`}
                    onClick={() => setShowConf((v) => !v)}
                  >
                    Conf. heat
                  </button>
                </div>
              </div>
              <div className="ws-canvas-wrap">
                {page?.previewUrl ? (
                  <div
                    className="doc-stage"
                    ref={stageRef}
                    data-testid="doc-stage"
                    onPointerDown={(e) => {
                      if (!regionMode) return;
                      e.preventDefault();
                      // Capture on the stage (not the img) so move/up stay on this element
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const p = pointerToImage(e.clientX, e.clientY);
                      const next = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
                      drawingRef.current = true;
                      regionRef.current = next;
                      setRegion(next);
                    }}
                    onPointerMove={(e) => {
                      if (!drawingRef.current) return;
                      const prev = regionRef.current;
                      if (!prev) return;
                      const p = pointerToImage(e.clientX, e.clientY);
                      const next = { ...prev, x1: p.x, y1: p.y };
                      regionRef.current = next;
                      setRegion(next);
                    }}
                    onPointerUp={(e) => {
                      drawingRef.current = false;
                      try {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      } catch {
                        /* already released */
                      }
                    }}
                    onPointerCancel={() => {
                      drawingRef.current = false;
                    }}
                  >
                    <img
                      src={page.previewUrl}
                      alt={`Document page ${pageIndex + 1}`}
                      className="doc-stage-img"
                      draggable={false}
                    />
                    <div className="bbox-layer">
                      {showBoxes &&
                        blocks.map((b, i) => (
                          <div
                            key={i}
                            className={`bbox${selectedBlock === i ? ' hi' : ''}`}
                            style={{
                              left: `${(b.bbox.x / (page.width || 1)) * 100}%`,
                              top: `${(b.bbox.y / (page.height || 1)) * 100}%`,
                              width: `${(b.bbox.w / (page.width || 1)) * 100}%`,
                              height: `${(b.bbox.h / (page.height || 1)) * 100}%`,
                              opacity: showConf ? 0.35 + b.confidence * 0.65 : 1,
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
                ) : (
                  <div className="ws-empty" role="status">
                    <p>{status || (busy ? 'Preparing document…' : 'Drop a file to begin')}</p>
                    {busy && (
                      <button type="button" className="pill ghost" onClick={onCancel}>
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="ws-status" data-testid="ws-status">
                <span data-testid="ws-status-text">
                  {(() => {
                    if (busy && job) {
                      return (
                        status ||
                        `Page ${Math.min(doneCount + 1, job.pages.length)} of ${job.pages.length} · processing`
                      );
                    }
                    if (busy) return status || 'Processing…';
                    const pageLine =
                      page?.result && job
                        ? `Page ${pageIndex + 1} of ${job.pages.length} · ${page.result.engineId} · ${page.result.durationMs}ms`
                        : '';
                    // Prefer explicit status (e.g. "Region OCR complete.") so users/tests see it
                    if (status && pageLine) return `${status} · ${pageLine}`;
                    return status || pageLine || page?.status || '';
                  })()}
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
                        {showConf && (
                          <span className={confidenceCssClass(b.confidence)}>
                            {b.confidence.toFixed(2)}
                          </span>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="muted">
                      {page?.status === 'running' || busy
                        ? 'Recognizing…'
                        : (page?.error ?? 'No text yet.')}
                    </p>
                  ))}
                {tab === 'markdown' && <pre className="export-pre">{exportMd || '—'}</pre>}
                {tab === 'json' && <pre className="export-pre json">{exportJson || '—'}</pre>}
              </div>
              <div className="result-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void copyActive()}
                  disabled={!job}
                >
                  Copy
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setView('export')}
                  disabled={!job || job.status === 'running'}
                >
                  Export…
                </button>
              </div>
            </aside>
          </div>
        </main>
      )}

      {view === 'export' && job && (
        <main className="export-view" id="main">
          <div className="export-main">
            <section className="panel">
              <div className="panel-h">
                <h2>Markdown</h2>
                <span className="pill soft">Preview</span>
              </div>
              <div className="panel-body">
                <pre className="export-pre" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.9rem' }}>
                  {exportMd || '—'}
                </pre>
                <p className="export-meta">
                  Generated locally · engine {job.engineId} · {job.pages.length} page
                  {job.pages.length === 1 ? '' : 's'}
                </p>
              </div>
            </section>
            <section className="panel">
              <div className="panel-h">
                <h2>JSON structure</h2>
                <span className="pill soft">Schema v1</span>
              </div>
              <div className="panel-body mono">{exportJson || '—'}</div>
            </section>
          </div>
          <div className="export-actions">
            <button type="button" className="btn btn-secondary" onClick={() => downloadNamed('txt')}>
              Download .txt
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => downloadNamed('md')}>
              Download .md
            </button>
            <button type="button" className="btn btn-primary" onClick={() => downloadNamed('json')}>
              Download .json
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void navigator.clipboard.writeText(exportText + '\n\n' + exportJson)}
            >
              Copy all
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void downloadSearchablePdf()}
              data-testid="download-searchable-pdf"
              title="Image pages + invisible text layer"
            >
              Searchable PDF
            </button>
          </div>
        </main>
      )}

      <footer className="site-footer">
        <div className="site-footer-inner">
          <span className="site-footer-brand">localOCR · on-device OCR</span>
          <nav className="site-footer-nav" aria-label="Site">
            <button type="button" className="footer-link" onClick={() => setPanel('privacy')}>
              Privacy
            </button>
            <button type="button" className="footer-link" onClick={() => setPanel('terms')}>
              Terms of use
            </button>
            <button type="button" className="footer-link" onClick={() => setPanel('about')}>
              About us
            </button>
            <button type="button" className="footer-link" onClick={() => setPanel('how')}>
              How it works
            </button>
          </nav>
        </div>
      </footer>
    </div>
  );
}
