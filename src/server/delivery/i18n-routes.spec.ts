import { createApp, toWebHandler, type EventHandler } from 'h3';

import { getCmsRuntime } from '../cms/runtime';
import { saveCatalog } from '../services/catalog.service';
import {
  createProject,
  deleteProject,
  updateProjectSettings,
} from '../services/project.service';
import manifestHandler from '../routes/i18n/[project]/manifest.json.get';
import localeHandler from '../routes/i18n/[project]/[locale].json.get';

// These route files intentionally never read h3 router params — they re-derive the project slug
// and locale from the request URL themselves (see `delivery-http.ts`) — so mounting each handler
// at the app root and driving it with a real `Request`/`toWebHandler` exercises the exact same
// header/status logic the real deployment does, without needing router-pattern matching here.
//
// This spec deliberately lives outside `src/server/routes/` (even though it tests files inside
// it) — Nitro's dev-server route scanner sweeps that whole tree, and a Vitest `.spec.ts` file
// placed inside it gets pulled into the dev/build bundle too, crashing on the bare `describe`
// global the moment `pnpm dev` starts.
function webHandlerFor(handler: EventHandler) {
  const app = createApp();
  app.use(handler);
  return toWebHandler(app);
}

const manifestFetch = webHandlerFor(manifestHandler);
const localeFetch = webHandlerFor(localeHandler);

async function setUpProject(slug: string, { publicDelivery = true } = {}) {
  const cms = await getCmsRuntime();
  await createProject(cms, {
    name: 'Volt UI',
    slug,
    sourceLocale: 'en',
    locales: ['en', 'es'],
    publicDelivery,
  });
  return cms;
}

