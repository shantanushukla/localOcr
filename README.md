# localOCR

Privacy-first **browser-local OCR**. Documents stay on your device; models run in Web Workers (WASM / WebGPU). Hosted as a static app on Cloudflare Pages.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## Workspace layout

```
apps/web              # Vite + React SPA (Pages deploy target)
packages/ocr-core     # Job/Page/Block model + orchestrator
packages/engine-tesseract
packages/engine-digital-pdf
docs/ui               # Design frames (setcalculators-inspired)
plan.md               # Product & architecture plan
research/             # Cloned engine repos + SPIKE notes (gitignored clones)
```

## Privacy

Default path never uploads your files. Only model weights are fetched from a CDN (or local `public/models`).

## License

MIT (product code). Third-party engines keep their own licenses — see `research/SPIKE.md`.
