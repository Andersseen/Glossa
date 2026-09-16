import { createApp, toWebHandler, type EventHandler } from 'h3';

import { getCmsRuntime, getPasswordAuthAdapter } from '../cms/runtime';
import { getPublicCatalog } from '../delivery/delivery.service';
import { getCatalog, saveCatalog } from './catalog.service';
import { createProjectToken } from './project-token.service';
import { createProject } from './project.service';
import machineCatalogHandler from '../routes/api/machine/v1/catalogs/[locale].get';
import deleteHandler from '../routes/api/projects/[slug]/translations/delete.post';
import renameHandler from '../routes/api/projects/[slug]/translations/rename.post';

// See translation-api.spec.ts for why these handlers live outside `src/server/routes/`.
function webHandlerFor(handler: EventHandler) {
  const app = createApp();
  app.use(handler);
  return toWebHandler(app);
}

const renameFetch = webHandlerFor(renameHandler);
const deleteFetch = webHandlerFor(deleteHandler);
const machineCatalogFetch = webHandlerFor(machineCatalogHandler);

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

async function revisionsOf(
  cms: Awaited<ReturnType<typeof getCmsRuntime>>,
  slug: string,
  locales: string[],
): Promise<Record<string, string>> {
  const revisions: Record<string, string> = {};

  for (const locale of locales) {
    try {
      revisions[locale] = (await getCatalog(cms, slug, locale)).revision;
    } catch {
      // No catalog yet for this locale — no revision to carry.
    }
  }

  return revisions;
}

describe('POST /api/projects/:slug/translations/rename', () => {
  it('renames the key for an admin and an editor', async () => {
    const slug = `lifecycle-rename-${Date.now()}`;
    const { cms } = await setUpProject(slug, ['en']);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });

    const response = await renameFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations/rename`,
        authed(await sessionToken('editor'), {
          method: 'POST',
          body: JSON.stringify({
            key: 'nav.home',
            newKey: 'navigation.home',
            expectedRevisions: await revisionsOf(cms, slug, ['en']),
          }),
        }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toBe(true);
    expect(body.operation).toBe('rename');
    expect(body.newKey).toBe('navigation.home');
    expect((await getCatalog(cms, slug, 'en')).content).toEqual({
      navigation: { home: 'Home' },
    });
  });

  it('rejects a viewer with 403 and an unauthenticated request with 401', async () => {
    const slug = `lifecycle-rename-auth-${Date.now()}`;
    const { cms } = await setUpProject(slug, ['en']);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });
    const body = JSON.stringify({
      key: 'nav.home',
      newKey: 'navigation.home',
      expectedRevisions: await revisionsOf(cms, slug, ['en']),
    });

    const viewer = await renameFetch(
      new Request(`${ORIGIN}/api/projects/${slug}/translations/rename`, {
        ...authed(await sessionToken('viewer'), { method: 'POST', body }),
      }),
    );
    expect(viewer.status).toBe(403);

    const anon = await renameFetch(
      new Request(`${ORIGIN}/api/projects/${slug}/translations/rename`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );
    expect(anon.status).toBe(401);
  });

  it('rejects a machine project access token', async () => {
    const slug = `lifecycle-rename-machine-${Date.now()}`;
    const { cms, project } = await setUpProject(slug, ['en']);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:read', 'catalog:write'],
    });

    const response = await renameFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations/rename`,
        authed(secret, {
          method: 'POST',
          body: JSON.stringify({
            key: 'nav.home',
            newKey: 'navigation.home',
            expectedRevisions: await revisionsOf(cms, slug, ['en']),
          }),
        }),
      ),
    );

    expect(response.status).toBe(401);
  });

  it('answers 400 for an unsafe new key', async () => {
    const slug = `lifecycle-rename-unsafe-${Date.now()}`;
    const { cms } = await setUpProject(slug, ['en']);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });

    const response = await renameFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations/rename`,
        authed(await sessionToken('admin'), {
          method: 'POST',
          body: JSON.stringify({
            key: 'nav.home',
            newKey: '__proto__.polluted',
            expectedRevisions: await revisionsOf(cms, slug, ['en']),
          }),
        }),
      ),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_TRANSLATION_KEY');
  });

  it('answers 404 when the source key does not exist', async () => {
    const slug = `lifecycle-rename-missing-${Date.now()}`;
    const { cms } = await setUpProject(slug, ['en']);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });

    const response = await renameFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations/rename`,
        authed(await sessionToken('admin'), {
          method: 'POST',
          body: JSON.stringify({
            key: 'nav.missing',
            newKey: 'nav.renamed',
            expectedRevisions: await revisionsOf(cms, slug, ['en']),
          }),
        }),
      ),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('TRANSLATION_NOT_FOUND');
  });

  it('answers 409 and changes nothing when the new key already collides', async () => {
    const slug = `lifecycle-rename-collision-${Date.now()}`;
    const { cms } = await setUpProject(slug, ['en', 'es']);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, slug, 'es', { navigation: { home: 'Existente' } });

    const response = await renameFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations/rename`,
        authed(await sessionToken('admin'), {
          method: 'POST',
          body: JSON.stringify({
            key: 'nav.home',
            newKey: 'navigation.home',
            expectedRevisions: await revisionsOf(cms, slug, ['en', 'es']),
          }),
        }),
      ),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe(
      'TRANSLATION_KEY_COLLISION',
    );
    expect((await getCatalog(cms, slug, 'en')).content).toEqual({
      nav: { home: 'Home' },
    });
  });

  it('answers 409 with no writes when a locale revision is stale', async () => {
    const slug = `lifecycle-rename-conflict-${Date.now()}`;
    const { cms } = await setUpProject(slug, ['en', 'es']);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });
    await saveCatalog(cms, slug, 'es', { nav: { home: 'Inicio' } });
    const stale = await revisionsOf(cms, slug, ['en', 'es']);

    // A concurrent human/MCP edit changes `es` after the caller "loaded" its revision above.
    await saveCatalog(cms, slug, 'es', { nav: { home: 'Casa' } });

    const response = await renameFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations/rename`,
        authed(await sessionToken('admin'), {
          method: 'POST',
          body: JSON.stringify({
            key: 'nav.home',
            newKey: 'navigation.home',
            expectedRevisions: stale,
          }),
        }),
      ),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('CATALOG_REVISION_CONFLICT');
    expect((await getCatalog(cms, slug, 'en')).content).toEqual({
      nav: { home: 'Home' },
    });
    expect((await getCatalog(cms, slug, 'es')).content).toEqual({
      nav: { home: 'Casa' },
    });
  });

  it('keeps projects isolated: a manipulated slug cannot rename another project', async () => {
    const stamp = Date.now();
    const { cms } = await setUpProject(`lifecycle-a-${stamp}`, ['en']);
    await setUpProject(`lifecycle-b-${stamp}`, ['en']);
    await saveCatalog(cms, `lifecycle-a-${stamp}`, 'en', {
      nav: { home: 'Home' },
    });

    const response = await renameFetch(
      new Request(
        `${ORIGIN}/api/projects/lifecycle-b-${stamp}/translations/rename`,
        authed(await sessionToken('admin'), {
          method: 'POST',
          body: JSON.stringify({
            key: 'nav.home',
            newKey: 'navigation.home',
            expectedRevisions: {},
          }),
        }),
      ),
    );

    expect(response.status).toBe(404);
    expect(
      (await getCatalog(cms, `lifecycle-a-${stamp}`, 'en')).content,
    ).toEqual({ nav: { home: 'Home' } });
  });
});

