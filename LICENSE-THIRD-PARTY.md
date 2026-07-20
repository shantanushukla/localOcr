# Third-party licenses

localOCR product code is MIT. Bundled/runtime engines keep their own licenses:

| Component | License | Notes |
|-----------|---------|--------|
| tesseract.js / tesseract-ocr | Apache-2.0 | Fallback OCR |
| ppu-paddle-ocr | MIT | Default modern OCR path |
| onnxruntime-web | MIT | Inference (WASM/WebGPU); WASM loaded from CDN |
| pdfjs-dist (Mozilla) | Apache-2.0 | PDF parse/raster |
| ppu-ocv | MIT | Image preprocess for Paddle path |
| React | MIT | UI |

See each package’s `LICENSE` under `node_modules/` for full text.
