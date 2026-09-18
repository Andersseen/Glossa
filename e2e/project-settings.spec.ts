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

test('an admin corrects the source locale of a project that has no catalogs yet', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `settings-source-${Date.now()}`, [
    'en',
    'es',
  ]);

  await openSettings(page, slug);
  await expect(page.getByLabel('Slug')).toHaveValue(slug);
  await expect(page.getByLabel('Slug')).toHaveAttribute('readonly', '');

  // The selector only offers the project's configured locales.
  const source = page.getByLabel('Source locale');
  await expect(source.locator('option')).toHaveText([
    'English / en',
    'Español / es',
  ]);

  // Nothing to save until something changes.
  await expect(
    page.getByRole('button', { name: 'Save settings' }),
  ).toBeDisabled();

  await source.selectOption('es');

  // No catalogs → no impact warning, just a normal save.
  await expect(page.getByText('unsaved changes')).toBeVisible();
  await expect(
    page.getByText('Changing the source locale changes which translation keys'),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'saved' }),
  ).toBeVisible();

  // Overview reflects the new source without a reload.
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(
    page
      .getByRole('term')
      .filter({ hasText: 'Source locale' })
      .locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('es');

  // Translations now treats `es` as canonical: a catalog created afterwards for `es` alone is the
  // key list, even though `en` has none.
  await putCatalog(page, slug, 'es', { greeting: 'Hola' });
  await page.getByRole('tab', { name: 'Translations' }).click();
  await expect(
    page.getByRole('button', { name: 'greeting Hola' }),
  ).toBeVisible();
});

test('changing the source locale of a project with catalogs shows the impact and needs confirmation', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `settings-impact-${Date.now()}`, [
    'en',
    'es',
    'uk',
  ]);
  await putCatalog(page, slug, 'en', { nav: { home: 'Home', docs: 'Docs' } });
  await putCatalog(page, slug, 'es', {
    nav: { home: 'Inicio' },
    footer: 'Pie',
  });

  await openSettings(page, slug);
  await page.getByLabel('Source locale').selectOption('es');

  await expect(
    page.getByText(
      'Changing the source locale changes which translation keys Glossa considers canonical.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText('1 key from English / en will no longer be canonical.'),
  ).toBeVisible();
  await expect(
    page.getByText('1 key from Español / es will become canonical.'),
  ).toBeVisible();
  await expect(
    page.getByText('Catalog content will not be deleted.'),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Applications may need to use the same source locale configuration.',
    ),
  ).toBeVisible();

  // Structural impact requires an explicit confirmation before saving.
  const save = page.getByRole('button', { name: 'Save settings' });
  await expect(save).toBeDisabled();
  await page.getByLabel('I understand which keys will change.').check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'saved' }),
  ).toBeVisible();

  // Catalog content is untouched and the workspace's canonical keys follow the new source.
  const en = await page.request.get(`/api/projects/${slug}/catalogs/en`);
  expect((await en.json()).catalog.content).toEqual({
    nav: { home: 'Home', docs: 'Docs' },
  });

  await page.getByRole('tab', { name: 'Translations' }).click();
  await expect(
    page.getByRole('button', { name: 'nav.home Inicio' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'footer Pie' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^nav\.docs/ })).toHaveCount(0);
});

test('a source locale without a catalog cannot be saved once catalogs exist', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `settings-blocked-${Date.now()}`, [
    'en',
    'es',
    'uk',
  ]);
  await putCatalog(page, slug, 'en', { a: 'A' });

  await openSettings(page, slug);
  await page.getByLabel('Source locale').selectOption('uk');

  await expect(
    page.getByText(
      'Українська / uk has no catalog, so it cannot become the source locale yet.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save settings' }),
  ).toBeDisabled();
});

