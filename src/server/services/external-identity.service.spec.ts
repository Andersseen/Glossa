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

  it('links an unverified provider email, since this provider cannot verify emails at all', async () => {
    const cms = await createTestRuntime();
    const user = await createGlossaUser(cms, 'admin@example.com');

    const resolved = await resolveOrLinkUser(
      cms,
      PROVIDER,
      identity({ emailVerified: false }),
    );

    expect(resolved?.id).toEqual(user.id);
  });

  it('denies an identity with no email at all, which cannot become a user row', async () => {
    const cms = await createTestRuntime();
    await createGlossaUser(cms, 'admin@example.com');

    const resolved = await resolveOrLinkUser(
      cms,
      PROVIDER,
      identity({ email: undefined, emailVerified: false }),
    );

    expect(resolved).toBeNull();
  });

  it('provisions the first user as an admin when the install is empty', async () => {
    const cms = await createTestRuntime();

    const resolved = await resolveOrLinkUser(cms, PROVIDER, identity());

    expect(resolved).toMatchObject({
      email: 'admin@example.com',
      role: 'admin',
    });
    expect(
      await findIdentity(cms, PROVIDER, 'devauth-subject-1'),
    ).toMatchObject({
      user: resolved?.id,
    });
  });

  it('provisions a later unknown identity as a viewer, not an admin', async () => {
    const cms = await createTestRuntime();
    await createGlossaUser(cms, 'admin@example.com');

    const resolved = await resolveOrLinkUser(
      cms,
      PROVIDER,
      identity({
        subject: 'devauth-subject-2',
        email: 'someone-new@example.com',
      }),
    );

    expect(resolved).toMatchObject({
      email: 'someone-new@example.com',
      role: 'viewer',
    });
  });

  it('never gives a provisioned user a usable password', async () => {
    const cms = await createTestRuntime();
    const resolved = await resolveOrLinkUser(cms, PROVIDER, identity());
    if (!resolved)
      throw new Error('Expected the first identity to be provisioned.');

    const stored = await cms.findByID({
      collection: 'users',
      id: resolved.id,
    });

    expect(stored['passwordHash']).toBeFalsy();
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

  // Deleting a user is not a revocation mechanism under this model: who may hold an identity is
  // DevAuth's decision (its signup allowlist), so the same person signing in again is provisioned a
  // fresh account. What deletion *does* guarantee is that their existing sessions die immediately and
  // their old row — including its role — is gone (see sso-session.service.spec.ts). Revoking access
  // for good means removing them at DevAuth.
  it('provisions a fresh account if a deleted user signs in again, rather than restoring the old row', async () => {
    const cms = await createTestRuntime();
    const user = await createGlossaUser(cms, 'admin@example.com');
    await resolveOrLinkUser(cms, PROVIDER, identity());

    await cms.delete({ collection: 'users', id: user.id });

    const resolved = await resolveOrLinkUser(cms, PROVIDER, identity());

    expect(resolved).not.toBeNull();
    expect(resolved?.id).not.toEqual(user.id);
    expect(
      await findIdentity(cms, PROVIDER, 'devauth-subject-1'),
    ).toMatchObject({ user: resolved?.id });
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
