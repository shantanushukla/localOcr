/// <reference types="vite/client" />

declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const url: string;
  export default url;
}

declare module 'ppu-paddle-ocr/web' {
  export class PaddleOcrService {
    constructor(options?: unknown);
    initialize(): Promise<void>;
    destroy(): Promise<void>;
    recognize(
      image: unknown,
      opts?: { flatten?: boolean },
    ): Promise<{
      text: string;
      confidence: number;
      results?: Array<{
        text: string;
        confidence: number;
        box: { x: number; y: number; width: number; height: number };
      }>;
      lines?: Array<
        Array<{
          text: string;
          confidence: number;
          box: { x: number; y: number; width: number; height: number };
        }>
      >;
    }>;
  }
  export function isWebGpuAvailable(): Promise<boolean>;
}
