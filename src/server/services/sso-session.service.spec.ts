import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import { GlossaSsoAuthAdapter } from '../auth/glossa-sso-auth-adapter';
import { hashSsoToken, SSO_TOKEN_PREFIX } from '../auth/session-token';
import { collections, type GlossaCmsRuntime } from '../cms/runtime';
import {
  createSsoSession,
  revokeSsoSessionByToken,
} from './sso-session.service';

function requestWithBearer(token: string): Request {
  return new Request('https://glossa.example/api/projects', {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function createTestRuntime(): Promise<{
  cms: GlossaCmsRuntime;
  ssoAdapter: GlossaSsoAuthAdapter;
  database: InMemoryDatabaseAdapter;
}> {
  const database = new InMemoryDatabaseAdapter();
  const ssoAdapter = new GlossaSsoAuthAdapter();
  const auth = new UsersCollectionAuthAdapter({ devMode: true });
  const cms = new ForgeCmsRuntime({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env: { userDatabase: database },
  }).init();
  ssoAdapter.init({ userDatabase: database });

  await cms.syncSchema();
  return { cms, ssoAdapter, database };
}

describe('sso session lifecycle', () => {
  it('returns the raw token once and persists only its hash', async () => {
    const { cms, database } = await createTestRuntime();
    const user = await cms.create({
      collection: 'users',
      data: { email: 'admin@example.com', role: 'admin', passwordHash: 'x' },
    });

    const { token } = await createSsoSession(cms, user.id, 'dev-auth');

    expect(token.startsWith(SSO_TOKEN_PREFIX)).toBe(true);

    const rows = await database.findMany({ collection: 'sso_sessions' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['tokenHash']).toEqual(await hashSsoToken(token));
    expect(rows[0]?.['tokenHash']).not.toEqual(token);
  });

  it('validates a freshly created session and loads the current user', async () => {
    const { cms, ssoAdapter } = await createTestRuntime();
    const user = await cms.create({
      collection: 'users',
      data: { email: 'admin@example.com', role: 'admin', passwordHash: 'x' },
    });
    const { token } = await createSsoSession(cms, user.id, 'dev-auth');

    const authedUser = await ssoAdapter.requireAuth(requestWithBearer(token));

    expect(authedUser).toMatchObject({
      email: 'admin@example.com',
      role: 'admin',
    });
  });

  it('rejects an expired session', async () => {
    const { cms, ssoAdapter, database } = await createTestRuntime();
    const user = await cms.create({
      collection: 'users',
      data: { email: 'admin@example.com', role: 'admin', passwordHash: 'x' },
    });
    const { token } = await createSsoSession(cms, user.id, 'dev-auth');
    const rows = await database.findMany({ collection: 'sso_sessions' });
    const row = rows[0];
    if (!row) throw new Error('Expected a session row to exist.');

    await database.update('sso_sessions', row['id'] as string, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    await expect(
      ssoAdapter.requireAuth(requestWithBearer(token)),
    ).rejects.toThrow();
  });

  it('rejects a revoked session after logout, even with the correct raw token', async () => {
    const { cms, ssoAdapter } = await createTestRuntime();
    const user = await cms.create({
      collection: 'users',
      data: { email: 'admin@example.com', role: 'admin', passwordHash: 'x' },
    });
    const { token } = await createSsoSession(cms, user.id, 'dev-auth');

    await revokeSsoSessionByToken(cms, token);

    await expect(
      ssoAdapter.requireAuth(requestWithBearer(token)),
    ).rejects.toThrow();
  });

  it('rejects a session whose linked user has been deleted, without recreating it', async () => {
    const { cms, ssoAdapter } = await createTestRuntime();
    const user = await cms.create({
      collection: 'users',
      data: { email: 'admin@example.com', role: 'editor', passwordHash: 'x' },
    });
    const { token } = await createSsoSession(cms, user.id, 'dev-auth');

    await cms.delete({ collection: 'users', id: user.id });

    await expect(
      ssoAdapter.requireAuth(requestWithBearer(token)),
    ).rejects.toThrow();

    const usersAfter = await cms.find({ collection: 'users' });
    expect(usersAfter.docs).toHaveLength(0);
  });

  it('reflects a role change on the very next request, without re-login', async () => {
    const { cms, ssoAdapter } = await createTestRuntime();
    const user = await cms.create({
      collection: 'users',
      data: { email: 'admin@example.com', role: 'admin', passwordHash: 'x' },
    });
    const { token } = await createSsoSession(cms, user.id, 'dev-auth');

    await cms.update({
      collection: 'users',
      id: user.id,
      data: { role: 'viewer' },
    });

    const authedUser = await ssoAdapter.requireAuth(requestWithBearer(token));

    expect(authedUser.role).toEqual('viewer');
  });

  it('logout revocation is idempotent for an already-revoked or unknown token', async () => {
    const { cms } = await createTestRuntime();

    await expect(
      revokeSsoSessionByToken(cms, `${SSO_TOKEN_PREFIX}unknown-token`),
    ).resolves.toBeUndefined();
  });
});
