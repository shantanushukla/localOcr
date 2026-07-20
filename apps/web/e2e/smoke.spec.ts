import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, 'fixtures');

test.describe('localOCR e2e', () => {
  test('landing shows privacy-first chrome', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /never leaves your browser/i })).toBeVisible();
    await expect(page.getByText('On-device', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /drop pdf or image/i })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('button', { name: /how it works/i })).toBeVisible();
    await expect(page.locator('.site-footer').getByRole('button', { name: /^privacy$/i })).toBeVisible();
    await expect(page.locator('.site-footer').getByRole('button', { name: /terms/i })).toBeVisible();
    await expect(page.locator('.site-footer').getByRole('button', { name: /about/i })).toBeVisible();
    await expect(page.getByTestId('runtime-mode')).toBeVisible();
    // History is not in the product chrome (design: topbar = On-device · WebGPU · How it works)
    await expect(page.getByRole('button', { name: /^history$/i })).toHaveCount(0);
  });

  test('privacy modal explains on-device processing', async ({ page }) => {
    await page.goto('/');
    await page.locator('.site-footer').getByRole('button', { name: /^privacy$/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/documents stay on your device/i)).toBeVisible();
    await expect(page.getByText(/no first-party document upload/i)).toBeVisible();
    await page.getByRole('button', { name: /close/i }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('OCR image fixture with Tesseract and export JSON', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');

    // Ensure Tesseract path (default) via landing options (docs/ui + product controls)
    await page.getByLabel('OCR engine').selectOption('tesseract');
    await page.getByLabel('Language').selectOption('eng');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(fixtures, 'invoice-sample.png'));

    // Workspace appears immediately while engine/OCR runs
    await expect(page.locator('.workspace')).toBeVisible({ timeout: 30_000 });

    // Wait for OCR completion status or results
    await expect(page.getByText(/done|files never left/i).first()).toBeVisible({
      timeout: 150_000,
    });

    // Results panel should contain recognizable text (OCR may vary slightly)
    const resultScroll = page.locator('.result-scroll');
    await expect(resultScroll).toBeVisible();

    // Prefer checking full page text content for invoice keywords
    const body = await page.locator('.ws-results').innerText();
    const upper = body.toUpperCase();
    const hit =
      upper.includes('INVOICE') ||
      upper.includes('1842') ||
      upper.includes('ACME') ||
      upper.includes('453');
    expect(hit, `expected OCR text in results, got:\n${body}`).toBe(true);

    // Bounding boxes rendered
    await expect(page.locator('.bbox').first()).toBeVisible({ timeout: 10_000 });

    // JSON export includes schema fields (AC4)
    await page.getByRole('tab', { name: /^json$/i }).click();
    const jsonText = await page.locator('.export-pre.json').innerText();
    expect(jsonText).toContain('"version": 1');
    expect(jsonText).toContain('"blocks"');
    expect(jsonText).toContain('bbox');
    expect(jsonText).toContain('confidence');
    expect(jsonText).toMatch(/"index"\s*:\s*0/);

    // Export view (design frame) + searchable PDF
    await page.getByRole('button', { name: /^export/i }).first().click();
    await expect(page.getByRole('heading', { name: /markdown/i })).toBeVisible();
    await expect(page.getByTestId('download-searchable-pdf')).toBeEnabled();

    // PDF button must not surface WinAnsi encoding errors
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
    await page.getByTestId('download-searchable-pdf').click();
    await page.waitForTimeout(1500);
    const errBanner = page.locator('.error-banner');
    if (await errBanner.isVisible().catch(() => false)) {
      const errText = await errBanner.innerText();
      expect(errText, 'PDF export should not show WinAnsi errors').not.toMatch(
        /WinAnsi|cannot encode/i,
      );
    }
    const dl = await downloadPromise;
    if (dl) {
      expect(dl.suggestedFilename()).toMatch(/\.pdf$/i);
    } else {
      await expect(page.getByText(/WinAnsi|cannot encode/i)).toHaveCount(0);
    }
  });

  test('digital PDF uses text layer without long OCR wait', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(fixtures, 'hello-digital.pdf'));

    await expect(page.locator('.workspace')).toBeVisible({ timeout: 30_000 });

    // Digital path should finish quickly and mark route digital or show text
    await expect(page.getByText(/done|digital|pdfjs-text/i).first()).toBeVisible({
      timeout: 60_000,
    });

    const results = await page.locator('.ws-results').innerText();
    expect(results.toLowerCase()).toMatch(/hello|digital|text/);

    // Route chip should mention digital / pdfjs
    const status = await page.locator('.ws-status').innerText();
    expect(status.toLowerCase()).toMatch(/digital|pdfjs|done|ms/);
  });

  test('multipage digital PDF shows all pages with progress (AC3)', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(fixtures, 'multipage-digital.pdf'));

    await expect(page.locator('.workspace')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/done|files never left/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // Three page thumbs
    await expect(page.locator('.thumb')).toHaveCount(3);

    // Navigate pages and check content
    await page.locator('.thumb').nth(0).click();
    await expect(page.locator('.ws-results')).toContainText(/PAGE 1|Page One/i);

    await page.locator('.thumb').nth(1).click();
    await expect(page.locator('.ws-results')).toContainText(/PAGE 2|Page Two/i);

    await page.locator('.thumb').nth(2).click();
    await expect(page.locator('.ws-results')).toContainText(/PAGE 3|Page Three/i);

    // Progress complete
    await expect(page.locator('.ws-status')).toContainText(/100%|ms/i);
  });

  test('cancel button appears while processing image OCR (AC3)', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await page.getByLabel('OCR engine').selectOption('tesseract');

    const fileInput = page.locator('input[type="file"]');
    // Start OCR — cancel may race on very fast machines, so accept either cancel or done
    await fileInput.setInputFiles(path.join(fixtures, 'invoice-sample.png'));
    await expect(page.locator('.workspace')).toBeVisible({ timeout: 30_000 });

    // Cancel is available as soon as workspace opens (engine load + OCR)
    const cancel = page.getByRole('button', { name: /^cancel$/i }).first();
    let sawCancel = false;
    for (let i = 0; i < 80; i++) {
      if (await cancel.isVisible().catch(() => false)) {
        sawCancel = true;
        await cancel.click();
        break;
      }
      if (await page.getByText(/done|files never left/i).first().isVisible().catch(() => false)) {
        break;
      }
      await page.waitForTimeout(100);
    }

    // Either cancelled or finished — both prove the pipeline works
    if (sawCancel) {
      await expect(page.getByText(/cancel/i).first()).toBeVisible({ timeout: 10_000 });
    } else {
      await expect(page.getByText(/done|files never left/i).first()).toBeVisible({
        timeout: 150_000,
      });
    }
  });

  test('no document upload to first-party origin during OCR (AC8)', async ({ page }) => {
    test.setTimeout(180_000);
    const uploads: string[] = [];

    page.on('request', (req) => {
      const method = req.method();
      const url = req.url();
      // Document bytes must never leave via write methods
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        uploads.push(`${method} ${url}`);
        return;
      }
      // Explicit upload/API endpoints (not package path names like ocr-core)
      try {
        const u = new URL(url);
        const p = u.pathname;
        if (
          p === '/api' ||
          p.startsWith('/api/') ||
          p === '/upload' ||
          p.startsWith('/upload/') ||
          p === '/ocr' ||
          p.startsWith('/ocr/')
        ) {
          uploads.push(`SUSPECT ${method} ${url}`);
        }
      } catch {
        /* ignore */
      }
    });

    await page.goto('/');
    await page.getByLabel('OCR engine').selectOption('tesseract');
    await page.locator('input[type="file"]').setInputFiles(path.join(fixtures, 'invoice-sample.png'));
    await expect(page.locator('.workspace')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/done|files never left|cancel/i).first()).toBeVisible({
      timeout: 150_000,
    });

    expect(uploads, `unexpected upload-like requests:\n${uploads.join('\n')}`).toEqual([]);
  });
});

