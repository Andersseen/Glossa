import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike,
} from '@modelcontextprotocol/client';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { createApp, toWebHandler, type EventHandler } from 'h3';

import { getCmsRuntime, getPasswordAuthAdapter } from '../cms/runtime';
import mcpHandler from '../mcp/route-handler';
import machineProjectHandler from '../routes/api/machine/v1/project.get';
import deleteHandler from '../routes/api/projects/[slug].delete';
import getProjectHandler from '../routes/api/projects/[slug].get';
import patchHandler from '../routes/api/projects/[slug].patch';
import deletionImpactHandler from '../routes/api/projects/[slug]/deletion-impact.get';
import sourcePreviewHandler from '../routes/api/projects/[slug]/source-locale-preview.get';
import analysisHandler from '../routes/api/projects/[slug]/translations/analysis.get';
import workspaceHandler from '../routes/api/projects/[slug]/translations/index.get';
import localeHandler from '../routes/i18n/[project]/[locale].json.get';
import manifestHandler from '../routes/i18n/[project]/manifest.json.get';
import { saveCatalog } from './catalog.service';
import { createProjectToken } from './project-token.service';
import {
  createProject,
  getProjectBySlug,
  ProjectNotFoundError,
} from './project.service';

// See translation-api.spec.ts for why these handlers are mounted in-process rather than served.
function webHandlerFor(handler: EventHandler) {
  const app = createApp();
  app.use(handler);
  return toWebHandler(app);
}

const patchFetch = webHandlerFor(patchHandler);
const deleteFetch = webHandlerFor(deleteHandler);
const getProjectFetch = webHandlerFor(getProjectHandler);
const impactFetch = webHandlerFor(deletionImpactHandler);
const previewFetch = webHandlerFor(sourcePreviewHandler);
const analysisFetch = webHandlerFor(analysisHandler);
const workspaceFetch = webHandlerFor(workspaceHandler);
const machineProjectFetch = webHandlerFor(machineProjectHandler);
const manifestFetch = webHandlerFor(manifestHandler);
const localeFetch = webHandlerFor(localeHandler);

const ORIGIN = 'https://glossa.test';

type Role = 'admin' | 'editor' | 'viewer';

let stamp = 0;

async function sessionToken(role: Role): Promise<string> {
  const cms = await getCmsRuntime();
  const auth = getPasswordAuthAdapter(cms);
  const email = `${role}-${(stamp += 1)}-${Math.random().toString(36).slice(2)}@example.com`;
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

function authed(token?: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  };
}

function patch(slug: string, body: unknown, token?: string): Promise<Response> {
  return patchFetch(
    new Request(
      `${ORIGIN}/api/projects/${slug}`,
      authed(token, { method: 'PATCH', body: JSON.stringify(body) }),
    ),
  );
}

function del(slug: string, token?: string): Promise<Response> {
  return deleteFetch(
    new Request(
      `${ORIGIN}/api/projects/${slug}`,
      authed(token, { method: 'DELETE' }),
    ),
  );
}

let projectCount = 0;

async function setUpProject(
  options: { locales?: string[]; publicDelivery?: boolean } = {},
) {
  const cms = await getCmsRuntime();
  const slug = `lifecycle-${(projectCount += 1)}-${Date.now()}`;
  const project = await createProject(cms, {
    name: 'My Blog',
    slug,
    sourceLocale: 'en',
    locales: options.locales ?? ['en', 'es'],
    publicDelivery: options.publicDelivery ?? true,
  });

  return { cms, project, slug };
}

// The first user created in a fresh runtime always becomes an admin regardless of the requested
// role (see auth.integration.spec.ts), so create one up front so every later role is honoured.
beforeAll(async () => {
  await sessionToken('admin');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The purged URLs' paths — h3 derives the origin from the Host header, which an in-process `Request` does not carry. */
function purgedPaths(cacheDelete: { mock: { calls: unknown[][] } }): string[] {
  return cacheDelete.mock.calls.map(([url]) => new URL(String(url)).pathname);
}

function mcpFetchFor(): FetchLike {
  const webHandler = webHandlerFor(mcpHandler);

  return (async (input, init) =>
    webHandler(new Request(input as string | URL, init))) as FetchLike;
}

async function connectMcp(secret: string): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
      fetch: mcpFetchFor(),
      authProvider: { token: async () => secret },
    }),
  );
  return client;
}

