import { createApp, toWebHandler, type EventHandler } from 'h3';

import { getCmsRuntime } from '../cms/runtime';
import { commitCatalogImport } from '../services/catalog-import.service';
import { createProject } from '../services/project.service';
import localeHandler from '../routes/i18n/[project]/[locale].json.get';

// Same rationale as `i18n-routes.spec.ts`: this spec lives outside `src/server/routes/` so
// Nitro's dev-server route scanner does not try to load it as a route file.
function webHandlerFor(handler: EventHandler) {
  const app = createApp();
  app.use(handler);
  return toWebHandler(app);
}

const localeFetch = webHandlerFor(localeHandler);

describe('public delivery sees imported catalogs with no extra publish step', () => {
  it('serves an imported catalog at /i18n/:project/:locale.json immediately', async () => {
    const slug = 'import-delivery-project';
    const cms = await getCmsRuntime();
    await createProject(cms, {
      name: 'Import Delivery Project',
      slug,
      sourceLocale: 'en',
      locales: ['en'],
      publicDelivery: true,
    });

    const content = { nav: { home: 'Home', docs: 'Docs' } };
    const result = await commitCatalogImport(cms, slug, {
      catalogs: [{ locale: 'en', content }],
    });
    expect(result.imported).toBe(true);

    const response = await localeFetch(
      new Request(`https://glossa.test/i18n/${slug}/en.json`),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(content);
  });
});
