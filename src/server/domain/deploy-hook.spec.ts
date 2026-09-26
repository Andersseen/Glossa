import {
  DeployHookValidationError,
  hasCommittedWrite,
  maskDeployHookUrl,
  parseCloudflareDeployHookUrl,
  parseDeployHookProvider,
  toDeployHookView,
  type DeployHook,
} from './deploy-hook';

const WORKERS_HOOK =
  'https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/5b0c1f8e-3a2d-4d6e-9f11-2a7c9e0d4b1a';
const PAGES_HOOK =
  'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/0f2d7c6a-94b1-4e4f-8f3a-1c2b3d4e5f60';

describe('parseCloudflareDeployHookUrl', () => {
  it.each([
    ['Workers Builds', WORKERS_HOOK],
    ['Pages', PAGES_HOOK],
  ])('accepts a current %s deploy hook URL', (_label, url) => {
    expect(parseCloudflareDeployHookUrl(url)).toBe(url);
  });

  it('trims surrounding whitespace from a pasted URL', () => {
    expect(parseCloudflareDeployHookUrl(`  ${WORKERS_HOOK}\n`)).toBe(
      WORKERS_HOOK,
    );
  });

  it('accepts a non-UUID opaque identifier', () => {
    const url =
      'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/SUPER_SECRET_DEPLOY_HOOK_ABC123';
    expect(parseCloudflareDeployHookUrl(url)).toBe(url);
  });

  it.each([
    ['http', WORKERS_HOOK.replace('https:', 'http:')],
    [
      'another domain',
      'https://example.com/client/v4/pages/webhooks/deploy_hooks/abcdefgh1234',
    ],
    [
      'a look-alike subdomain',
      'https://api.cloudflare.com.evil.test/client/v4/pages/webhooks/deploy_hooks/abcdefgh1234',
    ],
    [
      'localhost',
      'https://localhost/client/v4/pages/webhooks/deploy_hooks/abcdefgh1234',
    ],
    [
      'an IPv4 literal',
      'https://127.0.0.1/client/v4/pages/webhooks/deploy_hooks/abcdefgh1234',
    ],
    [
      'an IPv6 literal',
      'https://[::1]/client/v4/pages/webhooks/deploy_hooks/abcdefgh1234',
    ],
    [
      'credentials',
      'https://user:pass@api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/abcdefgh1234',
    ],
    [
      'an explicit port',
      'https://api.cloudflare.com:8443/client/v4/pages/webhooks/deploy_hooks/abcdefgh1234',
    ],
    ['a fragment', `${WORKERS_HOOK}#frag`],
    ['a query string', `${WORKERS_HOOK}?x=1`],
    [
      'a path without deploy_hooks',
      'https://api.cloudflare.com/client/v4/accounts/abc/workers/scripts',
    ],
    [
      'a deploy_hooks path with no id',
      'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/',
    ],
    ['a trailing path after the id', `${WORKERS_HOOK}/extra`],
    [
      'a path outside /client/v4',
      'https://api.cloudflare.com/deploy_hooks/abcdefgh1234',
    ],
    [
      'a too-short id',
      'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/abc',
    ],
    ['invalid text', 'not a url'],
    ['an empty string', '   '],
    ['a non-string', 42],
  ])('rejects %s', (_label, input) => {
    expect(() => parseCloudflareDeployHookUrl(input)).toThrow(
      DeployHookValidationError,
    );
  });
});

describe('parseDeployHookProvider', () => {
  it('defaults to and accepts cloudflare only', () => {
    expect(parseDeployHookProvider(undefined)).toBe('cloudflare');
    expect(parseDeployHookProvider('cloudflare')).toBe('cloudflare');
    expect(() => parseDeployHookProvider('vercel')).toThrow(
      DeployHookValidationError,
    );
  });
});

describe('maskDeployHookUrl', () => {
  it('keeps only the last characters of the identifier', () => {
    const secret = 'SUPER_SECRET_DEPLOY_HOOK_ABC123';
    const masked = maskDeployHookUrl(
      `https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/${secret}`,
    );

    expect(masked).toBe('https://api.cloudflare.com/…/deploy_hooks/••••••C123');
    expect(masked).not.toContain(secret);
    expect(masked).not.toContain('SUPER_SECRET');
  });

  it('reveals nothing of a short identifier', () => {
    expect(
      maskDeployHookUrl(
        'https://api.cloudflare.com/client/v4/pages/webhooks/deploy_hooks/abcdefgh',
      ),
    ).toBe('https://api.cloudflare.com/…/deploy_hooks/••••••');
  });
});

describe('toDeployHookView', () => {
  it('reports an unconfigured project', () => {
    expect(toDeployHookView(null)).toEqual({ configured: false });
  });

  it('never includes the stored URL', () => {
    const hook: DeployHook = {
      id: 'hook-1',
      projectId: 'project-1',
      provider: 'cloudflare',
      url: WORKERS_HOOK,
      enabled: true,
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-09-25T00:00:00.000Z',
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastStatusCode: null,
      lastError: null,
    };

    const view = toDeployHookView(hook);

    expect(view).toMatchObject({ configured: true, enabled: true });
    expect(JSON.stringify(view)).not.toContain('5b0c1f8e');
  });
});

describe('hasCommittedWrite', () => {
  it('is true when at least one catalog was written', () => {
    expect(hasCommittedWrite([{ status: 'failed' }, { status: 'saved' }])).toBe(
      true,
    );
    expect(hasCommittedWrite([{ status: 'imported' }])).toBe(true);
  });

  it('is false when nothing was written', () => {
    expect(hasCommittedWrite([])).toBe(false);
    expect(hasCommittedWrite([{ status: 'failed' }])).toBe(false);
  });
});
