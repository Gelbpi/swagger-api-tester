/**
 * Configuration loader (build-prompt §13).
 *
 * Reads `.api-tester/config.json` (authoritative) and, if present, the gitignored
 * `.api-tester/config.local.json` (overrides). Supports JSON-with-comments.
 * Unknown top-level keys are hard errors with "did you mean" suggestions.
 * `seed`/`teardown`/`smartValues` are reserved and produce warnings.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EngineError } from '../types/errors.js';
import {
  configSchema,
  KNOWN_TOP_LEVEL_KEYS,
  RESERVED_KEYS,
  type ApiTesterConfig,
  type Settings,
} from './schema.js';

export interface LoadedConfig {
  config: ApiTesterConfig;
  warnings: string[];
  /** Absolute paths that contributed to the merged config. */
  sources: string[];
}

/** Strip `//` and `/* *​/` comments from JSON while respecting string literals. */
export function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    const next = input[i + 1];
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && next === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[m]![n]!;
}

function suggestKey(unknown: string): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const known of KNOWN_TOP_LEVEL_KEYS) {
    const d = levenshtein(unknown.toLowerCase(), known.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = known;
    }
  }
  return bestDist <= 3 ? best : undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merge plain objects; arrays and scalars from `over` replace `base`. */
export function deepMerge<T>(base: T, over: Partial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(over)) return (over as T) ?? base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

async function readJsonc(path: string): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new EngineError('CONFIG_NOT_FOUND', `Cannot read config file at ${path}.`);
  }
  try {
    const parsed = JSON.parse(stripJsonComments(raw));
    if (!isPlainObject(parsed)) {
      throw new EngineError('CONFIG_INVALID', `Config at ${path} must be a JSON object.`);
    }
    return parsed;
  } catch (err) {
    if (err instanceof EngineError) throw err;
    throw new EngineError('CONFIG_INVALID', `Config at ${path} is not valid JSON: ${String(err)}`);
  }
}

function checkUnknownKeys(obj: Record<string, unknown>, path: string): void {
  const unknown = Object.keys(obj).filter((k) => !KNOWN_TOP_LEVEL_KEYS.includes(k));
  if (unknown.length === 0) return;
  const parts = unknown.map((k) => {
    const s = suggestKey(k);
    return s ? `"${k}" (did you mean "${s}"?)` : `"${k}"`;
  });
  throw new EngineError(
    'CONFIG_INVALID',
    `Unknown configuration key(s) in ${path}: ${parts.join(', ')}.`,
    `Allowed keys: ${KNOWN_TOP_LEVEL_KEYS.join(', ')}.`,
  );
}

/**
 * Load and validate the effective config for a project directory.
 * `.api-tester/config.local.json` overrides `.api-tester/config.json`.
 */
export async function loadConfig(projectDir: string): Promise<LoadedConfig> {
  const dir = join(projectDir, '.api-tester');
  const basePath = join(dir, 'config.json');
  const localPath = join(dir, 'config.local.json');
  const sources: string[] = [];
  const warnings: string[] = [];

  if (!existsSync(basePath)) {
    throw new EngineError(
      'CONFIG_NOT_FOUND',
      `No .api-tester/config.json found under ${projectDir}.`,
      'Create .api-tester/config.json with at least a "baseUrl".',
    );
  }

  let merged = await readJsonc(basePath);
  checkUnknownKeys(merged, basePath);
  sources.push(basePath);

  if (existsSync(localPath)) {
    const local = await readJsonc(localPath);
    checkUnknownKeys(local, localPath);
    merged = deepMerge(merged, local);
    sources.push(localPath);
  }

  for (const key of RESERVED_KEYS) {
    if (key in merged) {
      warnings.push(`"${key}" is reserved and is NOT executed in V1; it will be ignored.`);
    }
  }

  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new EngineError('CONFIG_INVALID', `Invalid configuration: ${issues}.`);
  }

  return { config: parsed.data, warnings, sources };
}

/**
 * Like loadConfig, but tolerates a MISSING .api-tester/config.json — in that case
 * it returns an empty config so baseUrl/openApiUrl can be auto-detected from the
 * project instead (build-prompt §2). A malformed config that DOES exist still
 * errors. `present` reports whether a config file contributed.
 */
export async function loadConfigOptional(
  projectDir: string,
): Promise<LoadedConfig & { present: boolean }> {
  const basePath = join(projectDir, '.api-tester', 'config.json');
  if (!existsSync(basePath)) {
    return { config: {}, warnings: [], sources: [], present: false };
  }
  const loaded = await loadConfig(projectDir);
  return { ...loaded, present: true };
}

/**
 * Apply a named profile's overrides onto the base settings (build-prompt §13).
 * Throws CONFIG_INVALID if the requested profile does not exist.
 */
export function applyProfile(config: ApiTesterConfig, profileName?: string): Settings {
  const { profiles, seed: _seed, teardown: _teardown, smartValues: _sv, ...base } = config;
  if (!profileName) return base;
  const override = profiles?.[profileName];
  if (!override) {
    const available = profiles ? Object.keys(profiles).join(', ') || '(none)' : '(none)';
    throw new EngineError(
      'CONFIG_INVALID',
      `Unknown profile "${profileName}". Available profiles: ${available}.`,
    );
  }
  return deepMerge(base, override);
}