describe('POST /api/projects/:slug/translations/delete', () => {
  it('deletes the key for an admin', async () => {
    const slug = `lifecycle-delete-${Date.now()}`;
    const { cms } = await setUpProject(slug, ['en']);
    await saveCatalog(cms, slug, 'en', {
      nav: { home: 'Home', docs: 'Docs' },
    });

    const response = await deleteFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations/delete`,
        authed(await sessionToken('admin'), {
          method: 'POST',
          body: JSON.stringify({
            key: 'nav.home',
            expectedRevisions: await revisionsOf(cms, slug, ['en']),
          }),
        }),
      ),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.saved).toBe(true);
    expect(body.operation).toBe('delete');
    expect((await getCatalog(cms, slug, 'en')).content).toEqual({
      nav: { docs: 'Docs' },
    });
  });

  it('rejects a viewer with 403', async () => {
    const slug = `lifecycle-delete-viewer-${Date.now()}`;
    const { cms } = await setUpProject(slug, ['en']);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });

    const response = await deleteFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations/delete`,
        authed(await sessionToken('viewer'), {
          method: 'POST',
          body: JSON.stringify({
            key: 'nav.home',
            expectedRevisions: await revisionsOf(cms, slug, ['en']),
          }),
        }),
      ),
    );

    expect(response.status).toBe(403);
  });

  it('answers 404 when the key does not exist in the source locale', async () => {
    const slug = `lifecycle-delete-missing-${Date.now()}`;
    const { cms } = await setUpProject(slug, ['en']);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });

    const response = await deleteFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations/delete`,
        authed(await sessionToken('admin'), {
          method: 'POST',
          body: JSON.stringify({
            key: 'nav.missing',
            expectedRevisions: await revisionsOf(cms, slug, ['en']),
          }),
        }),
      ),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('TRANSLATION_NOT_FOUND');
  });
});

describe('translation lifecycle writes need no synchronization step', () => {
  it('a rename is immediately visible to the machine API and public delivery', async () => {
    const slug = `lifecycle-crosssystem-rename-${Date.now()}`;
    const { cms, project } = await setUpProject(slug, ['en']);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });
    const { secret } = await createProjectToken(cms, project, {
      name: 'CI',
      scopes: ['catalog:read'],
    });

    const response = await renameFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations/rename`,
        authed(await sessionToken('admin'), {
          method: 'POST',
          body: JSON.stringify({
            key: 'nav.home',
            newKey: 'navigation.home',
            expectedRevisions: await revisionsOf(cms, slug, ['en']),
          }),
        }),
      ),
    );
    expect(response.status).toBe(200);

    const machine = await machineCatalogFetch(
      new Request(`${ORIGIN}/api/machine/v1/catalogs/en`, {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect((await machine.json()).data.content).toEqual({
      navigation: { home: 'Home' },
    });

    const delivered = await getPublicCatalog(cms, slug, 'en');
    expect(delivered?.content).toEqual({ navigation: { home: 'Home' } });
  });

  it('a delete is immediately absent from the machine API and public delivery', async () => {
    const slug = `lifecycle-crosssystem-delete-${Date.now()}`;
    const { cms, project } = await setUpProject(slug, ['en']);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });
    const { secret } = await createProjectToken(cms, project, {
      name: 'CI',
      scopes: ['catalog:read'],
    });

    const response = await deleteFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/translations/delete`,
        authed(await sessionToken('admin'), {
          method: 'POST',
          body: JSON.stringify({
            key: 'nav.home',
            expectedRevisions: await revisionsOf(cms, slug, ['en']),
          }),
        }),
      ),
    );
    expect(response.status).toBe(200);

    const machine = await machineCatalogFetch(
      new Request(`${ORIGIN}/api/machine/v1/catalogs/en`, {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect((await machine.json()).data.content).toEqual({});

    const delivered = await getPublicCatalog(cms, slug, 'en');
    expect(delivered?.content).toEqual({});
  });
});
