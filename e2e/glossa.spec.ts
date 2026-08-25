import { expect, test } from '@playwright/test';

test('home route loads', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Glossa' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Projects' })).toBeVisible();
});

test('locale switching works', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Interface language').selectOption('es');

  await expect(page.getByRole('button', { name: 'Proyectos' })).toBeVisible();
});

test('health endpoint returns ok', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({
    status: 'ok',
    app: 'glossa',
  });
});
