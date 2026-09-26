import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { collections, type GlossaCmsRuntime } from '../cms/runtime';
import { DeployHookValidationError } from '../domain/deploy-hook';
import { saveCatalog } from './catalog.service';
import {
  configureProjectDeployHook,
  deliverDeployHook,
  DeployHookNotFoundError,
  getProjectDeployHookView,
  removeProjectDeployHook,
  testProjectDeployHook,
  triggerProjectDeployHook,
} from './deploy-hook.service';
import { createProjectToken } from './project-token.service';
import { createProject, deleteProject } from './project.service';

const SECRET = 'SUPER_SECRET_DEPLOY_HOOK_ABC123';
const HOOK_URL = `https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/${SECRET}`;
const OTHER_HOOK_URL =
  'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/0f2d7c6a-94b1-4e4f-8f3a-1c2b3d4e5f60';

async function createTestRuntime(): Promise<GlossaCmsRuntime> {
  const database = new InMemoryDatabaseAdapter();
  const runtime = new ForgeCmsRuntime({
    collections,
    adapters: {
      database,
      auth: new UsersCollectionAuthAdapter({ devMode: true }),
      storage: new InMemoryStorageAdapter(),
    },
    env: { userDatabase: database, apiKeyDatabase: database },
  }).init();

  await runtime.syncSchema();
  return runtime;
}

async function setUp(slug = 'my-blog') {
  const cms = await createTestRuntime();
  const project = await createProject(cms, {
    name: 'My Blog',
    slug,
    sourceLocale: 'es',
    locales: ['es', 'en'],
  });

  return { cms, project };
}

function fetchReturning(status: number) {
  return vi.fn<typeof fetch>(async () => new Response(null, { status }));
}

function countHooks(cms: GlossaCmsRuntime): Promise<number> {
  return cms.count({ collection: 'deploy_hooks' });
}

