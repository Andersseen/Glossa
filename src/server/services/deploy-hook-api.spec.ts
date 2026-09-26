import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike,
} from '@modelcontextprotocol/client';
import { createApp, toWebHandler, type EventHandler } from 'h3';

import { getCmsRuntime, getPasswordAuthAdapter } from '../cms/runtime';
import mcpHandler from '../mcp/route-handler';
import machineCatalogPutHandler from '../routes/api/machine/v1/catalogs/[locale].put';
import machineProjectHandler from '../routes/api/machine/v1/project.get';
import projectDeleteHandler from '../routes/api/projects/[slug].delete';
import projectGetHandler from '../routes/api/projects/[slug].get';
import projectPatchHandler from '../routes/api/projects/[slug].patch';
import catalogDeleteHandler from '../routes/api/projects/[slug]/catalogs/[locale].delete';
import catalogPutHandler from '../routes/api/projects/[slug]/catalogs/[locale].put';
import importHandler from '../routes/api/projects/[slug]/catalogs/import.post';
import importPreviewHandler from '../routes/api/projects/[slug]/catalogs/import/preview.post';
import hookDeleteHandler from '../routes/api/projects/[slug]/deploy-hook/index.delete';
import hookGetHandler from '../routes/api/projects/[slug]/deploy-hook/index.get';
import hookPutHandler from '../routes/api/projects/[slug]/deploy-hook/index.put';
import hookTestHandler from '../routes/api/projects/[slug]/deploy-hook/test.post';
import tokenCreateHandler from '../routes/api/projects/[slug]/tokens/index.post';
import analysisHandler from '../routes/api/projects/[slug]/translations/analysis.get';
import translationDeleteHandler from '../routes/api/projects/[slug]/translations/delete.post';
import workspaceGetHandler from '../routes/api/projects/[slug]/translations/index.get';
import translationPatchHandler from '../routes/api/projects/[slug]/translations/index.patch';
import translationPostHandler from '../routes/api/projects/[slug]/translations/index.post';
import translationRenameHandler from '../routes/api/projects/[slug]/translations/rename.post';
import manifestHandler from '../routes/i18n/[project]/manifest.json.get';
import { getCatalog, saveCatalog } from './catalog.service';
import {
  configureProjectDeployHook,
  getProjectDeployHookView,
} from './deploy-hook.service';
import { createProjectToken } from './project-token.service';
import { createProject, getProjectBySlug } from './project.service';

/**
 * Route-level proof of the trigger matrix: every handler is mounted in-process (see
 * translation-api.spec.ts) with a Cloudflare-style `waitUntil` in its context, so the background
 * delivery can be awaited deterministically and `fetch` — the only outbound call — counted.
 */

const ORIGIN = 'https://glossa.test';
const SECRET = 'SUPER_SECRET_DEPLOY_HOOK_ABC123';
const HOOK_URL = `https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/${SECRET}`;

let pending: Promise<unknown>[] = [];

function waitUntilContext() {
  return {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  };
}

/** Awaits every background task the requests so far scheduled through `waitUntil`. */
async function settle(): Promise<number> {
  const tasks = pending;
  pending = [];
  await Promise.all(tasks);
  return tasks.length;
}

function mount(handler: EventHandler, withWaitUntil = true) {
  const app = createApp();
  app.use(handler);
  const web = toWebHandler(app);
  return (request: Request) =>
    web(request, withWaitUntil ? waitUntilContext() : undefined);
}

const routes = {
  hookGet: mount(hookGetHandler),
  hookPut: mount(hookPutHandler),
  hookDelete: mount(hookDeleteHandler),
  hookTest: mount(hookTestHandler),
  projectGet: mount(projectGetHandler),
  projectPatch: mount(projectPatchHandler),
  projectDelete: mount(projectDeleteHandler),
  translationPatch: mount(translationPatchHandler),
  translationPost: mount(translationPostHandler),
  translationRename: mount(translationRenameHandler),
  translationDelete: mount(translationDeleteHandler),
  workspaceGet: mount(workspaceGetHandler),
  analysis: mount(analysisHandler),
  catalogPut: mount(catalogPutHandler),
  catalogDelete: mount(catalogDeleteHandler),
  importCommit: mount(importHandler),
  importPreview: mount(importPreviewHandler),
  tokenCreate: mount(tokenCreateHandler),
  machinePut: mount(machineCatalogPutHandler),
  machineProject: mount(machineProjectHandler),
  manifest: mount(manifestHandler),
  mcp: mount(mcpHandler),
};

