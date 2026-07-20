import type { JobPage, OcrEngine, OcrJob, OcrPageResult } from './types.js';

export type PageSource = {
  index: number;
  width: number;
  height: number;
  image: CanvasImageSource | Blob | string | ImageData;
  previewUrl?: string;
  /** If set, skip OCR and use this result (digital PDF path). */
  digitalResult?: OcrPageResult;
};

export type OrchestratorEvents = {
  onJobUpdate?: (job: OcrJob) => void;
  onPageStart?: (pageIndex: number) => void;
  onPageDone?: (pageIndex: number, result: OcrPageResult) => void;
  onPageError?: (pageIndex: number, error: Error) => void;
};

function uid(): string {
  return crypto.randomUUID?.() ?? `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sequential page processor with cancel support.
 * Keeps memory bounded by processing one page at a time.
 */
export class JobOrchestrator {
  private abort: AbortController | null = null;

  constructor(
    private engine: OcrEngine,
    private events: OrchestratorEvents = {},
  ) {}

  setEngine(engine: OcrEngine) {
    this.engine = engine;
  }

  cancel() {
    this.abort?.abort();
  }

  async run(fileName: string, pages: PageSource[]): Promise<OcrJob> {
    this.abort?.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal;

    const job: OcrJob = {
      id: uid(),
      fileName,
      status: 'running',
      engineId: this.engine.id,
      createdAt: Date.now(),
      pages: pages.map(
        (p): JobPage => ({
          index: p.index,
          status: 'queued',
          width: p.width,
          height: p.height,
          previewUrl: p.previewUrl,
        }),
      ),
    };
    this.events.onJobUpdate?.(structuredClone(job));

    try {
      for (const src of pages) {
        if (signal.aborted) {
          job.status = 'cancelled';
          for (const p of job.pages) {
            if (p.status === 'queued' || p.status === 'running') p.status = 'cancelled';
          }
          this.events.onJobUpdate?.(structuredClone(job));
          return job;
        }

        const page = job.pages[src.index]!;
        page.status = 'running';
        this.events.onPageStart?.(src.index);
        this.events.onJobUpdate?.(structuredClone(job));

        try {
          let result: OcrPageResult;
          if (src.digitalResult) {
            result = src.digitalResult;
          } else {
            result = await this.engine.recognize({
              width: src.width,
              height: src.height,
              image: src.image,
              signal,
            });
          }
          page.status = 'done';
          page.result = result;
          page.width = src.width;
          page.height = src.height;
          this.events.onPageDone?.(src.index, result);
        } catch (e) {
          if (signal.aborted) {
            page.status = 'cancelled';
          } else {
            page.status = 'failed';
            page.error = e instanceof Error ? e.message : String(e);
            this.events.onPageError?.(
              src.index,
              e instanceof Error ? e : new Error(String(e)),
            );
          }
        }
        this.events.onJobUpdate?.(structuredClone(job));
      }

      if (signal.aborted) {
        job.status = 'cancelled';
      } else if (job.pages.every((p) => p.status === 'failed')) {
        job.status = 'failed';
      } else {
        job.status = 'done';
      }
      this.events.onJobUpdate?.(structuredClone(job));
      return job;
    } finally {
      this.abort = null;
    }
  }
}
