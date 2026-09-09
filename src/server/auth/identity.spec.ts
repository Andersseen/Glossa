import { MissingSubjectError, normalizeIdentity } from './identity';

describe('normalizeIdentity', () => {
  it('normalizes a full userinfo response', () => {
    const identity = normalizeIdentity({
      sub: 'user-123',
      email: 'Admin@Example.com',
      email_verified: true,
      name: 'Admin',
      picture: 'https://example.com/avatar.png',
    });

    expect(identity).toEqual({
      subject: 'user-123',
      email: 'Admin@Example.com',
      emailVerified: true,
      name: 'Admin',
      picture: 'https://example.com/avatar.png',
    });
  });

  it('throws when the subject is missing', () => {
    expect(() => normalizeIdentity({})).toThrow(MissingSubjectError);
    expect(() => normalizeIdentity({ sub: '' })).toThrow(MissingSubjectError);
    expect(() => normalizeIdentity({ sub: 42 })).toThrow(MissingSubjectError);
  });

  it('marks email as unverified when the field is absent', () => {
    const identity = normalizeIdentity({ sub: 'user-123', email: 'a@b.com' });

    expect(identity.emailVerified).toBe(false);
  });

  it('marks email as unverified when the provider says so explicitly', () => {
    const identity = normalizeIdentity({
      sub: 'user-123',
      email: 'a@b.com',
      email_verified: false,
    });

    expect(identity.emailVerified).toBe(false);
  });

  it('omits email entirely when the scope was not granted', () => {
    const identity = normalizeIdentity({ sub: 'user-123' });

    expect(identity.email).toBeUndefined();
    expect(identity.emailVerified).toBe(false);
  });
});
