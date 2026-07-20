import type { ExportDocument, OcrJob } from './types.js';

export function jobToExportDocument(job: OcrJob): ExportDocument {
  return {
    version: 1,
    engine: job.engineId,
    fileName: job.fileName,
    pages: job.pages
      .filter((p) => p.result)
      .map((p) => {
        const blocks = p.result!.blocks;
        const inferredW =
          blocks.length > 0
            ? Math.max(...blocks.map((b) => b.bbox.x + b.bbox.w), 0)
            : 0;
        return {
          index: p.index,
          width: p.width ?? inferredW,
          height: p.height ?? 0,
          fullText: p.result!.fullText,
          blocks,
        };
      }),
  };
}

export function jobToPlainText(job: OcrJob): string {
  return job.pages
    .filter((p) => p.result)
    .map((p) => p.result!.fullText.trim())
    .filter(Boolean)
    .join('\n\n---\n\n');
}

export function jobToMarkdown(job: OcrJob): string {
  const parts = [`# ${job.fileName}`, '', `_Engine: ${job.engineId}_`, ''];
  for (const page of job.pages) {
    if (!page.result) continue;
    parts.push(`## Page ${page.index + 1}`, '', page.result.fullText.trim(), '');
  }
  return parts.join('\n');
}
