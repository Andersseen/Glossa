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

test('SSO happy path: a fresh DevAuth login links the account and signs in', async ({
  page,
}) => {
  await bootstrapAdmin(page, 'admin@example.com');

  await page.goto('/projects');
  await waitForAngular(page);
  await expect(page).toHaveURL(/\/signin\?redirect=%2Fprojects$/);

  await continueWithDevAuth(page);
  await signInAtMockProvider(page, 'admin@example.com');

  await expect(page).toHaveURL(/\/projects$/);
  await waitForAngular(page);
  await expect(
    page.getByRole('heading', { name: 'Projects', exact: true }),
  ).toBeVisible();

  await page.reload();
  await waitForAngular(page);
  await expect(page).toHaveURL(/\/projects$/);

  const projectsResponse = await page.request.get('/api/projects');
  expect(projectsResponse.ok()).toBe(true);
});

test('an existing DevAuth provider session skips the credential form', async ({
  page,
}) => {
  await bootstrapAdmin(page, 'admin@example.com');

  await page.goto('/signin');
  await waitForAngular(page);
  await continueWithDevAuth(page);
  await signInAtMockProvider(page, 'admin@example.com');
  await expect(page).toHaveURL(/\/projects$/);
  await waitForAngular(page);

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/signin$/);

  await continueWithDevAuth(page);

  // No mock-provider credential form appears — straight back into Glossa.
  await expect(page).toHaveURL(/\/projects$/);
});

test('logout revokes the local session; the provider session still allows immediate re-entry', async ({
  page,
}) => {
  await bootstrapAdmin(page, 'admin@example.com');

  await page.goto('/signin');
  await waitForAngular(page);
  await continueWithDevAuth(page);
  await signInAtMockProvider(page, 'admin@example.com');
  await expect(page).toHaveURL(/\/projects$/);
  await waitForAngular(page);

  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/signin$/);

  await page.goto('/projects');
  await waitForAngular(page);
  await expect(page).toHaveURL(/\/signin/);

  await continueWithDevAuth(page);
  await expect(page).toHaveURL(/\/projects$/);
});

test('a DevAuth identity with no matching Glossa account is denied safely', async ({
  page,
}) => {
  await page.goto('/signin');
  await waitForAngular(page);
  await continueWithDevAuth(page);
  await signInAtMockProvider(page, 'unlinked-devauth-user@example.com');

  await expect(page).toHaveURL(/\/signin\?error=account_not_linked$/);
  await waitForAngular(page);
  await expect(
    page.getByText('Your DevAuth identity is not linked to a Glossa account.'),
  ).toBeVisible();

  await page.goto('/projects');
  await waitForAngular(page);
  await expect(page).toHaveURL(/\/signin/);
});

async function waitForAngular(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __ngHydrated?: boolean }).__ngHydrated === true,
  );
}

async function bootstrapAdmin(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/bootstrap', {
    headers: { 'x-glossa-bootstrap-key': 'playwright-bootstrap' },
    data: { email, password: 'correct-password', name: 'Admin' },
  });
}

async function continueWithDevAuth(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continue with DevAuth' }).click();
}

async function signInAtMockProvider(page: Page, email: string): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
}
