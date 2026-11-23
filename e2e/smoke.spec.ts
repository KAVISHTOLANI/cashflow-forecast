import { expect, test } from '@playwright/test';
import { checkMobile, snap } from './helpers';

test('forecast, what-if, add an item, monthly view', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('See the dip');
  await expect(page.locator('.hero .bchart svg')).toBeVisible();
  await page.waitForTimeout(1600);
  await snap(page, 'landing');
  await checkMobile(page, 'landing-mobile');

  await page.getByRole('link', { name: 'Open the forecast' }).click();
  const chart = page.getByRole('img', { name: /Projected balance over 90 days/ });
  await chart.hover({ position: { x: 300, y: 100 } });
  await expect(page.getByTestId('chart-readout')).toContainText('$');
  await page.getByRole('checkbox', { name: 'Holiday gifts' }).uncheck();
  await page.waitForTimeout(1600);
  await snap(page, 'forecast');
  await checkMobile(page);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Holiday gifts' })).not.toBeChecked();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Income & costs' }).click();
  await page.getByRole('link', { name: 'Add item' }).click();
  await page.getByLabel('Name').fill('Council tax');
  await page.getByLabel('Amount (USD)').fill('120');
  await page.getByLabel('Day of month').fill('15');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('link', { name: 'Council tax' })).toBeVisible();
  await snap(page, 'items');

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'By month' }).click();
  await expect(page.getByRole('table', { name: 'Monthly summary' })).toBeVisible();
  await page.waitForTimeout(900);
  await snap(page, 'months');
  await checkMobile(page, 'months-mobile');
});
