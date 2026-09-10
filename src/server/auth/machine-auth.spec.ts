import {
  ApiKeyAuthAdapter,
  CompositeAuthAdapter,
  UsersCollectionAuthAdapter,
} from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import {
  collections,
  PROJECT_TOKEN_PREFIX,
  type GlossaCmsRuntime,
} from '../cms/runtime';
import { createProject } from '../services/project.service';
import {
  createProjectToken,
  revokeProjectToken,
} from '../services/project-token.service';
import { createSsoSession } from '../services/sso-session.service';
import { GlossaSsoAuthAdapter } from './glossa-sso-auth-adapter';

function requestWithBearer(token: string): Request {
  return new Request('https://glossa.example/api/machine/v1/project', {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function createTestFixture(): Promise<{
  cms: GlossaCmsRuntime;
  users: UsersCollectionAuthAdapter;
}> {
  const database = new InMemoryDatabaseAdapter();
  const users = new UsersCollectionAuthAdapter({ devMode: true }).init({
    userDatabase: database,
  });
  const auth = new CompositeAuthAdapter([
    new GlossaSsoAuthAdapter(),
    new UsersCollectionAuthAdapter({ devMode: true }),
    new ApiKeyAuthAdapter({ prefix: PROJECT_TOKEN_PREFIX }),
  ]);
  const cms = new ForgeCmsRuntime({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env: { userDatabase: database, apiKeyDatabase: database },
  }).init();

  await cms.syncSchema();
  return { cms, users };
}

describe('CompositeAuthAdapter([GlossaSsoAuthAdapter, UsersCollectionAuthAdapter, ApiKeyAuthAdapter])', () => {
  it('authenticates a valid project token as a machine principal carrying its scopes and project metadata', async () => {
    const { cms } = await createTestFixture();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const { secret } = await createProjectToken(cms, project, {
      name: 'CI',
      scopes: ['catalog:read'],
    });

    const principal = await cms.adapters.auth.requireAuth(
      requestWithBearer(secret),
    );

    expect(principal.role).toBe('machine');
    expect(principal.scopes).toEqual(['catalog:read']);
    expect(principal.metadata).toMatchObject({
      projectId: project.id,
      projectSlug: project.slug,
    });
  });

  it('rejects a revoked token immediately, no grace period', async () => {
    const { cms } = await createTestFixture();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const { secret, token } = await createProjectToken(cms, project, {
      name: 'CI',
      scopes: ['catalog:read'],
    });
    await revokeProjectToken(cms, project, token.id);

    await expect(
      cms.adapters.auth.requireAuth(requestWithBearer(secret)),
    ).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers();

    try {
      const { cms } = await createTestFixture();
      const project = await createProject(cms, {
        name: 'Volt UI',
        slug: 'volt-ui',
        sourceLocale: 'en',
        locales: ['en'],
      });
      const soon = new Date(Date.now() + 1000).toISOString();
      const { secret } = await createProjectToken(cms, project, {
        name: 'CI',
        scopes: ['catalog:read'],
        expiresAt: soon,
      });

      vi.setSystemTime(Date.now() + 2000);

      await expect(
        cms.adapters.auth.requireAuth(requestWithBearer(secret)),
      ).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a malformed or foreign-shaped token with no cross-adapter fallback success', async () => {
    const { cms } = await createTestFixture();

    await expect(
      cms.adapters.auth.requireAuth(requestWithBearer('not-a-real-token')),
    ).rejects.toThrow();
    await expect(
      cms.adapters.auth.requireAuth(
        requestWithBearer(`${PROJECT_TOKEN_PREFIX}_bogus-id_bogus-secret`),
      ),
    ).rejects.toThrow();
    await expect(
      cms.adapters.auth.requireAuth(requestWithBearer('glossa_sso_garbage')),
    ).rejects.toThrow();
  });

  it('leaves SSO and password sessions authenticating exactly as before', async () => {
    const { cms, users } = await createTestFixture();
    const created = await users.createUser({
      email: 'admin@example.com',
      password: 'correct-password',
      role: 'admin',
    });
    if (!created.ok) throw new Error('Expected user creation to succeed.');

    const { token } = await createSsoSession(cms, created.user.id, 'dev-auth');
    const principal = await cms.adapters.auth.requireAuth(
      requestWithBearer(token),
    );

    expect(principal.role).toBe('admin');
  });
});
