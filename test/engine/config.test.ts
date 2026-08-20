import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyProfile,
  deepMerge,
  loadConfig,
  stripJsonComments,
} from '../../src/engine/config/loader.js';
import { EngineError } from '../../src/engine/types/errors.js';

let root: string;

function project(name: string, base: string, local?: string): string {
  const dir = join(root, name);
  mkdirSync(join(dir, '.api-tester'), { recursive: true });
  writeFileSync(join(dir, '.api-tester', 'config.json'), base);
  if (local !== undefined) writeFileSync(join(dir, '.api-tester', 'config.local.json'), local);
  return dir;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'apitester-config-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('stripJsonComments', () => {
  it('removes line and block comments but keeps strings', () => {
    const src = '{ // a\n "url": "http://x/*not a comment*/", /* b */ "n": 1 }';
    expect(JSON.parse(stripJsonComments(src))).toEqual({
      url: 'http://x/*not a comment*/',
      n: 1,
    });
  });
});

describe('deepMerge', () => {
  it('merges nested objects and replaces scalars/arrays', () => {
    expect(
      deepMerge<Record<string, unknown>>({ a: { x: 1, y: 2 }, l: [1] }, { a: { y: 9 }, l: [2] }),
    ).toEqual({
      a: { x: 1, y: 9 },
      l: [2],
    });
  });
});

describe('loadConfig (build-prompt §13)', () => {
  it('loads valid JSONC config', async () => {
    const dir = project(
      'ok',
      `{
      // base url
      "baseUrl": "http://localhost:8080",
      "mutations": false
    }`,
    );
    const { config, warnings } = await loadConfig(dir);
    expect(config.baseUrl).toBe('http://localhost:8080');
    expect(config.mutations).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('local overrides base', async () => {
    const dir = project(
      'override',
      `{ "baseUrl": "http://localhost:8080", "timeoutMs": 1000 }`,
      `{ "timeoutMs": 5000 }`,
    );
    const { config, sources } = await loadConfig(dir);
    expect(config.timeoutMs).toBe(5000);
    expect(config.baseUrl).toBe('http://localhost:8080');
    expect(sources).toHaveLength(2);
  });

  it('rejects unknown keys with a suggestion', async () => {
    const dir = project('typo', `{ "baseurl": "http://localhost:8080" }`);
    await expect(loadConfig(dir)).rejects.toMatchObject({ reason: 'CONFIG_INVALID' });
    await loadConfig(dir).catch((e: EngineError) => {
      expect(e.message).toContain('baseUrl');
    });
  });

  it('warns on reserved keys (teardown/smartValues)', async () => {
    const dir = project('reserved', `{ "baseUrl": "http://localhost:8080", "teardown": {} }`);
    const { warnings } = await loadConfig(dir);
    expect(warnings.some((w) => w.includes('teardown'))).toBe(true);
  });

  it('accepts seed and strictStatus as real settings (§#8/#11)', async () => {
    const dir = project('seed', `{ "baseUrl": "http://localhost:8080", "seed": 42, "strictStatus": false }`);
    const { config, warnings } = await loadConfig(dir);
    expect(config.seed).toBe(42);
    expect(config.strictStatus).toBe(false);
    expect(warnings).toEqual([]); // seed is no longer a reserved-key warning
  });

  it('errors when config.json is missing', async () => {
    await expect(loadConfig(join(root, 'nope'))).rejects.toMatchObject({
      reason: 'CONFIG_NOT_FOUND',
    });
  });
});

describe('applyProfile', () => {
  it('merges a named profile over base settings', async () => {
    const dir = project(
      'profiles',
      `{
      "baseUrl": "http://localhost:8080",
      "timeoutMs": 1000,
      "profiles": { "ci": { "timeoutMs": 30000, "mutations": true } }
    }`,
    );
    const { config } = await loadConfig(dir);
    const ci = applyProfile(config, 'ci');
    expect(ci.timeoutMs).toBe(30000);
    expect(ci.mutations).toBe(true);
    expect(ci.baseUrl).toBe('http://localhost:8080');
    expect('profiles' in ci).toBe(false);
  });

  it('throws on unknown profile', async () => {
    const dir = project('profiles2', `{ "baseUrl": "http://localhost:8080" }`);
    const { config } = await loadConfig(dir);
    expect(() => applyProfile(config, 'missing')).toThrow(EngineError);
  });
});
