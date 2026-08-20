/**
 * MCP tool: test_endpoint (build-prompt §6, §8). One of exactly two tools.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { testEndpoint } from '../../engine/execution/testEndpoint.js';
import { formatEndpointResult } from '../format/formatCompact.js';
import type { ServerOptions } from '../server.js';

const inputSchema = {
  method: z.string().describe('HTTP method, e.g. GET, POST'),
  path: z.string().describe('Endpoint path or template, e.g. /api/users/{id}'),
  project: z.string().optional().describe('Project directory override'),
  body: z.unknown().optional().describe('Explicit request body (overrides generated)'),
  query: z.record(z.unknown()).optional(),
  pathParams: z.record(z.unknown()).optional(),
  headers: z.record(z.string()).optional(),
  authProfile: z.string().optional(),
  expectStatus: z.number().int().optional(),
  profile: z.string().optional(),
  refreshSpec: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  confirmSideEffects: z.boolean().optional(),
  includeResponseBody: z.boolean().optional(),
};

export function registerTestEndpoint(server: McpServer, opts: ServerOptions): void {
  server.registerTool(
    'test_endpoint',
    {
      title: 'Test one API endpoint',
      description:
        'Test a single REST endpoint described by the project OpenAPI spec. The engine ' +
        'generates a valid request (or uses provided values), sends it, and validates the ' +
        'response against the documented contract. Read-only by default; side-effecting or ' +
        'destructive operations require confirmSideEffects=true.',
      inputSchema,
    },
    async (args) => {
      const { compact } = await testEndpoint({
        method: args.method,
        path: args.path,
        ...(args.project ? { project: args.project } : {}),
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.query ? { query: args.query } : {}),
        ...(args.pathParams ? { pathParams: args.pathParams } : {}),
        ...(args.headers ? { headers: args.headers } : {}),
        ...(args.authProfile ? { authProfile: args.authProfile } : {}),
        ...(args.expectStatus !== undefined ? { expectStatus: args.expectStatus } : {}),
        ...(args.profile ? { profile: args.profile } : {}),
        ...(args.refreshSpec ? { refreshSpec: args.refreshSpec } : {}),
        ...(args.dryRun ? { dryRun: args.dryRun } : {}),
        ...(args.confirmSideEffects ? { confirmSideEffects: args.confirmSideEffects } : {}),
        ...(args.includeResponseBody ? { includeResponseBody: args.includeResponseBody } : {}),
        ...(opts.dataDir ? { dataDir: opts.dataDir } : {}),
        env: opts.env ?? process.env,
      });
      return {
        content: [{ type: 'text', text: formatEndpointResult(compact) }],
        structuredContent: compact as unknown as Record<string, unknown>,
      };
    },
  );
}
