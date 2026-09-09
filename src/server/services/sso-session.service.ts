import type { GlossaCmsRuntime } from '../cms/runtime';
import {
  createOpaqueSsoToken,
  hashSsoToken,
  SSO_SESSION_TTL_MS,
} from '../auth/session-token';

const SESSIONS_COLLECTION = 'sso_sessions';

/**
 * Creates a Glossa-owned opaque session for a DevAuth-originated sign-in and returns the raw token —
 * the only time it ever exists outside a cookie. Only its SHA-256 hash is persisted.
 */
export async function createSsoSession(
  cms: GlossaCmsRuntime,
  userId: string,
  provider: string,
): Promise<{ token: string }> {
  const token = createOpaqueSsoToken();
  const tokenHash = await hashSsoToken(token);
  const expiresAt = new Date(Date.now() + SSO_SESSION_TTL_MS);

  await cms.create({
    collection: SESSIONS_COLLECTION,
    data: { tokenHash, user: userId, provider, expiresAt },
  });

  return { token };
}

/**
 * Revokes (deletes) the session row for a raw token, so a replay of it after logout fails. A token
 * with no matching row (already revoked, expired-and-pruned, or never ours) is a no-op — logout stays
 * idempotent.
 */
export async function revokeSsoSessionByToken(
  cms: GlossaCmsRuntime,
  token: string,
): Promise<void> {
  const tokenHash = await hashSsoToken(token);
  const existing = await cms.findOne({
    collection: SESSIONS_COLLECTION,
    where: { tokenHash },
  });

  if (existing) {
    await cms.delete({ collection: SESSIONS_COLLECTION, id: existing.id });
  }
}
