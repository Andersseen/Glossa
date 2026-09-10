import type { McpServer } from '@modelcontextprotocol/server';

import type { ProjectMachineContext } from '../../http/machine-http';
import { buildPublicUrl } from '../../delivery/delivery.service';
import { McpScopeError, toToolError } from '../errors';

export function registerGetDeliveryUrlsTool(
  server: McpServer,
  machine: ProjectMachineContext,
  origin: string,
): void {
  server.registerTool(
    'get_delivery_urls',
    {
      title: 'Get delivery URLs',
      description:
        "Return the public runtime-delivery URLs for this project — the manifest and one raw-JSON catalog URL per configured locale — plus whether public delivery is currently enabled. Useful for configuring a consuming application's i18n loader; these URLs require no auth and return 404 while delivery is disabled.",
    },
    async () => {
      try {
        if (!machine.canReadCatalog) {
          throw new McpScopeError('Token lacks the catalog:read scope.');
        }

        const { project } = machine;
        const catalogs: Record<string, string> = {};

        for (const locale of project.locales) {
          catalogs[locale] = buildPublicUrl(
            origin,
            project.slug,
            `${locale}.json`,
          );
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                enabled: project.publicDelivery,
                manifest: buildPublicUrl(origin, project.slug, 'manifest.json'),
                catalogs,
              }),
            },
          ],
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}