type Role = 'admin' | 'editor' | 'viewer';
let stamp = 0;

async function sessionToken(role: Role): Promise<string> {
  const auth = getPasswordAuthAdapter(await getCmsRuntime());
  const email = `hook-${role}-${(stamp += 1)}-${Math.random().toString(36).slice(2)}@example.com`;
  const created = await auth.createUser({
    email,
    password: 'correct-password',
    role,
  });
  const login = await auth.login(email, 'correct-password');

  if (!created.ok || !login.ok) {
    throw new Error(`Could not sign in the ${role} test user.`);
  }

  return login.token;
}

function request(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    token?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...init.headers,
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

let projectCount = 0;
let hookFetch: ReturnType<typeof vi.fn<typeof fetch>>;

async function setUpProject(
  options: {
    hook?: boolean;
    locales?: string[];
    publicDelivery?: boolean;
  } = {},
) {
  const cms = await getCmsRuntime();
  const slug = `hooks-${(projectCount += 1)}-${Date.now()}`;
  const locales = options.locales ?? ['es', 'en', 'uk'];
  const project = await createProject(cms, {
    name: 'My Blog',
    slug,
    sourceLocale: locales[0],
    locales,
    publicDelivery: options.publicDelivery ?? true,
  });

  if (options.hook ?? true) {
    await configureProjectDeployHook(cms, project, { url: HOOK_URL });
  }

  return { cms, project, slug };
}

async function seedCatalogs(slug: string, locales = ['es', 'en', 'uk']) {
  const cms = await getCmsRuntime();
  const values: Record<string, string> = {
    es: 'Inicio',
    en: 'Home',
    uk: 'Головна',
  };

  for (const locale of locales) {
    await saveCatalog(cms, slug, locale, {
      nav: { home: values[locale] ?? locale },
    });
  }
}

async function revisionsOf(slug: string, locales = ['es', 'en', 'uk']) {
  const cms = await getCmsRuntime();
  const revisions: Record<string, string> = {};

  for (const locale of locales) {
    revisions[locale] = (await getCatalog(cms, slug, locale)).revision;
  }

  return revisions;
}

async function machineToken(
  project: { id: string },
  scopes = ['catalog:read', 'catalog:write'],
) {
  const cms = await getCmsRuntime();
  const { secret } = await createProjectToken(cms, project as never, {
    name: 'Agent',
    scopes,
  });
  return secret;
}

async function connectMcp(secret: string): Promise<Client> {
  const client = new Client({ name: 'hook-test', version: '1.0.0' });
  const fetchLike = (async (input, init) =>
    routes.mcp(new Request(input as string | URL, init))) as FetchLike;

  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
      fetch: fetchLike,
      authProvider: { token: async () => secret },
    }),
  );
  return client;
}

// The first user in a fresh runtime always becomes admin (see auth.integration.spec.ts).
beforeAll(async () => {
  await sessionToken('admin');
});

