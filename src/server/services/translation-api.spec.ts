import { createApp, toWebHandler, type EventHandler } from 'h3';

import { getCmsRuntime, getPasswordAuthAdapter } from '../cms/runtime';
import { getPublicCatalog } from '../delivery/delivery.service';
import { getCatalog, saveCatalog } from './catalog.service';
import { createProjectToken } from './project-token.service';
import { createProject } from './project.service';
import machineCatalogHandler from '../routes/api/machine/v1/catalogs/[locale].get';
import workspaceHandler from '../routes/api/projects/[slug]/translations/index.get';
import updateHandler from '../routes/api/projects/[slug]/translations/index.patch';
import createHandler from '../routes/api/projects/[slug]/translations/index.post';

// Lives outside `src/server/routes/` for the same reason as `i18n-routes.spec.ts` — Nitro's
// dev-server route scanner would otherwise try to load this spec file as a route. The handlers
// re-derive the project slug from the request URL (`getProjectSlug`), so mounting each at the app
// root and driving it with a real `Request` exercises the same auth/status logic as deployment.
function webHandlerFor(handler: EventHandler) {
  const app = createApp();
  app.use(handler);
  return toWebHandler(app);
}

const workspaceFetch = webHandlerFor(workspaceHandler);
const updateFetch = webHandlerFor(updateHandler);
const createFetch = webHandlerFor(createHandler);
const machineCatalogFetch = webHandlerFor(machineCatalogHandler);

const ORIGIN = 'https://glossa.test';

/**
 * A session token for a Glossa role, passed as `Authorization: Bearer`. The first user ever
 * created in the shared in-memory runtime is forced to `admin` by Forge, so every spec here
 * creates its own uniquely-named user and the admin case is seeded first.
 */
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

