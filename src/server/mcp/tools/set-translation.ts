import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { ProjectMachineContext } from '../../http/machine-http';
import type { CatalogContent } from '../../domain/catalog';
import {
  parseTranslationKeyPath,
  setTranslationValue,
} from '../../domain/translation-path';
import {
  CatalogNotFoundError,
  getCatalog,
  saveCatalogWithPrecondition,
} from '../../services/catalog.service';
import { McpScopeError, toToolError } from '../errors';

const inputSchema = z.object({
  locale: z.string().describe('One of the project’s configured locales.'),
  key: z
    .string()
    .describe(
      'Dot-path to the translation leaf to create or replace, e.g. "nav.changelog". Segments must not be __proto__, prototype, or constructor.',
    ),
  value: z
    .string()
    .describe(
      'The exact value to write — written verbatim, never translated or reformatted.',
    ),
  expectedRevision: z
    .string()
    .optional()
    .describe(
      'The revision last read via get_translation/get_catalog/list_catalogs. Required to update an existing catalog — a stale or missing value is rejected with CATALOG_REVISION_CONFLICT rather than overwriting a concurrent edit. Omit only when the catalog does not exist yet (list_catalogs reports exists:false).',
    ),
});

export function registerSetTranslationTool(
  server: McpServer,
  machine: ProjectMachineContext,
): void {
  server.registerTool(
    'set_translation',
    {
      title: 'Set translation',
      description:
        'Create or replace exactly one translation value, by dot-path key, without submitting the rest of the catalog. Writes the value exactly as given — Glossa does not call an LLM or alter the string. Requires expectedRevision from a prior read for an existing catalog; a stale value is rejected and the newer content is preserved.',
      inputSchema,
    },
    async ({ locale, key, value, expectedRevision }) => {
      try {
        if (!machine.canWriteCatalog) {
          throw new McpScopeError('Token lacks the catalog:write scope.');
        }

        const path = parseTranslationKeyPath(key);
        const existingContent = await readExistingContent(machine, locale);
        const nextContent = setTranslationValue(existingContent, path, value);

        const catalog = await saveCatalogWithPrecondition(
          machine.cms,
          machine.project.slug,
          locale,
          nextContent,
          { ifMatch: expectedRevision },
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                locale,
                key,
                value,
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

/** Empty content for a configured-but-not-yet-created catalog; any other lookup failure propagates. */
async function readExistingContent(
  machine: ProjectMachineContext,
  locale: string,
): Promise<CatalogContent> {
  try {
    const existing = await getCatalog(
      machine.cms,
      machine.project.slug,
      locale,
    );
    return existing.content;
  } catch (error) {
    if (error instanceof CatalogNotFoundError) {
      return {};
    }

    throw error;
  }
}
