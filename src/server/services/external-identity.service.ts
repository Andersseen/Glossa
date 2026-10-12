import { NotFoundError, UniqueConstraintError } from '@forge-cms/runtime';

import type { ExternalIdentity } from '../auth/identity';
import { getPasswordAuthAdapter, type GlossaCmsRuntime } from '../cms/runtime';

const EXTERNAL_IDENTITIES_COLLECTION = 'external_identities';
const USERS_COLLECTION = 'users';

export interface ExternalIdentityRecord {
  id: string;
  provider: string;
  subject: string;
  user: string;
  emailSnapshot?: string;
}

export interface GlossaUserRecord {
  id: string;
  email?: string;
  name?: string;
  role?: string;
}

/** Case/whitespace-insensitive, matching `UsersCollectionAuthAdapter`'s own email storage convention. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `issuer + subject` (here, `provider` + `subject`) is the stable identity key — never email. */
export async function findIdentity(
  cms: GlossaCmsRuntime,
  provider: string,
  subject: string,
): Promise<ExternalIdentityRecord | null> {
  const record = await cms.findOne({
    collection: EXTERNAL_IDENTITIES_COLLECTION,
    where: { provider, subject },
  });

  return record ? (record as unknown as ExternalIdentityRecord) : null;
}

/**
 * Creates the first-time mapping for a DevAuth identity. If a concurrent request already created the
 * same `[provider, subject]` mapping, the unique index rejects this write — re-fetch and return the
 * winning mapping instead of erroring, so a duplicate-subject race still ends with exactly one
 * mapping and a successful sign-in, never a relink or a crash.
 */
export async function linkNewIdentity(
  cms: GlossaCmsRuntime,
  provider: string,
  subject: string,
  userId: string,
  emailSnapshot?: string,
): Promise<ExternalIdentityRecord> {
  try {
    const record = await cms.create({
      collection: EXTERNAL_IDENTITIES_COLLECTION,
      data: {
        provider,
        subject,
        user: userId,
        ...(emailSnapshot ? { emailSnapshot } : {}),
      },
    });

    return record as unknown as ExternalIdentityRecord;
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      const existing = await findIdentity(cms, provider, subject);
      if (existing) return existing;
    }

    throw error;
  }
}

/**
 * First-time linking only: an existing Glossa user whose email exactly matches (case/whitespace
 * insensitive) the provider's. Never used once a `[provider, subject]` mapping exists — the subject
 * remains authoritative after the first link, so a changed provider email cannot move the link.
 */
export async function findGlossaUserByEmail(
  cms: GlossaCmsRuntime,
  email: string,
): Promise<GlossaUserRecord | null> {
  const record = await cms.findOne({
    collection: USERS_COLLECTION,
    where: { email: normalizeEmail(email) },
  });

  return record ? (record as unknown as GlossaUserRecord) : null;
}

function randomUnusablePassword(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/**
 * Provisions a Glossa user for a DevAuth identity that has never signed in here before, and links it.
 * The first user in an empty install becomes `admin` (the same rule
 * `UsersCollectionAuthAdapter.createUser`/`signup` already applies to the password path); anyone
 * after that starts as `viewer` and an admin can promote them.
 *
 * The password is a random value that is discarded, so an SSO-provisioned account cannot be signed
 * into with a password unless one is deliberately set later.
 */
async function provisionUserFromIdentity(
  cms: GlossaCmsRuntime,
  provider: string,
  identity: ExternalIdentity,
  email: string,
): Promise<GlossaUserRecord> {
  const isFirstUser = (await cms.count({ collection: USERS_COLLECTION })) === 0;

  // The users collection is auth-managed, so generic CRUD cannot create rows in it. The adapter
  // requires a password, so give the account a random one that is never stored or shown anywhere:
  // password sign-in stays impossible until an admin deliberately sets a real one.
  const result = await getPasswordAuthAdapter(cms).createUser({
    email: normalizeEmail(email),
    ...(identity.name ? { name: identity.name } : {}),
    password: randomUnusablePassword(),
    role: isFirstUser ? 'admin' : 'viewer',
  });

  if (!result.ok) {
    throw new Error(
      `Could not provision a user for the identity: ${result.reason}.`,
    );
  }

  const created = await cms.findByID({
    collection: USERS_COLLECTION,
    id: result.user.id,
  });

  await linkNewIdentity(cms, provider, identity.subject, created.id, email);
  return created as unknown as GlossaUserRecord;
}

/**
 * The whole account-linking policy, in one place per AGENTS.md ("keep domain logic out of HTTP
 * handlers").
 *
 * Who is allowed to exist at all is DevAuth's decision, not Glossa's: every account-creation path on
 * that side (password sign-up and GitHub alike) runs through its `SIGNUP_ALLOWLIST` check in
 * `databaseHooks.user.create.before`, and fails closed. Reaching this function therefore already
 * means the provider vouched for the person, which is the same trust boundary DevFlare's and
 * Imageryx's own consumers rely on. Glossa's job is only to decide *what they may do* — hence a role
 * on a local user row, never a second gate on *who they are*.
 *
 * Resolution order:
 * 1. `provider + subject` — the stable OIDC identity key. Once a mapping exists it is authoritative
 *    forever, so a later change to the provider's email never relinks or recreates a user.
 * 2. An exact email match against an existing Glossa user — adopts accounts that predate SSO
 *    (a bootstrapped admin, say) instead of duplicating them. Email is only ever a *hint* for this
 *    first link; the subject takes over immediately afterwards.
 * 3. Otherwise provision a new user (see {@link provisionUserFromIdentity}).
 *
 * Note there is deliberately no `email_verified` requirement: this DevAuth deployment has no
 * transactional email provider and runs with `requireEmailVerification: false`, so legitimate
 * password accounts there carry `email_verified: false`. Gating on it would reject the provider's own
 * valid identities while adding nothing — the allowlist, not the flag, is what constrains access.
 */
export async function resolveOrLinkUser(
  cms: GlossaCmsRuntime,
  provider: string,
  identity: ExternalIdentity,
): Promise<GlossaUserRecord | null> {
  const existingMapping = await findIdentity(cms, provider, identity.subject);

  if (existingMapping) {
    try {
      const user = await cms.findByID({
        collection: USERS_COLLECTION,
        id: existingMapping.user,
      });
      return user as unknown as GlossaUserRecord;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      // The linked user was deleted. Auth-managed users never run relation cascades, so the mapping
      // is left behind; drop it and fall through to link or provision the person afresh.
      await cms.delete({
        collection: EXTERNAL_IDENTITIES_COLLECTION,
        id: existingMapping.id,
      });
    }
  }

  // The users collection requires a unique email, so an identity with no email at all cannot be
  // stored as a user. DevAuth always returns one for the `email` scope; this is a guard, not a gate.
  if (!identity.email) {
    return null;
  }

  const matchedUser = await findGlossaUserByEmail(cms, identity.email);

  if (matchedUser) {
    await linkNewIdentity(
      cms,
      provider,
      identity.subject,
      matchedUser.id,
      identity.email,
    );
    return matchedUser;
  }

  return provisionUserFromIdentity(cms, provider, identity, identity.email);
}
