import { expect, test, type Page } from '@playwright/test';

// Hydration finishes (listeners attached, event-replay queue drained) some time
// after `__ngContext__` first appears on the root component, so polling for
// `__ngContext__` lets a click land before its handler exists — the click is
// then lost (or falls through to the native default, e.g. a real form submit).
// Wait on Angular's own dev-mode "Angular hydrated" log instead, which only
// prints once ApplicationRef is stable and hydration cleanup has run.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __ngHydrated?: boolean }).__ngHydrated = false;
    const originalLog = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      if (
        typeof args[0] === 'string' &&
        args[0].startsWith('Angular hydrated')
      ) {
        (window as unknown as { __ngHydrated?: boolean }).__ngHydrated = true;
      }
      originalLog(...args);
    };
  });
});

test('home route enters the projects workspace shell', async ({ page }) => {
  await page.goto('/');
  await waitForAngular(page);

  await expect(page).toHaveURL(/\/projects$/);
  await expect(
    page.getByRole('heading', { name: 'Projects', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Projects', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Translations')).toBeVisible();
  await expect(page.getByText('Upcoming')).toBeVisible();
});

test('shell locale switching works', async ({ page }) => {
  await page.goto('/projects');
  await waitForAngular(page);

  await page.locator('#shell-locale').selectOption('es');

  await expect(
    page.getByRole('link', { name: 'Proyectos', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Traducciones')).toBeVisible();
});

test('mobile shell navigation opens in a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/projects');
  await waitForAngular(page);

  await page.getByRole('button', { name: 'Open navigation menu' }).click();

  await expect(
    page.getByRole('navigation', { name: 'Product navigation' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Projects', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#mobile-shell-locale')).toBeVisible();
});

test('health endpoint returns ok', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({
    status: 'ok',
    app: 'glossa',
  });
});

test('projects api supports create, list, get, update and delete', async ({
  request,
}) => {
  const slug = `api-project-${Date.now()}`;
  const createResponse = await request.post('/api/projects', {
    data: {
      name: 'API Project',
      slug,
      sourceLocale: 'en',
      locales: ['en', 'es', 'pt-BR'],
    },
  });

  expect(createResponse.status()).toBe(201);
  await expect(createResponse.json()).resolves.toMatchObject({
    project: {
      name: 'API Project',
      slug,
      sourceLocale: 'en',
      locales: ['en', 'es', 'pt-BR'],
    },
  });

  const listResponse = await request.get('/api/projects');
  expect(listResponse.ok()).toBe(true);
  const listBody = await listResponse.json();
  expect(
    listBody.projects.some(
      (project: { slug: string }) => project.slug === slug,
    ),
  ).toBe(true);

  const getResponse = await request.get(`/api/projects/${slug}`);
  expect(getResponse.ok()).toBe(true);
  await expect(getResponse.json()).resolves.toMatchObject({
    project: {
      slug,
    },
  });

  const updateResponse = await request.patch(`/api/projects/${slug}`, {
    data: {
      name: 'Updated API Project',
    },
  });
  expect(updateResponse.ok()).toBe(true);
  await expect(updateResponse.json()).resolves.toMatchObject({
    project: {
      name: 'Updated API Project',
      slug,
    },
  });

  const duplicateResponse = await request.post('/api/projects', {
    data: {
      name: 'Duplicate API Project',
      slug,
      sourceLocale: 'en',
      locales: ['en'],
    },
  });
  expect(duplicateResponse.status()).toBe(409);

  const deleteResponse = await request.delete(`/api/projects/${slug}`);
  expect(deleteResponse.ok()).toBe(true);

  const missingResponse = await request.get(`/api/projects/${slug}`);
  expect(missingResponse.status()).toBe(404);
});

test('project creation flow navigates to detail page', async ({ page }) => {
  const slug = `ui-project-${Date.now()}`;

  await page.goto('/projects/new');
  await waitForAngular(page);
  await page.getByLabel('Name').fill('UI Project');
  await page.getByLabel('Slug').fill(slug);
  await page.getByRole('textbox', { name: 'New locale' }).fill('es');
  await page.getByRole('button', { name: 'Add locale' }).click();
  await page.getByLabel('Source locale').selectOption('en');
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page).toHaveURL(new RegExp(`/projects/${slug}$`));
  await expect(page.getByRole('heading', { name: 'UI Project' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByText(`${slug}.json`)).toHaveCount(0);
  await expect(page.getByText('en.json')).toBeVisible();
  await expect(page.getByText('es.json')).toBeVisible();
  await expect(page.getByText('Not created')).toHaveCount(2);
});

test('catalog editor creates, persists and reopens a locale catalog', async ({
  page,
}) => {
  const slug = `catalog-project-${Date.now()}`;

  await page.request.post('/api/projects', {
    data: {
      name: 'Catalog Project',
      slug,
      sourceLocale: 'en',
      locales: ['en'],
    },
  });

  await page.goto(`/projects/${slug}`);
  await waitForAngular(page);

  await page.getByRole('link', { name: 'en.json' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${slug}/catalogs/en$`));
  await waitForAngular(page);
  await expect(page.getByText('Not created')).toBeVisible();

  const editor = page.getByLabel('Catalog JSON');
  await editor.fill(
    JSON.stringify({ common: { save: 'Save', cancel: 'Cancel' } }),
  );
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Ready')).toBeVisible();

  await page.goto(`/projects/${slug}`);
  await waitForAngular(page);
  await expect(
    page.getByRole('link', { name: 'en.json Source locale Ready' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'en.json' }).click();
  await waitForAngular(page);
  await expect(page.getByLabel('Catalog JSON')).toHaveValue(
    JSON.stringify({ common: { save: 'Save', cancel: 'Cancel' } }, null, 2),
  );
});

async function waitForAngular(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __ngHydrated?: boolean }).__ngHydrated === true,
  );
}
