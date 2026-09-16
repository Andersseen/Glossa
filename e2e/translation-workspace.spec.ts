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

test('a human edits one key across locales without opening any JSON', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `workspace-edit-${Date.now()}`);
  await putCatalog(page, slug, 'en', {
    nav: { home: 'Home', docs: 'Documentation' },
    dialog: { close: 'Close' },
  });
  await putCatalog(page, slug, 'es', { nav: { home: 'Inicio' } });

  await openTranslations(page, slug);

  // The source locale defines the key list, and completeness is visible per key.
  await expect(
    page.getByRole('button', { name: 'nav.home Home 2 / 3 Missing' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'nav', exact: true }),
  ).toBeVisible();

  await page.getByLabel('Search translations').fill('docs');
  await expect(
    page.getByRole('button', { name: 'nav.docs Documentation' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'dialog.close Close' }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'nav.docs Documentation' }).click();

  // The selected key shows every configured locale, with the source locale first and marked.
  await expect(page.getByLabel('English en Source')).toHaveValue(
    'Documentation',
  );
  await expect(page.getByLabel('Español es')).toHaveValue('');
  await expect(page.getByLabel('Українська uk')).toHaveValue('');

  await page.getByLabel('Español es').fill('Documentación');
  await page.getByLabel('Українська uk').fill('Документація');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'nav.docs Documentation 3 / 3' }),
  ).toBeVisible();

  // Reload: the values persist, and the untouched keys are untouched.
  await page.goto(`/projects/${slug}?tab=translations`);
  await waitForAngular(page);
  await page.getByRole('button', { name: 'nav.docs Documentation' }).click();
  await expect(page.getByLabel('Español es')).toHaveValue('Documentación');
  await expect(page.getByLabel('Українська uk')).toHaveValue('Документація');

  const stored = await page.request.get(`/api/projects/${slug}/catalogs/es`);
  expect((await stored.json()).catalog.content).toEqual({
    nav: { home: 'Inicio', docs: 'Documentación' },
  });
});

test('filters separate missing from complete keys', async ({ page }) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `workspace-filter-${Date.now()}`, [
    'en',
    'es',
  ]);
  await putCatalog(page, slug, 'en', {
    nav: { home: 'Home', docs: 'Documentation' },
  });
  await putCatalog(page, slug, 'es', { nav: { home: 'Inicio' } });

  await openTranslations(page, slug);

  await page.getByRole('button', { name: 'Missing', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'nav.docs Documentation' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'nav.home Home' })).toHaveCount(
    0,
  );

  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'nav.home Home' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'nav.docs Documentation' }),
  ).toHaveCount(0);
});

test('a human adds a translation key without touching JSON', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `workspace-add-${Date.now()}`);
  await putCatalog(page, slug, 'en', { nav: { home: 'Home' } });

  await openTranslations(page, slug);

  await page.getByRole('button', { name: 'Add translation' }).click();

  // Scoped to the drawer: the key editor behind it carries the same locale labels.
  const drawer = page.getByRole('dialog');
  await expect(
    drawer.getByRole('heading', { name: 'Add translation' }),
  ).toBeVisible();

  await drawer.getByLabel('Key').fill('checkout.payment.title');
  await drawer.getByLabel('English en Source · required').fill('Payment');
  await drawer.getByLabel('Español es').fill('Pago');
  await drawer.getByRole('button', { name: 'Add translation' }).click();

  await expect(drawer).toHaveCount(0);

  // The new key joins the list and the counts move, with no page reload.
  await expect(
    page.getByRole('button', {
      name: 'checkout.payment.title Payment 2 / 3 Missing',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'checkout.payment.title' }),
  ).toBeVisible();
  await expect(page.getByLabel('Українська uk')).toHaveValue('');

  await page.goto(`/projects/${slug}?tab=translations`);
  await waitForAngular(page);
  await expect(
    page.getByRole('button', {
      name: 'checkout.payment.title Payment 2 / 3 Missing',
    }),
  ).toBeVisible();
});

test('a viewer can read the workspace but cannot change it', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `workspace-viewer-${Date.now()}`);
  await putCatalog(page, slug, 'en', { nav: { home: 'Home' } });
  await putCatalog(page, slug, 'es', { nav: { home: 'Inicio' } });

  await setSignedRoleCookie(page, 'viewer');
  await openTranslations(page, slug);

  await page.getByRole('button', { name: 'nav.home Home' }).click();
  await expect(page.getByLabel('English en Source')).toHaveValue('Home');
  await expect(page.getByLabel('English en Source')).toHaveAttribute(
    'readonly',
    '',
  );
  await expect(page.getByLabel('Español es')).toHaveAttribute('readonly', '');
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Add translation' }),
  ).toHaveCount(0);

  const rejected = await page.request.patch(
    `/api/projects/${slug}/translations`,
    {
      headers: sameOriginHeaders(),
      data: { key: 'nav.home', changes: [{ locale: 'es', value: 'Casa' }] },
    },
  );
  expect(rejected.status()).toBe(403);
});

