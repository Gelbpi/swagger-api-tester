import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startMockApi } from './mockApi.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let app: FastifyInstance;
let baseUrl: string;
let root: string;
let projectDir: string;
let dataDir: string;
let bundlePath: string;
let client: Client;

beforeAll(async () => {
  ({ app, baseUrl } = await startMockApi());
  root = mkdtempSync(join(tmpdir(), 'apitester-stdio-'));
  projectDir = join(root, 'proj');
  dataDir = join(root, 'data');
  bundlePath = join(root, 'mcp-server.mjs');
  mkdirSync(join(projectDir, '.api-tester'), { recursive: true });
  writeFileSync(
    join(projectDir, '.api-tester', 'config.json'),
    JSON.stringify({ baseUrl, openApiUrl: '/openapi.json', timeoutMs: 700 }),
  );

  // Build the real shippable bundle and run THAT over stdio.
  await build({
    entryPoints: [resolve(repoRoot, 'src/mcp/bin.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundlePath],
    env: {
      ...process.env,
      CLAUDE_PLUGIN_OPTION_PROJECT_PATH: projectDir,
      CLAUDE_PLUGIN_DATA: dataDir,
    } as Record<string, string>,
  });
  client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('MCP over stdio, running the bundled server (build-prompt §45, §55)', () => {
  it('initializes and advertises exactly the two tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['test_all', 'test_endpoint']);
  });

  it('runs test_endpoint end-to-end against the real API via the bundle', async () => {
    const res = await client.callTool({ name: 'test_endpoint', arguments: { method: 'GET', path: '/users/{id}' } });
    const structured = res.structuredContent as { outcome: string };
    expect(structured.outcome).toBe('PASS');
  });
});
