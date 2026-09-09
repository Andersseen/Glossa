import {
  deriveCodeChallengeS256,
  generateCodeVerifier,
  generateNonce,
  generateState,
} from './pkce';

describe('pkce', () => {
  it('generates high-entropy, unique state values', () => {
    const a = generateState();
    const b = generateState();

    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it('generates high-entropy, unique nonce values', () => {
    const a = generateNonce();
    const b = generateNonce();

    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });

  it('generates a code verifier within the RFC 7636 length bounds', () => {
    const verifier = generateCodeVerifier();

    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('derives a deterministic S256 code challenge for a given verifier', async () => {
    const verifier = generateCodeVerifier();

    const challengeA = await deriveCodeChallengeS256(verifier);
    const challengeB = await deriveCodeChallengeS256(verifier);

    expect(challengeA).toEqual(challengeB);
    expect(challengeA).not.toEqual(verifier);
    expect(challengeA).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('derives different challenges for different verifiers', async () => {
    const challengeA = await deriveCodeChallengeS256(generateCodeVerifier());
    const challengeB = await deriveCodeChallengeS256(generateCodeVerifier());

    expect(challengeA).not.toEqual(challengeB);
  });
});
