import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { jobToSearchablePdf, toWinAnsiSafe } from '@localocr/ocr-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, 'fixtures');

/**
 * Regression for the Research Proposal PDF that contained 25× "→" (U+2192) and
 * 71× "•" (U+2022). Clicking PDF export threw:
 *   WinAnsi cannot encode "→" (0x2192)
 */
test.describe('searchable PDF unicode (WinAnsi)', () => {
  test('toWinAnsiSafe maps research-proposal glyphs', () => {
    expect(toWinAnsiSafe('Text → Semantic Chunker → VQ-VAE → Latent Tokens')).toBe(
      'Text -> Semantic Chunker -> VQ-VAE -> Latent Tokens',
    );
    expect(toWinAnsiSafe('• bullet')).toBe('* bullet');
    expect(toWinAnsiSafe('↓')).toBe('v');
  });

  test('jobToSearchablePdf accepts full research-proposal unicode sample', async () => {
    // Representative lines from Research_Proposal_Latent_Semantic_Wrapper_Existing_LLMs.pdf
    const lines = [
      'Architecture A: Semantic Vocabulary Expansion',
      'Text → Semantic Chunker → VQ-VAE → Latent Tokens → Existing LLM',
      '↓',
      'Text → Encoder → Continuous Latent Vectors → Prefix Tuning → Frozen LLM',
      'Text → JEPA Encoder → Semantic State → Quantization → Latent Prefix → LLM',
      'LATENT_TOKEN → Existing Internal Concept',
      '• discrete latent tokens',
      '• continuous latent tokens',
    ];
    const fullText = lines.join('\n');
    const bytes = await jobToSearchablePdf({
      version: 1,
      engine: 'pdfjs-text',
      fileName: 'Research_Proposal_Latent_Semantic_Wrapper_Existing_LLMs.pdf',
      pages: [
        {
          index: 0,
          width: 612,
          height: 792,
          fullText,
          blocks: lines.map((text, i) => ({
            text,
            bbox: { x: 40, y: 40 + i * 18, w: 520, h: 14 },
            confidence: 1,
            level: 'line' as const,
          })),
        },
      ],
    });
    expect(bytes.byteLength).toBeGreaterThan(500);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });

  test('browser: digital PDF then PDF button has no WinAnsi error', async ({ page }) => {
    test.setTimeout(120_000);
    const fixture = path.join(fixtures, 'architecture-arrows.pdf');
    // Optional: use user download if present (not committed)
    const userPdf =
      '/Users/shantanu/Downloads/Research_Proposal_Latent_Semantic_Wrapper_Existing_LLMs.pdf';
    const file = fs.existsSync(userPdf) ? userPdf : fixture;
    expect(fs.existsSync(file), `missing fixture ${file}`).toBe(true);

    await page.goto('/');
    await page.locator('input[type="file"]').setInputFiles(file);
    await expect(page.locator('.workspace')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/done|files never left|digital/i).first()).toBeVisible({
      timeout: 60_000,
    });

    const body = await page.locator('.ws-results').innerText();
    expect(body.toLowerCase()).toMatch(/latent|semantic|architecture|text/);

    await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }).catch(() => null),
      page.getByTestId('download-searchable-pdf').click(),
    ]);
    await page.waitForTimeout(1500);

    if (await page.locator('.error-banner').isVisible().catch(() => false)) {
      const t = await page.locator('.error-banner').innerText();
      expect(t).not.toMatch(/WinAnsi|cannot encode/i);
    }
    await expect(page.getByText(/WinAnsi|cannot encode/i)).toHaveCount(0);
  });
});
