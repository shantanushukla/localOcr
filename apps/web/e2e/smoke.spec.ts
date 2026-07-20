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
    await expect(page.getByRole('button', { name: /privacy/i })).toBeVisible();
  });

  test('privacy modal explains on-device processing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^privacy$/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/documents stay on your device/i)).toBeVisible();
    await page.getByRole('button', { name: /close/i }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('OCR image fixture with Tesseract and export JSON', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');

    // Ensure Tesseract path (default)
    await page.getByLabel('OCR engine').selectOption('tesseract');
    await page.getByLabel('Language').selectOption('eng');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(fixtures, 'invoice-sample.png'));

    // Workspace appears
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

    // JSON export includes schema fields
    await page.getByRole('tab', { name: /^json$/i }).click();
    const jsonText = await page.locator('.export-pre.json').innerText();
    expect(jsonText).toContain('"version": 1');
    expect(jsonText).toContain('"blocks"');
    expect(jsonText).toContain('bbox');
    expect(jsonText).toContain('confidence');
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
  });
});
