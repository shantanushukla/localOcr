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
| `npm run test:e2e` | Playwright browser e2e (Chromium) |
| `npm run test:ci` | Unit + build + asset gate + e2e |
| `npm run build` | Production build → `apps/web/dist` |
| `npm run test:all` | Unit tests + build + Pages 25 MiB asset gate |
| `npm run check:assets` | Asset size gate only (after build) |
| `npm run pages:dev` | Build + local Cloudflare Pages preview |
| `npm run pages:deploy` | Build, asset gate, deploy to CF Pages (`localocr`) |

## Features (v1)

- On-device OCR: **Tesseract.js** (multi-language) and **Paddle ONNX** (WebGPU / WASM)
- PDF: digital text layer skip, multipage raster OCR, cancel, progress
- Image preprocess (contrast/grayscale) + optional auto-deskew
- Region OCR, bounding boxes + confidence
- Export TXT / Markdown / JSON / **searchable PDF**
- Local history (`localStorage`), privacy + how-it-works panels
- PWA service worker (offline app shell + cached CDN models)
- Cloudflare Pages-ready build (ORT WASM via CDN, not in `dist/`)

## Workspace layout

```
apps/web                 # Vite + React SPA (+ e2e fixtures)
packages/ocr-core        # Job model, orchestrator, export, history, preprocess, CER
packages/engine-tesseract
packages/engine-paddle
packages/engine-digital-pdf
docs/ui                  # Design frames
plan.md                  # Architecture plan
research/                # SPIKE + clones (clones gitignored)
scripts/check-asset-size.mjs
.github/workflows/ci.yml # CI + optional Pages deploy
```

### E2E

```bash
# first time on a machine:
npx playwright install chromium

npm run test:e2e
```

Fixtures: `apps/web/e2e/fixtures/` (`invoice-sample.png`, `hello-digital.pdf`, `multipage-digital.pdf`).

## Deploy (Cloudflare Pages)

**Production** ([localocr.pages.dev](https://localocr.pages.dev)) is deployed by **Cloudflare Pages Git integration** on every push to `main`. GitHub Actions only runs tests/build/e2e — it does **not** call Wrangler (avoids dual deploys and API-token breakage).

### Cloudflare dashboard (already connected)

| Setting | Value |
|---------|--------|
| Production branch | `main` |
| Build command | `npm ci && npm run build` |
| Build output directory | `apps/web/dist` |
| Root directory | `/` (repo root) |
| Node version | 20+ |

### Manual / emergency deploy (local Wrangler OAuth)

```bash
npx wrangler login
npm run pages:deploy
```

Requires a Cloudflare account with access to the `localocr` Pages project. Do **not** put Wrangler OAuth tokens into GitHub secrets — use a dedicated [API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) with **Account → Cloudflare Pages → Edit** if you ever re-enable Actions-based deploys.

CI always runs unit tests, production build, the **25 MiB asset gate**, and Playwright e2e.

## Privacy

Default path never uploads your files. Only model weights are fetched from a CDN. See in-app **Privacy** panel. Analytics are off by default.

## License

MIT (product code). Third-party engines: `LICENSE-THIRD-PARTY.md` and `research/SPIKE.md`.
