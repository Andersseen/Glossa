import type { McpServer } from '@modelcontextprotocol/server';

import type { ProjectMachineContext } from '../../http/machine-http';
import { listCatalogs } from '../../services/catalog.service';
import { McpScopeError, toToolError } from '../errors';

export function registerListCatalogsTool(
  server: McpServer,
  machine: ProjectMachineContext,
): void {
  server.registerTool(
    'list_catalogs',
    {
      title: 'List catalogs',
      description:
        "List every locale configured for this project and, for each, whether a catalog has been created yet plus its revision/updatedAt — not the catalog content itself. Use get_catalog to read one locale's full content.",
    },
    async () => {
      try {
        if (!machine.canReadCatalog) {
          throw new McpScopeError('Token lacks the catalog:read scope.');
        }

        const existing = await listCatalogs(machine.cms, machine.project.slug);
        const byLocale = new Map(
          existing.map((catalog) => [catalog.locale, catalog]),
        );

        const catalogs = machine.project.locales.map((locale) => {
          const catalog = byLocale.get(locale);

          return catalog
            ? {
                locale,
                exists: true,
                revision: catalog.revision,
                updatedAt: catalog.updatedAt,
              }
            : { locale, exists: false };
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ catalogs }) }],
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}
