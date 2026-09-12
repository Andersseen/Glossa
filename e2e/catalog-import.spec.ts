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

function jsonFile(name: string, content: unknown) {
  return {
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(content)),
  };
}

test('import creates new catalogs from multiple files and updates the list without a reload', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = `catalog-import-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: {
      name: 'Catalog Import Project',
      slug,
      sourceLocale: 'en',
      locales: ['en', 'es', 'uk'],
    },
  });

  await page.goto(`/projects/${slug}`);
  await waitForAngular(page);

  await page.getByRole('button', { name: 'Import catalogs' }).click();
  await expect(
    page.getByRole('heading', { name: 'Import catalogs' }),
  ).toBeVisible();

  await page
    .getByLabel('Choose catalog JSON files')
    .setInputFiles([
      jsonFile('en.json', { common: { save: 'Save', cancel: 'Cancel' } }),
      jsonFile('es.json', { common: { save: 'Guardar', cancel: 'Cancelar' } }),
    ]);

  const previewButton = page.getByRole('button', {
    name: 'Preview import',
    exact: true,
  });
  await expect(previewButton).toBeEnabled();

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(`/catalogs/import/preview`) &&
        response.request().method() === 'POST',
    ),
    previewButton.click(),
  ]);

  const previewRows = page.locator('table tbody tr');
  await expect(previewRows).toHaveCount(2);
  await expect(page.getByText('New', { exact: true })).toHaveCount(2);

  const importButton = page.getByRole('button', {
    name: 'Import',
    exact: true,
  });
  await expect(importButton).toBeEnabled();

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/projects/${slug}/catalogs/import`) &&
        response.request().method() === 'POST',
    ),
    importButton.click(),
  ]);

  await expect(page.getByText('2 catalogs imported')).toBeVisible();
  await expect(page.getByText('2 messages')).toHaveCount(2);

  await page.getByRole('button', { name: 'Close' }).click();

  // The catalog list reflects the import without a page reload — no page.goto/reload happens here.
  await expect(
    page.getByRole('link', { name: 'en.json Source locale Ready' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'es.json Ready' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'uk.json Not created' }),
  ).toBeVisible();
});

test('import requires explicit confirmation before replacing an existing catalog', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = `catalog-import-replace-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: {
      name: 'Catalog Import Replace Project',
      slug,
      sourceLocale: 'en',
      locales: ['en'],
    },
  });
  await page.request.put(`/api/projects/${slug}/catalogs/en`, {
    headers: sameOriginHeaders(),
    data: { content: { common: { save: 'Save' } } },
  });

  await page.goto(`/projects/${slug}`);
  await waitForAngular(page);

  await page.getByRole('button', { name: 'Import catalogs' }).click();
  await page
    .getByLabel('Choose catalog JSON files')
    .setInputFiles([
      jsonFile('en.json', { common: { save: 'Guardar', cancel: 'Cancelar' } }),
    ]);

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes(`/catalogs/import/preview`) &&
        response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Preview import', exact: true }).click(),
  ]);

  await expect(page.getByText('Replace existing')).toBeVisible();

  const importButton = page.getByRole('button', {
    name: 'Import',
    exact: true,
  });
  await expect(importButton).toBeDisabled();

  await page.getByLabel(/Replace the existing/).check();
  await expect(importButton).toBeEnabled();

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/projects/${slug}/catalogs/import`) &&
        response.request().method() === 'POST',
    ),
    importButton.click(),
  ]);

  await expect(page.getByText('1 catalog imported')).toBeVisible();

  const getResponse = await page.request.get(
    `/api/projects/${slug}/catalogs/en`,
  );
  await expect(getResponse.json()).resolves.toMatchObject({
    catalog: { content: { common: { save: 'Guardar', cancel: 'Cancelar' } } },
  });
});

