import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, 'fixtures');
const invoicePng = path.join(fixtures, 'invoice-sample.png');

/** Keywords we expect from invoice-sample.png OCR (full page or large region). */
const INVOICE_HINTS = [/INVOICE/i, /NVOICE/i, /ACME/i, /cme/i, /1842/, /453/, /TOTAL/i, /otal/i];

function hasInvoiceHint(text: string): boolean {
  return INVOICE_HINTS.some((re) => re.test(text));
}

async function waitForWorkspaceReady(page: Page, timeout = 150_000) {
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 30_000 });
  // Paddle first load downloads ONNX models — doc-stage only appears after prepareImage
  await expect(page.getByTestId('doc-stage')).toBeVisible({ timeout });
  await expect(page.getByTestId('ws-status-text')).toContainText(/Page|done|ms|100%|complete/i, {
    timeout,
  });
  // Wait until busy clears (Cancel gone / progress complete)
  await expect(page.getByRole('button', { name: /^cancel$/i })).toHaveCount(0, {
    timeout,
  });
  // Surface engine load / recognize failures instead of hanging on empty results
  const err = page.locator('.error-banner');
  if (await err.isVisible().catch(() => false)) {
    throw new Error(`OCR failed before region test: ${await err.innerText()}`);
  }
}

async function openInvoiceWithEngine(page: Page, engine: 'tesseract' | 'paddle') {
  await page.goto('/');
  await page.getByLabel('OCR engine').selectOption(engine);
  // Language is disabled for Paddle (bundled multi-lang models)
  if (engine === 'tesseract') {
    await page.getByLabel('Language').selectOption('eng');
  }
  await page.locator('input[type="file"]').setInputFiles(invoicePng);
  await waitForWorkspaceReady(page, engine === 'paddle' ? 240_000 : 150_000);
  // Results should have text from full-page OCR
  await expect
    .poll(async () => (await page.locator('.ws-results').innerText()).trim().length, {
      timeout: 30_000,
    })
    .toBeGreaterThan(2);
}

/**
 * Drag a large box on the document stage using synthetic pointer events
 * (more reliable than mouse API with React pointer-capture handlers).
 */
async function drawRegionSelection(page: Page) {
  const stage = page.getByTestId('doc-stage');
  await expect(stage).toBeVisible();

  await page.getByTestId('tool-region').click();
  await expect(page.getByTestId('tool-region')).toHaveClass(/active/);

  const box = await stage.boundingBox();
  if (!box || box.width < 20 || box.height < 20) {
    throw new Error(`doc-stage box invalid: ${JSON.stringify(box)}`);
  }

  const start = { x: box.x + box.width * 0.08, y: box.y + box.height * 0.1 };
  const end = { x: box.x + box.width * 0.92, y: box.y + box.height * 0.9 };

  await page.evaluate(
    ({ start: s, end: e }) => {
      const el = document.querySelector('[data-testid="doc-stage"]');
      if (!(el instanceof HTMLElement)) throw new Error('doc-stage missing');

      const fire = (type: string, x: number, y: number, buttons: number) => {
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: 'mouse',
            buttons,
            button: buttons ? 0 : -1,
            isPrimary: true,
            view: window,
          }),
        );
      };

      fire('pointerdown', s.x, s.y, 1);
      // intermediate move helps some handlers
      fire('pointermove', (s.x + e.x) / 2, (s.y + e.y) / 2, 1);
      fire('pointermove', e.x, e.y, 1);
      fire('pointerup', e.x, e.y, 0);
    },
    { start, end },
  );

  // Fallback: Playwright mouse drag if synthetic events did not create a region
  if (!(await page.getByTestId('ocr-selection').isVisible().catch(() => false))) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 16 });
    await page.mouse.up();
  }

  await expect(page.getByTestId('ocr-selection')).toBeVisible({ timeout: 8_000 });
}

