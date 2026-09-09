import {
  extractBearerToken,
  ForgeAuthError,
  parseCookieToken,
  type AuthAdapter,
  type AuthSession,
  type AuthUser,
} from '@forge-cms/auth';
import type { DatabaseAdapter, DatabaseRecord } from '@forge-cms/db';

import { hashSsoToken, SSO_TOKEN_PREFIX } from './session-token';

const USERS_COLLECTION = 'users';
const SESSIONS_COLLECTION = 'sso_sessions';

export interface GlossaSsoAuthEnv {
  userDatabase?: DatabaseAdapter;
}

function sanitizeUser(record: DatabaseRecord): AuthUser {
  const { passwordHash: _ignored, ...rest } = record;
  void _ignored;
  return rest as unknown as AuthUser;
}

function isExpired(expiresAt: unknown): boolean {
  const date =
    expiresAt instanceof Date ? expiresAt : new Date(expiresAt as string);
  return Number.isNaN(date.getTime()) || date.getTime() <= Date.now();
}

/**
 * Validates Glossa's own opaque DevAuth-SSO session tokens (`glossa_sso_...`). Talks to the raw
 * `DatabaseAdapter` rather than the `ForgeCmsRuntime` Local API — an `AuthAdapter` is constructed and
 * `init()`-ed before the runtime that would own it exists, exactly the same constraint
 * `UsersCollectionAuthAdapter` works under. Always reloads the current user row so a role change or
 * a deleted user takes effect immediately, without waiting for the session to expire.
 */
export class GlossaSsoAuthAdapter implements AuthAdapter {
  readonly name = 'glossa-sso';
  private db?: DatabaseAdapter;

  init(env?: GlossaSsoAuthEnv): this {
    if (env?.userDatabase) {
      this.db = env.userDatabase;
    }
    return this;
  }

  private getDb(): DatabaseAdapter {
    if (!this.db) {
      throw new Error(
        'GlossaSsoAuthAdapter not initialized. Call init() with userDatabase.',
      );
    }
    return this.db;
  }

  extractToken(request: Request): string | null {
    return extractBearerToken(request) ?? parseCookieToken(request);
  }

  /** Cheap format check for `CompositeAuthAdapter` routing: only tokens with our own prefix are ours. */
  canHandleToken(token: string): boolean {
    return token.startsWith(SSO_TOKEN_PREFIX);
  }

  async validateSession(token: string): Promise<AuthSession | null> {
    if (!token.startsWith(SSO_TOKEN_PREFIX)) {
      return null;
    }

    const db = this.getDb();
    const tokenHash = await hashSsoToken(token);
    const sessions = await db.findMany({
      collection: SESSIONS_COLLECTION,
      where: { tokenHash },
      limit: 1,
    });
    const session = sessions[0];

    if (!session || isExpired(session['expiresAt'])) {
      return null;
    }

    const userId = session['user'];
    if (typeof userId !== 'string') {
      return null;
    }

    const user = await db.findById(USERS_COLLECTION, userId);
    if (!user) {
      return null;
    }

    return { user: sanitizeUser(user) };
  }

  async requireAuth(request: Request): Promise<AuthUser> {
    const token = this.extractToken(request);
    if (!token) throw new ForgeAuthError('Unauthorized', 'unauthorized');

    const session = await this.validateSession(token);
    if (!session) throw new ForgeAuthError('Unauthorized', 'unauthorized');

    return session.user;
  }
}
