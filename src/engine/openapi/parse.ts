/**
 * Raw spec parsing and version detection (build-prompt §16).
 * Content type is NOT trusted — we inspect the content itself.
 */
import { parse as parseYaml } from 'yaml';
import { EngineError } from '../types/errors.js';
import type { SpecVersion } from '../types/openapi.js';

export interface RawDoc {
  swagger?: unknown;
  openapi?: unknown;
  urls?: unknown;
  configUrl?: unknown;
  [k: string]: unknown;
}

/** Parse spec text as JSON, falling back to YAML. Extension/content-type agnostic. */
export function parseSpecText(text: string, sourceUrl = '<spec>'): RawDoc {
  const trimmed = text.trimStart();
  const tryJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  const attempts: Array<() => unknown> = tryJson
    ? [() => JSON.parse(text), () => parseYaml(text)]
    : [() => parseYaml(text), () => JSON.parse(text)];
  for (const attempt of attempts) {
    try {
      const parsed = attempt();
      if (parsed && typeof parsed === 'object') return parsed as RawDoc;
    } catch {
      // try next strategy
    }
  }
  throw new EngineError('SPEC_INVALID', `Could not parse spec at ${sourceUrl} as JSON or YAML.`);
}

/** True if the object looks like a springdoc swagger-config (grouped APIs). */
export function isSwaggerConfig(doc: RawDoc): boolean {
  return Array.isArray(doc.urls) || typeof doc.configUrl === 'string';
}

/** True if the object looks like an OpenAPI/Swagger spec. */
export function isSpecLike(doc: RawDoc): boolean {
  return typeof doc.openapi === 'string' || typeof doc.swagger === 'string';
}

/** Detect the spec version, or throw a categorized engine error. */
export function detectVersion(doc: RawDoc, sourceUrl = '<spec>'): SpecVersion {
  if (typeof doc.swagger === 'string') {
    if (doc.swagger.startsWith('2')) return '2.0';
    throw new EngineError(
      'SPEC_UNSUPPORTED_VERSION',
      `Unsupported Swagger version "${doc.swagger}" at ${sourceUrl}.`,
    );
  }
  if (typeof doc.openapi === 'string') {
    if (doc.openapi.startsWith('3.0')) return '3.0';
    if (doc.openapi.startsWith('3.1')) return '3.1';
    throw new EngineError(
      'SPEC_UNSUPPORTED_VERSION',
      `Unsupported OpenAPI version "${doc.openapi}" at ${sourceUrl}.`,
    );
  }
  throw new EngineError(
    'SPEC_INVALID',
    `Document at ${sourceUrl} is not an OpenAPI/Swagger spec (no "openapi"/"swagger" field).`,
  );
}
