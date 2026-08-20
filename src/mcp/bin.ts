#!/usr/bin/env node
/**
 * Plugin entry point (build-prompt §4, §49).
 *
 * Bridges plugin userConfig into the engine's environment, then serves the MCP
 * server over stdio. Never writes to stdout except MCP protocol traffic; logs go
 * to stderr (§40: progress may be written to stderr, never through MCP).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

/** Map plugin userConfig (CLAUDE_PLUGIN_OPTION_*) into engine env conventions. */
function bridgeEnv(env: NodeJS.ProcessEnv): void {
  const projectPath = env.CLAUDE_PLUGIN_OPTION_PROJECT_PATH ?? env.API_TESTER_PROJECT_PATH;
  if (projectPath && !env.API_TESTER_PROJECT) env.API_TESTER_PROJECT = projectPath;

  const baseUrl = env.CLAUDE_PLUGIN_OPTION_BASE_URL;
  if (baseUrl && !env.API_TESTER_BASE_URL) env.API_TESTER_BASE_URL = baseUrl;
  const openApiUrl = env.CLAUDE_PLUGIN_OPTION_OPEN_API_URL;
  if (openApiUrl && !env.API_TESTER_OPENAPI_URL) env.API_TESTER_OPENAPI_URL = openApiUrl;

  const allowRemote = env.CLAUDE_PLUGIN_OPTION_ALLOW_REMOTE ?? env.API_TESTER_ALLOW_REMOTE;
  if (allowRemote && /^(1|true|yes|on)$/i.test(allowRemote)) env.API_TESTER_ALLOW_REMOTE = '1';
}

async function main(): Promise<void> {
  bridgeEnv(process.env);
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[swagger-api-tester] MCP server ready on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`[swagger-api-tester] fatal: ${String(err)}\n`);
  process.exit(1);
});
