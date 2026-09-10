import { McpServer } from '@modelcontextprotocol/server';

import type { ProjectMachineContext } from '../http/machine-http';
import { registerGetCatalogTool } from './tools/get-catalog';
import { registerGetDeliveryUrlsTool } from './tools/get-delivery-urls';
import { registerGetProjectTool } from './tools/get-project';
import { registerGetTranslationTool } from './tools/get-translation';
import { registerListCatalogsTool } from './tools/list-catalogs';
import { registerSetTranslationTool } from './tools/set-translation';

/**
 * Builds one fresh, project-scoped MCP server per HTTP request (stateless — see `mcp.post.ts`).
 * The project comes only from the already-authenticated `ProjectMachineContext` (token metadata),
 * never from a tool argument — no tool below accepts a `project`/`projectSlug` input, so a caller
 * has no way to point a single connection at a different project.
 */
export function createProjectMcpServer(
  machine: ProjectMachineContext,
  origin: string,
): McpServer {
  const server = new McpServer({ name: 'glossa', version: '1.0.0' });

  registerGetProjectTool(server, machine);
  registerListCatalogsTool(server, machine);
  registerGetCatalogTool(server, machine);
  registerGetTranslationTool(server, machine);
  registerSetTranslationTool(server, machine);
  registerGetDeliveryUrlsTool(server, machine, origin);

  return server;
}
