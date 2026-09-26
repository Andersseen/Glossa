import { McpServer } from '@modelcontextprotocol/server';

import type { ProjectMachineContext } from '../http/machine-http';
import { registerAnalyzeTranslationsTool } from './tools/analyze-translations';
import { registerDeleteTranslationTool } from './tools/delete-translation';
import { registerGetCatalogTool } from './tools/get-catalog';
import { registerGetDeliveryUrlsTool } from './tools/get-delivery-urls';
import { registerGetProjectTool } from './tools/get-project';
import { registerGetTranslationTool } from './tools/get-translation';
import { registerListCatalogsTool } from './tools/list-catalogs';
import { registerRenameTranslationTool } from './tools/rename-translation';
import { registerSetTranslationTool } from './tools/set-translation';

export type McpServerHooks = {
  /**
   * Called once after a mutating tool (set/rename/delete) successfully writes content — the single
   * place an MCP change reaches side effects such as the static-consumer deploy hook, so no tool
   * knows about deploy hooks itself. Read tools never call it.
   */
  onProjectChanged: () => void;
};

/**
 * Builds one fresh, project-scoped MCP server per HTTP request (stateless — see `mcp.post.ts`).
 * The project comes only from the already-authenticated `ProjectMachineContext` (token metadata),
 * never from a tool argument — no tool below accepts a `project`/`projectSlug` input, so a caller
 * has no way to point a single connection at a different project.
 */
export function createProjectMcpServer(
  machine: ProjectMachineContext,
  origin: string,
  hooks: McpServerHooks,
): McpServer {
  const server = new McpServer({ name: 'glossa', version: '1.0.0' });

  registerGetProjectTool(server, machine);
  registerListCatalogsTool(server, machine);
  registerGetCatalogTool(server, machine);
  registerGetTranslationTool(server, machine);
  registerSetTranslationTool(server, machine, hooks);
  registerRenameTranslationTool(server, machine, hooks);
  registerDeleteTranslationTool(server, machine, hooks);
  registerAnalyzeTranslationsTool(server, machine);
  registerGetDeliveryUrlsTool(server, machine, origin);

  return server;
}
