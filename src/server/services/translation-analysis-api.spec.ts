import { createApp, toWebHandler, type EventHandler } from 'h3';

import { getCmsRuntime, getPasswordAuthAdapter } from '../cms/runtime';
import { saveCatalog } from './catalog.service';
import { createProjectToken } from './project-token.service';
import { createProject } from './project.service';
import analysisHandler from '../routes/api/projects/[slug]/translations/analysis.get';

// See translation-api.spec.ts for why these handlers live outside `src/server/routes/`.
function webHandlerFor(handler: EventHandler) {
  const app = createApp();
  app.use(handler);
  return toWebHandler(app);
}

const analysisFetch = webHandlerFor(analysisHandler);

const ORIGIN = 'https://glossa.test';

async function sessionToken(role: 'admin' | 'editor' | 'viewer') {
  const cms = await getCmsRuntime();
  const auth = getPasswordAuthAdapter(cms);
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const created = await auth.createUser({
    email,
    password: 'correct-password',
    role,
  });

  if (!created.ok) {
    throw new Error(`Could not create the ${role} test user.`);
  }

  const login = await auth.login(email, 'correct-password');

  if (!login.ok) {
    throw new Error(`Could not sign in the ${role} test user.`);
  }

  return login.token;
}

function authed(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  };
}

async function setUpProject(slug: string, locales = ['en', 'es', 'uk']) {
  const cms = await getCmsRuntime();
  const project = await createProject(cms, {
    name: 'Volt UI',
    slug,
    sourceLocale: 'en',
    locales,
    publicDelivery: true,
  });
  return { cms, project };
}

describe('GET /api/projects/:slug/translations/analysis', () => {
  it('returns per-locale coverage and structural diffs for an admin, editor and viewer', async () => {
    const slug = `analysis-read-${Date.now()}`;
    const { cms } = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', {
      nav: { home: 'Home', docs: 'Documentation' },
    });
    await saveCatalog(cms, slug, 'es', { nav: { home: 'Inicio' } });

    for (const role of ['admin', 'editor', 'viewer'] as const) {
      const response = await analysisFetch(
        new Request(
          `${ORIGIN}/api/projects/${slug}/translations/analysis`,
          authed(await sessionToken(role)),
        ),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.analysis.sourceKeys).toBe(2);

      const es = body.analysis.locales.find(
        (locale: { locale: string }) => locale.locale === 'es',
      );
      expect(es).toMatchObject({
        catalogExists: true,
        translatedKeys: 1,
        missingKeys: ['nav.docs'],
        extraKeys: [],
      });

      const uk = body.analysis.locales.find(
        (locale: { locale: string }) => locale.locale === 'uk',
      );
      expect(uk).toMatchObject({
        catalogExists: false,
        missingKeys: ['nav.home', 'nav.docs'],
      });
    }
  });

  it('rejects an unauthenticated request', async () => {
    const slug = `analysis-anon-${Date.now()}`;
    await setUpProject(slug);

    const response = await analysisFetch(
      new Request(`${ORIGIN}/api/projects/${slug}/translations/analysis`),
    );

    expect(response.status).toBe(401);
  });

  it('rejects a machine project access token on the human route', async () => {
    const slug = `analysis-machine-${Date.now()}`;
    const { cms, project } = await setUpProject(slug);
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:read', 'catalog:write'],
    });

    const response = await analysisFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations/analysis`,
        authed(secret),
      ),
    );

    expect(response.status).toBe(401);
  });

  it('keeps projects isolated', async () => {
    const stamp = Date.now();
    const { cms } = await setUpProject(`analysis-a-${stamp}`);
    await setUpProject(`analysis-b-${stamp}`);
    await saveCatalog(cms, `analysis-a-${stamp}`, 'en', { only: 'A' });

    const token = await sessionToken('admin');
    const other = await analysisFetch(
      new Request(
        `${ORIGIN}/api/projects/analysis-b-${stamp}/translations/analysis`,
        authed(token),
      ),
    );

    expect((await other.json()).analysis.sourceKeys).toBe(0);

    const missing = await analysisFetch(
      new Request(
        `${ORIGIN}/api/projects/does-not-exist-${stamp}/translations/analysis`,
        authed(token),
      ),
    );
    expect(missing.status).toBe(404);
  });
});