describe('deploy hook configuration', () => {
  it('reports an unconfigured project', async () => {
    const { cms, project } = await setUp();

    await expect(getProjectDeployHookView(cms, project)).resolves.toEqual({
      configured: false,
    });
  });

  it('creates an enabled Cloudflare hook and returns only a masked view', async () => {
    const { cms, project } = await setUp();

    const view = await configureProjectDeployHook(cms, project, {
      provider: 'cloudflare',
      url: HOOK_URL,
    });

    expect(view).toMatchObject({
      configured: true,
      provider: 'cloudflare',
      enabled: true,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastStatusCode: null,
      lastError: null,
    });
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(JSON.stringify(view)).not.toContain('SUPER_SECRET');
  });

  it('requires a URL to create and rejects an unsafe one without storing it', async () => {
    const { cms, project } = await setUp();

    await expect(
      configureProjectDeployHook(cms, project, { enabled: true }),
    ).rejects.toBeInstanceOf(DeployHookValidationError);
    await expect(
      configureProjectDeployHook(cms, project, {
        url: 'https://127.0.0.1/client/v4/pages/webhooks/deploy_hooks/abcdefgh1234',
      }),
    ).rejects.toBeInstanceOf(DeployHookValidationError);
    await expect(
      configureProjectDeployHook(cms, project, {
        url: HOOK_URL,
        provider: 'vercel',
      }),
    ).rejects.toBeInstanceOf(DeployHookValidationError);
    expect(await countHooks(cms)).toBe(0);
  });

  it('toggles enabled without the URL and keeps exactly one row', async () => {
    const { cms, project } = await setUp();
    await configureProjectDeployHook(cms, project, { url: HOOK_URL });

    await expect(
      configureProjectDeployHook(cms, project, { enabled: false }),
    ).resolves.toMatchObject({ configured: true, enabled: false });
    await expect(
      configureProjectDeployHook(cms, project, { enabled: true }),
    ).resolves.toMatchObject({ enabled: true });
    expect(await countHooks(cms)).toBe(1);
  });

  it('replaces the URL, resetting the old endpoint’s delivery status', async () => {
    const { cms, project } = await setUp();
    await configureProjectDeployHook(cms, project, { url: HOOK_URL });
    await testProjectDeployHook(cms, project, { fetch: fetchReturning(200) });

    const view = await configureProjectDeployHook(cms, project, {
      url: OTHER_HOOK_URL,
    });

    expect(view).toMatchObject({
      urlPreview: 'https://api.cloudflare.com/…/deploy_hooks/••••••5f60',
      lastAttemptAt: null,
      lastStatusCode: null,
    });
    expect(await countHooks(cms)).toBe(1);

    const fetchImpl = fetchReturning(204);
    await testProjectDeployHook(cms, project, { fetch: fetchImpl });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(OTHER_HOOK_URL);
  });

  it('enforces one hook per project at the database level', async () => {
    const { cms, project } = await setUp();
    await configureProjectDeployHook(cms, project, { url: HOOK_URL });

    await expect(
      cms.create({
        collection: 'deploy_hooks',
        data: {
          project: project.id,
          provider: 'cloudflare',
          url: OTHER_HOOK_URL,
          enabled: true,
          createdAt: 'x',
          updatedAt: 'x',
        },
      }),
    ).rejects.toThrow();
    expect(await countHooks(cms)).toBe(1);
  });

  it('removes only the hook configuration', async () => {
    const { cms, project } = await setUp();
    await saveCatalog(cms, 'my-blog', 'es', { nav: { home: 'Inicio' } });
    await configureProjectDeployHook(cms, project, { url: HOOK_URL });

    await expect(removeProjectDeployHook(cms, project)).resolves.toEqual({
      removed: true,
    });
    await expect(removeProjectDeployHook(cms, project)).resolves.toEqual({
      removed: false,
    });
    expect(await countHooks(cms)).toBe(0);
    expect(await cms.count({ collection: 'catalogs' })).toBe(1);
    expect(await cms.count({ collection: 'projects' })).toBe(1);
  });

  it('never calls the hook while configuring, toggling, replacing or removing', async () => {
    const { cms, project } = await setUp();
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchImpl);

    try {
      await configureProjectDeployHook(cms, project, { url: HOOK_URL });
      await configureProjectDeployHook(cms, project, { enabled: false });
      await configureProjectDeployHook(cms, project, { enabled: true });
      await configureProjectDeployHook(cms, project, { url: OTHER_HOOK_URL });
      await removeProjectDeployHook(cms, project);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('deliverDeployHook', () => {
  it('POSTs with no body and no credentials, not following redirects', async () => {
    const fetchImpl = fetchReturning(200);

    await deliverDeployHook(HOOK_URL, { fetch: fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(HOOK_URL);
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual' });
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toBeUndefined();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([200, 201, 202, 204])('treats HTTP %i as success', async (status) => {
    await expect(
      deliverDeployHook(HOOK_URL, { fetch: fetchReturning(status) }),
    ).resolves.toEqual({ success: true, statusCode: status });
  });

  it.each([302, 400, 404, 500, 503])(
    'treats HTTP %i as an http_error',
    async (status) => {
      await expect(
        deliverDeployHook(HOOK_URL, { fetch: fetchReturning(status) }),
      ).resolves.toEqual({
        success: false,
        statusCode: status,
        error: 'http_error',
      });
    },
  );

  it('reports a network failure without leaking its message', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`fetch failed for ${HOOK_URL}`);
    });

    await expect(
      deliverDeployHook(HOOK_URL, { fetch: fetchImpl }),
    ).resolves.toEqual({ success: false, error: 'network_error' });
  });

  it('aborts a slow provider after the timeout', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );

    await expect(
      deliverDeployHook(HOOK_URL, { fetch: fetchImpl, timeoutMs: 20 }),
    ).resolves.toEqual({ success: false, error: 'timeout' });
  });
});

describe('triggerProjectDeployHook', () => {
  it('is a no-op without a configured hook', async () => {
    const { cms, project } = await setUp();
    const fetchImpl = fetchReturning(200);

    await expect(
      triggerProjectDeployHook(cms, project, { fetch: fetchImpl }),
    ).resolves.toEqual({ status: 'skipped', reason: 'not_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is a no-op for a disabled hook', async () => {
    const { cms, project } = await setUp();
    await configureProjectDeployHook(cms, project, {
      url: HOOK_URL,
      enabled: false,
    });
    const fetchImpl = fetchReturning(200);

    await expect(
      triggerProjectDeployHook(cms, project, { fetch: fetchImpl }),
    ).resolves.toEqual({ status: 'skipped', reason: 'disabled' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('records a success', async () => {
    const { cms, project } = await setUp();
    await configureProjectDeployHook(cms, project, { url: HOOK_URL });
    const now = () => new Date('2026-09-25T20:24:00.000Z');

    await triggerProjectDeployHook(cms, project, {
      fetch: fetchReturning(200),
      now,
    });

    await expect(getProjectDeployHookView(cms, project)).resolves.toMatchObject(
      {
        lastAttemptAt: '2026-09-25T20:24:00.000Z',
        lastSuccessAt: '2026-09-25T20:24:00.000Z',
        lastStatusCode: 200,
        lastError: null,
      },
    );
  });

  it('records a failure while keeping the previous success', async () => {
    const { cms, project } = await setUp();
    await configureProjectDeployHook(cms, project, { url: HOOK_URL });
    await triggerProjectDeployHook(cms, project, {
      fetch: fetchReturning(204),
      now: () => new Date('2026-09-25T10:00:00.000Z'),
    });

    await triggerProjectDeployHook(cms, project, {
      fetch: fetchReturning(500),
      now: () => new Date('2026-09-25T11:00:00.000Z'),
    });

    await expect(getProjectDeployHookView(cms, project)).resolves.toMatchObject(
      {
        lastAttemptAt: '2026-09-25T11:00:00.000Z',
        lastSuccessAt: '2026-09-25T10:00:00.000Z',
        lastStatusCode: 500,
        lastError: 'http_error',
      },
    );

    await triggerProjectDeployHook(cms, project, {
      fetch: vi.fn<typeof fetch>(async () => {
        throw new TypeError('network down');
      }),
      now: () => new Date('2026-09-25T12:00:00.000Z'),
    });

    await expect(getProjectDeployHookView(cms, project)).resolves.toMatchObject(
      {
        lastAttemptAt: '2026-09-25T12:00:00.000Z',
        lastSuccessAt: '2026-09-25T10:00:00.000Z',
        lastStatusCode: null,
        lastError: 'network_error',
      },
    );
  });

  it('never stores the provider response body', async () => {
    const { cms, project } = await setUp();
    await configureProjectDeployHook(cms, project, { url: HOOK_URL });

    await triggerProjectDeployHook(cms, project, {
      fetch: vi.fn<typeof fetch>(
        async () => new Response('PROVIDER_BODY_SENTINEL', { status: 500 }),
      ),
    });

    const stored = await cms.find({ collection: 'deploy_hooks' });
    expect(JSON.stringify(stored.docs)).not.toContain('PROVIDER_BODY_SENTINEL');
  });

  it('only ever calls the hook of the project it was asked for', async () => {
    const cms = await createTestRuntime();
    const blog = await createProject(cms, {
      name: 'Blog',
      slug: 'blog',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const docs = await createProject(cms, {
      name: 'Docs',
      slug: 'docs',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await configureProjectDeployHook(cms, blog, { url: HOOK_URL });
    await configureProjectDeployHook(cms, docs, { url: OTHER_HOOK_URL });
    const fetchImpl = fetchReturning(200);

    await triggerProjectDeployHook(cms, docs, { fetch: fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(OTHER_HOOK_URL);
  });
});

describe('testProjectDeployHook', () => {
  it('fails clearly when nothing is configured', async () => {
    const { cms, project } = await setUp();

    await expect(testProjectDeployHook(cms, project)).rejects.toBeInstanceOf(
      DeployHookNotFoundError,
    );
  });

  it('calls even a disabled hook, because the admin asked', async () => {
    const { cms, project } = await setUp();
    await configureProjectDeployHook(cms, project, {
      url: HOOK_URL,
      enabled: false,
    });
    const fetchImpl = fetchReturning(204);

    const result = await testProjectDeployHook(cms, project, {
      fetch: fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, statusCode: 204 });
    expect(typeof result.attemptedAt).toBe('string');
  });

  it('reports a failure category with no URL', async () => {
    const { cms, project } = await setUp();
    await configureProjectDeployHook(cms, project, { url: HOOK_URL });

    const result = await testProjectDeployHook(cms, project, {
      fetch: fetchReturning(500),
    });

    expect(result).toMatchObject({
      success: false,
      statusCode: 500,
      error: 'http_error',
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe('project deletion', () => {
  it('removes the project hook without calling it and leaves other projects untouched', async () => {
    const cms = await createTestRuntime();
    const blog = await createProject(cms, {
      name: 'Blog',
      slug: 'blog',
      sourceLocale: 'es',
      locales: ['es', 'en'],
    });
    const docs = await createProject(cms, {
      name: 'Docs',
      slug: 'docs',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await saveCatalog(cms, 'blog', 'es', { nav: { home: 'Inicio' } });
    await saveCatalog(cms, 'blog', 'en', { nav: { home: 'Home' } });
    await createProjectToken(cms, blog, {
      name: 'CI',
      scopes: ['catalog:read'],
    });
    await configureProjectDeployHook(cms, blog, { url: HOOK_URL });
    await configureProjectDeployHook(cms, docs, { url: OTHER_HOOK_URL });
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchImpl);

    try {
      await expect(deleteProject(cms, 'blog')).resolves.toMatchObject({
        deletedCatalogs: 2,
        revokedTokens: 1,
        removedDeployHook: true,
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await countHooks(cms)).toBe(1);
    await expect(getProjectDeployHookView(cms, docs)).resolves.toMatchObject({
      configured: true,
      enabled: true,
    });
    const remaining = await cms.find({ collection: 'deploy_hooks' });
    expect(JSON.stringify(remaining.docs)).not.toContain(SECRET);
  });

  it('refuses to delete a project record while its hook still exists', async () => {
    const { cms, project } = await setUp();
    await configureProjectDeployHook(cms, project, { url: HOOK_URL });

    await expect(
      cms.delete({ collection: 'projects', id: project.id }),
    ).rejects.toThrow();
  });
});

describe('persistence model', () => {
  it('adds a single deploy_hooks collection with no delivery-history table', () => {
    const slugs = collections.map((collection) => collection.slug);

    expect(slugs.filter((slug) => slug.includes('deploy'))).toEqual([
      'deploy_hooks',
    ]);
    expect(
      slugs.some((slug) => /deliver|history|event|webhook/.test(slug)),
    ).toBe(false);
  });
});
