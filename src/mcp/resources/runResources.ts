/**
 * MCP resources for detailed run/test data (build-prompt §7, §41).
 *
 *   apitest://runs/{runId}            -> the full sanitized run
 *   apitest://runs/{runId}/{testId}   -> one sanitized test record
 *
 * Records are already sanitized on persistence; we never expose secrets or the
 * OpenAPI document here.
 */
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RunStore } from '../../engine/results/runStore.js';
import type { ServerOptions } from '../server.js';

export function registerRunResources(server: McpServer, opts: ServerOptions): void {
  const store = new RunStore(opts.dataDir);

  server.registerResource(
    'api-test-run',
    new ResourceTemplate('apitest://runs/{runId}', { list: undefined }),
    {
      title: 'API test run',
      description: 'Full sanitized results for a run (totals + every test record).',
      mimeType: 'application/json',
    },
    (uri, variables) => {
      const runId = String(variables.runId);
      const run = store.getRun(runId);
      if (!run) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: `run ${runId} not found` }) }] };
      }
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(run, null, 2) }] };
    },
  );

  server.registerResource(
    'api-test-case',
    new ResourceTemplate('apitest://runs/{runId}/{testId}', { list: undefined }),
    {
      title: 'API test case',
      description: 'One sanitized test record: request, response, validation, timing.',
      mimeType: 'application/json',
    },
    (uri, variables) => {
      const runId = String(variables.runId);
      const testId = String(variables.testId);
      const test = store.getTest(runId, testId);
      if (!test) {
        return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: `test ${testId} not found in run ${runId}` }) }] };
      }
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(test, null, 2) }] };
    },
  );
}
