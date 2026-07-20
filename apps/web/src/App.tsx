import { useCallback, useMemo, useRef, useState } from 'react';
import type { OcrBlock, OcrEngine, OcrJob } from '@localocr/ocr-core';
import { JobOrchestrator, jobToMarkdown, jobToPlainText, jobToExportDocument } from '@localocr/ocr-core';
import { createTesseractEngine } from '@localocr/engine-tesseract';
import { prepareImage, preparePdf } from '@localocr/engine-digital-pdf';

type EngineChoice = 'tesseract' | 'paddle';
type View = 'landing' | 'workspace';
type ResultTab = 'text' | 'markdown' | 'json';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

async function createEngine(choice: EngineChoice): Promise<OcrEngine> {
  if (choice === 'paddle') {
    const { createPaddleEngine } = await import('@localocr/engine-paddle');
    return createPaddleEngine();
  }
  return createTesseractEngine();
}

function confClass(c: number): string {
  if (c >= 0.9) return 'conf';
  if (c >= 0.75) return 'conf mid';
  return 'conf low';
}

export function App() {
  const [view, setView] = useState<View>('landing');
  const [engineChoice, setEngineChoice] = useState<EngineChoice>('tesseract');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<OcrJob | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [tab, setTab] = useState<ResultTab>('text');
  const [dragOver, setDragOver] = useState(false);

  const engineRef = useRef<OcrEngine | null>(null);
  const orchRef = useRef<JobOrchestrator | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const page = job?.pages[pageIndex];
  const blocks: OcrBlock[] = page?.result?.blocks ?? [];
  const doneCount = job?.pages.filter((p) => p.status === 'done' || p.status === 'failed').length ?? 0;
  const progress = job ? doneCount / Math.max(job.pages.length, 1) : 0;

  const ensureEngine = useCallback(async (choice: EngineChoice) => {
    if (engineRef.current?.id.startsWith(choice === 'paddle' ? 'ppu' : 'tesseract')) {
      return engineRef.current;
    }
    if (engineRef.current) await engineRef.current.dispose();
    setStatus(
      choice === 'paddle'
        ? 'Loading Paddle OCR models (first run may download)…'
        : 'Loading Tesseract…',
    );
    const engine = await createEngine(choice);
    await engine.init({ preferWebGpu: true, language: 'eng' });
    engineRef.current = engine;
    orchRef.current = new JobOrchestrator(engine, {
      onJobUpdate: (j) => setJob(j),
    });
    return engine;
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

      try {
        await ensureEngine(engineChoice);
        const orch = orchRef.current!;
        setView('workspace');

        let pages;
        let fileName = file.name;

        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          setStatus('Reading PDF…');
          const prepared = await preparePdf(file, { scale: 2 });
          pages = prepared.pages;
          fileName = prepared.fileName;
          const digital = pages.filter((p) => p.digitalResult).length;
          setStatus(
            digital === pages.length
              ? 'Digital PDF — extracting text layer…'
              : `PDF ready (${digital} digital / ${pages.length - digital} OCR)…`,
          );
        } else if (IMAGE_TYPES.has(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
          setStatus('Preparing image…');
          pages = [await prepareImage(file)];
        } else {
          throw new Error(`Unsupported file type: ${file.type || file.name}`);
        }

        setStatus('Running recognition…');
        await orch.run(fileName, pages);
        setStatus('Done — files never left this device.');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStatus('');
      } finally {
        setBusy(false);
      }
    },
    [engineChoice, ensureEngine],
  );

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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo-mark">lO</div>
          <div>
            <div className="brand-name">localOCR</div>
            <div className="brand-tag">
              {job ? `${job.fileName} · ${job.pages.length} page(s)` : 'On-device document text'}
            </div>
          </div>
        </div>
        <div className="top-actions">
          <span className="pill soft">
            <span className="dot" /> On-device
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
            <option value="tesseract">Tesseract (fallback)</option>
            <option value="paddle">Paddle ONNX (WebGPU)</option>
          </select>
          {view === 'workspace' && (
            <button type="button" className="pill ghost" onClick={() => setView('landing')}>
              New file
            </button>
          )}
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {view === 'landing' && (
        <main className="landing">
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
          {status && <p className="status-msg">{status}</p>}
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
        <main className="workspace">
          {status && <p className="status-msg" style={{ margin: '0 0 0.5rem' }}>{status}</p>}
          <div className="ws-body">
            <aside className="ws-side">
              <div className="ws-side-h">Pages</div>
              {job.pages.map((p) => (
                <button
                  key={p.index}
                  type="button"
                  className={`thumb${p.index === pageIndex ? ' active' : ''}`}
                  onClick={() => {
                    setPageIndex(p.index);
                    setSelectedBlock(null);
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
              <div className="ws-canvas-wrap">
                {page?.previewUrl && (
                  <div className="doc-stage">
                    <img
                      src={page.previewUrl}
                      alt=""
                      style={{ width: page.width, maxWidth: '100%' }}
                    />
                    <div
                      className="bbox-layer"
                      style={{
                        width: '100%',
                        height: '100%',
                      }}
                    >
                      {blocks.map((b, i) => {
                        const scale =
                          page.width && page.previewUrl
                            ? // img may shrink; use percent positions
                              1
                            : 1;
                        void scale;
                        return (
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
                        );
                      })}
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
                      : page?.status ?? ''}
                </span>
                <div className="progress">
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

            <aside className="ws-results">
              <div className="tabs">
                {(['text', 'markdown', 'json'] as ResultTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`tab${tab === t ? ' active' : ''}`}
                    onClick={() => setTab(t)}
                  >
                    {t === 'text' ? 'Text' : t === 'markdown' ? 'Markdown' : 'JSON'}
                  </button>
                ))}
              </div>
              <div className="result-scroll">
                {tab === 'text' &&
                  (blocks.length ? (
                    blocks.map((b, i) => (
                      <div
                        key={i}
                        className={`result-line${selectedBlock === i ? ' selected' : ''}`}
                        onClick={() => setSelectedBlock(i)}
                        onKeyDown={() => setSelectedBlock(i)}
                        role="button"
                        tabIndex={0}
                      >
                        <span>{b.text}</span>
                        <span className={confClass(b.confidence)}>
                          {b.confidence.toFixed(2)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p style={{ color: 'var(--color-text-muted)' }}>
                      {page?.status === 'running' || busy
                        ? 'Recognizing…'
                        : page?.error ?? 'No text yet.'}
                    </p>
                  ))}
                {tab === 'markdown' && (
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    {exportMd || '—'}
                  </pre>
                )}
                {tab === 'json' && (
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {exportJson || '—'}
                  </pre>
                )}
              </div>
              <div className="result-footer">
                <button type="button" className="btn btn-secondary" onClick={() => void copyActive()}>
                  Copy
                </button>
                <button type="button" className="btn btn-primary" onClick={downloadActive}>
                  Download
                </button>
              </div>
            </aside>
          </div>
        </main>
      )}
    </div>
  );
}
