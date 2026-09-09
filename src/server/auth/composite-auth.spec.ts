import {
  CompositeAuthAdapter,
  UsersCollectionAuthAdapter,
} from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { collections, type GlossaCmsRuntime } from '../cms/runtime';
import { createSsoSession } from '../services/sso-session.service';
import { GlossaSsoAuthAdapter } from './glossa-sso-auth-adapter';

function requestWithBearer(token: string): Request {
  return new Request('https://glossa.example/api/projects', {
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
  ]);
  const cms = new ForgeCmsRuntime({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env: { userDatabase: database },
  }).init();

  await cms.syncSchema();
  return { cms, users };
}

describe('CompositeAuthAdapter([GlossaSsoAuthAdapter, UsersCollectionAuthAdapter])', () => {
  it('authenticates an SSO opaque token as the linked user, via the SSO path only', async () => {
    const { cms, users } = await createTestFixture();
    const created = await users.createUser({
      email: 'sso-user@example.com',
      password: 'correct-password',
      role: 'admin',
    });
    if (!created.ok) throw new Error('Expected user creation to succeed.');

    const { token } = await createSsoSession(cms, created.user.id, 'dev-auth');
    const authedUser = await cms.adapters.auth.requireAuth(
      requestWithBearer(token),
    );

    expect(authedUser).toMatchObject({
      email: 'sso-user@example.com',
      role: 'admin',
    });
  });

  it('authenticates a Forge password-signed token as the password user, via the password path only', async () => {
    const { cms, users } = await createTestFixture();
    // The very first user in a fresh install is always forced to admin (bootstrap rule) — create a
    // placeholder first so the user under test actually gets the non-admin role it asks for.
    await users.createUser({
      email: 'first-admin@example.com',
      password: 'correct-password',
      role: 'admin',
    });
    const created = await users.createUser({
      email: 'password-user@example.com',
      password: 'correct-password',
      role: 'editor',
    });
    if (!created.ok) throw new Error('Expected user creation to succeed.');

    const authedUser = await cms.adapters.auth.requireAuth(
      requestWithBearer(created.token),
    );

    expect(authedUser).toMatchObject({
      email: 'password-user@example.com',
      role: 'editor',
    });
  });

  it('rejects a malformed/foreign token with no cross-adapter fallback success', async () => {
    const { cms } = await createTestFixture();

    await expect(
      cms.adapters.auth.requireAuth(requestWithBearer('not-a-real-token')),
    ).rejects.toThrow();
    await expect(
      cms.adapters.auth.requireAuth(requestWithBearer('glossa_sso_garbage')),
    ).rejects.toThrow();
    await expect(
      cms.adapters.auth.requireAuth(requestWithBearer('garbage.garbage')),
    ).rejects.toThrow();
  });
});
