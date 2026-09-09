import { NotFoundError, UniqueConstraintError } from '@forge-cms/runtime';

import type { ExternalIdentity } from '../auth/identity';
import type { GlossaCmsRuntime } from '../cms/runtime';

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
 * insensitive) the DevAuth-verified email. Never used once a `[provider, subject]` mapping exists —
 * see spec's "email change safety" (subject remains authoritative after the first link).
 */
export async function findGlossaUserByVerifiedEmail(
  cms: GlossaCmsRuntime,
  email: string,
): Promise<GlossaUserRecord | null> {
  const record = await cms.findOne({
    collection: USERS_COLLECTION,
    where: { email: normalizeEmail(email) },
  });

  return record ? (record as unknown as GlossaUserRecord) : null;
}

/**
 * The whole account-linking policy, in one place per AGENTS.md ("keep domain logic out of HTTP
 * handlers"). `provider + subject` is checked first and, once a mapping exists, is authoritative
 * forever — a later change to the provider email never relinks or recreates a user (spec: "email
 * change safety"). Only a brand-new subject may be linked, and only by an exact, DevAuth-verified
 * email match against an *existing* Glossa user; anything else is denied, never auto-created.
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
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  if (!identity.email || !identity.emailVerified) {
    return null;
  }

  const matchedUser = await findGlossaUserByVerifiedEmail(cms, identity.email);
  if (!matchedUser) {
    return null;
  }

  await linkNewIdentity(
    cms,
    provider,
    identity.subject,
    matchedUser.id,
    identity.email,
  );
  return matchedUser;
}
