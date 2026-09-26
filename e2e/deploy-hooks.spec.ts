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

const SECRET = 'SUPER_SECRET_DEPLOY_HOOK_ABC123';
// A well-formed but fake Cloudflare hook: configuring never calls it, this project gets no content
// edits (so nothing triggers it automatically), and "Test hook" is intercepted in the browser below
// — no real Cloudflare deployment is ever requested, and production SSRF validation is unchanged.
const HOOK_URL = `https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/${SECRET}`;

test('admin configures, tests, toggles, replaces and removes a deploy hook without ever seeing the secret again', async ({
  page,
}) => {
  await signInAsAdmin(page);

  const slug = `deploy-hook-ui-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: {
      name: 'Deploy Hook UI Project',
      slug,
      sourceLocale: 'es',
      locales: ['es', 'en'],
    },
  });

  await page.goto(`/projects/${slug}`);
  await waitForAngular(page);
  await page.getByRole('tab', { name: 'Delivery' }).click();

  const panel = page.getByRole('tabpanel', { name: 'Delivery' });
  await expect(
    panel.getByRole('heading', { name: 'Static site rebuild' }),
  ).toBeVisible();
  await expect(panel.getByText('No deploy hook configured.')).toBeVisible();

  // Configure — an unsafe URL is refused with an associated error first.
  await panel
    .getByRole('button', { name: 'Configure Cloudflare hook' })
    .click();
  const drawer = page.getByRole('dialog', { name: 'Configure deploy hook' });
  await expect(drawer).toBeVisible();
  const urlField = drawer.getByLabel('Cloudflare Deploy Hook URL');
  await urlField.fill('https://example.com/deploy_hooks/abcdefgh1234');
  await drawer.getByRole('button', { name: 'Save hook' }).click();
  await expect(drawer.getByRole('alert')).toContainText('Cloudflare');
  await expect(urlField).toHaveAttribute(
    'aria-describedby',
    /deploy-hook-url-error/,
  );

  await urlField.fill(HOOK_URL);
  await drawer.getByRole('button', { name: 'Save hook' }).click();
  await expect(drawer).toBeHidden();

  await expect(panel.getByText('Configured · Enabled')).toBeVisible();
  await expect(panel.getByTestId('deploy-hook-preview')).toContainText(
    '••••••C123',
  );
  await expect(panel.getByText('No trigger yet')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(SECRET);

  // The full secret is gone after a reload too — the server only ever returns the mask.
  await page.reload();
  await waitForAngular(page);
  await page.getByRole('tab', { name: 'Delivery' }).click();
  await expect(panel.getByText('Configured · Enabled')).toBeVisible();
  expect(await page.content()).not.toContain(SECRET);

  // Test hook — success, then a provider failure, both answered deterministically.
  const testResponses = [
    { success: true, statusCode: 204, lastError: null },
    {
      success: false,
      statusCode: 500,
      error: 'http_error',
      lastError: 'http_error',
    },
  ];
  await page.route(
    `**/api/projects/${slug}/deploy-hook/test`,
    async (route) => {
      const next = testResponses.shift()!;
      const attemptedAt = new Date().toISOString();
      await route.fulfill({
        json: {
          success: next.success,
          statusCode: next.statusCode,
          ...(next.error ? { error: next.error } : {}),
          attemptedAt,
          deployHook: {
            configured: true,
            provider: 'cloudflare',
            enabled: true,
            urlPreview: 'https://api.cloudflare.com/…/deploy_hooks/••••••C123',
            createdAt: attemptedAt,
            updatedAt: attemptedAt,
            lastAttemptAt: attemptedAt,
            lastSuccessAt: next.success ? attemptedAt : null,
            lastStatusCode: next.statusCode,
            lastError: next.lastError,
          },
        },
      });
    },
  );

  const status = panel.getByTestId('deploy-hook-test-status');
  await panel.getByRole('button', { name: 'Test hook' }).click();
  await expect(status).toHaveText('Deployment triggered.');
  await expect(panel.getByTestId('deploy-hook-last-result')).toHaveText(
    'Succeeded · HTTP 204',
  );

  await panel.getByRole('button', { name: 'Test hook' }).click();
  await expect(status).toContainText('The deploy hook returned HTTP 500.');
  await expect(status).toContainText('Your translations were saved normally.');
  await expect(panel.getByTestId('deploy-hook-last-result')).toHaveText(
    'Deploy hook failed · HTTP 500',
  );
  await page.unroute(`**/api/projects/${slug}/deploy-hook/test`);

  // Disable / enable — keyboard-operable real buttons.
  const disable = panel.getByRole('button', { name: 'Disable' });
  await disable.focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByText('Configured · Disabled')).toBeVisible();
  await panel.getByRole('button', { name: 'Enable' }).click();
  await expect(panel.getByText('Configured · Enabled')).toBeVisible();

  // Replace — the drawer starts empty; the masked value is never sent back as if it were the URL.
  await panel.getByRole('button', { name: 'Replace hook' }).click();
  const replaceDrawer = page.getByRole('dialog', {
    name: 'Replace deploy hook',
  });
  await expect(
    replaceDrawer.getByLabel('Cloudflare Deploy Hook URL'),
  ).toHaveValue('');
  await replaceDrawer
    .getByLabel('Cloudflare Deploy Hook URL')
    .fill(
      'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/0f2d7c6a-94b1-4e4f-8f3a-1c2b3d4e5f60',
    );
  await replaceDrawer.getByRole('button', { name: 'Save hook' }).click();
  await expect(replaceDrawer).toBeHidden();
  await expect(panel.getByTestId('deploy-hook-preview')).toContainText(
    '••••••5f60',
  );

  // Remove — confirmed, and back to the empty state without a reload.
  await panel.getByRole('button', { name: 'Remove', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm remove' }).click();
  await expect(panel.getByText('No deploy hook configured.')).toBeVisible();

  const api = await page.request.get(`/api/projects/${slug}/deploy-hook`);
  expect(await api.json()).toEqual({ deployHook: { configured: false } });
});

test('deploy-hook management API rejects a non-admin', async ({ page }) => {
  await signInAsAdmin(page);
  const slug = `deploy-hook-auth-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: { name: 'Hook Auth', slug, sourceLocale: 'en', locales: ['en'] },
  });

  const anonymous = await page.context().browser()!.newContext({
    baseURL: 'http://127.0.0.1:5173',
  });

  try {
    const response = await anonymous.request.put(
      `/api/projects/${slug}/deploy-hook`,
      { headers: sameOriginHeaders(), data: { url: HOOK_URL } },
    );
    expect(response.status()).toBe(401);
  } finally {
    await anonymous.close();
  }
});

async function waitForAngular(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __ngHydrated?: boolean }).__ngHydrated === true,
  );
}

// Bootstrap returns 409 once an admin exists; every test signs into that same fixed admin.
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
