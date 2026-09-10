import {
  projectTokenStatus,
  validateCreateProjectTokenInput,
  ProjectTokenValidationError,
} from './project-token';

describe('project token domain validation', () => {
  it('accepts a valid name and scopes', () => {
    expect(
      validateCreateProjectTokenInput({
        name: '  Volt UI — CI  ',
        scopes: ['catalog:read'],
      }),
    ).toEqual({ name: 'Volt UI — CI', scopes: ['catalog:read'] });
  });

  it('normalizes catalog:write to always include catalog:read', () => {
    expect(
      validateCreateProjectTokenInput({
        name: 'Write only request',
        scopes: ['catalog:write'],
      }),
    ).toEqual({
      name: 'Write only request',
      scopes: ['catalog:read', 'catalog:write'],
    });
  });

  it('dedupes and orders scopes deterministically', () => {
    expect(
      validateCreateProjectTokenInput({
        name: 'Dedupe',
        scopes: ['catalog:write', 'catalog:read', 'catalog:write'],
      }),
    ).toEqual({
      name: 'Dedupe',
      scopes: ['catalog:read', 'catalog:write'],
    });
  });

  it('rejects a missing or blank name', () => {
    expect(() =>
      validateCreateProjectTokenInput({ scopes: ['catalog:read'] }),
    ).toThrow('Token name is required.');
    expect(() =>
      validateCreateProjectTokenInput({
        name: '   ',
        scopes: ['catalog:read'],
      }),
    ).toThrow(ProjectTokenValidationError);
  });

  it('rejects a name over the length limit', () => {
    expect(() =>
      validateCreateProjectTokenInput({
        name: 'x'.repeat(121),
        scopes: ['catalog:read'],
      }),
    ).toThrow('Token name must be 120 characters or fewer.');
  });

  it('rejects an empty scope list', () => {
    expect(() =>
      validateCreateProjectTokenInput({ name: 'No scopes', scopes: [] }),
    ).toThrow('At least one scope is required.');
    expect(() =>
      validateCreateProjectTokenInput({ name: 'No scopes' }),
    ).toThrow(ProjectTokenValidationError);
  });

  it('rejects an unknown scope — Glossa scopes are whitelisted, not arbitrary Forge strings', () => {
    expect(() =>
      validateCreateProjectTokenInput({
        name: 'Bad scope',
        scopes: ['admin', 'catalog:read'],
      }),
    ).toThrow('Unknown scope "admin".');
  });

  it('accepts a future expiresAt and normalizes it to ISO', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const result = validateCreateProjectTokenInput({
      name: 'Expiring',
      scopes: ['catalog:read'],
      expiresAt: future,
    });
    expect(result.expiresAt).toBe(future);
  });

  it('rejects a past or invalid expiresAt', () => {
    expect(() =>
      validateCreateProjectTokenInput({
        name: 'Past',
        scopes: ['catalog:read'],
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).toThrow('expiresAt must be in the future.');

    expect(() =>
      validateCreateProjectTokenInput({
        name: 'Invalid',
        scopes: ['catalog:read'],
        expiresAt: 'not-a-date',
      }),
    ).toThrow('expiresAt is not a valid date.');
  });

  it('omits expiresAt entirely when not provided', () => {
    const result = validateCreateProjectTokenInput({
      name: 'No expiry',
      scopes: ['catalog:read'],
    });
    expect('expiresAt' in result).toBe(false);
  });
});

describe('projectTokenStatus', () => {
  it('is active with no revokedAt/expiresAt', () => {
    expect(projectTokenStatus({})).toBe('active');
  });

  it('is revoked when revokedAt is set, regardless of expiresAt', () => {
    expect(
      projectTokenStatus({
        revokedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toBe('revoked');
  });

  it('is expired when expiresAt is in the past and not revoked', () => {
    expect(
      projectTokenStatus({ expiresAt: new Date(Date.now() - 1).toISOString() }),
    ).toBe('expired');
  });

  it('is active when expiresAt is in the future', () => {
    expect(
      projectTokenStatus({
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toBe('active');
  });
});