beforeEach(() => {
  pending = [];
  hookFetch = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 200 }),
  );
  vi.stubGlobal('fetch', hookFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deploy-hook management API — authorization', () => {
  it('lets an admin configure, read, toggle, test and remove a hook', async () => {
    const { slug } = await setUpProject({ hook: false });
    const admin = await sessionToken('admin');
    const path = `/api/projects/${slug}/deploy-hook`;

    const initial = await routes.hookGet(request(path, { token: admin }));
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ deployHook: { configured: false } });

    const created = await routes.hookPut(
      request(path, {
        method: 'PUT',
        token: admin,
        body: { provider: 'cloudflare', url: HOOK_URL, enabled: true },
      }),
    );
    expect(created.status).toBe(200);
    expect((await created.json()).deployHook).toMatchObject({
      configured: true,
      enabled: true,
    });

    const disabled = await routes.hookPut(
      request(path, { method: 'PUT', token: admin, body: { enabled: false } }),
    );
    expect((await disabled.json()).deployHook).toMatchObject({
      enabled: false,
    });

    const tested = await routes.hookTest(
      request(`${path}/test`, { method: 'POST', token: admin }),
    );
    expect(tested.status).toBe(200);
    expect(await tested.json()).toMatchObject({
      success: true,
      statusCode: 200,
      attemptedAt: expect.any(String),
      deployHook: { lastStatusCode: 200 },
    });
    expect(hookFetch).toHaveBeenCalledTimes(1);

    const removed = await routes.hookDelete(
      request(path, { method: 'DELETE', token: admin }),
    );
    expect(await removed.json()).toEqual({
      removed: true,
      deployHook: { configured: false },
    });
    // Configuration itself never triggers a rebuild — only the explicit test did.
    expect(await settle()).toBe(0);
    expect(hookFetch).toHaveBeenCalledTimes(1);
  });

  it('refuses editors, viewers, anonymous callers and machine tokens on every route', async () => {
    const { project, slug } = await setUpProject();
    const path = `/api/projects/${slug}/deploy-hook`;
    const machine = await machineToken(project);
    const callers: [string | undefined, number][] = [
      [await sessionToken('editor'), 403],
      [await sessionToken('viewer'), 403],
      [undefined, 401],
      [machine, 401],
    ];

    for (const [token, status] of callers) {
      expect((await routes.hookGet(request(path, { token }))).status).toBe(
        status,
      );
      expect(
        (
          await routes.hookPut(
            request(path, { method: 'PUT', token, body: { enabled: false } }),
          )
        ).status,
      ).toBe(status);
      expect(
        (await routes.hookDelete(request(path, { method: 'DELETE', token })))
          .status,
      ).toBe(status);
      expect(
        (
          await routes.hookTest(
            request(`${path}/test`, { method: 'POST', token }),
          )
        ).status,
      ).toBe(status);
    }

    expect(hookFetch).not.toHaveBeenCalled();
    await expect(
      getProjectDeployHookView(await getCmsRuntime(), project),
    ).resolves.toMatchObject({ configured: true, enabled: true });
  });

  it('rejects an unsafe URL with a message that does not echo it', async () => {
    const { slug } = await setUpProject({ hook: false });
    const admin = await sessionToken('admin');
    const evil =
      'https://169.254.169.254/client/v4/pages/webhooks/deploy_hooks/EVIL_SENTINEL_123';

    const response = await routes.hookPut(
      request(`/api/projects/${slug}/deploy-hook`, {
        method: 'PUT',
        token: admin,
        body: { url: evil },
      }),
    );

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe('DEPLOY_HOOK_VALIDATION_FAILED');
    expect(text).not.toContain('EVIL_SENTINEL');
  });

  it('returns 404 when testing a project with no hook', async () => {
    const { slug } = await setUpProject({ hook: false });

    const response = await routes.hookTest(
      request(`/api/projects/${slug}/deploy-hook/test`, {
        method: 'POST',
        token: await sessionToken('admin'),
      }),
    );

    expect(response.status).toBe(404);
    expect(hookFetch).not.toHaveBeenCalled();
  });
});

describe('deploy-hook management API — project isolation', () => {
  it('takes the project only from the URL, never from the body', async () => {
    const cms = await getCmsRuntime();
    const a = await setUpProject({ hook: false });
    const b = await setUpProject({ hook: false });
    const admin = await sessionToken('admin');

    await routes.hookPut(
      request(`/api/projects/${a.slug}/deploy-hook`, {
        method: 'PUT',
        token: admin,
        body: { url: HOOK_URL, project: b.project.id, projectId: b.project.id },
      }),
    );

    await expect(
      getProjectDeployHookView(cms, a.project),
    ).resolves.toMatchObject({
      configured: true,
    });
    await expect(getProjectDeployHookView(cms, b.project)).resolves.toEqual({
      configured: false,
    });

    await routes.hookDelete(
      request(`/api/projects/${b.slug}/deploy-hook`, {
        method: 'DELETE',
        token: admin,
      }),
    );
    await expect(
      getProjectDeployHookView(cms, a.project),
    ).resolves.toMatchObject({
      configured: true,
    });
  });
});

