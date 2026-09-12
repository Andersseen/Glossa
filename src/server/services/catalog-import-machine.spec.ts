import { createApp, toWebHandler, type EventHandler } from 'h3';

import { getCmsRuntime } from '../cms/runtime';
import machineCatalogHandler from '../routes/api/machine/v1/catalogs/[locale].get';
import { commitCatalogImport } from './catalog-import.service';
import { createProjectToken } from './project-token.service';
import { createProject } from './project.service';

// Lives outside `src/server/routes/` for the same reason as `i18n-routes.spec.ts` — Nitro's
// dev-server route scanner would otherwise try to load this spec file as a route.
function webHandlerFor(handler: EventHandler) {
  const app = createApp();
  app.use(handler);
  return toWebHandler(app);
}

const machineCatalogFetch = webHandlerFor(machineCatalogHandler);

describe('machine API sees imported catalog content immediately', () => {
  it('GET /api/machine/v1/catalogs/:locale returns the imported catalog with no extra sync step', async () => {
    const cms = await getCmsRuntime();
    const project = await createProject(cms, {
      name: 'Import Machine Project',
      slug: 'import-machine-project',
      sourceLocale: 'en',
      locales: ['en'],
    });
    const { secret } = await createProjectToken(cms, project, {
      name: 'CI',
      scopes: ['catalog:read'],
    });

    const content = { nav: { home: 'Home', docs: 'Docs' } };
    const result = await commitCatalogImport(cms, project.slug, {
      catalogs: [{ locale: 'en', content }],
    });
    expect(result.imported).toBe(true);

    const response = await machineCatalogFetch(
      new Request('https://glossa.test/api/machine/v1/catalogs/en', {
        headers: { authorization: `Bearer ${secret}` },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.content).toEqual(content);
  });
});
