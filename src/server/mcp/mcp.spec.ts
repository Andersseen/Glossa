import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike,
} from '@modelcontextprotocol/client';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { createApp, toWebHandler } from 'h3';

import {
  getCmsRuntime,
  getPasswordAuthAdapter,
  type GlossaCmsRuntime,
} from '../cms/runtime';
import { getPublicCatalog } from '../delivery/delivery.service';
import type { Project } from '../domain/project';
import { getCatalog, saveCatalog } from '../services/catalog.service';
import {
  createProjectToken,
  revokeProjectToken,
} from '../services/project-token.service';
import { createProject } from '../services/project.service';
import routeHandler from './route-handler';

const ORIGIN = 'https://glossa.test';
const ENDPOINT = new URL(`${ORIGIN}/mcp`);

/**
 * Drives the actual `/mcp` route handler in-process — no live network listener. The route
 * resolves its own CMS runtime via `getRuntimeForEvent` → `getCloudflareEnv`, which (with no
 * `env.DB` in this test process) always returns the one shared in-memory singleton `getCmsRuntime`
 * itself hands back — the same runtime every test in this file seeds its fixtures into.
 */
function mcpFetch(): FetchLike {
  const app = createApp();
  app.use(routeHandler);
  const webHandler = toWebHandler(app);

  return (async (input, init) => {
    return webHandler(new Request(input as string | URL, init));
  }) as FetchLike;
}

async function connectClient(secret: string): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(ENDPOINT, {
    fetch: mcpFetch(),
    authProvider: { token: async () => secret },
  });

  await client.connect(transport);
  return client;
}

function textOf(result: CallToolResult): Record<string, unknown> {
  const [first] = result.content;

  if (!first || first.type !== 'text') {
    throw new Error('Expected a text content block.');
  }

  return JSON.parse(first.text) as Record<string, unknown>;
}

/** The documented set_translation workflow: read first, then write with that revision as the precondition. */
async function currentRevision(
  client: Client,
  locale: string,
  key: string,
): Promise<string> {
  const read = await client.callTool({
    name: 'get_translation',
    arguments: { locale, key },
  });
  return textOf(read)['revision'] as string;
}

describe('MCP auth boundary', () => {
  it('rejects a request with no Authorization header', async () => {
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(ENDPOINT, {
      fetch: mcpFetch(),
    });

    await expect(client.connect(transport)).rejects.toBeTruthy();
  });

  it('rejects an invalid/malformed token', async () => {
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(ENDPOINT, {
      fetch: mcpFetch(),
      authProvider: { token: async () => 'glossa_not_a_real_token' },
    });

    await expect(client.connect(transport)).rejects.toBeTruthy();
  });

  it('rejects a human password-session token (not a project access token)', async () => {
    const cms = await getCmsRuntime();
    const adapter = getPasswordAuthAdapter(cms);
    const email = `admin-${Date.now()}@example.com`;
    const created = await adapter.createUser({
      email,
      password: 'password123',
      role: 'admin',
    });
    if (!created.ok) throw new Error('Could not create test user.');
    const login = await adapter.login(email, 'password123');
    if (!login.ok) throw new Error('Could not log in test user.');

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(ENDPOINT, {
      fetch: mcpFetch(),
      authProvider: { token: async () => login.token },
    });

    await expect(client.connect(transport)).rejects.toBeTruthy();
  });

  it('rejects a revoked token', async () => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui-revoked',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const { token, secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:read'],
    });
    await revokeProjectToken(cms, project, token.id);

    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(ENDPOINT, {
      fetch: mcpFetch(),
      authProvider: { token: async () => secret },
    });

    await expect(client.connect(transport)).rejects.toBeTruthy();
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers();

    try {
      const cms = await getCmsRuntime();
      const project = await createProject(cms, {
        name: 'Volt UI',
        slug: 'volt-ui-expired',
        sourceLocale: 'en',
        locales: ['en'],
      });
      const { secret } = await createProjectToken(cms, project, {
        name: 'Agent',
        scopes: ['catalog:read'],
        expiresAt: new Date(Date.now() + 1000).toISOString(),
      });
      vi.setSystemTime(Date.now() + 2000);

      const client = new Client({ name: 'test-client', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(ENDPOINT, {
        fetch: mcpFetch(),
        authProvider: { token: async () => secret },
      });

      await expect(client.connect(transport)).rejects.toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a valid project token', async () => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui-valid',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:read'],
    });

    const client = await connectClient(secret);
    await expect(client.listTools()).resolves.toBeTruthy();
  });
});

