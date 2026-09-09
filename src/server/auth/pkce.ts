import { randomBase64Url, sha256Base64Url } from './encoding';

/** Opaque anti-CSRF value for the OAuth authorization request. */
export function generateState(): string {
  return randomBase64Url(32);
}

/** Opaque replay-binding value sent to the authorize endpoint as `nonce`. */
export function generateNonce(): string {
  return randomBase64Url(32);
}

/** RFC 7636 code verifier: 43-128 characters, here a 32-byte random value (43 chars base64url). */
export function generateCodeVerifier(): string {
  return randomBase64Url(32);
}

/** RFC 7636 S256 code challenge: base64url(SHA-256(verifier)). */
export function deriveCodeChallengeS256(verifier: string): Promise<string> {
  return sha256Base64Url(verifier);
}