describe('GET /i18n/:project/manifest.json', () => {
  it('returns the manifest with the expected headers for an enabled project', async () => {
    const slug = 'manifest-enabled';
    const cms = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', { title: 'Hello' });

    const response = await manifestFetch(
      new Request(`https://glossa.test/i18n/${slug}/manifest.json`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'application/json; charset=utf-8',
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Cache-Control')).toBe('no-store');

    const body = await response.json();
    expect(body.project).toEqual({
      slug,
      name: 'Volt UI',
      sourceLocale: 'en',
      locales: ['en', 'es'],
    });
    expect(Object.keys(body.catalogs)).toEqual(['en']);
  });

  it('returns 404 for a project with delivery disabled', async () => {
    const slug = 'manifest-disabled';
    await setUpProject(slug, { publicDelivery: false });

    const response = await manifestFetch(
      new Request(`https://glossa.test/i18n/${slug}/manifest.json`),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it('returns 404 for an unknown project', async () => {
    const response = await manifestFetch(
      new Request('https://glossa.test/i18n/does-not-exist/manifest.json'),
    );

    expect(response.status).toBe(404);
  });
});

describe('GET /i18n/:project/:locale.json', () => {
  it('returns raw catalog JSON with an ETag for an enabled project', async () => {
    const slug = 'catalog-enabled';
    const cms = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', { nav: { home: 'Home' } });

    const response = await localeFetch(
      new Request(`https://glossa.test/i18n/${slug}/en.json`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(
      'application/json; charset=utf-8',
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('ETag')).toMatch(/^".+"$/);
    expect(await response.json()).toEqual({ nav: { home: 'Home' } });
  });

  it('returns 304 with no body when If-None-Match matches the current revision', async () => {
    const slug = 'catalog-conditional';
    const cms = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', { title: 'v1' });

    const first = await localeFetch(
      new Request(`https://glossa.test/i18n/${slug}/en.json`),
    );
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();

    const second = await localeFetch(
      new Request(`https://glossa.test/i18n/${slug}/en.json`, {
        headers: { 'If-None-Match': etag! },
      }),
    );

    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
    expect(second.headers.get('ETag')).toBe(etag);
  });

  it('returns 404 for an unknown locale', async () => {
    const slug = 'catalog-unknown-locale';
    await setUpProject(slug);

    const response = await localeFetch(
      new Request(`https://glossa.test/i18n/${slug}/fr.json`),
    );

    expect(response.status).toBe(404);
  });

  it('returns 404 for a configured locale with no catalog yet', async () => {
    const slug = 'catalog-not-created';
    await setUpProject(slug);

    const response = await localeFetch(
      new Request(`https://glossa.test/i18n/${slug}/es.json`),
    );

    expect(response.status).toBe(404);
  });

  it('returns 404 when delivery is disabled', async () => {
    const slug = 'catalog-disabled';
    const cms = await setUpProject(slug, { publicDelivery: false });
    await saveCatalog(cms, slug, 'en', { title: 'v1' });

    const response = await localeFetch(
      new Request(`https://glossa.test/i18n/${slug}/en.json`),
    );

    expect(response.status).toBe(404);
  });
});

describe('revocation of public delivery', () => {
  const manifestUrl = (slug: string) =>
    `https://glossa.test/i18n/${slug}/manifest.json`;
  const localeUrl = (slug: string) =>
    `https://glossa.test/i18n/${slug}/en.json`;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A Cache API stand-in pre-seeded with a successful response for every URL. */
  function stubPoisonedEdgeCache(urls: string[]) {
    const stored = new Map(
      urls.map((url) => [
        url,
        new Response('{"stale":"secret"}', {
          headers: {
            'Cache-Control': 'public, max-age=0, s-maxage=30',
            ETag: '"stale"',
          },
        }),
      ]),
    );
    const cache = {
      match: vi.fn(async (request: Request | string) => {
        const url = typeof request === 'string' ? request : request.url;
        return stored.get(url)?.clone();
      }),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => true),
    };
    vi.stubGlobal('caches', { default: cache });
    return cache;
  }

  it('never consults caches.default, so a cached copy cannot bypass the project state', async () => {
    const slug = 'revoke-cache-bypass';
    const cms = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', { title: 'live' });
    const cache = stubPoisonedEdgeCache([manifestUrl(slug), localeUrl(slug)]);

    await updateProjectSettings(cms, slug, { publicDelivery: false });

    const manifest = await manifestFetch(new Request(manifestUrl(slug)));
    const catalog = await localeFetch(new Request(localeUrl(slug)));

    expect(manifest.status).toBe(404);
    expect(catalog.status).toBe(404);
    expect(await catalog.text()).toBe('');
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();

    await updateProjectSettings(cms, slug, { publicDelivery: true });
    const live = await localeFetch(new Request(localeUrl(slug)));

    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ title: 'live' });
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('returns 404 at the same URLs once delivery is disabled after being served', async () => {
    const slug = 'revoke-disabled';
    const cms = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', { title: 'v1' });

    expect((await manifestFetch(new Request(manifestUrl(slug)))).status).toBe(
      200,
    );
    expect((await localeFetch(new Request(localeUrl(slug)))).status).toBe(200);

    await updateProjectSettings(cms, slug, { publicDelivery: false });

    expect((await manifestFetch(new Request(manifestUrl(slug)))).status).toBe(
      404,
    );
    expect((await localeFetch(new Request(localeUrl(slug)))).status).toBe(404);
  });

  it('returns 404 at the same URLs once the project is deleted after being served', async () => {
    const slug = 'revoke-deleted';
    const cms = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', { title: 'v1' });

    expect((await manifestFetch(new Request(manifestUrl(slug)))).status).toBe(
      200,
    );
    expect((await localeFetch(new Request(localeUrl(slug)))).status).toBe(200);

    await deleteProject(cms, slug);

    expect((await manifestFetch(new Request(manifestUrl(slug)))).status).toBe(
      404,
    );
    expect((await localeFetch(new Request(localeUrl(slug)))).status).toBe(404);
  });

  it('does not answer 304 to a previously valid ETag after delivery is disabled', async () => {
    const slug = 'revoke-etag';
    const cms = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', { title: 'v1' });

    const first = await localeFetch(new Request(localeUrl(slug)));
    const etag = first.headers.get('ETag')!;
    const conditional = () =>
      new Request(localeUrl(slug), { headers: { 'If-None-Match': etag } });

    const notModified = await localeFetch(conditional());
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('Cache-Control')).toBe('no-store');

    await updateProjectSettings(cms, slug, { publicDelivery: false });

    const revoked = await localeFetch(conditional());
    expect(revoked.status).toBe(404);
    expect(revoked.headers.get('ETag')).toBeNull();
  });

  it('issues a new ETag after a catalog update so the old one no longer matches', async () => {
    const slug = 'revoke-new-revision';
    const cms = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', { title: 'v1' });

    const first = await localeFetch(new Request(localeUrl(slug)));
    const oldEtag = first.headers.get('ETag')!;

    await saveCatalog(cms, slug, 'en', { title: 'v2' });

    const second = await localeFetch(
      new Request(localeUrl(slug), { headers: { 'If-None-Match': oldEtag } }),
    );

    expect(second.status).toBe(200);
    expect(second.headers.get('ETag')).not.toBe(oldEtag);
    expect(await second.json()).toEqual({ title: 'v2' });
  });

  it('marks every public response non-cacheable', async () => {
    const slug = 'revoke-headers';
    const cms = await setUpProject(slug);
    await saveCatalog(cms, slug, 'en', { title: 'v1' });

    const responses = [
      await manifestFetch(new Request(manifestUrl(slug))),
      await localeFetch(new Request(localeUrl(slug))),
      await localeFetch(
        new Request(`https://glossa.test/i18n/${slug}/es.json`),
      ),
      await localeFetch(new Request('https://glossa.test/i18n/nope/en.json')),
      await manifestFetch(
        new Request('https://glossa.test/i18n/nope/manifest.json'),
      ),
    ];

    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 404, 404, 404,
    ]);
    for (const response of responses) {
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });
});
