import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { ProjectMachineContext } from '../../http/machine-http';
import { getCatalog } from '../../services/catalog.service';
import {
  getTranslationValue,
  parseTranslationKeyPath,
} from '../../domain/translation-path';
import { McpScopeError, toToolError } from '../errors';

const inputSchema = z.object({
  locale: z.string().describe('One of the project’s configured locales.'),
  key: z
    .string()
    .describe(
      'Dot-path to a translation leaf, e.g. "nav.home". Segments must not be __proto__, prototype, or constructor.',
    ),
});

export function registerGetTranslationTool(
  server: McpServer,
  machine: ProjectMachineContext,
): void {
  server.registerTool(
    'get_translation',
    {
      title: 'Get translation',
      description:
        'Read one translation value from the Glossa project associated with the current access token. Use this before editing an existing literal, and use the returned revision as expectedRevision when calling set_translation, so a concurrent edit is never silently overwritten.',
      inputSchema,
    },
    async ({ locale, key }) => {
      try {
        if (!machine.canReadCatalog) {
          throw new McpScopeError('Token lacks the catalog:read scope.');
        }

        const path = parseTranslationKeyPath(key);
        const catalog = await getCatalog(
          machine.cms,
          machine.project.slug,
          locale,
        );
        const value = getTranslationValue(catalog.content, path);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                value === undefined
                  ? { locale, key, exists: false, revision: catalog.revision }
                  : {
                      locale,
                      key,
                      exists: true,
                      value,
                      revision: catalog.revision,
                    },
              ),
            },
          ],
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}
