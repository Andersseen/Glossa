import { UsersCollectionAuthAdapter } from '@forge-cms/auth';
import { InMemoryDatabaseAdapter } from '@forge-cms/db';
import { ForgeCmsRuntime } from '@forge-cms/runtime';
import { InMemoryStorageAdapter } from '@forge-cms/storage';

import type { ExternalIdentity } from '../auth/identity';
import { collections, type GlossaCmsRuntime } from '../cms/runtime';
import {
  findIdentity,
  linkNewIdentity,
  resolveOrLinkUser,
} from './external-identity.service';

const PROVIDER = 'dev-auth';

async function createTestRuntime(): Promise<GlossaCmsRuntime> {
  const database = new InMemoryDatabaseAdapter();
  const auth = new UsersCollectionAuthAdapter({ devMode: true });
  const cms = new ForgeCmsRuntime({
    collections,
    adapters: { database, auth, storage: new InMemoryStorageAdapter() },
    env: { userDatabase: database },
  }).init();

  await cms.syncSchema();
  return cms;
}

function identity(overrides: Partial<ExternalIdentity> = {}): ExternalIdentity {
  return {
    subject: 'devauth-subject-1',
    email: 'admin@example.com',
    emailVerified: true,
    ...overrides,
  };
}

async function createGlossaUser(
  cms: GlossaCmsRuntime,
  email: string,
  role: 'admin' | 'editor' | 'viewer' = 'admin',
) {
  const record = await cms.create({
    collection: 'users',
    data: { email, name: 'Test User', role, passwordHash: 'unused' },
  });
  return record;
}

describe('resolveOrLinkUser', () => {
  it('links a new subject to an existing user by verified, exact email match', async () => {
    const cms = await createTestRuntime();
    const user = await createGlossaUser(cms, 'admin@example.com');

    const resolved = await resolveOrLinkUser(cms, PROVIDER, identity());

    expect(resolved?.id).toEqual(user.id);
    expect(resolved?.role).toEqual('admin');

    const mapping = await findIdentity(cms, PROVIDER, 'devauth-subject-1');
    expect(mapping).toMatchObject({
      provider: PROVIDER,
      subject: 'devauth-subject-1',
      user: user.id,
    });
  });

  it('denies linking when the email is not verified', async () => {
    const cms = await createTestRuntime();
    await createGlossaUser(cms, 'admin@example.com');

    const resolved = await resolveOrLinkUser(
      cms,
      PROVIDER,
      identity({ emailVerified: false }),
    );

    expect(resolved).toBeNull();
    expect(await findIdentity(cms, PROVIDER, 'devauth-subject-1')).toBeNull();
  });

  it('denies linking when no email is present', async () => {
    const cms = await createTestRuntime();
    await createGlossaUser(cms, 'admin@example.com');

    const resolved = await resolveOrLinkUser(
      cms,
      PROVIDER,
      identity({ email: undefined, emailVerified: false }),
    );

    expect(resolved).toBeNull();
  });

  it('denies linking when no Glossa user matches the email', async () => {
    const cms = await createTestRuntime();

    const resolved = await resolveOrLinkUser(cms, PROVIDER, identity());

    expect(resolved).toBeNull();
    expect(await findIdentity(cms, PROVIDER, 'devauth-subject-1')).toBeNull();
  });

  it('uses the existing mapping on a later login, preserving the user role', async () => {
    const cms = await createTestRuntime();
    const user = await createGlossaUser(cms, 'admin@example.com', 'admin');
    await resolveOrLinkUser(cms, PROVIDER, identity());

    // Promote to viewer directly, as an admin action would.
    await cms.update({
      collection: 'users',
      id: user.id,
      data: { role: 'viewer' },
    });

    const resolved = await resolveOrLinkUser(cms, PROVIDER, identity());

    expect(resolved?.id).toEqual(user.id);
    expect(resolved?.role).toEqual('viewer');
  });

  it('never relinks to a different user when the provider email changes after linking', async () => {
    const cms = await createTestRuntime();
    const originalUser = await createGlossaUser(cms, 'admin@example.com');
    await createGlossaUser(cms, 'someone-else@example.com', 'viewer');
    await resolveOrLinkUser(cms, PROVIDER, identity());

    const resolved = await resolveOrLinkUser(
      cms,
      PROVIDER,
      identity({ email: 'someone-else@example.com' }),
    );

    expect(resolved?.id).toEqual(originalUser.id);
  });

  it('denies access once the linked user has been deleted, without recreating it', async () => {
    const cms = await createTestRuntime();
    const user = await createGlossaUser(cms, 'admin@example.com');
    await resolveOrLinkUser(cms, PROVIDER, identity());

    await cms.delete({ collection: 'users', id: user.id });

    const resolved = await resolveOrLinkUser(cms, PROVIDER, identity());

    expect(resolved).toBeNull();
  });

  it('keeps a single mapping when two concurrent first-logins race for the same subject', async () => {
    const cms = await createTestRuntime();
    const user = await createGlossaUser(cms, 'admin@example.com');

    const [first, second] = await Promise.all([
      linkNewIdentity(
        cms,
        PROVIDER,
        'race-subject',
        user.id,
        'admin@example.com',
      ),
      linkNewIdentity(
        cms,
        PROVIDER,
        'race-subject',
        user.id,
        'admin@example.com',
      ),
    ]);

    expect(first.id).toEqual(second.id);

    const allMappings = await cms.find({
      collection: 'external_identities',
      where: { provider: PROVIDER, subject: 'race-subject' },
    });
    expect(allMappings.docs).toHaveLength(1);
  });
});
