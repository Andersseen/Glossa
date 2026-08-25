import { expect, test, type Page } from '@playwright/test';

test('home route loads', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Glossa' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible();
});

test('locale switching works', async ({ page }) => {
  await page.goto('/');
  await waitForAngular(page, 'app-home');

  await page.locator('#locale').selectOption('es');

  await expect(page.getByText('Proyectos / Traducciones')).toBeVisible();
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
  await waitForAngular(page, 'app-project-new');
  await page.getByLabel('Name').fill('UI Project');
  await page.getByLabel('Slug').fill(slug);
  await page.getByRole('textbox', { name: 'New locale' }).fill('es');
  await page.getByRole('button', { name: 'Add locale' }).click();
  await page.getByLabel('Source locale').selectOption('en');
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page).toHaveURL(new RegExp(`/projects/${slug}$`));
  await expect(page.getByRole('heading', { name: 'UI Project' })).toBeVisible();
  await expect(
    page.getByText('Catalog management will be implemented next.'),
  ).toBeVisible();
});

async function waitForAngular(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (componentSelector) =>
      Boolean(
        (
          document.querySelector(componentSelector) as
            (Element & { __ngContext__?: unknown }) | null
        )?.__ngContext__,
      ),
    selector,
  );
}
