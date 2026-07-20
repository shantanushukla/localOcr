#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

clone() {
  local url="$1" dir="$2"
  if [[ -d "$dir/.git" ]]; then
    echo "skip $dir (exists)"
    return
  fi
  git clone --depth 1 "$url" "$dir"
}

clone https://github.com/naptha/tesseract.js.git tesseract.js
clone https://github.com/robertknight/tesseract-wasm.git tesseract-wasm
clone https://github.com/siva-sub/client-ocr.git client-ocr
clone https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr.git ppu-paddle-ocr
clone https://github.com/X3ZvaWQ/paddleocr.js.git paddleocr.js
clone https://github.com/xulihang/paddleocr-browser.git paddleocr-browser
clone https://github.com/RapidAI/RapidOCR.git RapidOCR
clone https://github.com/robertknight/ocrs.git ocrs
clone https://github.com/raphaelmansuy/edgeparse.git edgeparse
clone https://github.com/simonw/tools.git tools

echo "Done. See research/SPIKE.md"
