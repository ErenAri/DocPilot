import { test, expect } from '@playwright/test';

test.describe('Documents page', () => {
  test('loads list, opens first doc, analyzes', async ({ page }) => {
    await page.goto('/documents');

    // Wait for initial list (either skeleton replaced or at least one row)
    await page.waitForSelector('div[role="listitem"], button:has(div.font-medium), text=No documents found.', { timeout: 15000 });

    const docButtons = page.locator('button:has(div.font-medium)');
    const count = await docButtons.count();
    if (count === 0) test.skip(true, 'No documents available to open');

    await docButtons.first().click();

    // Wait for chunk viewer to populate (either skeleton disappears or a chunk card appears)
    await page.waitForSelector('div.border.border-white\/10.rounded.p-2.bg-white\/5', { timeout: 20000 });

    // Click Analyze
    const analyzeBtn = page.getByRole('button', { name: /Analyze/i });
    await analyzeBtn.click();

    // Wait for some analysis element (clauses grid item or risks list)
    await expect(page.locator('text=Compliance Analysis')).toBeVisible();
    await page.waitForSelector('div:has-text("Compliance Analysis")');
  });
});


