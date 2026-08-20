/**
 * MCP tool: test_all (build-prompt §6, §9). The second and final tool.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { testAll } from '../../engine/execution/testAll.js';
import { formatRunSummary } from '../format/formatCompact.js';
import type { ServerOptions } from '../server.js';

const inputSchema = {
  project: z.string().optional(),
  include: z.array(z.string()).optional().describe('Glob patterns of "METHOD /path" or path to include'),
  exclude: z.array(z.string()).optional(),
  methods: z.array(z.string()).optional().describe('Restrict to these HTTP methods'),
  tags: z.array(z.string()).optional(),
  authProfile: z.string().optional(),
  profile: z.string().optional(),
  mutations: z.boolean().optional().describe('Enable state-changing methods (default off)'),
  negativeTests: z
    .boolean()
    .optional()
    .describe('Also test documented error responses (e.g. 404/400) by sending deliberately bad input'),
  maxParallelRequests: z.number().int().positive().optional(),
  refreshSpec: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  maxFailuresReturned: z.number().int().positive().optional(),
};

export function registerTestAll(server: McpServer, opts: ServerOptions): void {
  server.registerTool(
    'test_all',
    {
      title: 'Test all endpoints',
      description:
        'Test many endpoints from the project OpenAPI spec in one run. Read-only by default ' +
        '(only GET/HEAD/OPTIONS execute); set mutations=true to include writes. Continues past ' +
        'individual failures and returns a compact, collapsed summary. Filter with ' +
        'include/exclude/methods/tags.',
      inputSchema,
    },
    async (args) => {
      const { summary } = await testAll({
        ...(args.project ? { project: args.project } : {}),
        ...(args.include ? { include: args.include } : {}),
        ...(args.exclude ? { exclude: args.exclude } : {}),
        ...(args.methods ? { methods: args.methods } : {}),
        ...(args.tags ? { tags: args.tags } : {}),
        ...(args.authProfile ? { authProfile: args.authProfile } : {}),
        ...(args.profile ? { profile: args.profile } : {}),
        ...(args.mutations !== undefined ? { mutations: args.mutations } : {}),
        ...(args.negativeTests !== undefined ? { negativeTests: args.negativeTests } : {}),
        ...(args.maxParallelRequests ? { maxParallelRequests: args.maxParallelRequests } : {}),
        ...(args.refreshSpec ? { refreshSpec: args.refreshSpec } : {}),
        ...(args.dryRun ? { dryRun: args.dryRun } : {}),
        ...(args.maxFailuresReturned ? { maxFailuresReturned: args.maxFailuresReturned } : {}),
        ...(opts.dataDir ? { dataDir: opts.dataDir } : {}),
        env: opts.env ?? process.env,
      });
      return {
        content: [{ type: 'text', text: formatRunSummary(summary) }],
        structuredContent: summary as unknown as Record<string, unknown>,
      };
    },
  );
}
