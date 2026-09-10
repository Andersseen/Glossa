import type { GlossaCmsRuntime } from '../cms/runtime';
import type { CatalogRecord } from '../domain/catalog';
import { getCatalog, listCatalogs } from '../services/catalog.service';
import { getProjectBySlug } from '../services/project.service';

export class DeliveryDisabledError extends Error {
  readonly code = 'DELIVERY_DISABLED';

  constructor() {
    super('Public delivery is not enabled for this project.');
  }
}

export type PublicManifest = {
  project: {
    slug: string;
    name: string;
    sourceLocale: string;
    locales: string[];
  };
  catalogs: Record<string, { url: string; revision: string }>;
};

/**
 * The single place that knows the `/i18n/:projectSlug/...` URL shape — reused by the manifest
 * response and by the MCP `get_delivery_urls` tool so the two surfaces can never drift apart.
 */
export function buildPublicUrl(
  origin: string,
  projectSlug: string,
  path: string,
): string {
  return `${origin}/i18n/${encodeURIComponent(projectSlug)}/${path}`;
}

export async function getPublicManifest(
  cms: GlossaCmsRuntime,
  projectSlug: string,
  origin: string,
): Promise<PublicManifest> {
  const project = await getProjectBySlug(cms, projectSlug);

  if (!project.publicDelivery) {
    throw new DeliveryDisabledError();
  }

  const catalogs = await listCatalogs(cms, projectSlug);
  const catalogsByLocale: PublicManifest['catalogs'] = {};

  for (const catalog of catalogs) {
    catalogsByLocale[catalog.locale] = {
      url: buildPublicUrl(origin, projectSlug, `${catalog.locale}.json`),
      revision: catalog.revision,
    };
  }

  return {
    project: {
      slug: project.slug,
      name: project.name,
      sourceLocale: project.sourceLocale,
      locales: project.locales,
    },
    catalogs: catalogsByLocale,
  };
}

/** Every public delivery URL a project can currently be cached under — see `purgeEdgeCache`. */
export function getDeliveryUrls(
  origin: string,
  project: { slug: string; locales: string[] },
): string[] {
  return [
    buildPublicUrl(origin, project.slug, 'manifest.json'),
    ...project.locales.map((locale) =>
      buildPublicUrl(origin, project.slug, `${locale}.json`),
    ),
  ];
}

export async function getPublicCatalog(
  cms: GlossaCmsRuntime,
  projectSlug: string,
  locale: string,
): Promise<CatalogRecord> {
  const project = await getProjectBySlug(cms, projectSlug);

  if (!project.publicDelivery) {
    throw new DeliveryDisabledError();
  }

  return getCatalog(cms, projectSlug, locale);
}
