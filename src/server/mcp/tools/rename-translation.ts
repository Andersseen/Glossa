import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { ProjectMachineContext } from '../../http/machine-http';
import { renameProjectTranslationKey } from '../../services/translation-lifecycle.service';
import { McpScopeError, toToolError } from '../errors';

const inputSchema = z.object({
  key: z
    .string()
    .describe(
      'The existing dot-path key in the source locale, e.g. "nav.home". Read it first with list_catalogs/get_catalog/get_translation.',
    ),
  newKey: z
    .string()
    .describe(
      'The new dot-path key, e.g. "navigation.home". Must differ from key, use safe segments (not __proto__, prototype, or constructor), and must not already exist in any configured locale.',
    ),
  expectedRevisions: z
    .record(z.string(), z.string())
    .describe(
      'The current revision of every configured locale that already has a catalog, from a prior get_catalog/list_catalogs read (locale → revision). A locale with no catalog yet is omitted. Any stale or missing entry rejects the whole rename with CATALOG_REVISION_CONFLICT before anything is written.',
    ),
});

export function registerRenameTranslationTool(
  server: McpServer,
  machine: ProjectMachineContext,
): void {
  server.registerTool(
    'rename_translation',
    {
      title: 'Rename translation key',
      description:
        'Renames one logical translation key across every existing catalog in this project: the value at "key" moves to "newKey" in every locale that has it, preserved exactly, and a locale that never had the key stays without it. Refuses the whole operation (no partial writes) if the new key already exists in any configured locale, if the source locale does not have the old key, or if any supplied revision is stale. Read current revisions with list_catalogs/get_catalog first. Requires catalog:write.',
      inputSchema,
    },
    async ({ key, newKey, expectedRevisions }) => {
      try {
        if (!machine.canWriteCatalog) {
          throw new McpScopeError('Token lacks the catalog:write scope.');
        }

        const result = await renameProjectTranslationKey(
          machine.cms,
          machine.project.slug,
          { key, newKey, expectedRevisions },
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
