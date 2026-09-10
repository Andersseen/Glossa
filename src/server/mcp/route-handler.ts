import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { eventHandler, getRequestURL, sendWebResponse, toWebRequest } from 'h3';

import {
  requireProjectMachineContext,
  sendMachineError,
} from '../http/machine-http';
import { createProjectMcpServer } from './server';

/**
 * Shared by `mcp.get.ts`/`mcp.post.ts`/`mcp.delete.ts` — `WebStandardStreamableHTTPServerTransport`
 * already dispatches all three methods correctly for a stateless server (see its own doc comment:
 * "Handles an incoming HTTP request, whether GET, POST, or DELETE"), so there is nothing
 * method-specific to add at this layer. Auth runs identically for every verb: a request with no
 * token, an invalid token, a revoked/expired token, or a human cookie session is rejected the same
 * way `/api/machine/v1/*` already rejects it — reusing `requireProjectMachineContext` rather than
 * reimplementing machine-context validation for MCP.
 *
 * Stateless by design (`sessionIdGenerator: undefined`): a fresh `McpServer` and transport are
 * built per request, matching Cloudflare Pages Functions' per-request execution model — there is
 * no in-memory session to keep alive between requests, and none is needed for single tool calls.
 */
export default eventHandler(async (event) => {
  try {
    const machine = await requireProjectMachineContext(event);
    const origin = getRequestURL(event).origin;
    const server = createProjectMcpServer(machine, origin);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);

    try {
      const response = await transport.handleRequest(toWebRequest(event));
      await sendWebResponse(event, response);
    } finally {
      await server.close();
    }

    return undefined;
  } catch (error) {
    return sendMachineError(event, error);
  }
});