describe('MCP tool discovery', () => {
  it('lists all six tools, none accepting a project-selecting argument', async () => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui-tools',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:write'],
    });

    const client = await connectClient(secret);
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'get_catalog',
      'get_delivery_urls',
      'get_project',
      'get_translation',
      'list_catalogs',
      'set_translation',
    ]);

    for (const tool of tools) {
      const properties = Object.keys(
        (
          tool.inputSchema as
            { properties?: Record<string, unknown> } | undefined
        )?.properties ?? {},
      );
      expect(properties).not.toEqual(
        expect.arrayContaining(['project', 'projectId', 'slug']),
      );
    }
  });
});

describe('MCP scope enforcement', () => {
  async function setUpProject(
    cms: GlossaCmsRuntime,
    slug: string,
  ): Promise<Project> {
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug,
      sourceLocale: 'en',
      locales: ['en'],
    });
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });
    return project;
  }

  it('a read-only token can read but not write', async () => {
    const cms = await getCmsRuntime();
    const project = await setUpProject(cms, 'volt-ui-read-only');
    const { secret } = await createProjectToken(cms, project, {
      name: 'Reader',
      scopes: ['catalog:read'],
    });
    const client = await connectClient(secret);

    const getProject = await client.callTool({
      name: 'get_project',
      arguments: {},
    });
    expect(getProject.isError).toBeFalsy();

    const getCatalogResult = await client.callTool({
      name: 'get_catalog',
      arguments: { locale: 'en' },
    });
    expect(getCatalogResult.isError).toBeFalsy();

    const setResult = await client.callTool({
      name: 'set_translation',
      arguments: { locale: 'en', key: 'nav.docs', value: 'Docs' },
    });
    expect(setResult.isError).toBe(true);
    expect(textOf(setResult)['code']).toBe('INVALID_SCOPE');
  });

  it('a write token can set a translation', async () => {
    const cms = await getCmsRuntime();
    const project = await setUpProject(cms, 'volt-ui-write');
    const { secret } = await createProjectToken(cms, project, {
      name: 'Writer',
      scopes: ['catalog:write'],
    });
    const client = await connectClient(secret);
    const expectedRevision = await currentRevision(client, 'en', 'nav.home');

    const result = await client.callTool({
      name: 'set_translation',
      arguments: {
        locale: 'en',
        key: 'nav.docs',
        value: 'Docs',
        expectedRevision,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)['value']).toBe('Docs');
  });
});

