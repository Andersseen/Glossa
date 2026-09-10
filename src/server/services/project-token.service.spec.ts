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
import { createProject } from './project.service';
import {
  createProjectToken,
  deleteProjectToken,
  listProjectTokens,
  ProjectTokenNotFoundError,
  revokeAllProjectTokens,
  revokeProjectToken,
} from './project-token.service';

async function createTestRuntime(): Promise<GlossaCmsRuntime> {
  const database = new InMemoryDatabaseAdapter();
  const runtime = new ForgeCmsRuntime({
    collections,
    adapters: {
      database,
      // Real `ApiKeyAuthAdapter` throughout — this suite is specifically integrating it, not a
      // seam to mock away.
      auth: new CompositeAuthAdapter([
        new UsersCollectionAuthAdapter({ devMode: true }),
        new ApiKeyAuthAdapter({ prefix: PROJECT_TOKEN_PREFIX }),
      ]),
      storage: new InMemoryStorageAdapter(),
    },
    env: { userDatabase: database, apiKeyDatabase: database },
  }).init();

  await runtime.syncSchema();
  return runtime;
}

describe('project token service', () => {
  it('creates a token bound to the project, returning the plaintext secret once', async () => {
    const cms = await createTestRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });

    const { token, secret } = await createProjectToken(cms, project, {
      name: 'Volt UI — CI',
      scopes: ['catalog:read'],
    });

    expect(secret.startsWith(`${PROJECT_TOKEN_PREFIX}_`)).toBe(true);
    expect(token).toMatchObject({
      name: 'Volt UI — CI',
      scopes: ['catalog:read'],
      status: 'active',
    });
    expect('secret' in token).toBe(false);
    expect('secretHash' in token).toBe(false);
  });

  it('normalizes catalog:write to also carry catalog:read on the stored token', async () => {
    const cms = await createTestRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });

    const { token } = await createProjectToken(cms, project, {
      name: 'Writer',
      scopes: ['catalog:write'],
    });

    expect(token.scopes).toEqual(['catalog:read', 'catalog:write']);
  });

  it('rejects an unknown scope without creating a key', async () => {
    const cms = await createTestRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });

    await expect(
      createProjectToken(cms, project, { name: 'Bad', scopes: ['admin'] }),
    ).rejects.toThrow('Unknown scope "admin".');

    expect(await listProjectTokens(cms, project)).toHaveLength(0);
  });

  it('lists only tokens whose trusted metadata belongs to the given project', async () => {
    const cms = await createTestRuntime();
    const projectA = await createProject(cms, {
      name: 'Project A',
      slug: 'project-a',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const projectB = await createProject(cms, {
      name: 'Project B',
      slug: 'project-b',
      sourceLocale: 'en',
      locales: ['en'],
    });

    await createProjectToken(cms, projectA, {
      name: 'A token',
      scopes: ['catalog:read'],
    });
    await createProjectToken(cms, projectB, {
      name: 'B token',
      scopes: ['catalog:read'],
    });

    expect((await listProjectTokens(cms, projectA)).map((t) => t.name)).toEqual(
      ['A token'],
    );
    expect((await listProjectTokens(cms, projectB)).map((t) => t.name)).toEqual(
      ['B token'],
    );
  });

  it('revokes an owned token idempotently', async () => {
    const cms = await createTestRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const { token } = await createProjectToken(cms, project, {
      name: 'X',
      scopes: ['catalog:read'],
    });

    const revoked = await revokeProjectToken(cms, project, token.id);
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedAt).toBeTruthy();

    const revokedAgain = await revokeProjectToken(cms, project, token.id);
    expect(revokedAgain.revokedAt).toBe(revoked.revokedAt);
  });

  it('deletes an owned token entirely', async () => {
    const cms = await createTestRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const { token } = await createProjectToken(cms, project, {
      name: 'X',
      scopes: ['catalog:read'],
    });

    await deleteProjectToken(cms, project, token.id);

    expect(await listProjectTokens(cms, project)).toHaveLength(0);
  });

  it('refuses to revoke a token belonging to a different project (IDOR)', async () => {
    const cms = await createTestRuntime();
    const projectA = await createProject(cms, {
      name: 'Project A',
      slug: 'project-a',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const projectB = await createProject(cms, {
      name: 'Project B',
      slug: 'project-b',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const { token } = await createProjectToken(cms, projectA, {
      name: 'A token',
      scopes: ['catalog:read'],
    });

    await expect(
      revokeProjectToken(cms, projectB, token.id),
    ).rejects.toBeInstanceOf(ProjectTokenNotFoundError);

    const [stillA] = await listProjectTokens(cms, projectA);
    expect(stillA?.status).toBe('active');
  });

  it('refuses to delete a token belonging to a different project (IDOR)', async () => {
    const cms = await createTestRuntime();
    const projectA = await createProject(cms, {
      name: 'Project A',
      slug: 'project-a',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const projectB = await createProject(cms, {
      name: 'Project B',
      slug: 'project-b',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const { token } = await createProjectToken(cms, projectA, {
      name: 'A token',
      scopes: ['catalog:read'],
    });

    await expect(
      deleteProjectToken(cms, projectB, token.id),
    ).rejects.toBeInstanceOf(ProjectTokenNotFoundError);

    expect(await listProjectTokens(cms, projectA)).toHaveLength(1);
  });

  it('revokes every active token for a project (project-deletion lifecycle)', async () => {
    const cms = await createTestRuntime();
    const project = await createProject(cms, {
      name: 'Volt UI',
      slug: 'volt-ui',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await createProjectToken(cms, project, {
      name: 'One',
      scopes: ['catalog:read'],
    });
    await createProjectToken(cms, project, {
      name: 'Two',
      scopes: ['catalog:write'],
    });

    await revokeAllProjectTokens(cms, project.id);

    const tokens = await listProjectTokens(cms, project);
    expect(tokens).toHaveLength(2);
    expect(tokens.every((token) => token.status === 'revoked')).toBe(true);
  });

  it('reports a token as expired once its expiresAt passes, without revoking it', async () => {
    vi.useFakeTimers();

    try {
      const cms = await createTestRuntime();
      const project = await createProject(cms, {
        name: 'Volt UI',
        slug: 'volt-ui',
        sourceLocale: 'en',
        locales: ['en'],
      });
      const soon = new Date(Date.now() + 1000).toISOString();
      const { token } = await createProjectToken(cms, project, {
        name: 'Expiring',
        scopes: ['catalog:read'],
        expiresAt: soon,
      });
      expect(token.status).toBe('active');

      vi.setSystemTime(Date.now() + 2000);

      const [refreshed] = await listProjectTokens(cms, project);
      expect(refreshed?.status).toBe('expired');
      expect(refreshed?.revokedAt).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