test('the raw JSON catalog remains available as the advanced editor', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `workspace-advanced-${Date.now()}`);
  await putCatalog(page, slug, 'en', { nav: { home: 'Home' } });

  await page.goto(`/projects/${slug}/catalogs/en`);
  await waitForAngular(page);

  await expect(page.getByText('Advanced', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Catalog JSON')).toHaveValue(
    JSON.stringify({ nav: { home: 'Home' } }, null, 2),
  );

  await page.getByRole('link', { name: 'Back to translations' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${slug}\\?tab=translations`),
  );
  await waitForAngular(page);
  await expect(
    page.getByRole('button', { name: 'nav.home Home' }),
  ).toBeVisible();
});

test('an admin renames a key across every locale without opening JSON', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `workspace-rename-${Date.now()}`);
  await putCatalog(page, slug, 'en', {
    nav: { home: 'Home', docs: 'Documentation' },
  });
  await putCatalog(page, slug, 'es', { nav: { home: 'Inicio' } });

  await openTranslations(page, slug);
  await page
    .getByRole('button', { name: 'nav.home Home 2 / 3 Missing' })
    .click();
  await page.getByRole('button', { name: 'Rename key' }).click();

  const drawer = page.getByRole('dialog');
  await expect(
    drawer.getByRole('heading', { name: 'Rename translation key' }),
  ).toBeVisible();
  await expect(drawer.getByText('Current key')).toBeVisible();

  await drawer.getByLabel('New key').fill('navigation.home');
  await drawer.getByRole('button', { name: 'Rename key' }).click();

  await expect(drawer).toHaveCount(0);

  // The old key is gone, the new one holds the exact preserved values, and it is auto-selected.
  await expect(page.getByRole('button', { name: 'nav.home Home' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', {
      name: 'navigation.home Home 2 / 3 Missing',
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'navigation.home' }),
  ).toBeVisible();
  await expect(page.getByLabel('English en Source')).toHaveValue('Home');
  await expect(page.getByLabel('Español es')).toHaveValue('Inicio');

  const stored = await page.request.get(`/api/projects/${slug}/catalogs/en`);
  expect((await stored.json()).catalog.content).toEqual({
    nav: { docs: 'Documentation' },
    navigation: { home: 'Home' },
  });
});

test('an admin deletes a key, pruning it from every locale', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `workspace-delete-${Date.now()}`);
  await putCatalog(page, slug, 'en', {
    legacy: { banner: { title: 'Old title' } },
    nav: { home: 'Home' },
  });
  await putCatalog(page, slug, 'es', { nav: { home: 'Inicio' } });

  await openTranslations(page, slug);
  await page
    .getByRole('button', { name: 'legacy.banner.title Old title' })
    .click();
  await page.getByRole('button', { name: 'Delete key' }).click();

  const drawer = page.getByRole('dialog');
  await expect(
    drawer.getByRole('heading', { name: 'Delete translation key?' }),
  ).toBeVisible();
  await expect(drawer.getByText('legacy.banner.title')).toBeVisible();

  await drawer.getByRole('button', { name: 'Delete translation' }).click();
  await expect(drawer).toHaveCount(0);

  await expect(
    page.getByRole('button', { name: 'legacy.banner.title' }),
  ).toHaveCount(0);
  await expect(
    page.locator('dl > div', { has: page.getByText('Keys', { exact: true }) }),
  ).toContainText('1');

  const stored = await page.request.get(`/api/projects/${slug}/catalogs/en`);
  expect((await stored.json()).catalog.content).toEqual({
    nav: { home: 'Home' },
  });
});

test('a viewer sees no Rename or Delete actions', async ({ page }) => {
  await signInAsAdmin(page);
  const slug = await createProject(
    page,
    `workspace-lifecycle-viewer-${Date.now()}`,
  );
  await putCatalog(page, slug, 'en', { nav: { home: 'Home' } });

  await setSignedRoleCookie(page, 'viewer');
  await openTranslations(page, slug);

  await page.getByRole('button', { name: 'nav.home Home' }).click();
  await expect(page.getByRole('button', { name: 'Rename key' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete key' })).toHaveCount(0);
});

test('a stale workspace shows a conflict instead of silently overwriting a rename', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(
    page,
    `workspace-rename-conflict-${Date.now()}`,
  );
  await putCatalog(page, slug, 'en', { nav: { home: 'Home' } });

  await openTranslations(page, slug);
  await page.getByRole('button', { name: 'nav.home Home' }).click();

  // Someone else changes the catalog through the API after this workspace was loaded.
  await putCatalog(page, slug, 'en', { nav: { home: 'Home changed' } });

  await page.getByRole('button', { name: 'Rename key' }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel('New key').fill('navigation.home');
  await drawer.getByRole('button', { name: 'Rename key' }).click();

  await expect(drawer.getByText(/changed after you opened/)).toBeVisible();
  await expect(drawer).toBeVisible();

  const stored = await page.request.get(`/api/projects/${slug}/catalogs/en`);
  expect((await stored.json()).catalog.content).toEqual({
    nav: { home: 'Home changed' },
  });
});

async function openTranslations(page: Page, slug: string): Promise<void> {
  await page.goto(`/projects/${slug}`);
  await waitForAngular(page);
  await page.getByRole('tab', { name: 'Translations' }).click();
}

async function createProject(
  page: Page,
  slug: string,
  locales: string[] = ['en', 'es', 'uk'],
): Promise<string> {
  const response = await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: { name: 'Workspace Project', slug, sourceLocale: 'en', locales },
  });
  expect(response.status()).toBe(201);
  return slug;
}

async function putCatalog(
  page: Page,
  slug: string,
  locale: string,
  content: unknown,
): Promise<void> {
  const response = await page.request.put(
    `/api/projects/${slug}/catalogs/${locale}`,
    { headers: sameOriginHeaders(), data: { content } },
  );
  expect(response.ok()).toBe(true);
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
