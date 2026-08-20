/**
 * Zero-config project auto-detection (build-prompt §2 "plugin discovers …").
 *
 * The address of the API and the spec path are already in the project's own
 * config, so `.api-tester/config.json` is OPTIONAL — only needed to override a
 * non-standard setup (custom host, Docker port mapping, reverse proxy). We infer
 * *where* the server listens; it still has to be running.
 *
 * Supported frameworks:
 *   - Spring Boot : server.port,     springdoc default /v3/api-docs
 *   - Quarkus     : quarkus.http.port, default /q/openapi
 *   - Micronaut   : micronaut.server.port (spec path left to discovery)
 * Falls back to a PORT/SERVER_PORT value from a `.env` file, then to 8080.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export type Framework = 'spring-boot' | 'quarkus' | 'micronaut' | 'unknown';

export interface AutoDetected {
  baseUrl?: string;
  openApiUrl?: string;
  framework: Framework;
  notes: string[];
}

const APP_CONFIG_LOCATIONS = [
  'src/main/resources/application.properties',
  'src/main/resources/application.yml',
  'src/main/resources/application.yaml',
  'application.properties',
  'application.yml',
  'application.yaml',
];

const BUILD_FILES = ['pom.xml', 'build.gradle', 'build.gradle.kts'];

interface FrameworkSpec {
  framework: Framework;
  buildPattern: RegExp;
  portKeys: string[];
  contextKeys: string[];
  docsKey?: string;
  defaultDocsPath?: string;
}

const FRAMEWORKS: FrameworkSpec[] = [
  {
    framework: 'quarkus',
    buildPattern: /io\.quarkus|quarkus-/i,
    portKeys: ['quarkus.http.port'],
    contextKeys: ['quarkus.http.root-path'],
    defaultDocsPath: '/q/openapi',
  },
  {
    framework: 'micronaut',
    buildPattern: /io\.micronaut|micronaut-/i,
    portKeys: ['micronaut.server.port'],
    contextKeys: ['micronaut.server.context-path'],
  },
  {
    framework: 'spring-boot',
    buildPattern: /spring-boot|springframework\.boot/i,
    portKeys: ['server.port'],
    contextKeys: ['server.servlet.context-path'],
    docsKey: 'springdoc.api-docs.path',
    defaultDocsPath: '/v3/api-docs',
  },
];

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

function detectFramework(projectDir: string): FrameworkSpec | undefined {
  const buildText = BUILD_FILES.map((f) => readIfExists(join(projectDir, f)) ?? '').join('\n');
  for (const spec of FRAMEWORKS) {
    if (spec.buildPattern.test(buildText)) return spec;
  }
  // No recognizable build marker, but a Spring-style app config? Assume Spring.
  if (APP_CONFIG_LOCATIONS.some((rel) => existsSync(join(projectDir, rel)))) {
    return FRAMEWORKS.find((f) => f.framework === 'spring-boot');
  }
  return undefined;
}

function parseProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const eq = line.indexOf('=');
    const colon = line.indexOf(':');
    const sep = eq === -1 ? colon : colon === -1 ? eq : Math.min(eq, colon);
    if (sep <= 0) continue;
    out[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  return out;
}

function pick(flat: Record<string, string>, nested: unknown, dotted: string): string | undefined {
  if (flat[dotted] !== undefined) return flat[dotted];
  let cur: unknown = nested;
  for (const part of dotted.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      cur = undefined;
      break;
    }
  }
  return cur === undefined || cur === null ? undefined : String(cur);
}

/** Ignore values the engine can't resolve statically (env placeholders, random). */
function usable(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.includes('${') || value === '0' || /random/i.test(value)) return undefined;
  return value;
}

function normalizeContextPath(p: string | undefined): string {
  if (!p || p === '/') return '';
  let s = p.trim();
  if (!s.startsWith('/')) s = '/' + s;
  return s.replace(/\/$/, '');
}

/** Best-effort PORT from a .env file (PORT / SERVER_PORT / QUARKUS_HTTP_PORT). */
function portFromDotenv(projectDir: string): string | undefined {
  const text = readIfExists(join(projectDir, '.env'));
  if (!text) return undefined;
  const props = parseProperties(text);
  return usable(props.PORT ?? props.SERVER_PORT ?? props.QUARKUS_HTTP_PORT);
}

function firstUsable(
  keys: string[],
  flat: Record<string, string>,
  nested: unknown,
): string | undefined {
  for (const k of keys) {
    const v = usable(pick(flat, nested, k));
    if (v) return v;
  }
  return undefined;
}

export function autoDetectProject(projectDir: string): AutoDetected {
  const spec = detectFramework(projectDir);
  if (!spec) return { framework: 'unknown', notes: [] };

  let flat: Record<string, string> = {};
  let nested: unknown;
  let usedFile: string | undefined;
  for (const rel of APP_CONFIG_LOCATIONS) {
    const text = readIfExists(join(projectDir, rel));
    if (!text) continue;
    usedFile = rel;
    if (rel.endsWith('.properties')) flat = parseProperties(text);
    else {
      try {
        nested = parseYaml(text);
      } catch {
        nested = undefined;
      }
    }
    break;
  }

  const port =
    firstUsable(spec.portKeys, flat, nested) ?? portFromDotenv(projectDir) ?? '8080';
  const contextPath = normalizeContextPath(firstUsable(spec.contextKeys, flat, nested));
  const docsPath =
    (spec.docsKey ? usable(pick(flat, nested, spec.docsKey)) : undefined) ?? spec.defaultDocsPath;

  const baseUrl = `http://localhost:${port}${contextPath}`;
  const openApiUrl = docsPath ? `http://localhost:${port}${contextPath}${docsPath}` : undefined;

  const notes = [
    `Auto-detected ${spec.framework}: baseUrl ${baseUrl}` +
      `${usedFile ? ` (from ${usedFile})` : ' (defaults)'}. Add .api-tester/config.json to override.`,
  ];

  return { framework: spec.framework, baseUrl, ...(openApiUrl ? { openApiUrl } : {}), notes };
}
