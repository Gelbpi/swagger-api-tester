/**
 * MCP server assembly (build-prompt §6, §7).
 *
 * Exposes EXACTLY TWO tools (test_endpoint, test_all) and the run resources.
 * No third tool is permitted — an MCP stdio test asserts this.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTestEndpoint } from './tools/testEndpointTool.js';
import { registerTestAll } from './tools/testAllTool.js';
import { registerRunResources } from './resources/runResources.js';

export interface ServerOptions {
  /** Persistent data dir (defaults to ${CLAUDE_PLUGIN_DATA} / ~/.api-tester). */
  dataDir?: string;
  /** Environment for project/target resolution (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
}

export const SERVER_NAME = 'swagger-api-tester';
export const SERVER_VERSION = '0.1.0';

export function createServer(opts: ServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        'Test a local REST API described by OpenAPI/Swagger. Use test_endpoint for one ' +
        'endpoint and test_all for a whole spec. Detailed results are available via the ' +
        'apitest://runs/{runId} resources.',
    },
  );

  registerTestEndpoint(server, opts);
  registerTestAll(server, opts);
  registerRunResources(server, opts);

  return server;
}
