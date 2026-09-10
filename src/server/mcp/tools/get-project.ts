import type { McpServer } from '@modelcontextprotocol/server';

import type { ProjectMachineContext } from '../../http/machine-http';
import { McpScopeError, toToolError } from '../errors';

export function registerGetProjectTool(
  server: McpServer,
  machine: ProjectMachineContext,
): void {
  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description:
        "Read the Glossa project this access token is bound to — its slug, name, source locale, configured locales, and what this token itself may do (catalogRead/catalogWrite). Call this first to understand the agent's context; no arguments needed.",
    },
    async () => {
      try {
        if (!machine.canReadCatalog) {
          throw new McpScopeError('Token lacks the catalog:read scope.');
        }

        const { project } = machine;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                slug: project.slug,
                name: project.name,
                sourceLocale: project.sourceLocale,
                locales: project.locales,
                capabilities: {
                  catalogRead: machine.canReadCatalog,
                  catalogWrite: machine.canWriteCatalog,
                },
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
