import { expect, test, type Page } from '@playwright/test';

// See e2e/glossa.spec.ts for why this hydration wait exists.
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

test('admin creates, sees once, lists, and revokes a project access token', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = `token-ui-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: {
      name: 'Token UI Project',
      slug,
      sourceLocale: 'en',
      locales: ['en'],
    },
  });

  await page.goto(`/projects/${slug}`);
  await waitForAngular(page);
  await page.getByRole('tab', { name: 'Access tokens' }).click();

  await page.getByRole('button', { name: 'New token' }).click();
  await page.getByLabel('Name').fill('CI token');

  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(`/api/projects/${slug}/tokens`) &&
        response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Create token' }).click(),
  ]);
  const secret = (await createResponse.json()).secret as string;
  expect(secret).toMatch(/^glossa_/);

  await expect(page.getByText('Copy this token now.')).toBeVisible();
  await expect(page.getByText(secret)).toBeVisible();

  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Copy this token now.')).toHaveCount(0);

  await expect(page.getByText('CI token')).toBeVisible();
  await expect(page.getByText('Active')).toBeVisible();
  await expect(page.getByText('catalog:read')).toBeVisible();

  await page.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Revoked')).toBeVisible();

  // The plaintext secret from creation is unusable now that it is revoked.
  const response = await page.request.get('/api/machine/v1/project', {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(response.status()).toBe(401);
});

test('read-only token can read the manifest and catalog but not write', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = `token-read-only-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: { name: 'Read Only', slug, sourceLocale: 'en', locales: ['en'] },
  });

  const secret = await createProjectTokenViaApi(page, slug, ['catalog:read']);

  const manifest = await page.request.get('/api/machine/v1/project', {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(manifest.ok()).toBe(true);
  const manifestBody = await manifest.json();
  expect(manifestBody.data).toMatchObject({
    project: { slug, sourceLocale: 'en', locales: ['en'] },
    capabilities: { catalogRead: true, catalogWrite: false },
  });

  const readCatalogs = await page.request.get('/api/machine/v1/catalogs', {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(readCatalogs.ok()).toBe(true);
  await expect(readCatalogs.json()).resolves.toEqual({ data: [] });

  const write = await page.request.put(`/api/machine/v1/catalogs/en`, {
    headers: { authorization: `Bearer ${secret}` },
    data: { content: { common: { save: 'Save' } } },
  });
  expect(write.status()).toBe(403);
  const writeBody = await write.json();
  expect(writeBody.error.code).toBe('INVALID_SCOPE');
});

test('a write-scoped token can create and read a catalog with a matching ETag/revision', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = `token-write-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: { name: 'Writer', slug, sourceLocale: 'en', locales: ['en'] },
  });

  const secret = await createProjectTokenViaApi(page, slug, [
    'catalog:read',
    'catalog:write',
  ]);

  // Missing locale, no precondition header at all -> created.
  const created = await page.request.put(`/api/machine/v1/catalogs/en`, {
    headers: { authorization: `Bearer ${secret}` },
    data: { content: { common: { save: 'Save' } } },
  });
  expect(created.status()).toBe(200);
  const createdBody = await created.json();
  expect(createdBody.data.content).toEqual({ common: { save: 'Save' } });
  const revision = createdBody.data.revision as string;
  expect(revision).toBeTruthy();
  expect(created.headers()['etag']).toBe(`"${revision}"`);

  const read = await page.request.get(`/api/machine/v1/catalogs/en`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(read.ok()).toBe(true);
  const readBody = await read.json();
  expect(readBody.data.revision).toBe(revision);
  expect(read.headers()['etag']).toBe(`"${revision}"`);

  // Correct If-Match succeeds and advances the revision.
  const updated = await page.request.put(`/api/machine/v1/catalogs/en`, {
    headers: {
      authorization: `Bearer ${secret}`,
      'if-match': `"${revision}"`,
    },
    data: { content: { common: { save: 'Guardar' } } },
  });
  expect(updated.status()).toBe(200);
  const updatedBody = await updated.json();
  expect(updatedBody.data.revision).not.toBe(revision);

  // The now-stale revision is rejected with 412 and the current content is untouched.
  const stale = await page.request.put(`/api/machine/v1/catalogs/en`, {
    headers: {
      authorization: `Bearer ${secret}`,
      'if-match': `"${revision}"`,
    },
    data: { content: { common: { save: 'Should not apply' } } },
  });
  expect(stale.status()).toBe(412);
  const staleBody = await stale.json();
  expect(staleBody.error.code).toBe('CATALOG_REVISION_CONFLICT');

  const finalRead = await page.request.get(`/api/machine/v1/catalogs/en`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  const finalBody = await finalRead.json();
  expect(finalBody.data.content).toEqual({ common: { save: 'Guardar' } });
});

test('a stale machine write loses to a newer human edit, and the human edit survives', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = `token-concurrency-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: { name: 'Concurrency', slug, sourceLocale: 'en', locales: ['en'] },
  });
  await page.request.put(`/api/projects/${slug}/catalogs/en`, {
    headers: sameOriginHeaders(),
    data: { content: { common: { save: 'Save' } } },
  });

  const secret = await createProjectTokenViaApi(page, slug, [
    'catalog:read',
    'catalog:write',
  ]);

  const machineRead = await page.request.get(`/api/machine/v1/catalogs/en`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  const staleRevision = (await machineRead.json()).data.revision as string;

  // A human edits the catalog through the normal UI-facing API in the meantime.
  await page.request.put(`/api/projects/${slug}/catalogs/en`, {
    headers: sameOriginHeaders(),
    data: { content: { common: { save: 'Human edit' } } },
  });

  const staleWrite = await page.request.put(`/api/machine/v1/catalogs/en`, {
    headers: {
      authorization: `Bearer ${secret}`,
      'if-match': `"${staleRevision}"`,
    },
    data: { content: { common: { save: 'Stale machine write' } } },
  });
  expect(staleWrite.status()).toBe(412);

  const finalRead = await page.request.get(`/api/projects/${slug}/catalogs/en`);
  const finalBody = await finalRead.json();
  expect(finalBody.catalog.content).toEqual({ common: { save: 'Human edit' } });
});

