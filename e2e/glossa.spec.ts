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
  await signInAsAdmin(page);
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
  await signInAsAdmin(page);
  await page.goto('/projects');
  await waitForAngular(page);

  await page.locator('#shell-locale').selectOption('es');

  await expect(
    page.getByRole('link', { name: 'Proyectos', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Traducciones')).toBeVisible();
});

test('mobile shell navigation opens in a drawer', async ({ page }) => {
  await signInAsAdmin(page);
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

test('anonymous users are redirected away from protected projects', async ({
  page,
}) => {
  await page.goto('/projects');
  await waitForAngular(page);

  await expect(page).toHaveURL(/\/signin\?redirect=%2Fprojects$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('projects api rejects anonymous mutations', async ({ request }) => {
  const response = await request.post('/api/projects', {
    data: {
      name: 'Anonymous Project',
      slug: `anonymous-project-${Date.now()}`,
      sourceLocale: 'en',
      locales: ['en'],
    },
  });

  expect(response.status()).toBe(401);
});

test('projects api supports authenticated create, list and get', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = `api-project-${Date.now()}`;
  const createResponse = await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
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

  const listResponse = await page.request.get('/api/projects');
  expect(listResponse.ok()).toBe(true);
  const listBody = await listResponse.json();
  expect(
    listBody.projects.some(
      (project: { slug: string }) => project.slug === slug,
    ),
  ).toBe(true);

  const getResponse = await page.request.get(`/api/projects/${slug}`);
  expect(getResponse.ok()).toBe(true);
  await expect(getResponse.json()).resolves.toMatchObject({
    project: {
      slug,
    },
  });

  const updateResponse = await page.request.patch(`/api/projects/${slug}`, {
    headers: sameOriginHeaders(),
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

  const duplicateResponse = await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: {
      name: 'Duplicate API Project',
      slug,
      sourceLocale: 'en',
      locales: ['en'],
    },
  });
  expect(duplicateResponse.status()).toBe(409);

  const getStillExists = await page.request.get(`/api/projects/${slug}`);
  expect(getStillExists.ok()).toBe(true);
});

test('project creation flow navigates to detail page', async ({ page }) => {
  await signInAsAdmin(page);
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

  // Scoped to the Overview tabpanel — the Delivery tab also renders `<locale>.json` labels for
  // its runtime URLs, and Angular's tabs component keeps every tabpanel mounted in the DOM.
  const overview = page.getByRole('tabpanel', { name: 'Overview' });
  await expect(overview.getByText(`${slug}.json`)).toHaveCount(0);
  await expect(overview.getByText('en.json')).toBeVisible();
  await expect(overview.getByText('es.json')).toBeVisible();
  await expect(overview.getByText('Not created')).toHaveCount(2);
});

test('catalog editor creates, persists and reopens a locale catalog', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = `catalog-project-${Date.now()}`;

  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
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

  await editor.fill(
    JSON.stringify({ common: { save: 'Store', cancel: 'Cancel' } }),
  );
  await page.getByRole('button', { name: 'Save' }).click();
  await page.reload();
  await waitForAngular(page);
  await expect(page.getByLabel('Catalog JSON')).toHaveValue(
    JSON.stringify({ common: { save: 'Store', cancel: 'Cancel' } }, null, 2),
  );

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await page.goto(`/projects/${slug}`);
  await waitForAngular(page);
  await expect(page).toHaveURL(new RegExp('/signin'));
});

test('invalid catalog JSON stays local and server validation is readable', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = `invalid-catalog-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: {
      name: 'Invalid Catalog Project',
      slug,
      sourceLocale: 'en',
      locales: ['en'],
    },
  });

  await page.goto(`/projects/${slug}/catalogs/en`);
  await waitForAngular(page);
  const editor = page.getByLabel('Catalog JSON');

  await editor.fill('{');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Invalid JSON')).toBeVisible();

  await editor.fill(JSON.stringify({ count: 1 }));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByText('Translation value at "count" must be a string or object.'),
  ).toBeVisible();
});

test('viewer is read-only and editor can save a catalog', async ({ page }) => {
  await signInAsAdmin(page);
  const slug = `role-boundary-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: {
      name: 'Role Boundary',
      slug,
      sourceLocale: 'en',
      locales: ['en'],
    },
  });

  await setSignedRoleCookie(page, 'viewer');
  await page.goto(`/projects/${slug}/catalogs/en`);
  await waitForAngular(page);
  await expect(page.getByLabel('Catalog JSON')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  const viewerSave = await page.request.put(
    `/api/projects/${slug}/catalogs/en`,
    {
      headers: sameOriginHeaders(),
      data: { content: { common: { save: 'Read only' } } },
    },
  );
  expect(viewerSave.status()).toBe(403);

  await setSignedRoleCookie(page, 'editor');
  await page.goto(`/projects/${slug}/catalogs/en`);
  await waitForAngular(page);
  await page.getByLabel('Catalog JSON').fill(
    JSON.stringify({
      common: {
        save: 'Editor saved',
      },
    }),
  );
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Ready')).toBeVisible();
});

async function waitForAngular(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __ngHydrated?: boolean }).__ngHydrated === true,
  );
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.request.post('/api/auth/bootstrap', {
    headers: { 'x-glossa-bootstrap-key': 'playwright-bootstrap' },
    data: {
      email: 'admin@example.com',
      password: 'correct-password',
      name: 'Admin',
    },
  });
  await page.goto('/signin');
  await waitForAngular(page);
  await page.getByText('Use local credentials').click();
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

function sameOriginHeaders(): Record<string, string> {
  return { origin: 'http://127.0.0.1:5173' };
}

async function setSignedRoleCookie(
  page: Page,
  role: 'editor' | 'viewer',
): Promise<void> {
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: 'forge_session',
      value: await issueTestToken(role),
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 60 * 60,
    },
  ]);
}

async function issueTestToken(role: 'editor' | 'viewer'): Promise<string> {
  const payloadPart = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        sub: `${role}-user`,
        email: `${role}@example.com`,
        name: role,
        role,
        exp: Date.now() + 60 * 60 * 1000,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('playwright-auth-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadPart),
  );

  return `${payloadPart}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
