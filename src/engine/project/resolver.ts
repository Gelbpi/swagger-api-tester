/**
 * Project resolution (build-prompt §12).
 *
 * Resolution order:
 *   1. explicit MCP `project` argument;
 *   2. plugin `project_path` (userConfig, via CLAUDE_PLUGIN_OPTION_PROJECT_PATH);
 *   3. API_TESTER_PROJECT env var;
 *   4. upward search for `.api-tester/config.json` from cwd;
 *   5. a registered project in ~/.api-tester/projects.json.
 *
 * Multiple registered projects with none selected -> PROJECT_AMBIGUOUS.
 * Nothing found anywhere -> CONFIG_NOT_FOUND.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { EngineError } from '../types/errors.js';
import { stripJsonComments } from '../config/loader.js';

export type ProjectSource =
  | 'explicit'
  | 'plugin_project_path'
  | 'env'
  | 'upward_search'
  | 'registry';

export interface ResolvedProject {
  projectDir: string;
  source: ProjectSource;
}

export interface ResolveOptions {
  /** Explicit project path from the MCP tool call. */
  project?: string;
  /** Plugin userConfig `project_path`. */
  pluginProjectPath?: string;
  cwd?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

const CONFIG_REL = join('.api-tester', 'config.json');

/**
 * Files that mark a directory as a testable project even without an explicit
 * .api-tester/config.json — so baseUrl/openApiUrl can be auto-detected (§12).
 */
const PROJECT_MARKERS = ['pom.xml', 'build.gradle', 'build.gradle.kts'];

function hasConfig(dir: string): boolean {
  return existsSync(join(dir, CONFIG_REL));
}

function hasMarker(dir: string): boolean {
  return hasConfig(dir) || PROJECT_MARKERS.some((m) => existsSync(join(dir, m)));
}

/** For explicit/env/plugin paths: trust the user's chosen directory if it exists. */
function assertProjectDir(dir: string, source: ProjectSource): ResolvedProject {
  const abs = resolve(dir);
  if (!existsSync(abs)) {
    throw new EngineError(
      'CONFIG_NOT_FOUND',
      `Project directory ${abs} (from ${source}) does not exist.`,
    );
  }
  return { projectDir: abs, source };
}

function searchUpward(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    if (hasMarker(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

interface RegistryEntry {
  path: string;
  name?: string;
}

function readRegistry(home: string): { entries: RegistryEntry[]; default?: string } {
  const file = join(home, '.api-tester', 'projects.json');
  if (!existsSync(file)) return { entries: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(readFileSync(file, 'utf8')));
  } catch {
    throw new EngineError('CONFIG_INVALID', `~/.api-tester/projects.json is not valid JSON.`);
  }
  const obj = parsed as { projects?: unknown; default?: unknown };
  const rawList = Array.isArray(parsed) ? parsed : obj.projects;
  const entries: RegistryEntry[] = Array.isArray(rawList)
    ? rawList
        .map((e) => (typeof e === 'string' ? { path: e } : (e as RegistryEntry)))
        .filter((e) => e && typeof e.path === 'string')
    : [];
  const def = typeof obj.default === 'string' ? obj.default : undefined;
  return def !== undefined ? { entries, default: def } : { entries };
}

export function resolveProject(opts: ResolveOptions = {}): ResolvedProject {
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;

  if (opts.project) return assertProjectDir(opts.project, 'explicit');
  if (opts.pluginProjectPath) return assertProjectDir(opts.pluginProjectPath, 'plugin_project_path');
  if (env.API_TESTER_PROJECT) return assertProjectDir(env.API_TESTER_PROJECT, 'env');

  const found = searchUpward(cwd);
  if (found) return { projectDir: resolve(found), source: 'upward_search' };

  const { entries, default: def } = readRegistry(home);
  if (entries.length === 1) return assertProjectDir(entries[0]!.path, 'registry');
  if (entries.length > 1) {
    if (def) {
      const match = entries.find((e) => e.name === def || resolve(e.path) === resolve(def));
      if (match) return assertProjectDir(match.path, 'registry');
    }
    const names = entries.map((e) => e.name ?? e.path).join(', ');
    throw new EngineError(
      'PROJECT_AMBIGUOUS',
      `Multiple registered projects and none selected: ${names}.`,
      'Pass a `project` argument, set project_path in the plugin settings, or set API_TESTER_PROJECT.',
    );
  }

  throw new EngineError(
    'CONFIG_NOT_FOUND',
    'No project could be resolved.',
    'Pass a `project` argument, set the plugin project_path, set API_TESTER_PROJECT, or run inside a project (a directory with pom.xml/build.gradle or .api-tester/config.json).',
  );
}