describe('deploy-hook secret never leaks', () => {
  it('keeps the stored URL out of every API, delivery and MCP response', async () => {
    const { project, slug } = await setUpProject({ publicDelivery: true });
    await seedCatalogs(slug);
    const admin = await sessionToken('admin');
    const machine = await machineToken(project);
    const bodies: string[] = [];

    bodies.push(
      await (
        await routes.hookGet(
          request(`/api/projects/${slug}/deploy-hook`, { token: admin }),
        )
      ).text(),
    );
    bodies.push(
      await (
        await routes.hookPut(
          request(`/api/projects/${slug}/deploy-hook`, {
            method: 'PUT',
            token: admin,
            body: { enabled: true },
          }),
        )
      ).text(),
    );
    bodies.push(
      await (
        await routes.hookTest(
          request(`/api/projects/${slug}/deploy-hook/test`, {
            method: 'POST',
            token: admin,
          }),
        )
      ).text(),
    );
    hookFetch.mockImplementationOnce(
      async () => new Response(`echo ${SECRET}`, { status: 500 }),
    );
    bodies.push(
      await (
        await routes.hookTest(
          request(`/api/projects/${slug}/deploy-hook/test`, {
            method: 'POST',
            token: admin,
          }),
        )
      ).text(),
    );
    bodies.push(
      await (
        await routes.hookPut(
          request(`/api/projects/${slug}/deploy-hook`, {
            method: 'PUT',
            token: admin,
            body: { enabled: 'yes' },
          }),
        )
      ).text(),
    );
    bodies.push(
      await (
        await routes.projectGet(
          request(`/api/projects/${slug}`, { token: admin }),
        )
      ).text(),
    );
    bodies.push(
      await (
        await routes.workspaceGet(
          request(`/api/projects/${slug}/translations`, { token: admin }),
        )
      ).text(),
    );
    bodies.push(
      await (
        await routes.manifest(request(`/i18n/${slug}/manifest.json`))
      ).text(),
    );
    bodies.push(
      await (
        await routes.machineProject(
          request('/api/machine/v1/project', { token: machine }),
        )
      ).text(),
    );

    const client = await connectMcp(machine);
    try {
      for (const name of [
        'get_project',
        'get_delivery_urls',
        'list_catalogs',
      ]) {
        bodies.push(
          JSON.stringify(await client.callTool({ name, arguments: {} })),
        );
      }
    } finally {
      await client.close();
    }

    for (const body of bodies) {
      expect(body).not.toContain(SECRET);
      expect(body).not.toContain('SUPER_SECRET');
      expect(body).not.toContain('deploy_hooks/SUPER');
    }
    expect(bodies[0]).toContain('••••••C123');
  });
});

