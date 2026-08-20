import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/mcp/server.js';
import { startMockApi } from './mockApi.js';

let app: FastifyInstance;
let baseUrl: string;
let projectDir: string;
let dataDir: string;
let root: string;
let client: Client;

const SECRET = 'plain-secret-token-xyz';

beforeAll(async () => {
  ({ app, baseUrl } = await startMockApi());
  root = mkdtempSync(join(tmpdir(), 'apitester-mcp-'));
  projectDir = join(root, 'proj');
  dataDir = join(root, 'data');
  mkdirSync(join(projectDir, '.api-tester'), { recursive: true });
  writeFileSync(
    join(projectDir, '.api-tester', 'config.json'),
    JSON.stringify({
      baseUrl,
      openApiUrl: '/openapi.json',
      timeoutMs: 700,
      defaultAuthProfile: 'default',
      auth: { profiles: { default: { type: 'bearer', token: SECRET } } },
    }),
  );

  const server = createServer({ dataDir, env: { API_TESTER_PROJECT: projectDir } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('MCP surface (build-prompt §45)', () => {
  it('advertises EXACTLY two tools with the correct names', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['test_all', 'test_endpoint']);
    expect(tools).toHaveLength(2); // a third tool must fail the build
  });

  it('exposes correct input schemas', async () => {
    const { tools } = await client.listTools();
    const endpoint = tools.find((t) => t.name === 'test_endpoint')!;
    expect(endpoint.inputSchema.type).toBe('object');
    const props = Object.keys(endpoint.inputSchema.properties ?? {});
    expect(props).toContain('method');
    expect(props).toContain('path');
    expect(endpoint.inputSchema.required).toContain('method');
    expect(endpoint.inputSchema.required).toContain('path');
  });

  it('advertises the run resource templates', async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    const uris = resourceTemplates.map((r) => r.uriTemplate);
    expect(uris).toContain('apitest://runs/{runId}');
    expect(uris).toContain('apitest://runs/{runId}/{testId}');
  });

  it('test_endpoint returns compact output and a details resource that works', async () => {
    const res = await client.callTool({ name: 'test_endpoint', arguments: { method: 'GET', path: '/users/{id}' } });
    const structured = res.structuredContent as { outcome: string; runId: string; detailsUri: string };
    expect(structured.outcome).toBe('PASS');

    const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain('GET /users/{id}');
    // Compact: no full OpenAPI doc, bounded size.
    expect(text.length).toBeLessThan(2000);
    expect(text).not.toContain('openapi');

    // Detail resource is retrievable and secret-free.
    const detail = await client.readResource({ uri: structured.detailsUri });
    const body = (detail.contents as Array<{ text: string }>)[0]!.text;
    expect(body).toContain('"outcome": "PASS"');
    expect(body).not.toContain(SECRET);
  });

  it('test_all returns a compact collapsed summary without secrets', async () => {
    const res = await client.callTool({ name: 'test_all', arguments: {} });
    const text = (res.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(text).toContain('API TEST SUMMARY');
    expect(text).toContain('Total 5');
    expect(text).not.toContain(SECRET);
    expect(text.length).toBeLessThan(6000); // output-size ceiling
  });

  it('a missing run resource returns a clean not-found, not a crash', async () => {
    const detail = await client.readResource({ uri: 'apitest://runs/r_does_not_exist' });
    const body = (detail.contents as Array<{ text: string }>)[0]!.text;
    expect(body).toContain('not found');
  });
});
