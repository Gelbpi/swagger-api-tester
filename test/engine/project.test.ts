import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProject } from '../../src/engine/project/resolver.js';

let root: string;

function makeProject(name: string): string {
  const dir = join(root, name);
  mkdirSync(join(dir, '.api-tester'), { recursive: true });
  writeFileSync(join(dir, '.api-tester', 'config.json'), '{ "baseUrl": "http://localhost:8080" }');
  return dir;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'apitester-project-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('resolveProject (build-prompt §12)', () => {
  it('1: explicit project path', () => {
    const dir = makeProject('explicit');
    expect(resolveProject({ project: dir }).source).toBe('explicit');
  });

  it('2: plugin project_path', () => {
    const dir = makeProject('plugin');
    const r = resolveProject({ pluginProjectPath: dir, env: {} });
    expect(r.source).toBe('plugin_project_path');
    expect(r.projectDir).toBe(dir);
  });

  it('3: API_TESTER_PROJECT env', () => {
    const dir = makeProject('env');
    expect(resolveProject({ env: { API_TESTER_PROJECT: dir } }).source).toBe('env');
  });

  it('4: upward search from a nested cwd', () => {
    const dir = makeProject('upward');
    const nested = join(dir, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    const r = resolveProject({ cwd: nested, env: {}, home: join(root, 'empty-home') });
    expect(r.source).toBe('upward_search');
    expect(r.projectDir).toBe(dir);
  });

  it('5: single registered project', () => {
    const dir = makeProject('reg-single');
    const home = join(root, 'home-single');
    mkdirSync(join(home, '.api-tester'), { recursive: true });
    writeFileSync(
      join(home, '.api-tester', 'projects.json'),
      JSON.stringify({ projects: [{ path: dir, name: 'only' }] }),
    );
    const r = resolveProject({ cwd: join(root, 'nowhere'), env: {}, home });
    expect(r.source).toBe('registry');
  });

  it('PROJECT_AMBIGUOUS when multiple registered and none selected', () => {
    const a = makeProject('reg-a');
    const b = makeProject('reg-b');
    const home = join(root, 'home-multi');
    mkdirSync(join(home, '.api-tester'), { recursive: true });
    writeFileSync(
      join(home, '.api-tester', 'projects.json'),
      JSON.stringify({ projects: [{ path: a, name: 'a' }, { path: b, name: 'b' }] }),
    );
    expect(() => resolveProject({ cwd: join(root, 'nowhere'), env: {}, home })).toThrowError(
      /PROJECT_AMBIGUOUS|Multiple registered/,
    );
  });

  it('CONFIG_NOT_FOUND when nothing resolves', () => {
    const home = join(root, 'home-empty');
    mkdirSync(home, { recursive: true });
    expect(() => resolveProject({ cwd: join(root, 'nowhere'), env: {}, home })).toThrowError(
      /No project could be resolved/,
    );
  });
});