describe('GET /api/projects/:slug/translations', () => {
  it('returns the workspace for an admin, an editor and a viewer', async () => {
    const slug = `workspace-read-${Date.now()}`;
    const { cms } = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });

    for (const role of ['admin', 'editor', 'viewer'] as const) {
      const response = await workspaceFetch(
        new Request(
          `${ORIGIN}/api/projects/${slug}/translations`,
          authed(await sessionToken(role)),
        ),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.workspace.entries).toHaveLength(1);
      expect(body.workspace.project.sourceLocale).toBe('en');
    }
  });

  it('rejects an unauthenticated request', async () => {
    const slug = `workspace-anon-${Date.now()}`;
    await setUpProject(slug);

    const response = await workspaceFetch(
      new Request(`${ORIGIN}/api/projects/${slug}/translations`),
    );

    expect(response.status).toBe(401);
  });

  it('rejects a machine project access token on the human route', async () => {
    const slug = `workspace-machine-${Date.now()}`;
    const { cms, project } = await setUpProject(slug);
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:read', 'catalog:write'],
    });

    const response = await workspaceFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations`,
        authed(secret),
      ),
    );

    expect(response.status).toBe(401);
  });

  it('keeps projects isolated', async () => {
    const stamp = Date.now();
    const { cms } = await setUpProject(`workspace-a-${stamp}`);
    await setUpProject(`workspace-b-${stamp}`);
    await saveCatalog(cms, `workspace-a-${stamp}`, 'en', { only: 'A' });

    const token = await sessionToken('admin');
    const other = await workspaceFetch(
      new Request(
        `${ORIGIN}/api/projects/workspace-b-${stamp}/translations`,
        authed(token),
      ),
    );

    expect((await other.json()).workspace.entries).toEqual([]);

    const missing = await workspaceFetch(
      new Request(
        `${ORIGIN}/api/projects/does-not-exist-${stamp}/translations`,
        authed(token),
      ),
    );
    expect(missing.status).toBe(404);
  });
});

describe('PATCH /api/projects/:slug/translations', () => {
  it('saves a changed locale for an editor and reports the new revision', async () => {
    const slug = `workspace-update-${Date.now()}`;
    const { cms } = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });
    const token = await sessionToken('editor');

    const response = await updateFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations`,
        authed(token, {
          method: 'PATCH',
          body: JSON.stringify({
            key: 'nav.home',
            changes: [{ locale: 'es', value: 'Inicio' }],
          }),
        }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toBe(true);
    expect(body.entry.values.es).toEqual({ exists: true, value: 'Inicio' });
    expect(body.catalogs.es.revision).toBeTruthy();
  });

  it('answers 409 with per-locale detail for a stale revision', async () => {
    const slug = `workspace-conflict-${Date.now()}`;
    const { cms } = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, slug, 'es', { nav: { home: 'Inicio' } });
    const token = await sessionToken('admin');

    const response = await updateFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations`,
        authed(token, {
          method: 'PATCH',
          body: JSON.stringify({
            key: 'nav.home',
            changes: [
              { locale: 'es', value: 'Casa', expectedRevision: 'stale' },
            ],
          }),
        }),
      ),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.saved).toBe(false);
    expect(body.results[0].error.code).toBe('CATALOG_REVISION_CONFLICT');
    expect((await getCatalog(cms, slug, 'es')).content).toEqual({
      nav: { home: 'Inicio' },
    });
  });

  it('answers 400 for an unsafe key and 403 for a viewer', async () => {
    const slug = `workspace-guard-${Date.now()}`;
    const { cms } = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });

    const unsafe = await updateFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations`,
        authed(await sessionToken('admin'), {
          method: 'PATCH',
          body: JSON.stringify({
            key: '__proto__.polluted',
            changes: [{ locale: 'es', value: 'Inicio' }],
          }),
        }),
      ),
    );
    expect(unsafe.status).toBe(400);
    expect((await unsafe.json()).error.code).toBe('INVALID_TRANSLATION_KEY');

    const viewer = await updateFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations`,
        authed(await sessionToken('viewer'), {
          method: 'PATCH',
          body: JSON.stringify({
            key: 'nav.home',
            changes: [{ locale: 'es', value: 'Inicio' }],
          }),
        }),
      ),
    );
    expect(viewer.status).toBe(403);
  });
});

describe('POST /api/projects/:slug/translations', () => {
  it('creates a key with 201 and rejects a duplicate with 409', async () => {
    const slug = `workspace-create-${Date.now()}`;
    await setUpProject(slug);
    const token = await sessionToken('admin');

    const created = await createFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations`,
        authed(token, {
          method: 'POST',
          body: JSON.stringify({
            key: 'checkout.payment.title',
            values: { en: 'Payment', es: 'Pago' },
          }),
        }),
      ),
    );

    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.entry).toMatchObject({
      key: 'checkout.payment.title',
      translatedCount: 2,
      totalLocales: 3,
      complete: false,
    });

    const duplicate = await createFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations`,
        authed(token, {
          method: 'POST',
          body: JSON.stringify({
            key: 'checkout.payment.title',
            values: { en: 'Payment again' },
          }),
        }),
      ),
    );

    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe('TRANSLATION_KEY_EXISTS');
  });

  it('answers 400 without a source value', async () => {
    const slug = `workspace-create-invalid-${Date.now()}`;
    await setUpProject(slug);

    const response = await createFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations`,
        authed(await sessionToken('admin'), {
          method: 'POST',
          body: JSON.stringify({
            key: 'checkout.title',
            values: { es: 'Pago' },
          }),
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(
      'TRANSLATION_VALIDATION_FAILED',
    );
  });
});

describe('a human translation edit needs no synchronization step', () => {
  it('is visible to the machine API and public delivery immediately', async () => {
    const slug = `workspace-crosssystem-${Date.now()}`;
    const { cms, project } = await setUpProject(slug, ['en']);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });
    const { secret } = await createProjectToken(cms, project, {
      name: 'CI',
      scopes: ['catalog:read'],
    });

    const workspace = await workspaceFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations`,
        authed(await sessionToken('admin')),
      ),
    );
    const revision = (await workspace.json()).workspace.catalogs.en.revision;

    const saved = await updateFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations`,
        authed(await sessionToken('admin'), {
          method: 'PATCH',
          body: JSON.stringify({
            key: 'nav.home',
            changes: [
              { locale: 'en', value: 'Start', expectedRevision: revision },
            ],
          }),
        }),
      ),
    );
    expect(saved.status).toBe(200);

    const machine = await machineCatalogFetch(
      new Request(`${ORIGIN}/api/machine/v1/catalogs/en`, {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect((await machine.json()).data.content).toEqual({
      nav: { home: 'Start' },
    });

    const delivered = await getPublicCatalog(cms, slug, 'en');
    expect(delivered?.content).toEqual({ nav: { home: 'Start' } });
  });
});