function textOf(result: CallToolResult): Record<string, unknown> {
  const [first] = result.content;

  if (!first || first.type !== 'text') {
    throw new Error('Expected a text content block.');
  }

  return JSON.parse(first.text) as Record<string, unknown>;
}

describe('PATCH /api/projects/:slug — settings', () => {
  it('lets an admin and an editor edit the name, source locale and locales', async () => {
    for (const role of ['admin', 'editor'] as const) {
      const { slug } = await setUpProject();

      const response = await patch(
        slug,
        { name: 'Renamed', sourceLocale: 'es', locales: ['en', 'es', 'uk'] },
        await sessionToken(role),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).project).toMatchObject({
        name: 'Renamed',
        sourceLocale: 'es',
        locales: ['en', 'es', 'uk'],
      });
    }
  });

  it('refuses a viewer, an unauthenticated caller and a machine token', async () => {
    const { cms, project, slug } = await setUpProject();
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:read', 'catalog:write'],
    });

    expect(
      (await patch(slug, { name: 'X' }, await sessionToken('viewer'))).status,
    ).toBe(403);
    expect((await patch(slug, { name: 'X' })).status).toBe(401);
    expect((await patch(slug, { name: 'X' }, secret)).status).toBe(401);
    await expect(getProjectBySlug(cms, slug)).resolves.toMatchObject({
      name: 'My Blog',
    });
  });

  it('rejects a source locale with no catalog while other catalogs exist, with a stable code', async () => {
    const { cms, slug } = await setUpProject({ locales: ['en', 'es', 'uk'] });
    await saveCatalog(cms, slug, 'en', { a: 'A' });

    const response = await patch(
      slug,
      { sourceLocale: 'uk' },
      await sessionToken('admin'),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toEqual({
      code: 'PROJECT_SOURCE_CATALOG_REQUIRED',
      message:
        'The source locale cannot be changed to "uk" because that locale has no catalog.',
    });
  });

  it('keeps refusing to remove a locale that has a catalog', async () => {
    const { cms, slug } = await setUpProject();
    await saveCatalog(cms, slug, 'es', { a: 'a' });

    const response = await patch(
      slug,
      { locales: ['en'] },
      await sessionToken('admin'),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('PROJECT_LOCALE_CONFLICT');
  });

  it('rejects a source locale that is not configured with a validation error', async () => {
    const { slug } = await setUpProject();

    const response = await patch(
      slug,
      { sourceLocale: 'fr' },
      await sessionToken('admin'),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(
      'PROJECT_VALIDATION_FAILED',
    );
  });

  it('purges the delivery manifest and locale URLs from the edge cache after a source change', async () => {
    const { slug } = await setUpProject();
    const cacheDelete = vi.fn(async () => true);
    vi.stubGlobal('caches', {
      default: {
        match: async () => undefined,
        put: async () => {},
        delete: cacheDelete,
      },
    });

    const response = await patch(
      slug,
      { sourceLocale: 'es' },
      await sessionToken('admin'),
    );

    expect(response.status).toBe(200);
    expect(purgedPaths(cacheDelete)).toEqual([
      `/i18n/${slug}/manifest.json`,
      `/i18n/${slug}/en.json`,
      `/i18n/${slug}/es.json`,
    ]);
  });
});

describe('a source locale change is reflected on every surface, with no sync step', () => {
  it('moves the workspace, analysis, machine manifest, MCP and public manifest to the new source', async () => {
    const { cms, project, slug } = await setUpProject();
    await saveCatalog(cms, slug, 'en', { a: 'A', b: 'B' });
    await saveCatalog(cms, slug, 'es', { a: 'a', c: 'c' });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:read'],
    });
    const admin = await sessionToken('admin');
    const url = (path: string) => `${ORIGIN}/api/projects/${slug}${path}`;
    const machineUrl = `${ORIGIN}/api/machine/v1/project`;
    const publicManifest = `${ORIGIN}/i18n/${slug}/manifest.json`;

    const workspaceBefore = (
      await (
        await workspaceFetch(new Request(url('/translations'), authed(admin)))
      ).json()
    ).workspace;
    expect(workspaceBefore.entries.map((e: { key: string }) => e.key)).toEqual([
      'a',
      'b',
    ]);

    const changed = await patch(slug, { sourceLocale: 'es' }, admin);
    expect(changed.status).toBe(200);

    const workspace = (
      await (
        await workspaceFetch(new Request(url('/translations'), authed(admin)))
      ).json()
    ).workspace;
    expect(workspace.project.sourceLocale).toBe('es');
    expect(workspace.entries.map((e: { key: string }) => e.key)).toEqual([
      'a',
      'c',
    ]);

    const analysis = await (
      await analysisFetch(
        new Request(url('/translations/analysis'), authed(admin)),
      )
    ).json();
    expect(analysis.analysis.sourceLocale).toBe('es');
    expect(analysis.analysis.sourceKeys).toBe(2);

    const machine = await (
      await machineProjectFetch(new Request(machineUrl, authed(secret)))
    ).json();
    expect(machine.data.project.sourceLocale).toBe('es');

    const client = await connectMcp(secret);
    const mcpProject = textOf(
      (await client.callTool({ name: 'get_project' })) as CallToolResult,
    );
    expect(mcpProject['sourceLocale']).toBe('es');
    await client.close();

    const manifest = await (
      await manifestFetch(new Request(publicManifest))
    ).json();
    expect(manifest.project.sourceLocale).toBe('es');

    // Catalog content is exactly what it was before the change.
    const en = await (
      await localeFetch(new Request(`${ORIGIN}/i18n/${slug}/en.json`))
    ).json();
    expect(en).toEqual({ a: 'A', b: 'B' });
  });
});

