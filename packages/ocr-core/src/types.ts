/** Axis-aligned box in page image coordinates (pixels). */
export type BBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type OcrBlockLevel = 'page' | 'block' | 'line' | 'word';

export type OcrBlock = {
  text: string;
  bbox: BBox;
  /** 0–1 */
  confidence: number;
  level: OcrBlockLevel;
};

export type OcrPageInput = {
  width: number;
  height: number;
  /** Canvas, ImageBitmap, Blob, or data URL depending on engine support */
  image: CanvasImageSource | Blob | string | ImageData;
  languageHints?: string[];
  signal?: AbortSignal;
};

export type OcrPageResult = {
  blocks: OcrBlock[];
  fullText: string;
  engineId: string;
  durationMs: number;
  /** How the page was produced */
  route?: 'ocr' | 'digital';
};

export type EngineCapabilities = {
  languages: string[];
  webgpu: boolean;
  bboxes: boolean;
  confidence: boolean;
};

export type EngineInitOptions = {
  /** Base URL for model / wasm assets (trailing slash optional). */
  baseUrl?: string;
  preferWebGpu?: boolean;
  language?: string;
};

export interface OcrEngine {
  readonly id: string;
  readonly capabilities: EngineCapabilities;
  init(opts?: EngineInitOptions): Promise<void>;
  recognize(input: OcrPageInput): Promise<OcrPageResult>;
  dispose(): Promise<void>;
}

export type PageStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type JobPage = {
  index: number;
  status: PageStatus;
  width?: number;
  height?: number;
  result?: OcrPageResult;
  error?: string;
  /** Object URL for preview (caller manages revoke) */
  previewUrl?: string;
};

export type JobStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'failed';

export type OcrJob = {
  id: string;
  fileName: string;
  status: JobStatus;
  pages: JobPage[];
  engineId: string;
  createdAt: number;
};

export type ExportDocument = {
  version: 1;
  engine: string;
  fileName: string;
  pages: Array<{
    index: number;
    width: number;
    height: number;
    fullText: string;
    blocks: OcrBlock[];
  }>;
};
