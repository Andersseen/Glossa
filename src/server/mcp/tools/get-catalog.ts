import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { ProjectMachineContext } from '../../http/machine-http';
import { getCatalog } from '../../services/catalog.service';
import { McpScopeError, toToolError } from '../errors';

const inputSchema = z.object({
  locale: z
    .string()
    .describe('One of the project’s configured locales (see get_project).'),
});

export function registerGetCatalogTool(
  server: McpServer,
  machine: ProjectMachineContext,
): void {
  server.registerTool(
    'get_catalog',
    {
      title: 'Get catalog',
      description:
        "Read the full translation catalog for one locale — every key and value, plus its revision. This is the only tool that returns full catalog content; prefer get_translation to read a single key without paying for the whole catalog's tokens.",
      inputSchema,
    },
    async ({ locale }) => {
      try {
        if (!machine.canReadCatalog) {
          throw new McpScopeError('Token lacks the catalog:read scope.');
        }

        const catalog = await getCatalog(
          machine.cms,
          machine.project.slug,
          locale,
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                locale: catalog.locale,
                content: catalog.content,
                revision: catalog.revision,
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