describe('GET /api/projects/:slug/source-locale-preview', () => {
  it('returns the structural impact to an admin, editor and viewer', async () => {
    const { cms, slug } = await setUpProject();
    await saveCatalog(cms, slug, 'en', { a: 'A', b: 'B' });
    await saveCatalog(cms, slug, 'es', { a: 'a' });

    for (const role of ['admin', 'editor', 'viewer'] as const) {
      const response = await previewFetch(
        new Request(
          `${ORIGIN}/api/projects/${slug}/source-locale-preview?locale=es`,
          authed(await sessionToken(role)),
        ),
      );

      expect(response.status).toBe(200);
      expect((await response.json()).preview).toMatchObject({
        currentSourceLocale: 'en',
        nextSourceLocale: 'es',
        removedCanonicalKeys: ['b'],
        addedCanonicalKeys: [],
        canChange: true,
      });
    }
  });

  it('does not write anything', async () => {
    const { cms, slug } = await setUpProject();
    await saveCatalog(cms, slug, 'en', { a: 'A' });

    await previewFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/source-locale-preview?locale=es`,
        authed(await sessionToken('admin')),
      ),
    );

    await expect(getProjectBySlug(cms, slug)).resolves.toMatchObject({
      sourceLocale: 'en',
    });
  });

  it('rejects an unauthenticated caller, a machine token, and a locale that is not configured', async () => {
    const { cms, project, slug } = await setUpProject();
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:read'],
    });
    const path = `${ORIGIN}/api/projects/${slug}/source-locale-preview`;

    expect((await previewFetch(new Request(`${path}?locale=es`))).status).toBe(
      401,
    );
    expect(
      (await previewFetch(new Request(`${path}?locale=es`, authed(secret))))
        .status,
    ).toBe(401);
    expect(
      (
        await previewFetch(
          new Request(`${path}?locale=fr`, authed(await sessionToken('admin'))),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await previewFetch(
          new Request(path, authed(await sessionToken('admin'))),
        )
      ).status,
    ).toBe(400);
  });
});

describe('GET /api/projects/:slug/deletion-impact', () => {
  it('shows an admin the counts, without a secret', async () => {
    const { cms, project, slug } = await setUpProject();
    await saveCatalog(cms, slug, 'en', { a: 'A' });
    const { secret } = await createProjectToken(cms, project, {
      name: 'CI',
      scopes: ['catalog:read'],
    });

    const response = await impactFetch(
      new Request(
        `${ORIGIN}/api/projects/${slug}/deletion-impact`,
        authed(await sessionToken('admin')),
      ),
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text).impact).toMatchObject({
      catalogs: 1,
      catalogLocales: ['en'],
      accessTokens: { total: 1, active: 1 },
      publicDelivery: true,
    });
    expect(text).not.toContain(secret);
  });

  it('is admin-only', async () => {
    const { slug } = await setUpProject();
    const url = `${ORIGIN}/api/projects/${slug}/deletion-impact`;

    for (const role of ['editor', 'viewer'] as const) {
      expect(
        (await impactFetch(new Request(url, authed(await sessionToken(role)))))
          .status,
      ).toBe(403);
    }
    expect((await impactFetch(new Request(url))).status).toBe(401);
  });
});

describe('DELETE /api/projects/:slug', () => {
  it('lets an admin delete a project with catalogs, reporting counts and no content', async () => {
    const { cms, project, slug } = await setUpProject();
    await saveCatalog(cms, slug, 'en', { secretish: 'Contents stay private' });
    await saveCatalog(cms, slug, 'es', { a: 'a' });
    await createProjectToken(cms, project, {
      name: 'CI',
      scopes: ['catalog:read'],
    });

    const response = await del(slug, await sessionToken('admin'));

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      deleted: true,
      project: { id: project.id, slug, name: 'My Blog' },
      deletedCatalogs: 2,
      revokedTokens: 1,
    });
    expect(text).not.toContain('Contents stay private');
    await expect(getProjectBySlug(cms, slug)).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    );
    await expect(
      cms.count({ collection: 'catalogs', where: { project: project.id } }),
    ).resolves.toBe(0);
  });

  it('refuses an editor, a viewer, an unauthenticated caller and a machine token — and deletes nothing', async () => {
    const { cms, project, slug } = await setUpProject();
    await saveCatalog(cms, slug, 'en', { a: 'A' });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:read', 'catalog:write'],
    });

    expect((await del(slug, await sessionToken('editor'))).status).toBe(403);
    expect((await del(slug, await sessionToken('viewer'))).status).toBe(403);
    expect((await del(slug)).status).toBe(401);
    expect((await del(slug, secret)).status).toBe(401);

    await expect(getProjectBySlug(cms, slug)).resolves.toMatchObject({ slug });
    await expect(
      cms.count({ collection: 'catalogs', where: { project: project.id } }),
    ).resolves.toBe(1);
  });

  it('returns 404 for an unknown project', async () => {
    const response = await del('does-not-exist', await sessionToken('admin'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('stops public delivery immediately: the locale URL and manifest go from 200 to 404', async () => {
    const { cms, slug } = await setUpProject();
    await saveCatalog(cms, slug, 'en', { a: 'A' });
    const localeUrl = `${ORIGIN}/i18n/${slug}/en.json`;
    const manifestUrl = `${ORIGIN}/i18n/${slug}/manifest.json`;

    expect((await localeFetch(new Request(localeUrl))).status).toBe(200);
    expect((await manifestFetch(new Request(manifestUrl))).status).toBe(200);

    expect((await del(slug, await sessionToken('admin'))).status).toBe(200);

    expect((await localeFetch(new Request(localeUrl))).status).toBe(404);
    expect((await manifestFetch(new Request(manifestUrl))).status).toBe(404);
  });

  it('explicitly purges the deleted project’s manifest and locale URLs from the edge cache', async () => {
    const { cms, slug } = await setUpProject();
    await saveCatalog(cms, slug, 'en', { a: 'A' });
    const cacheDelete = vi.fn(async () => true);
    vi.stubGlobal('caches', {
      default: {
        match: async () => undefined,
        put: async () => {},
        delete: cacheDelete,
      },
    });

    expect((await del(slug, await sessionToken('admin'))).status).toBe(200);

    expect(purgedPaths(cacheDelete)).toEqual([
      `/i18n/${slug}/manifest.json`,
      `/i18n/${slug}/en.json`,
      `/i18n/${slug}/es.json`,
    ]);
  });

  it('does not purge, and deletes nothing, when the caller is not allowed to delete', async () => {
    const { slug } = await setUpProject();
    const cacheDelete = vi.fn(async () => true);
    vi.stubGlobal('caches', {
      default: {
        match: async () => undefined,
        put: async () => {},
        delete: cacheDelete,
      },
    });

    expect((await del(slug, await sessionToken('editor'))).status).toBe(403);

    expect(cacheDelete).not.toHaveBeenCalled();
  });

  it('makes the project’s access tokens unusable on the machine API and MCP, and the human route 404', async () => {
    const { cms, project, slug } = await setUpProject();
    await saveCatalog(cms, slug, 'en', { a: 'A' });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:read', 'catalog:write'],
    });
    const machineUrl = `${ORIGIN}/api/machine/v1/project`;
    const admin = await sessionToken('admin');

    expect(
      (await machineProjectFetch(new Request(machineUrl, authed(secret))))
        .status,
    ).toBe(200);
    await (await connectMcp(secret)).close();

    expect((await del(slug, admin)).status).toBe(200);

    expect(
      (await machineProjectFetch(new Request(machineUrl, authed(secret))))
        .status,
    ).toBe(401);
    await expect(connectMcp(secret)).rejects.toBeTruthy();
    expect(
      (
        await getProjectFetch(
          new Request(`${ORIGIN}/api/projects/${slug}`, authed(admin)),
        )
      ).status,
    ).toBe(404);
  });

  it('leaves other projects, their catalogs and their tokens working', async () => {
    const doomed = await setUpProject();
    const keeper = await setUpProject();
    await saveCatalog(keeper.cms, keeper.slug, 'en', { k: 'K' });
    const { secret } = await createProjectToken(keeper.cms, keeper.project, {
      name: 'Keeper',
      scopes: ['catalog:read'],
    });

    expect((await del(doomed.slug, await sessionToken('admin'))).status).toBe(
      200,
    );

    expect(
      (
        await machineProjectFetch(
          new Request(`${ORIGIN}/api/machine/v1/project`, authed(secret)),
        )
      ).status,
    ).toBe(200);
    expect(
      await (
        await localeFetch(new Request(`${ORIGIN}/i18n/${keeper.slug}/en.json`))
      ).json(),
    ).toEqual({ k: 'K' });
  });

  it('reports a part-way failure as PROJECT_DELETE_INCOMPLETE, keeps the project, and still purges', async () => {
    const { cms, slug } = await setUpProject();
    await saveCatalog(cms, slug, 'en', { a: 'A' });
    await saveCatalog(cms, slug, 'es', { a: 'a' });
    const admin = await sessionToken('admin');
    const cacheDelete = vi.fn(async () => true);
    vi.stubGlobal('caches', {
      default: {
        match: async () => undefined,
        put: async () => {},
        delete: cacheDelete,
      },
    });

    const realDelete = cms.delete.bind(cms);
    let catalogDeletes = 0;
    vi.spyOn(cms, 'delete').mockImplementation(((
      args: Parameters<typeof cms.delete>[0],
    ) => {
      if (args.collection === 'catalogs' && (catalogDeletes += 1) === 2) {
        return Promise.reject(new Error('database unavailable'));
      }

      return realDelete(args);
    }) as typeof cms.delete);

    const response = await del(slug, admin);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe('PROJECT_DELETE_INCOMPLETE');
    expect(body.error.message).not.toContain('database unavailable');
    await expect(getProjectBySlug(cms, slug)).resolves.toMatchObject({ slug });
    expect(cacheDelete).toHaveBeenCalled();
  });
});
