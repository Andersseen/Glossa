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

// Playwright's webServer here is plain `pnpm dev` (see playwright.config.ts) — Analog's dev
// middleware only proxies `/api/**` into the Nitro/H3 server; a request to `/i18n/*` or `/mcp`
// falls straight through to the Angular SSR shell instead of the real route. The actual HTTP
// behavior of those two surfaces (raw JSON, headers, 404s, ETag/304, the full MCP protocol) is
// covered where it can genuinely run: `src/server/delivery/i18n-routes.spec.ts` and
// `src/server/mcp/mcp.spec.ts` (Vitest, driving the real route handlers directly), plus manual
// verification against the built Cloudflare Worker via `wrangler pages dev`. This file covers
// what Playwright *can* prove under `pnpm dev`: the Angular UI itself.
test('project delivery UI: enable, generated URLs, copy, and access tokens remain intact', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signInAsAdmin(page);

  const slug = `delivery-ui-${Date.now()}`;
  await page.request.post('/api/projects', {
    headers: sameOriginHeaders(),
    data: {
      name: 'Delivery UI Project',
      slug,
      sourceLocale: 'en',
      locales: ['en', 'es'],
    },
  });

  await page.goto(`/projects/${slug}`);
  await waitForAngular(page);
  await page.getByRole('tab', { name: 'Delivery' }).click();

  const deliveryPanel = page.getByRole('tabpanel', { name: 'Delivery' });
  const toggle = page.getByRole('checkbox', { name: 'Public delivery' });
  await expect(toggle).not.toBeChecked();
  await expect(
    deliveryPanel.getByText('Not served until public delivery'),
  ).toBeVisible();

  await toggle.check();
  await expect(toggle).toBeChecked();
  await expect(deliveryPanel.getByText('Live now')).toBeVisible();

  const manifestUrl = `${new URL(page.url()).origin}/i18n/${slug}/manifest.json`;
  const enCatalogUrl = `${new URL(page.url()).origin}/i18n/${slug}/en.json`;

  await expect(
    deliveryPanel.getByText(manifestUrl, { exact: true }),
  ).toBeVisible();
  await expect(
    deliveryPanel.getByText(enCatalogUrl, { exact: true }),
  ).toBeVisible();
  await expect(deliveryPanel.getByText('Source locale')).toBeVisible();

  // The manifest row is always first in the list — its Copy button is the first one rendered.
  const manifestCopyButton = deliveryPanel
    .getByRole('button', { name: 'Copy' })
    .first();
  await manifestCopyButton.click();
  await expect(
    deliveryPanel.getByRole('button', { name: 'Copied!' }).first(),
  ).toBeVisible();

  const clipboardText = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  expect(clipboardText).toBe(manifestUrl);

  const mcpEndpoint = `${new URL(page.url()).origin}/mcp`;
  await expect(
    deliveryPanel.getByText(mcpEndpoint, { exact: true }),
  ).toBeVisible();
  await expect(deliveryPanel.getByText('mcpServers')).toBeVisible();

  // Regression: the Access tokens tab (and the rest of the page) still works normally.
  await page.getByRole('tab', { name: 'Access tokens' }).click();
  await expect(
    page.getByText(
      'No access tokens yet. Create one to let an agent or CI process',
    ),
  ).toBeVisible();
});

async function waitForAngular(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __ngHydrated?: boolean }).__ngHydrated === true,
  );
}

// Bootstrap is a one-time, idempotent-in-effect operation: it returns 409 once an admin already
// exists, and every test in this suite signs into that same fixed admin account.
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
