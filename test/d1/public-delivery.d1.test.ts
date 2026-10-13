import {
  DeliveryDisabledError,
  getPublicCatalog,
  getPublicManifest,
} from '../../src/server/delivery/delivery.service';
import { saveCatalog } from '../../src/server/services/catalog.service';
import {
  createProject,
  deleteProject,
  ProjectNotFoundError,
  updateProject,
} from '../../src/server/services/project.service';
import { freshRuntime, openRuntime } from './harness';

const ORIGIN = 'https://glossa.test';

describe('public delivery on D1', () => {
  beforeEach(async () => {
    await freshRuntime();
  });

  it('serves current data, tracks updates, and stops on disable and delete', async () => {
    const admin = await openRuntime();
    await createProject(admin, {
      name: 'App',
      slug: 'app',
      sourceLocale: 'en',
      locales: ['en', 'es'],
      publicDelivery: true,
    });
    const v1 = await saveCatalog(admin, 'app', 'en', { hello: 'Hello' });

    // A separate runtime plays the public edge: it shares nothing with the writer but D1.
    const manifest = await getPublicManifest(
      await openRuntime(),
      'app',
      ORIGIN,
    );
    expect(manifest.catalogs).toEqual({
      en: { url: `${ORIGIN}/i18n/app/en.json`, revision: v1.revision },
    });
    await expect(
      getPublicCatalog(await openRuntime(), 'app', 'en'),
    ).resolves.toMatchObject({ content: { hello: 'Hello' } });

    const v2 = await saveCatalog(admin, 'app', 'en', { hello: 'Hi there' });
    await saveCatalog(admin, 'app', 'es', { hello: 'Hola' });
    const updated = await getPublicManifest(await openRuntime(), 'app', ORIGIN);
    expect(Object.keys(updated.catalogs)).toEqual(['en', 'es']);
    expect(updated.catalogs['en']?.revision).toBe(v2.revision);
    await expect(
      getPublicCatalog(await openRuntime(), 'app', 'en'),
    ).resolves.toMatchObject({ content: { hello: 'Hi there' } });

    await updateProject(admin, 'app', { publicDelivery: false });
    await expect(
      getPublicManifest(await openRuntime(), 'app', ORIGIN),
    ).rejects.toBeInstanceOf(DeliveryDisabledError);
    await expect(
      getPublicCatalog(await openRuntime(), 'app', 'en'),
    ).rejects.toBeInstanceOf(DeliveryDisabledError);

    await updateProject(admin, 'app', { publicDelivery: true });
    await expect(
      getPublicCatalog(await openRuntime(), 'app', 'es'),
    ).resolves.toMatchObject({ content: { hello: 'Hola' } });

    await deleteProject(admin, 'app');
    await expect(
      getPublicManifest(await openRuntime(), 'app', ORIGIN),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(
      getPublicCatalog(await openRuntime(), 'app', 'en'),
    ).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('never exposes a project that has not enabled delivery', async () => {
    const admin = await openRuntime();
    await createProject(admin, {
      name: 'Private',
      slug: 'private',
      sourceLocale: 'en',
      locales: ['en'],
    });
    await saveCatalog(admin, 'private', 'en', { secret: 'x' });

    await expect(
      getPublicCatalog(await openRuntime(), 'private', 'en'),
    ).rejects.toBeInstanceOf(DeliveryDisabledError);
  });
});
