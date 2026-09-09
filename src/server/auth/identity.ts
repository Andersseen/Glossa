/** DevAuth `/userinfo` response shape actually verified against `@better-auth/oauth-provider`. */
export interface DevAuthUserinfo {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
}

/**
 * Normalized external identity Glossa reasons about. `emailVerified` gates whether `email` may be
 * used for first-time account linking (spec: "verified/trusted provider email") — an unverified or
 * absent email can never link an account, so callers must check it rather than just truthiness of
 * `email`.
 */
export interface ExternalIdentity {
  subject: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

export class MissingSubjectError extends Error {
  constructor() {
    super('DevAuth userinfo response is missing a subject.');
  }
}

/** Throws {@link MissingSubjectError} if `sub` is absent — the one field this boundary requires. */
export function normalizeIdentity(userinfo: DevAuthUserinfo): ExternalIdentity {
  const subject = typeof userinfo.sub === 'string' ? userinfo.sub.trim() : '';

  if (!subject) {
    throw new MissingSubjectError();
  }

  const email =
    typeof userinfo.email === 'string' ? userinfo.email.trim() : undefined;

  return {
    subject,
    ...(email ? { email } : {}),
    emailVerified: userinfo.email_verified === true,
    ...(typeof userinfo.name === 'string' && userinfo.name.trim()
      ? { name: userinfo.name.trim() }
      : {}),
    ...(typeof userinfo.picture === 'string' && userinfo.picture.trim()
      ? { picture: userinfo.picture.trim() }
      : {}),
  };
}
