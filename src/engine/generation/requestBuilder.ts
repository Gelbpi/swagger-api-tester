/**
 * RequestBuilder (build-prompt §22–24, §21).
 *
 * Assembles a concrete, sanitizable request from an endpoint + config + explicit
 * overrides. Path params are never guessed (§22); only documented query params
 * are generated, optional ones only when they have an explicit source (§23);
 * content type is chosen from a supported allow-list (§24); the generated body
 * is validated against its own request schema before it can be sent (§21).
 *
 * Precedence for every slot: explicit test_endpoint args > config.requestOverrides
 * > generated/resolved values.
 */
import type { OpenAPIV3 } from 'openapi-types';
import type { Endpoint } from '../types/endpoint.js';
import type { BuildResult, ExplicitOverrides, PreparedRequest } from '../types/request.js';
import { SchemaValidator } from '../validation/schemaValidator.js';
import { generateValue } from './dataGenerator.js';
import {
  EXPLICIT_SOURCES,
  resolveParam,
  type TestValuesByLocation,
} from './paramResolver.js';

export interface TestValuesConfig extends TestValuesByLocation {
  body?: Record<string, unknown>;
  byFormat?: Record<string, unknown>;
}

export interface BuildRequestInput {
  endpoint: Endpoint;
  baseUrl: string;
  testValues?: TestValuesConfig;
  requestOverride?: ExplicitOverrides;
  explicit?: ExplicitOverrides;
  validator?: SchemaValidator;
}

/** Supported request content types, in selection-priority order (§24). */
const SUPPORTED_CONTENT_TYPES = [
  'application/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
  'application/octet-stream',
] as const;

function seedFor(endpoint: Endpoint): string {
  return endpoint.operationId ?? `${endpoint.method} ${endpoint.path}`;
}

function serializeQueryParam(param: OpenAPIV3.ParameterObject, value: unknown): Array<[string, string]> {
  const name = param.name;
  const style = param.style ?? 'form';
  const explode = param.explode ?? style === 'form';

  if (Array.isArray(value)) {
    if (style === 'spaceDelimited') return [[name, value.join(' ')]];
    if (style === 'pipeDelimited') return [[name, value.join('|')]];
    if (style === 'form' && !explode) return [[name, value.map(String).join(',')]];
    return value.map((v) => [name, String(v)] as [string, string]);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (style === 'deepObject') return entries.map(([k, v]) => [`${name}[${k}]`, String(v)]);
    if (explode) return entries.map(([k, v]) => [k, String(v)]);
    return [[name, entries.flatMap(([k, v]) => [k, String(v)]).join(',')]];
  }
  return [[name, String(value)]];
}

interface BodyOutcome {
  none?: true;
  skip?: { reason: 'UNSUPPORTED_MEDIA_TYPE' | 'UNGENERATABLE_SCHEMA'; explanation: string };
  contentType?: string;
  body?: unknown;
  bodyString?: string;
}

function serializeBody(contentType: string, value: unknown): string {
  if (contentType === 'application/json') return JSON.stringify(value);
  if (contentType === 'application/x-www-form-urlencoded') {
    const params = new URLSearchParams();
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) params.append(k, String(v));
    }
    return params.toString();
  }
  if (contentType === 'text/plain') return typeof value === 'string' ? value : String(value);
  if (contentType === 'application/octet-stream') return typeof value === 'string' ? value : 'binary-data';
  // multipart is materialized by the HTTP layer; keep a readable placeholder.
  return JSON.stringify(value);
}

function buildBody(input: BuildRequestInput, validator: SchemaValidator): BodyOutcome {
  const { endpoint, explicit, requestOverride } = input;
  const rb = endpoint.requestBody;
  const overrideBody = explicit?.body !== undefined ? explicit.body : requestOverride?.body;

  if (!rb && overrideBody === undefined) return { none: true };

  const content = (rb?.content ?? {}) as Record<string, OpenAPIV3.MediaTypeObject>;
  const contentType = SUPPORTED_CONTENT_TYPES.find((ct) => ct in content);

  if (!contentType) {
    if (overrideBody !== undefined) {
      // User supplied a body but no supported media type is documented -> send JSON.
      return {
        contentType: 'application/json',
        body: overrideBody,
        bodyString: serializeBody('application/json', overrideBody),
      };
    }
    if (rb?.required) {
      const documented = Object.keys(content).join(', ') || '(none)';
      return {
        skip: {
          reason: 'UNSUPPORTED_MEDIA_TYPE',
          explanation: `No supported request media type (documented: ${documented}).`,
        },
      };
    }
    return { none: true };
  }

  if (overrideBody !== undefined) {
    return {
      contentType,
      body: overrideBody,
      bodyString: serializeBody(contentType, overrideBody),
    };
  }

  const schema = content[contentType]!.schema;
  const value = generateValue(schema, {
    seed: `${seedFor(endpoint)}#body`,
    ...(input.testValues
      ? {
          testValues: {
            ...(input.testValues.body ? { byName: input.testValues.body } : {}),
            ...(input.testValues.byFormat ? { byFormat: input.testValues.byFormat } : {}),
          },
        }
      : {}),
  });

  // Self-validation (§21): never send a request our own contract rejects.
  if (schema) {
    const key = `${seedFor(endpoint)}#reqbody#${contentType}`;
    const result = validator.validate(schema, value, key);
    if (!result.valid) {
      return {
        skip: {
          reason: 'UNGENERATABLE_SCHEMA',
          explanation: `Generated body failed its own request schema: ${result.errors
            .slice(0, 3)
            .map((e) => e.message)
            .join('; ')}`,
        },
      };
    }
  }

  return { contentType, body: value, bodyString: serializeBody(contentType, value) };
}