describe('automatic trigger — exactly one per successful logical operation', () => {
  it('human edit of two locales in one save → one delivery', async () => {
    const { slug } = await setUpProject();
    await seedCatalogs(slug);
    const revisions = await revisionsOf(slug);

    const response = await routes.translationPatch(
      request(`/api/projects/${slug}/translations`, {
        method: 'PATCH',
        token: await sessionToken('editor'),
        body: {
          key: 'nav.home',
          changes: [
            {
              locale: 'es',
              value: 'Portada',
              expectedRevision: revisions['es'],
            },
            { locale: 'uk', value: 'Дім', expectedRevision: revisions['uk'] },
          ],
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await settle()).toBe(1);
    expect(hookFetch).toHaveBeenCalledTimes(1);
    expect(hookFetch.mock.calls[0]?.[0]).toBe(HOOK_URL);
    expect(hookFetch.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });

  it('human create across locales → one delivery', async () => {
    const { slug } = await setUpProject();
    await seedCatalogs(slug);

    const response = await routes.translationPost(
      request(`/api/projects/${slug}/translations`, {
        method: 'POST',
        token: await sessionToken('admin'),
        body: {
          key: 'nav.blog',
          values: { es: 'Blog', en: 'Blog', uk: 'Блог' },
          expectedRevisions: await revisionsOf(slug),
        },
      }),
    );

    expect(response.status).toBe(201);
    await settle();
    expect(hookFetch).toHaveBeenCalledTimes(1);
  });

  it('rename across three catalogs → one delivery', async () => {
    const { slug } = await setUpProject();
    await seedCatalogs(slug);

    const response = await routes.translationRename(
      request(`/api/projects/${slug}/translations/rename`, {
        method: 'POST',
        token: await sessionToken('editor'),
        body: {
          key: 'nav.home',
          newKey: 'navigation.home',
          expectedRevisions: await revisionsOf(slug),
        },
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).results).toHaveLength(3);
    await settle();
    expect(hookFetch).toHaveBeenCalledTimes(1);
  });

  it('delete key across three catalogs → one delivery', async () => {
    const { slug } = await setUpProject();
    await seedCatalogs(slug);

    const response = await routes.translationDelete(
      request(`/api/projects/${slug}/translations/delete`, {
        method: 'POST',
        token: await sessionToken('editor'),
        body: { key: 'nav.home', expectedRevisions: await revisionsOf(slug) },
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).results).toHaveLength(3);
    await settle();
    expect(hookFetch).toHaveBeenCalledTimes(1);
  });

  it('importing three catalogs → one delivery; preview → none', async () => {
    const { slug } = await setUpProject();
    const token = await sessionToken('editor');
    const body = {
      catalogs: [
        { locale: 'es', content: { nav: { home: 'Inicio' } } },
        { locale: 'en', content: { nav: { home: 'Home' } } },
        { locale: 'uk', content: { nav: { home: 'Головна' } } },
      ],
    };

    const preview = await routes.importPreview(
      request(`/api/projects/${slug}/catalogs/import/preview`, {
        method: 'POST',
        token,
        body,
      }),
    );
    expect(preview.status).toBe(200);
    expect(await settle()).toBe(0);
    expect(hookFetch).not.toHaveBeenCalled();

    const commit = await routes.importCommit(
      request(`/api/projects/${slug}/catalogs/import`, {
        method: 'POST',
        token,
        body,
      }),
    );
    expect(commit.status).toBe(200);
    expect((await commit.json()).imported).toBe(true);
    await settle();
    expect(hookFetch).toHaveBeenCalledTimes(1);
  });

  it('raw JSON catalog save → one delivery; catalog delete → one delivery', async () => {
    const { slug } = await setUpProject();
    const token = await sessionToken('editor');

    const saved = await routes.catalogPut(
      request(`/api/projects/${slug}/catalogs/en`, {
        method: 'PUT',
        token,
        body: { content: { nav: { home: 'Home' } } },
      }),
    );
    expect(saved.status).toBe(200);
    await settle();
    expect(hookFetch).toHaveBeenCalledTimes(1);

    const deleted = await routes.catalogDelete(
      request(`/api/projects/${slug}/catalogs/en`, { method: 'DELETE', token }),
    );
    expect(deleted.status).toBe(200);
    await settle();
    expect(hookFetch).toHaveBeenCalledTimes(2);
  });

  it('Machine API catalog PUT → one delivery', async () => {
    const { project, slug } = await setUpProject();
    await seedCatalogs(slug);
    const secret = await machineToken(project);
    const revisions = await revisionsOf(slug);

    const response = await routes.machinePut(
      request('/api/machine/v1/catalogs/en', {
        method: 'PUT',
        token: secret,
        headers: { 'if-match': `"${revisions['en']}"` },
        body: { content: { nav: { home: 'Start' } } },
      }),
    );

    expect(response.status).toBe(200);
    await settle();
    expect(hookFetch).toHaveBeenCalledTimes(1);
  });

  it('MCP set/rename/delete → one delivery each; read tools → none', async () => {
    const { project, slug } = await setUpProject();
    await seedCatalogs(slug);
    const client = await connectMcp(await machineToken(project));

    try {
      for (const name of [
        'get_project',
        'list_catalogs',
        'get_delivery_urls',
        'analyze_translations',
      ]) {
        await client.callTool({ name, arguments: {} });
      }
      await client.callTool({
        name: 'get_catalog',
        arguments: { locale: 'en' },
      });
      await client.callTool({
        name: 'get_translation',
        arguments: { locale: 'en', key: 'nav.home' },
      });
      await settle();
      expect(hookFetch).not.toHaveBeenCalled();

      const set = await client.callTool({
        name: 'set_translation',
        arguments: {
          locale: 'en',
          key: 'nav.home',
          value: 'Start',
          expectedRevision: (await revisionsOf(slug))['en'],
        },
      });
      expect(set.isError).toBeFalsy();
      await settle();
      expect(hookFetch).toHaveBeenCalledTimes(1);

      const rename = await client.callTool({
        name: 'rename_translation',
        arguments: {
          key: 'nav.home',
          newKey: 'navigation.home',
          expectedRevisions: await revisionsOf(slug),
        },
      });
      expect(rename.isError).toBeFalsy();
      await settle();
      expect(hookFetch).toHaveBeenCalledTimes(2);

      const remove = await client.callTool({
        name: 'delete_translation',
        arguments: {
          key: 'navigation.home',
          expectedRevisions: await revisionsOf(slug),
        },
      });
      expect(remove.isError).toBeFalsy();
      await settle();
      expect(hookFetch).toHaveBeenCalledTimes(3);
    } finally {
      await client.close();
    }
  });

  it('project settings: source-locale and locale changes trigger; name, delivery and tokens do not', async () => {
    const { slug } = await setUpProject({ locales: ['es', 'en'] });
    await seedCatalogs(slug, ['es', 'en']);
    const admin = await sessionToken('admin');
    const patchProject = (body: unknown) =>
      routes.projectPatch(
        request(`/api/projects/${slug}`, {
          method: 'PATCH',
          token: admin,
          body,
        }),
      );

    expect((await patchProject({ name: 'Renamed' })).status).toBe(200);
    expect((await patchProject({ publicDelivery: false })).status).toBe(200);
    expect((await patchProject({ publicDelivery: true })).status).toBe(200);
    expect(
      (
        await routes.tokenCreate(
          request(`/api/projects/${slug}/tokens`, {
            method: 'POST',
            token: admin,
            body: { name: 'CI', scopes: ['catalog:read'] },
          }),
        )
      ).status,
    ).toBe(201);
    await routes.analysis(
      request(`/api/projects/${slug}/translations/analysis`, { token: admin }),
    );
    await settle();
    expect(hookFetch).not.toHaveBeenCalled();

    expect((await patchProject({ sourceLocale: 'en' })).status).toBe(200);
    await settle();
    expect(hookFetch).toHaveBeenCalledTimes(1);

    expect((await patchProject({ locales: ['en', 'es', 'uk'] })).status).toBe(
      200,
    );
    await settle();
    expect(hookFetch).toHaveBeenCalledTimes(2);
  });

  it('never calls a disabled hook, or a project without one', async () => {
    const disabled = await setUpProject();
    await configureProjectDeployHook(await getCmsRuntime(), disabled.project, {
      enabled: false,
    });
    const none = await setUpProject({ hook: false });
    const token = await sessionToken('editor');

    for (const slug of [disabled.slug, none.slug]) {
      await routes.catalogPut(
        request(`/api/projects/${slug}/catalogs/en`, {
          method: 'PUT',
          token,
          body: { content: { nav: { home: 'Home' } } },
        }),
      );
    }

    await settle();
    expect(hookFetch).not.toHaveBeenCalled();
  });
});

describe('automatic trigger — failed mutations trigger nothing', () => {
  it('stale revision on a human edit → zero', async () => {
    const { slug } = await setUpProject();
    await seedCatalogs(slug);

    const response = await routes.translationPatch(
      request(`/api/projects/${slug}/translations`, {
        method: 'PATCH',
        token: await sessionToken('editor'),
        body: {
          key: 'nav.home',
          changes: [
            { locale: 'es', value: 'X', expectedRevision: 'stale' },
            {
              locale: 'en',
              value: 'Y',
              expectedRevision: (await revisionsOf(slug))['en'],
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(409);
    await settle();
    expect(hookFetch).not.toHaveBeenCalled();
  });

  it('rename collision and stale lifecycle revisions → zero', async () => {
    const { slug } = await setUpProject();
    await seedCatalogs(slug);
    const token = await sessionToken('editor');
    await saveCatalog(await getCmsRuntime(), slug, 'es', {
      nav: { home: 'Inicio', start: 'Comienzo' },
    });

    const collision = await routes.translationRename(
      request(`/api/projects/${slug}/translations/rename`, {
        method: 'POST',
        token,
        body: {
          key: 'nav.home',
          newKey: 'nav.start',
          expectedRevisions: await revisionsOf(slug),
        },
      }),
    );
    expect(collision.status).toBe(409);
    expect((await collision.json()).error.code).toBe(
      'TRANSLATION_KEY_COLLISION',
    );

    const stale = await routes.translationDelete(
      request(`/api/projects/${slug}/translations/delete`, {
        method: 'POST',
        token,
        body: { key: 'nav.home', expectedRevisions: { es: 'stale' } },
      }),
    );
    expect(stale.status).toBe(409);

    await settle();
    expect(hookFetch).not.toHaveBeenCalled();
  });

  it('Machine PUT revision conflict, invalid catalog and bad credentials → zero', async () => {
    const { project, slug } = await setUpProject();
    await seedCatalogs(slug);
    const secret = await machineToken(project);
    const readOnly = await machineToken(project, ['catalog:read']);

    const conflict = await routes.machinePut(
      request('/api/machine/v1/catalogs/en', {
        method: 'PUT',
        token: secret,
        headers: { 'if-match': '"stale"' },
        body: { content: { nav: { home: 'X' } } },
      }),
    );
    expect(conflict.status).toBe(412);
    expect((await conflict.json()).error.code).toBe(
      'CATALOG_REVISION_CONFLICT',
    );

    const invalid = await routes.machinePut(
      request('/api/machine/v1/catalogs/en', {
        method: 'PUT',
        token: secret,
        headers: { 'if-match': `"${(await revisionsOf(slug))['en']}"` },
        body: { content: { nav: { home: 42 } } },
      }),
    );
    expect(invalid.status).toBe(400);

    const unauthorized = await routes.machinePut(
      request('/api/machine/v1/catalogs/en', {
        method: 'PUT',
        token: 'glossa_nope_nope',
        body: { content: {} },
      }),
    );
    expect(unauthorized.status).toBe(401);

    const noScope = await routes.machinePut(
      request('/api/machine/v1/catalogs/en', {
        method: 'PUT',
        token: readOnly,
        body: { content: {} },
      }),
    );
    expect(noScope.status).toBe(403);

    await settle();
    expect(hookFetch).not.toHaveBeenCalled();
  });

  it('a human viewer or anonymous write, an invalid import, and an MCP conflict → zero', async () => {
    const { project, slug } = await setUpProject();
    await seedCatalogs(slug);

    const viewer = await routes.catalogPut(
      request(`/api/projects/${slug}/catalogs/en`, {
        method: 'PUT',
        token: await sessionToken('viewer'),
        body: { content: { a: 'b' } },
      }),
    );
    expect(viewer.status).toBe(403);

    const anonymous = await routes.translationPatch(
      request(`/api/projects/${slug}/translations`, {
        method: 'PATCH',
        body: { key: 'nav.home', changes: [{ locale: 'en', value: 'X' }] },
      }),
    );
    expect(anonymous.status).toBe(401);

    const badImport = await routes.importCommit(
      request(`/api/projects/${slug}/catalogs/import`, {
        method: 'POST',
        token: await sessionToken('editor'),
        body: {
          catalogs: [
            { locale: 'en', content: { nav: { home: 'Home' } } },
            { locale: 'zz', content: { nav: { home: 'Nope' } } },
          ],
        },
      }),
    );
    expect(badImport.status).toBe(422);

    const client = await connectMcp(await machineToken(project));
    try {
      const conflict = await client.callTool({
        name: 'set_translation',
        arguments: {
          locale: 'en',
          key: 'nav.home',
          value: 'X',
          expectedRevision: 'stale',
        },
      });
      expect(conflict.isError).toBe(true);
    } finally {
      await client.close();
    }

    await settle();
    expect(hookFetch).not.toHaveBeenCalled();
  });
});

describe('automatic trigger — best effort', () => {
  it('a failing provider never fails or rolls back the content change', async () => {
    const { project, slug } = await setUpProject();
    await seedCatalogs(slug);
    hookFetch.mockImplementation(
      async () => new Response(null, { status: 500 }),
    );

    const response = await routes.translationPatch(
      request(`/api/projects/${slug}/translations`, {
        method: 'PATCH',
        token: await sessionToken('editor'),
        body: {
          key: 'nav.home',
          changes: [
            {
              locale: 'en',
              value: 'Start',
              expectedRevision: (await revisionsOf(slug))['en'],
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).saved).toBe(true);
    await settle();

    const cms = await getCmsRuntime();
    expect((await getCatalog(cms, slug, 'en')).content).toEqual({
      nav: { home: 'Start' },
    });
    await expect(getProjectDeployHookView(cms, project)).resolves.toMatchObject(
      {
        lastStatusCode: 500,
        lastError: 'http_error',
        lastSuccessAt: null,
      },
    );
  });

  it('a thrown network error is recorded, not surfaced', async () => {
    const { project, slug } = await setUpProject();
    hookFetch.mockImplementation(async () => {
      throw new TypeError('connection reset');
    });

    const response = await routes.catalogPut(
      request(`/api/projects/${slug}/catalogs/en`, {
        method: 'PUT',
        token: await sessionToken('editor'),
        body: { content: { nav: { home: 'Home' } } },
      }),
    );

    expect(response.status).toBe(200);
    await settle();
    await expect(
      getProjectDeployHookView(await getCmsRuntime(), project),
    ).resolves.toMatchObject({ lastError: 'network_error' });
  });

  it('still delivers without Cloudflare waitUntil (dev / Node fallback)', async () => {
    const { slug } = await setUpProject();
    const plainCatalogPut = mount(catalogPutHandler, false);

    const response = await plainCatalogPut(
      request(`/api/projects/${slug}/catalogs/en`, {
        method: 'PUT',
        token: await sessionToken('editor'),
        body: { content: { nav: { home: 'Home' } } },
      }),
    );

    expect(response.status).toBe(200);
    expect(pending).toHaveLength(0);
    await vi.waitFor(() => expect(hookFetch).toHaveBeenCalledTimes(1));
  });
});

describe('project deletion via the API', () => {
  it('removes the hook, does not call it, and leaves another project’s hook alone', async () => {
    const doomed = await setUpProject();
    const kept = await setUpProject();
    await seedCatalogs(doomed.slug);
    const secret = await machineToken(doomed.project);

    const response = await routes.projectDelete(
      request(`/api/projects/${doomed.slug}`, {
        method: 'DELETE',
        token: await sessionToken('admin'),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      deleted: true,
      deletedCatalogs: 3,
      revokedTokens: 1,
      removedDeployHook: true,
    });
    await settle();
    expect(hookFetch).not.toHaveBeenCalled();

    const cms = await getCmsRuntime();
    await expect(getProjectBySlug(cms, doomed.slug)).rejects.toThrow();
    expect(
      await cms.count({
        collection: 'deploy_hooks',
        where: { project: doomed.project.id },
      }),
    ).toBe(0);
    await expect(
      getProjectDeployHookView(cms, kept.project),
    ).resolves.toMatchObject({
      configured: true,
    });
    expect(
      (
        await routes.machineProject(
          request('/api/machine/v1/project', { token: secret }),
        )
      ).status,
    ).toBe(401);
  });
});