test('a project A token cannot see or affect project B', async ({ page }) => {
  await signInAsAdmin(page);
  const suffix = Date.now();
  const slugA = `project-a-${suffix}`;
  const slugB = `project-b-${suffix}`;

  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: { name: 'A', slug: slugA, sourceLocale: 'en', locales: ['en'] },
  });
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: { name: 'B', slug: slugB, sourceLocale: 'en', locales: ['en'] },
  });
  await page.request.put(`/api/projects/${slugB}/catalogs/en`, {
    headers: sameOriginHeaders(),
    data: { content: { common: { save: 'Project B secret content' } } },
  });

  const secretA = await createProjectTokenViaApi(page, slugA, [
    'catalog:read',
    'catalog:write',
  ]);

  const manifest = await page.request.get('/api/machine/v1/project', {
    headers: { authorization: `Bearer ${secretA}` },
  });
  const manifestBody = await manifest.json();
  expect(manifestBody.data.project.slug).toBe(slugA);

  // The token has no way to address project B's catalog at all — the machine API namespace
  // carries no project selector, so "project B's en.json" is simply not reachable through it.
  const catalogs = await page.request.get('/api/machine/v1/catalogs', {
    headers: { authorization: `Bearer ${secretA}` },
  });
  await expect(catalogs.json()).resolves.toEqual({ data: [] });
});

test('a machine token cannot be used against the human project/catalog routes at all', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const suffix = Date.now();
  const slugA = `human-route-a-${suffix}`;
  const slugB = `human-route-b-${suffix}`;

  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: { name: 'A', slug: slugA, sourceLocale: 'en', locales: ['en'] },
  });
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: { name: 'B', slug: slugB, sourceLocale: 'en', locales: ['en'] },
  });
  await page.request.put(`/api/projects/${slugB}/catalogs/en`, {
    headers: sameOriginHeaders(),
    data: { content: { common: { save: 'Project B secret content' } } },
  });

  const secretA = await createProjectTokenViaApi(page, slugA, [
    'catalog:read',
    'catalog:write',
  ]);

  // A token for project A must not be usable to read even its *own* project through the human
  // surface, let alone project B's — human routes take the project from the URL, not the
  // token, so a machine credential must be rejected there outright rather than "just" isolated.
  const readOwnProjectHuman = await page.request.get(`/api/projects/${slugA}`, {
    headers: { authorization: `Bearer ${secretA}` },
  });
  expect(readOwnProjectHuman.status()).toBe(401);

  const readOtherProjectCatalog = await page.request.get(
    `/api/projects/${slugB}/catalogs/en`,
    { headers: { authorization: `Bearer ${secretA}` } },
  );
  expect(readOtherProjectCatalog.status()).toBe(401);

  const listProjectsHuman = await page.request.get('/api/projects', {
    headers: { authorization: `Bearer ${secretA}` },
  });
  expect(listProjectsHuman.status()).toBe(401);
});

async function createProjectTokenViaApi(
  page: Page,
  slug: string,
  scopes: string[],
): Promise<string> {
  const response = await page.request.post(`/api/projects/${slug}/tokens`, {
    headers: sameOriginHeaders(),
    data: { name: `Token for ${slug}`, scopes },
  });
  const body = await response.json();
  return body.secret as string;
}

async function waitForAngular(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __ngHydrated?: boolean }).__ngHydrated === true,
  );
}

// Bootstrap is a one-time, idempotent-in-effect operation (spec 053/bootstrap.post.ts): it
// returns 409 once an admin already exists, and every test in this file — like every test in
// glossa.spec.ts, sharing the same dev server — signs into that same fixed admin account.
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
