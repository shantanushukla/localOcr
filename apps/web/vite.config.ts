import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Drop ONNX Runtime .wasm binaries from the emit bundle.
 * They exceed Cloudflare Pages' 25 MiB/file limit; runtime loads from jsDelivr
 * via ort.env.wasm.wasmPaths (see engine-paddle).
 */
function stripOrtWasmFromBundle(): Plugin {
  return {
    name: 'strip-ort-wasm-from-bundle',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (fileName.endsWith('.wasm') || fileName.includes('ort-wasm')) {
          delete bundle[fileName];
        }
      }
    },
    writeBundle(output) {
      const dir = output.dir;
      if (!dir) return;
      const assets = path.join(dir, 'assets');
      if (!fs.existsSync(assets)) return;
      for (const f of fs.readdirSync(assets)) {
        if (f.endsWith('.wasm')) {
          fs.unlinkSync(path.join(assets, f));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), stripOrtWasmFromBundle()],
  resolve: {
    alias: {
      '@localocr/ocr-core': path.resolve(__dirname, '../../packages/ocr-core/src/index.ts'),
      '@localocr/engine-tesseract': path.resolve(
        __dirname,
        '../../packages/engine-tesseract/src/index.ts',
      ),
      '@localocr/engine-paddle': path.resolve(
        __dirname,
        '../../packages/engine-paddle/src/index.ts',
      ),
      '@localocr/engine-digital-pdf': path.resolve(
        __dirname,
        '../../packages/engine-digital-pdf/src/index.ts',
      ),
    },
  },
  optimizeDeps: {
    exclude: ['ppu-paddle-ocr', 'onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
  },
});
