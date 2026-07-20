# localOCR

Privacy-first **browser-local OCR**. Documents stay on your device; models run in Web Workers (WASM / WebGPU). Hosted as a static app on Cloudflare Pages.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local Vite app |
| `npm test` | Unit tests (all workspaces) |
| `npm run build` | Production build → `apps/web/dist` |
| `npm run test:all` | Tests + build + Pages 25 MiB asset gate |
| `npm run check:assets` | Asset size gate only (after build) |

## Features (v1)

- On-device OCR: **Tesseract.js** (multi-language) and **Paddle ONNX** (WebGPU)
- PDF: digital text layer skip, multipage raster OCR, cancel
- Image preprocess (contrast/grayscale), region OCR
- Bounding boxes + confidence, export TXT / Markdown / JSON
- Local history (`localStorage`), privacy + how-it-works panels
- Cloudflare Pages-ready build (ORT WASM via CDN, not in `dist/`)

## Workspace layout

```
apps/web                 # Vite + React SPA
packages/ocr-core        # Job model, orchestrator, export, history, preprocess
packages/engine-tesseract
packages/engine-paddle
packages/engine-digital-pdf
docs/ui                  # Design frames
plan.md                  # Architecture plan
research/                # SPIKE + clones (clones gitignored)
scripts/check-asset-size.mjs
```

## Privacy

Default path never uploads your files. Only model weights are fetched from a CDN. See in-app **Privacy** panel.

## License

MIT (product code). Third-party engines: `LICENSE-THIRD-PARTY.md` and `research/SPIKE.md`.
