import { defineConfig, devices } from '@playwright/test';

const MOCK_DEV_AUTH_PORT = 4310;
const MOCK_DEV_AUTH_ISSUER = `http://127.0.0.1:${MOCK_DEV_AUTH_PORT}`;
const DEV_AUTH_CLIENT_ID = 'glossa-dev';
const DEV_AUTH_CLIENT_SECRET = 'test-secret';

export default defineConfig({
  testDir: './e2e',
  webServer: [
    {
      command: `MOCK_DEV_AUTH_PORT=${MOCK_DEV_AUTH_PORT} MOCK_DEV_AUTH_CLIENT_ID=${DEV_AUTH_CLIENT_ID} MOCK_DEV_AUTH_CLIENT_SECRET=${DEV_AUTH_CLIENT_SECRET} node e2e/mock-dev-auth/server.mjs`,
      url: MOCK_DEV_AUTH_ISSUER,
      reuseExistingServer: !process.env['CI'],
    },
    {
      command:
        `AUTH_SECRET=playwright-auth-secret BOOTSTRAP_ADMIN_KEY=playwright-bootstrap ` +
        `DEV_AUTH_ISSUER=${MOCK_DEV_AUTH_ISSUER} DEV_AUTH_CLIENT_ID=${DEV_AUTH_CLIENT_ID} ` +
        `DEV_AUTH_CLIENT_SECRET=${DEV_AUTH_CLIENT_SECRET} ` +
        `DEV_AUTH_REDIRECT_URI=http://127.0.0.1:5173/api/auth/sso/callback ` +
        `pnpm dev --host 127.0.0.1 --port 5173`,
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env['CI'],
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
