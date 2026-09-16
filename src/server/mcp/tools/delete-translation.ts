import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { ProjectMachineContext } from '../../http/machine-http';
import { deleteProjectTranslationKey } from '../../services/translation-lifecycle.service';
import { McpScopeError, toToolError } from '../errors';

const inputSchema = z.object({
  key: z
    .string()
    .describe(
      'The existing dot-path key in the source locale to remove, e.g. "legacy.banner.title". Read it first with list_catalogs/get_catalog/get_translation.',
    ),
  expectedRevisions: z
    .record(z.string(), z.string())
    .describe(
      'The current revision of every configured locale that already has a catalog, from a prior get_catalog/list_catalogs read (locale → revision). A locale with no catalog yet is omitted. Any stale or missing entry rejects the whole delete with CATALOG_REVISION_CONFLICT before anything is written.',
    ),
});

export function registerDeleteTranslationTool(
  server: McpServer,
  machine: ProjectMachineContext,
): void {
  server.registerTool(
    'delete_translation',
    {
      title: 'Delete translation key',
      description:
        'Deletes one logical translation key from every existing catalog in this project that has it, pruning any parent group left empty. A locale that never had the key is left untouched, not treated as an error. Refuses the whole operation (no partial writes) if the source locale does not have the key, or if any supplied revision is stale. Read current revisions with list_catalogs/get_catalog first. Requires catalog:write.',
      inputSchema,
    },
    async ({ key, expectedRevisions }) => {
      try {
        if (!machine.canWriteCatalog) {
          throw new McpScopeError('Token lacks the catalog:write scope.');
        }

        const result = await deleteProjectTranslationKey(
          machine.cms,
          machine.project.slug,
          { key, expectedRevisions },
        );

        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}
