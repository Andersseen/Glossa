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

test('a human sees per-locale coverage and jumps from a missing key to the Workspace', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `analysis-jump-${Date.now()}`);
  await putCatalog(page, slug, 'en', {
    nav: { home: 'Home', docs: 'Documentation' },
  });
  await putCatalog(page, slug, 'es', { nav: { home: 'Inicio' } });

  await openTranslations(page, slug);

  // Workspace is the default surface — Analysis is opt-in.
  await expect(
    page.getByRole('button', { name: 'Workspace', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'nav.home Home' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Analysis', exact: true }).click();

  // Per-locale coverage is visible without opening any JSON.
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Español' })).toBeVisible();

  await page.getByRole('button', { name: 'Español' }).click();
  await expect(page.getByRole('button', { name: 'Missing 1' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'nav.docs', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'nav.docs', exact: true }).click();

  // Clicking the missing key returns to the Workspace with that exact key selected.
  await expect(
    page.getByRole('button', { name: 'Workspace', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('heading', { name: 'nav.docs', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('English en Source')).toHaveValue(
    'Documentation',
  );
  await expect(page.getByLabel('Español es')).toHaveValue('');
});

test('a target-only extra key is listed in Analysis, not treated as missing', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `analysis-extra-${Date.now()}`);
  await putCatalog(page, slug, 'en', { nav: { home: 'Home' } });
  await putCatalog(page, slug, 'es', {
    nav: { home: 'Inicio' },
    legacy: { banner: 'Viejo' },
  });

  await openTranslations(page, slug);
  await page.getByRole('button', { name: 'Analysis', exact: true }).click();

  await page.getByRole('button', { name: 'Español' }).click();
  await expect(page.getByRole('button', { name: 'Missing 0' })).toBeVisible();

  await page.getByRole('button', { name: 'Extra 1' }).click();
  await expect(page.getByText('legacy.banner', { exact: true })).toBeVisible();
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
    data: { name: 'Analysis Project', slug, sourceLocale: 'en', locales },
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
