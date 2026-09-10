import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { collections, type GlossaCmsRuntime } from '../cms/runtime';

async function createAuthRuntime(): Promise<{
  auth: UsersCollectionAuthAdapter;
  cms: GlossaCmsRuntime;
}> {
  const database = new InMemoryDatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter({ devMode: true });
  const cms = new ForgeCmsRuntime({
    collections,
    adapters: {
      database,
      auth,
      storage: new InMemoryStorageAdapter(),
    },
    env: { userDatabase: database, apiKeyDatabase: database },
  }).init();

  await cms.syncSchema();
  return { auth, cms };
}

describe('users collection auth integration', () => {
  it('creates the first user as an admin and signs in with a cookie token', async () => {
    const { auth } = await createAuthRuntime();

    const created = await auth.createUser({
      email: 'Admin@Example.com',
      password: 'correct-password',
      name: 'Admin',
      role: 'viewer',
    });

    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error('Expected admin creation to succeed.');
    }
    expect(created.user).toMatchObject({
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
    });
    expect('passwordHash' in created.user).toBe(false);

    const signedIn = await auth.login('admin@example.com', 'correct-password');

    expect(signedIn).toMatchObject({
      ok: true,
      user: { role: 'admin' },
    });
  });

  it('rejects invalid credentials safely', async () => {
    const { auth } = await createAuthRuntime();
    await auth.createUser({
      email: 'admin@example.com',
      password: 'correct-password',
    });

    await expect(
      auth.login('admin@example.com', 'wrong-password'),
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid-credentials',
    });
  });

  it('persists editor and viewer roles without exposing password hashes', async () => {
    const { auth } = await createAuthRuntime();
    await auth.createUser({
      email: 'admin@example.com',
      password: 'correct-password',
    });
    await auth.createUser({
      email: 'editor@example.com',
      password: 'correct-password',
      role: 'editor',
    });
    await auth.createUser({
      email: 'viewer@example.com',
      password: 'correct-password',
      role: 'viewer',
    });

    const users = await auth.listUsers();

    expect(users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          email: 'editor@example.com',
          role: 'editor',
        }),
        expect.objectContaining({
          email: 'viewer@example.com',
          role: 'viewer',
        }),
      ]),
    );
    expect(users.some((user) => 'passwordHash' in user)).toBe(false);
  });
});