export function buildRequest(input: BuildRequestInput): BuildResult {
  const { endpoint, baseUrl, testValues, explicit, requestOverride } = input;
  const validator = input.validator ?? new SchemaValidator();
  const resolveOpts = testValues ? { testValues } : {};
  const missing: string[] = [];
  const notes: string[] = [];

  const paramsByLoc = (loc: string) =>
    endpoint.parameters.filter((p) => p.in === loc) as OpenAPIV3.ParameterObject[];
  const pathParamByName = new Map(paramsByLoc('path').map((p) => [p.name, p]));

  // --- Path parameters (never guessed, §22) ---
  const pathParams: Record<string, unknown> = {};
  let concretePath = endpoint.path;
  for (const token of [...endpoint.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!)) {
    let value: unknown;
    if (explicit?.pathParams && token in explicit.pathParams) value = explicit.pathParams[token];
    else if (requestOverride?.pathParams && token in requestOverride.pathParams) value = requestOverride.pathParams[token];
    else {
      const param = pathParamByName.get(token);
      if (param) value = resolveParam(param, resolveOpts)?.value;
      if (value === undefined) value = testValues?.path?.[token];
    }
    if (value === undefined) {
      missing.push(token);
      continue;
    }
    pathParams[token] = value;
    concretePath = concretePath.replace(`{${token}}`, encodeURIComponent(String(value)));
  }

  // --- Query parameters (§23) ---
  const query: Array<[string, string]> = [];
  const documentedQueryNames = new Set(paramsByLoc('query').map((p) => p.name));
  for (const param of paramsByLoc('query')) {
    const name = param.name;
    let value: unknown;
    let include = false;
    if (explicit?.query && name in explicit.query) {
      value = explicit.query[name];
      include = true;
    } else if (requestOverride?.query && name in requestOverride.query) {
      value = requestOverride.query[name];
      include = true;
    } else {
      const resolved = resolveParam(param, resolveOpts);
      if (resolved && (param.required === true || EXPLICIT_SOURCES.has(resolved.source))) {
        value = resolved.value;
        include = true;
      } else if (!resolved && param.required === true) {
        missing.push(name);
      }
    }
    if (include) query.push(...serializeQueryParam(param, value));
  }
  // Explicit user query params that are not documented are still honored.
  for (const [k, v] of Object.entries(explicit?.query ?? {})) {
    if (!documentedQueryNames.has(k)) {
      if (Array.isArray(v)) for (const item of v) query.push([k, String(item)]);
      else query.push([k, String(v)]);
    }
  }

  // --- Header + cookie parameters ---
  const headers: Record<string, string> = {};
  for (const param of paramsByLoc('header')) {
    const name = param.name;
    if (explicit?.headers && name in explicit.headers) continue; // applied later at top precedence
    const resolved = resolveParam(param, resolveOpts);
    if (resolved && (param.required === true || EXPLICIT_SOURCES.has(resolved.source))) {
      headers[name] = String(resolved.value);
    } else if (!resolved && param.required === true) {
      missing.push(name);
    }
  }
  const cookiePairs: string[] = [];
  for (const param of paramsByLoc('cookie')) {
    const resolved = resolveParam(param, resolveOpts);
    if (resolved && (param.required === true || EXPLICIT_SOURCES.has(resolved.source))) {
      cookiePairs.push(`${param.name}=${String(resolved.value)}`);
    }
  }
  if (cookiePairs.length) headers['Cookie'] = cookiePairs.join('; ');

  if (missing.length) {
    return {
      ok: false,
      reason: 'NO_TEST_DATA',
      explanation: `No value for required parameter${missing.length > 1 ? 's' : ''} "${missing.join(
        '", "',
      )}"`,
    };
  }

  // --- Body (§24) + self-validation (§21) ---
  const bodyOutcome = buildBody(input, validator);
  if (bodyOutcome.skip) {
    return { ok: false, reason: bodyOutcome.skip.reason, explanation: bodyOutcome.skip.explanation };
  }

  // --- Merge overrides (config then explicit; explicit wins) ---
  Object.assign(headers, requestOverride?.headers ?? {}, explicit?.headers ?? {});
  if (bodyOutcome.contentType && headers['Content-Type'] === undefined && headers['content-type'] === undefined) {
    headers['Content-Type'] = bodyOutcome.contentType;
  }

  const qs = new URLSearchParams(query).toString();
  const url = `${baseUrl.replace(/\/$/, '')}${concretePath}${qs ? `?${qs}` : ''}`;

  const request: PreparedRequest = {
    method: endpoint.method,
    url,
    path: concretePath,
    pathParams,
    query,
    headers,
    ...(bodyOutcome.contentType ? { contentType: bodyOutcome.contentType } : {}),
    ...(bodyOutcome.body !== undefined ? { body: bodyOutcome.body } : {}),
    ...(bodyOutcome.bodyString !== undefined ? { bodyString: bodyOutcome.bodyString } : {}),
  };
  return { ok: true, request, notes };
}