async function runRegionOcrAndAssertOutput(page: Page, engineLabel: string) {
  // Snapshot results before region pass (for debugging failures)
  const before = await page.locator('.ws-results').innerText();

  await page.getByTestId('ocr-selection').click();

  // Must never surface the classic tesseract ImageData failure
  await expect(page.getByText(/Error attempting to read image/i)).toHaveCount(0);

  // Wait for region pass to finish (status text and/or busy clear)
  await expect(page.getByTestId('ws-status-text')).toContainText(/Region OCR complete/i, {
    timeout: 180_000,
  });

  await expect(page.locator('.error-banner')).toHaveCount(0);
  await expect(page.getByText(/Error attempting to read image/i)).toHaveCount(0);

  const results = page.locator('.ws-results');
  await expect(results).toBeVisible();
  const body = await results.innerText();
  expect(
    body.trim().length,
    `${engineLabel}: region OCR produced empty results.\nBefore:\n${before}\nAfter:\n${body}`,
  ).toBeGreaterThan(2);

  expect(
    hasInvoiceHint(body),
    `${engineLabel}: expected invoice-like text after region OCR, got:\n${body}`,
  ).toBe(true);

  // JSON still has schema + blocks
  await page.getByRole('tab', { name: /^json$/i }).click();
  const jsonText = await page.locator('.export-pre.json').innerText();
  expect(jsonText).toContain('"version": 1');
  expect(jsonText).toContain('"blocks"');
  expect(jsonText).not.toMatch(/Error attempting to read image/i);
  // At least one block with non-empty text
  expect(jsonText).toMatch(/"text"\s*:\s*"[^"]+"/);

  await page.getByRole('tab', { name: /^text$/i }).click();
  const textTab = await page.locator('.result-scroll').innerText();
  expect(textTab.trim().length).toBeGreaterThan(2);
}

test.describe('Region selection OCR', () => {
  test('Tesseract: drag region → OCR selection yields text (no read-image error)', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openInvoiceWithEngine(page, 'tesseract');

    const fullBody = await page.locator('.ws-results').innerText();
    expect(hasInvoiceHint(fullBody)).toBe(true);

    await drawRegionSelection(page);
    await runRegionOcrAndAssertOutput(page, 'Tesseract');
  });

  test('Paddle ONNX: drag region → OCR selection yields text', async ({ page }) => {
    test.setTimeout(360_000);
    await openInvoiceWithEngine(page, 'paddle');

    const fullBody = await page.locator('.ws-results').innerText();
    expect(fullBody.trim().length, 'Paddle full-page OCR empty').toBeGreaterThan(2);

    await drawRegionSelection(page);
    await runRegionOcrAndAssertOutput(page, 'Paddle');
  });

  test('Tesseract: title-band region still returns output (never silent / never read-image error)', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openInvoiceWithEngine(page, 'tesseract');

    const stage = page.getByTestId('doc-stage');
    const box = await stage.boundingBox();
    if (!box) throw new Error('no stage box');

    await page.getByTestId('tool-region').click();

    const start = { x: box.x + box.width * 0.12, y: box.y + box.height * 0.04 };
    const end = { x: box.x + box.width * 0.88, y: box.y + box.height * 0.4 };

    await page.evaluate(
      ({ start: s, end: e }) => {
        const el = document.querySelector('[data-testid="doc-stage"]');
        if (!(el instanceof HTMLElement)) throw new Error('doc-stage missing');
        const fire = (type: string, x: number, y: number, buttons: number) => {
          el.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              clientX: x,
              clientY: y,
              pointerId: 1,
              pointerType: 'mouse',
              buttons,
              button: buttons ? 0 : -1,
              isPrimary: true,
              view: window,
            }),
          );
        };
        fire('pointerdown', s.x, s.y, 1);
        fire('pointermove', e.x, e.y, 1);
        fire('pointerup', e.x, e.y, 0);
      },
      { start, end },
    );

    await expect(page.getByTestId('ocr-selection')).toBeVisible({ timeout: 8_000 });
    await page.getByTestId('ocr-selection').click();

    await expect(page.getByText(/Error attempting to read image/i)).toHaveCount(0);
    await expect(page.getByTestId('ws-status-text')).toContainText(
      /Region OCR complete|Draw a larger region|failed/i,
      { timeout: 180_000 },
    );

    const errVisible = await page.locator('.error-banner').isVisible().catch(() => false);
    if (errVisible) {
      const msg = await page.locator('.error-banner').innerText();
      expect(msg).not.toMatch(/Error attempting to read image/i);
    } else {
      await expect(page.getByTestId('ws-status-text')).toContainText(/Region OCR complete/i);
      const body = await page.locator('.ws-results').innerText();
      expect(body.trim().length).toBeGreaterThan(0);
    }
  });

  test('engine switch in workspace: Tesseract full page → Paddle region still works', async ({
    page,
  }) => {
    test.setTimeout(360_000);
    await openInvoiceWithEngine(page, 'tesseract');

    const engineSelect = page.getByLabel('OCR engine');
    await engineSelect.selectOption('paddle');
    await expect(engineSelect).toHaveValue('paddle');

    // Dispose is async on select — give the UI a beat before region OCR
    await page.waitForTimeout(300);

    await drawRegionSelection(page);
    await runRegionOcrAndAssertOutput(page, 'Paddle (after Tesseract)');
  });
});
