import type { McpServer } from '@modelcontextprotocol/server';

import type { ProjectMachineContext } from '../../http/machine-http';
import { getTranslationAnalysis } from '../../services/translation-analysis.service';
import { McpScopeError, toToolError } from '../errors';

export function registerAnalyzeTranslationsTool(
  server: McpServer,
  machine: ProjectMachineContext,
): void {
  server.registerTool(
    'analyze_translations',
    {
      title: 'Analyze translations',
      description:
        'Project-wide translation completeness and key-set diff, derived from the same analysis the human Analysis view uses — not a linguistic comparison of values. For every configured locale: how many source keys it has translated, the exact source keys it is missing (in source-catalog order), and the exact target-only keys it has that the source locale does not define. One call answers "what is missing in <locale>?" without downloading and diffing full catalogs. Read-only; requires catalog:read.',
    },
    async () => {
      try {
        if (!machine.canReadCatalog) {
          throw new McpScopeError('Token lacks the catalog:read scope.');
        }

        const { analysis } = await getTranslationAnalysis(
          machine.cms,
          machine.project.slug,
        );

        return {
          content: [{ type: 'text', text: JSON.stringify(analysis) }],
        };
      } catch (error) {
        return toToolError(error);
      }
    },
  );
}