test('import blocks a file mapped to an unconfigured locale until manually corrected', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = `catalog-import-unknown-locale-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: {
      name: 'Catalog Import Unknown Locale',
      slug,
      sourceLocale: 'en',
      locales: ['en'],
    },
  });

  await page.goto(`/projects/${slug}`);
  await waitForAngular(page);

  await page.getByRole('button', { name: 'Import catalogs' }).click();
  await page
    .getByLabel('Choose catalog JSON files')
    .setInputFiles([jsonFile('fr.json', { common: { save: 'Enregistrer' } })]);

  await expect(
    page.getByText(
      "Choose one of this project's configured locales for this file.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Preview import', exact: true }),
  ).toBeDisabled();

  await page.getByLabel('Locale').selectOption('en');

  await expect(
    page.getByText(
      "Choose one of this project's configured locales for this file.",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Preview import', exact: true }),
  ).toBeEnabled();
});

test('import accepts three realistic ~1,000-key catalogs over real HTTP in one batch', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = `catalog-import-large-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: {
      name: 'Catalog Import Large Project',
      slug,
      sourceLocale: 'en',
      locales: ['en', 'es', 'uk'],
    },
  });

  function largeCatalog(prefix: string, keyCount: number) {
    const content: Record<string, string> = {};
    for (let i = 0; i < keyCount; i++) {
      content[`key_${i}`] = `${prefix} value number ${i}`;
    }
    return content;
  }

  const response = await page.request.post(
    `/api/projects/${slug}/catalogs/import`,
    {
      headers: sameOriginHeaders(),
      data: {
        catalogs: [
          { locale: 'en', content: largeCatalog('English', 1144) },
          { locale: 'es', content: largeCatalog('Spanish', 1144) },
          { locale: 'uk', content: largeCatalog('Ukrainian', 1144) },
        ],
      },
    },
  );

  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.imported).toBe(true);
  expect(body.results).toHaveLength(3);
  for (const result of body.results) {
    expect(result).toMatchObject({ status: 'imported', messageCount: 1144 });
  }

  const getResponse = await page.request.get(
    `/api/projects/${slug}/catalogs/en`,
  );
  const catalog = (await getResponse.json()).catalog;
  expect(Object.keys(catalog.content)).toHaveLength(1144);
});

test('import route enforces the same authorization boundary as other catalog writes', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = `catalog-import-authz-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: {
      name: 'Catalog Import Authz Project',
      slug,
      sourceLocale: 'en',
      locales: ['en'],
    },
  });

  await page.goto(`/projects/${slug}`);
  await waitForAngular(page);
  await expect(
    page.getByRole('button', { name: 'Import catalogs' }),
  ).toBeVisible();

  const machineToken = await createProjectTokenViaApi(page, slug, [
    'catalog:read',
    'catalog:write',
  ]);

  await setSignedRoleCookie(page, 'viewer');
  await page.goto(`/projects/${slug}`);
  await waitForAngular(page);
  await expect(
    page.getByRole('button', { name: 'Import catalogs' }),
  ).toHaveCount(0);

  const viewerImport = await page.request.post(
    `/api/projects/${slug}/catalogs/import`,
    {
      headers: sameOriginHeaders(),
      data: { catalogs: [{ locale: 'en', content: { a: 'b' } }] },
    },
  );
  expect(viewerImport.status()).toBe(403);

  await page.context().clearCookies();
  const anonymousImport = await page.request.post(
    `/api/projects/${slug}/catalogs/import`,
    {
      headers: sameOriginHeaders(),
      data: { catalogs: [{ locale: 'en', content: { a: 'b' } }] },
    },
  );
  expect(anonymousImport.status()).toBe(401);

  const machineImport = await page.request.post(
    `/api/projects/${slug}/catalogs/import`,
    {
      headers: { authorization: `Bearer ${machineToken}` },
      data: { catalogs: [{ locale: 'en', content: { a: 'b' } }] },
    },
  );
  expect(machineImport.status()).toBe(401);
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
