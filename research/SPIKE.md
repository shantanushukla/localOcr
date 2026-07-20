# Engine spike — localOCR

**Date:** 2026-07-20  
**Goal:** Choose browser-local OCR engines that fit Cloudflare Pages (25 MiB/asset) and the Job/Page/Block model.

## Clones reviewed

| Repo | License | Browser entry | Notes |
|------|---------|---------------|-------|
| `tesseract.js` v7 | Apache-2.0 | Yes (WASM worker) | Mature; 100+ langs; bboxes + conf; no native PDF |
| `tesseract-wasm` | Apache-2.0 | Yes | Leaner Tesseract WASM; lower-level |
| `ppu-paddle-ocr` v6 | MIT | `ppu-paddle-ocr/web` | **Default candidate** — WebGPU auto, PP-OCRv5/v6, Box+conf |
| `client-ocr` | MIT | ONNX RapidOCR + Paddle | Good reference app; more opinionated packaging |
| `paddleocr.js` | MIT | ONNX Runtime | Small PP-OCRv5; less docs than ppu |
| `paddleocr-browser` | — | Demo around eSearch-OCR | Reference only |
| `RapidOCR` | Apache-2.0 | Server-oriented multi-lang | Model source / inspiration |
| `ocrs` | MIT/Apache | WASM-oriented Rust | Immature vs Paddle for product |
| `edgeparse` | Apache-2.0 | WASM SDK | **Digital PDF path** (no OCR) |
| `simonw/tools` | — | `ocr.html` | UX pattern PDF.js + tesseract |

## Model size vs Pages 25 MiB

From `ppu-paddle-ocr/models/` (local clone):

| File | Size |
|------|------|
| `PP-OCRv5_mobile_det_infer.onnx` | ~4.5 MiB |
| `paddleocr-detection.onnx` | ~4.5 MiB |
| `en_PP-OCRv4_mobile_rec_infer.onnx` | ~7.3 MiB |
| `paddleocr-recognition.onnx` | ~7.5 MiB |

All individual files **under 25 MiB**. Safe to serve from Pages or R2 as separate assets. Prefer auto-fetch from package CDN/cache in v1.

## API shapes (normalized)

### tesseract.js

```ts
const worker = await createWorker('eng');
const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
// data.text, data.blocks[].paragraphs[].lines[].words[] with bbox {x0,y0,x1,y1} + confidence
```

### ppu-paddle-ocr/web

```ts
import { PaddleOcrService } from 'ppu-paddle-ocr/web';
const service = new PaddleOcrService();
await service.initialize();
const result = await service.recognize(canvas, { flatten: true });
// result.text, result.results[]: { text, box: {x,y,width,height}, confidence 0–1 }
// WebGPU auto; WASM fallback
```

### Digital PDF

- **pdf.js** text content API for quick text-layer extract (v1 implementation).
- **edgeparse-wasm** later for structured MD/JSON with bboxes on born-digital PDFs.

## Decision matrix (filled)

| Criterion | tesseract.js | ppu-paddle-ocr | client-ocr | edgeparse |
|-----------|--------------|----------------|------------|-----------|
| Browser-ready | 5 | 5 | 5 | 4 (WASM) |
| WebWorker friendly | 5 | 4 (ORT may need main or dedicated worker care) | 4 | 4 |
| WebGPU | 0 | **5** | 3 | 0 |
| Bboxes | 5 | 5 | 5 | 5 (digital) |
| Confidence | 5 | 5 | 5 | n/a |
| Lang breadth | **5** | 4 | 4 | n/a |
| Model ≤25 MiB | 5 (per lang pack) | **5** | 5 | 5 |
| License | Apache-2.0 | MIT | MIT | Apache-2.0 |
| Maintenance | High | High | Medium | High |
| **Spike score** | 4.3 | **4.7** | 4.2 | 4.5 (digital only) |

## Decisions

| Choice | Selection | Rationale |
|--------|-----------|-----------|
| **Default OCR** | `ppu-paddle-ocr/web` | Speed (WebGPU), modern det+rec, MIT, small models |
| **Fallback / languages / OSD** | `tesseract.js` | Breadth + maturity |
| **Digital PDF v1** | `pdfjs-dist` text layer | Zero extra model; edgeparse as v1.1+ |
| **Scanned PDF** | pdf.js raster → default OCR | Standard pattern (simonw/tools) |
| **Workers (Cloudflare)** | Not used for OCR | 128 MB / CPU limits |

## Gaps closed this spike

- [x] Confirmed ppu browser import path (`/web`)
- [x] Confirmed result has per-item box + confidence
- [x] Confirmed model files fit Pages asset limit
- [x] Mapped tesseract bbox (x0/y0/x1/y1) → our `{x,y,w,h}`
- [x] Documented COOP/COEP optional for multi-thread WASM (WebGPU avoids need)

## Cloudflare Pages packaging note (closed)

`onnxruntime-web` ships a ~26 MiB `.wasm` which **exceeds** Pages’ 25 MiB/file limit.  
**Mitigation implemented:** Vite `stripOrtWasmFromBundle` plugin removes `.wasm` from `dist/`; runtime sets:

```ts
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
```

Default engine path (Tesseract) does not need ORT. Paddle is dynamically imported.

## Remaining gaps / follow-ups

| Gap | Priority | Plan |
|-----|----------|------|
| golden CER on fixtures | P1 | Add `research/fixtures` + script after first UI works |
| Self-host ORT wasm on R2 | P2 | Mirror CDN files for offline/enterprise |
| edgeparse-wasm npm integration | P2 | After digital pdf.js path ships |
| client-ocr as alternate adapter | P3 | Only if ppu fails production constraints |
| OpenDoc-0.1B / GLM-OCR WebGPU | P3 | Roadmap experimental engine |

## Recommended npm deps (app)

```
tesseract.js
pdfjs-dist
ppu-paddle-ocr
onnxruntime-web
ppu-ocv          # transitive via ppu-paddle-ocr
```