describe('MCP project isolation', () => {
  it('a token only ever sees the project it was issued for', async () => {
    const cms = await getCmsRuntime();
    const projectA = await createProject(cms, {
      name: 'Project A',
      slug: 'project-a',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await createProject(cms, {
      name: 'Project B',
      slug: 'project-b',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const { secret } = await createProjectToken(cms, projectA, {
      name: 'Agent',
      scopes: ['catalog:read'],
    });

    const client = await connectClient(secret);
    const result = await client.callTool({
      name: 'get_project',
      arguments: {},
    });

    expect(textOf(result)['slug']).toBe('project-a');
  });
});

describe('MCP get_translation / set_translation', () => {
  it('reads an existing nested key with its revision', async () => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui-get-existing',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await saveCatalog(cms, project.slug, 'en', { nav: { home: 'Home' } });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:read'],
    });
    const client = await connectClient(secret);

    const result = await client.callTool({
      name: 'get_translation',
      arguments: { locale: 'en', key: 'nav.home' },
    });

    expect(textOf(result)).toMatchObject({ exists: true, value: 'Home' });
    expect(typeof textOf(result)['revision']).toBe('string');
  });

  it('reports a missing key as not existing, still with a revision', async () => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui-get-missing',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await saveCatalog(cms, project.slug, 'en', { nav: { home: 'Home' } });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:read'],
    });
    const client = await connectClient(secret);

    const result = await client.callTool({
      name: 'get_translation',
      arguments: { locale: 'en', key: 'nav.missing' },
    });

    expect(textOf(result)).toMatchObject({ exists: false });
    expect(typeof textOf(result)['revision']).toBe('string');
  });

  it('rejects an unconfigured locale', async () => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui-get-bad-locale',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:read'],
    });
    const client = await connectClient(secret);

    const result = await client.callTool({
      name: 'get_translation',
      arguments: { locale: 'fr', key: 'nav.home' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)['code']).toBe('LOCALE_NOT_CONFIGURED');
  });

  it.each([
    ['__proto__.polluted', 'volt-ui-pollute-proto'],
    ['prototype.polluted', 'volt-ui-pollute-prototype'],
    ['constructor.polluted', 'volt-ui-pollute-constructor'],
  ])('rejects a prototype-pollution key path "%s"', async (key, slug) => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug,
      sourceLocale: 'en',
      locales: ['en'],
    });
    await saveCatalog(cms, project.slug, 'en', {});
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:write'],
    });
    const client = await connectClient(secret);

    const result = await client.callTool({
      name: 'set_translation',
      arguments: { locale: 'en', key, value: 'x' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)['code']).toBe('INVALID_TRANSLATION_KEY');
  });

  it('creates a new nested key in an existing catalog', async () => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui-create-key',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await saveCatalog(cms, project.slug, 'en', { nav: { home: 'Home' } });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:write'],
    });
    const client = await connectClient(secret);
    const expectedRevision = await currentRevision(client, 'en', 'nav.home');

    const result = await client.callTool({
      name: 'set_translation',
      arguments: {
        locale: 'en',
        key: 'nav.changelog',
        value: 'Changelog',
        expectedRevision,
      },
    });

    expect(result.isError).toBeFalsy();
    const catalog = await getCatalog(cms, project.slug, 'en');
    expect(catalog.content).toEqual({
      nav: { home: 'Home', changelog: 'Changelog' },
    });
  });

  it('safely creates the catalog for a configured locale with no catalog yet', async () => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui-first-key',
      sourceLocale: 'en',
      locales: ['en', 'es'],
    });
    await saveCatalog(cms, project.slug, 'en', { title: 'v1' });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:write'],
    });
    const client = await connectClient(secret);

    const result = await client.callTool({
      name: 'set_translation',
      arguments: { locale: 'es', key: 'title', value: 'v1-es' },
    });

    expect(result.isError).toBeFalsy();
    const catalog = await getCatalog(cms, project.slug, 'es');
    expect(catalog.content).toEqual({ title: 'v1-es' });
  });

  it('does not create a catalog for a locale outside the project', async () => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui-outside-locale',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:write'],
    });
    const client = await connectClient(secret);

    const result = await client.callTool({
      name: 'set_translation',
      arguments: { locale: 'fr', key: 'title', value: 'v1-fr' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)['code']).toBe('LOCALE_NOT_CONFIGURED');
  });

  it('rejects a stale expectedRevision and preserves the newer human/machine edit', async () => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui-conflict',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await saveCatalog(cms, project.slug, 'en', { title: 'original' });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:write'],
    });
    const client = await connectClient(secret);

    const read = await client.callTool({
      name: 'get_translation',
      arguments: { locale: 'en', key: 'title' },
    });
    const staleRevision = textOf(read)['revision'] as string;

    // A human/machine edit lands after the agent's read, advancing the revision.
    await saveCatalog(cms, project.slug, 'en', { title: 'edited by a human' });

    const conflicting = await client.callTool({
      name: 'set_translation',
      arguments: {
        locale: 'en',
        key: 'title',
        value: 'agent value',
        expectedRevision: staleRevision,
      },
    });

    expect(conflicting.isError).toBe(true);
    expect(textOf(conflicting)['code']).toBe('CATALOG_REVISION_CONFLICT');

    const catalog = await getCatalog(cms, project.slug, 'en');
    expect(catalog.content).toEqual({ title: 'edited by a human' });
  });
});

describe('MCP write reflected in public delivery', () => {
  it('a set_translation write is immediately visible through public delivery', async () => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui-delivery-reflects-mcp',
      sourceLocale: 'en',
      locales: ['en'],
      publicDelivery: true,
    });
    await saveCatalog(cms, project.slug, 'en', { title: 'old value' });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:write'],
    });
    const client = await connectClient(secret);

    expect((await getPublicCatalog(cms, project.slug, 'en')).content).toEqual({
      title: 'old value',
    });

    const expectedRevision = await currentRevision(client, 'en', 'title');
    const written = await client.callTool({
      name: 'set_translation',
      arguments: {
        locale: 'en',
        key: 'title',
        value: 'new value',
        expectedRevision,
      },
    });
    expect(written.isError).toBeFalsy();

    expect((await getPublicCatalog(cms, project.slug, 'en')).content).toEqual({
      title: 'new value',
    });
  });
});

describe('MCP does not expose credentials', () => {
  it('no tool result ever contains the raw token secret or AUTH_SECRET-shaped values', async () => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui-no-secrets',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await saveCatalog(cms, project.slug, 'en', { title: 'v1' });
    const { secret } = await createProjectToken(cms, project, {
      name: 'Agent',
      scopes: ['catalog:write'],
    });
    const client = await connectClient(secret);

    const results = await Promise.all([
      client.callTool({ name: 'get_project', arguments: {} }),
      client.callTool({ name: 'list_catalogs', arguments: {} }),
      client.callTool({ name: 'get_catalog', arguments: { locale: 'en' } }),
      client.callTool({
        name: 'get_translation',
        arguments: { locale: 'en', key: 'title' },
      }),
      client.callTool({ name: 'get_delivery_urls', arguments: {} }),
    ]);

    for (const result of results) {
      const raw = JSON.stringify(result);
      expect(raw).not.toContain(secret);
    }
  });
});