test('a locale that already has a catalog cannot be removed from settings', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `settings-locales-${Date.now()}`, [
    'en',
    'es',
    'uk',
  ]);
  await putCatalog(page, slug, 'es', { a: 'a' });

  await openSettings(page, slug);

  await expect(page.getByRole('button', { name: 'Remove es' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove en' })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove uk' }).click();
  await page.getByLabel('New locale').fill('pt-BR');
  await page.getByRole('button', { name: 'Add locale' }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'saved' }),
  ).toBeVisible();

  const project = await page.request.get(`/api/projects/${slug}`);
  expect((await project.json()).project.locales).toEqual(['en', 'es', 'pt-BR']);
});

test('an admin deletes a project and its catalogs behind a typed confirmation', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `settings-delete-${Date.now()}`, [
    'en',
    'es',
  ]);
  await putCatalog(page, slug, 'en', { a: 'A' });
  await putCatalog(page, slug, 'es', { a: 'a' });

  await openSettings(page, slug);
  await expect(
    page.getByRole('heading', { name: 'Danger zone' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete project' }).click();

  const dialog = page.getByRole('alertdialog', {
    name: `Delete project ${slug}?`,
  });
  await expect(dialog).toBeVisible();

  // Factual impact, no secrets.
  await expect(dialog.getByText('2 (en, es)')).toBeVisible();
  await expect(dialog.getByText('en, es', { exact: true })).toBeVisible();

  const confirm = dialog.getByLabel(`Type "${slug}" to confirm:`);
  const remove = dialog.getByRole('button', { name: 'Delete permanently' });
  await expect(remove).toBeDisabled();

  await confirm.fill('not-the-slug');
  await expect(remove).toBeDisabled();

  await confirm.fill(slug);
  await expect(remove).toBeEnabled();
  await remove.click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('status')).toContainText(
    `Project ${slug} was deleted.`,
  );
  await expect(page.getByRole('link', { name: slug })).toHaveCount(0);

  const gone = await page.request.get(`/api/projects/${slug}`);
  expect(gone.status()).toBe(404);
});

test('cancelling the delete dialog leaves the project in place', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `settings-keep-${Date.now()}`, ['en']);

  await openSettings(page, slug);
  await page.getByRole('button', { name: 'Delete project' }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByLabel(`Type "${slug}" to confirm:`).fill(slug);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page).toHaveURL(new RegExp(`/projects/${slug}`));
  const still = await page.request.get(`/api/projects/${slug}`);
  expect(still.status()).toBe(200);
});

test('a viewer sees read-only settings; an editor can edit them but cannot delete the project', async ({
  page,
}) => {
  await signInAsAdmin(page);
  const slug = await createProject(page, `settings-roles-${Date.now()}`, [
    'en',
    'es',
  ]);

  await setSignedRoleCookie(page, 'viewer');
  await openSettings(page, slug);
  await expect(
    page.getByText(
      'Only project admins and editors can change project settings.',
    ),
  ).toBeVisible();
  await expect(page.getByLabel('Source locale')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', { name: 'Delete project' }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Only project admins can delete a project.'),
  ).toBeVisible();
  const viewerEdit = await page.request.patch(`/api/projects/${slug}`, {
    headers: sameOriginHeaders(),
    data: { name: 'Nope' },
  });
  expect(viewerEdit.status()).toBe(403);

  await setSignedRoleCookie(page, 'editor');
  await openSettings(page, slug);
  await page.getByLabel('Name', { exact: true }).fill('Renamed by editor');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'saved' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Renamed by editor', level: 1 }),
  ).toBeVisible();

  // No delete affordance for an editor, and the server refuses it regardless.
  await expect(
    page.getByRole('button', { name: 'Delete project' }),
  ).toHaveCount(0);
  const editorDelete = await page.request.delete(`/api/projects/${slug}`, {
    headers: sameOriginHeaders(),
  });
  expect(editorDelete.status()).toBe(403);
});

async function openSettings(page: Page, slug: string): Promise<void> {
  await page.goto(`/projects/${slug}`);
  await waitForAngular(page);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(
    page.getByRole('heading', { name: 'Project settings' }),
  ).toBeVisible();
}

async function createProject(
  page: Page,
  slug: string,
  locales: string[],
): Promise<string> {
  const response = await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: { name: 'Settings Project', slug, sourceLocale: 'en', locales },
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
