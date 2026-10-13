import {
  createProject,
  deleteProject,
  getProjectBySlug,
} from '../../src/server/services/project.service';
import {
  createProjectToken,
  deleteProjectToken,
  listProjectTokens,
  ProjectTokenNotFoundError,
  revokeProjectToken,
} from '../../src/server/services/project-token.service';
import {
  getPasswordAuthAdapter,
  getProjectApiKeyAdapter,
} from '../../src/server/cms/runtime';
import { freshRuntime, openRuntime } from './harness';

async function seedProject(slug: string) {
  const cms = await openRuntime();
  return createProject(cms, {
    name: slug,
    slug,
    sourceLocale: 'en',
    locales: ['en'],
  });
}

describe('Forge authentication users on D1', () => {
  beforeEach(async () => {
    await freshRuntime();
  });

  it('persists users and password login across runtimes', async () => {
    const writer = getPasswordAuthAdapter(await openRuntime());
    // Forge promotes the very first user to admin regardless of the requested role.
    await writer.createUser({
      email: 'admin@example.com',
      password: 'correct-horse-battery',
    });
    const created = await writer.createUser({
      email: 'Editor@Example.com',
      password: 'correct-horse-battery',
      role: 'editor',
    });
    expect(created.ok).toBe(true);

    const reader = getPasswordAuthAdapter(await openRuntime());
    const users = await reader.listUsers();
    expect(users).toHaveLength(2);
    expect(
      users.find((user) => user.email === 'editor@example.com'),
    ).toMatchObject({
      email: 'editor@example.com',
      role: 'editor',
    });
    expect(JSON.stringify(users)).not.toContain('correct-horse-battery');

    await expect(
      reader.login('editor@example.com', 'correct-horse-battery'),
    ).resolves.toMatchObject({ ok: true });
    await expect(reader.login('editor@example.com', 'wrong')).resolves.toEqual({
      ok: false,
      reason: 'invalid-credentials',
    });
  });
});

describe('project access tokens on D1', () => {
  beforeEach(async () => {
    await freshRuntime();
  });

  it('scopes a token to its project and authenticates it from another runtime', async () => {
    const alpha = await seedProject('alpha');
    const beta = await seedProject('beta');
    const cms = await openRuntime();

    const { token, secret } = await createProjectToken(cms, alpha, {
      name: 'CI',
      scopes: ['catalog:read'],
    });

    const reader = await openRuntime();
    await expect(listProjectTokens(reader, alpha)).resolves.toEqual([token]);
    await expect(listProjectTokens(reader, beta)).resolves.toEqual([]);

    const session =
      await getProjectApiKeyAdapter(reader).validateSession(secret);
    expect(session?.user.id).toBeTruthy();
    expect(session?.user).toMatchObject({ role: 'machine' });
    const stored = await getProjectApiKeyAdapter(reader).getApiKey(token.id);
    expect(stored?.metadata).toMatchObject({ projectId: alpha.id });
    expect(stored?.scopes).toEqual(['catalog:read']);
  });

  it('refuses to revoke or delete a token through a different project', async () => {
    const alpha = await seedProject('alpha');
    const beta = await seedProject('beta');
    const cms = await openRuntime();
    const { token } = await createProjectToken(cms, alpha, {
      name: 'CI',
      scopes: ['catalog:write'],
    });

    await expect(
      revokeProjectToken(cms, beta, token.id),
    ).rejects.toBeInstanceOf(ProjectTokenNotFoundError);
    await expect(
      deleteProjectToken(cms, beta, token.id),
    ).rejects.toBeInstanceOf(ProjectTokenNotFoundError);
    const [still] = await listProjectTokens(await openRuntime(), alpha);
    expect(still).toMatchObject({ id: token.id, status: 'active' });
  });

  it('persists revocation and stops the secret from authenticating', async () => {
    const alpha = await seedProject('alpha');
    const cms = await openRuntime();
    const { token, secret } = await createProjectToken(cms, alpha, {
      name: 'CI',
      scopes: ['catalog:read'],
    });
    await expect(
      getProjectApiKeyAdapter(cms).validateSession(secret),
    ).resolves.not.toBeNull();

    const revoked = await revokeProjectToken(cms, alpha, token.id);
    expect(revoked.status).toBe('revoked');

    const reader = await openRuntime();
    const [listed] = await listProjectTokens(reader, alpha);
    expect(listed).toMatchObject({ id: token.id, status: 'revoked' });
    await expect(
      getProjectApiKeyAdapter(reader).validateSession(secret),
    ).resolves.toBeNull();
  });

  it('revokes only the deleted project’s tokens when the project is deleted', async () => {
    const alpha = await seedProject('alpha');
    const beta = await seedProject('beta');
    const cms = await openRuntime();
    const a = await createProjectToken(cms, alpha, {
      name: 'A',
      scopes: ['catalog:read'],
    });
    const b = await createProjectToken(cms, beta, {
      name: 'B',
      scopes: ['catalog:read'],
    });

    await expect(deleteProject(cms, 'alpha')).resolves.toMatchObject({
      revokedTokens: 1,
    });

    const reader = await openRuntime();
    const adapter = getProjectApiKeyAdapter(reader);
    await expect(adapter.validateSession(a.secret)).resolves.toBeNull();
    await expect(adapter.validateSession(b.secret)).resolves.not.toBeNull();
    await expect(getProjectBySlug(reader, 'beta')).resolves.toEqual(beta);
  });
});
