/**
 * OpenAPI load orchestration (build-prompt §16).
 *
 * Pipeline: discover candidate URL(s) -> fetch (cached, conditional) -> parse
 * (JSON/YAML) -> detect version -> Swagger 2.0 conversion if needed -> validate
 * + dereference -> (merge grouped Springdoc APIs) -> LoadedSpec.
 *
 * Normalization to JSON Schema and the EndpointRegistry are Phase 3; this phase
 * stops at a validated, dereferenced OpenAPI 3.x document.
 */
import OpenAPIParser from '@readme/openapi-parser';
import { EngineError } from '../types/errors.js';
import type { HttpFetcher, LoadedSpec, OpenApiDocument, SpecVersion } from '../types/openapi.js';
import { defaultFetcher } from '../http/fetcher.js';
import { SpecCache, sha256Hex } from '../cache/specCache.js';
import { candidateSpecUrls, resolveUrl } from './discovery.js';
import { fetchSpec } from './fetchSpec.js';
import { convertSwagger2 } from './convert.js';
import { mergeDocuments } from './merge.js';
import {
  detectVersion,
  isSpecLike,
  isSwaggerConfig,
  parseSpecText,
  type RawDoc,
} from './parse.js';

export interface LoadOpenApiOptions {
  baseUrl: string;
  openApiUrl?: string;
  fetcher?: HttpFetcher;
  cache?: SpecCache;
  dataDir?: string;
  refreshSpec?: boolean;
  now?: () => string;
}

interface FetchCtx {
  baseUrl: string;
  fetcher: HttpFetcher;
  cache: SpecCache;
  refreshSpec: boolean;
  now?: () => string;
}

/** Validate + dereference a 3.x document, mapping failures to SPEC_INVALID. */
export async function validateAndDereference(
  doc: OpenApiDocument,
  sourceUrl: string,
): Promise<OpenApiDocument> {
  try {
    const validated = await OpenAPIParser.validate(structuredClone(doc), {
      validate: { spec: false },
    });
    return validated as unknown as OpenApiDocument;
  } catch (err) {
    throw new EngineError('SPEC_INVALID', `Spec at ${sourceUrl} failed validation: ${String(err)}`);
  }
}

async function toDocument(raw: RawDoc, sourceUrl: string): Promise<{ doc: OpenApiDocument; version: SpecVersion }> {
  const version = detectVersion(raw, sourceUrl);
  const doc3 = version === '2.0' ? await convertSwagger2(raw) : (raw as unknown as OpenApiDocument);
  const validated = await validateAndDereference(doc3, sourceUrl);
  return { doc: validated, version };
}

interface GroupRef {
  url: string;
  name: string;
}

function readGroupRefs(config: RawDoc, configUrl: string, baseUrl: string): GroupRef[] {
  if (!Array.isArray(config.urls)) return [];
  const refs: GroupRef[] = [];
  for (const entry of config.urls as unknown[]) {
    if (entry && typeof entry === 'object' && typeof (entry as RawDoc).url === 'string') {
      const rel = (entry as { url: string; name?: string }).url;
      const name = (entry as { name?: string }).name ?? rel;
      refs.push({ url: resolveUrl(configUrl || baseUrl, rel), name });
    }
  }
  // Deterministic order regardless of server response ordering.
  refs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return refs;
}

async function loadGrouped(config: RawDoc, configUrl: string, ctx: FetchCtx): Promise<LoadedSpec> {
  const refs = readGroupRefs(config, configUrl, ctx.baseUrl);
  if (refs.length === 0) {
    throw new EngineError(
      'SPEC_INVALID',
      `Springdoc swagger-config at ${configUrl} listed no group URLs.`,
    );
  }
  const docs: OpenApiDocument[] = [];
  const shas: string[] = [];
  let version: SpecVersion = '3.0';
  for (const ref of refs) {
    const fetched = await fetchSpec(ref.url, ctx);
    const raw = parseSpecText(fetched.text, ref.url);
    if (!isSpecLike(raw)) {
      throw new EngineError('SPEC_INVALID', `Group ${ref.name} at ${ref.url} is not a spec.`);
    }
    const { doc, version: v } = await toDocument(raw, ref.url);
    docs.push(doc);
    shas.push(fetched.sha256);
    version = v;
  }
  return {
    document: mergeDocuments(docs),
    version,
    sourceUrls: refs.map((r) => r.url),
    sha256: sha256Hex(shas.join(':')),
  };
}

export async function loadOpenApi(opts: LoadOpenApiOptions): Promise<LoadedSpec> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const cache = opts.cache ?? new SpecCache(opts.dataDir);
  const ctx: FetchCtx = {
    baseUrl: opts.baseUrl,
    fetcher,
    cache,
    refreshSpec: opts.refreshSpec ?? false,
    ...(opts.now ? { now: opts.now } : {}),
  };

  const candidates = candidateSpecUrls(opts.baseUrl, opts.openApiUrl);
  const tried: string[] = [];
  let connectionRefused = false;

  for (const url of candidates) {
    tried.push(url);
    let text: string;
    let sha: string;
    try {
      const fetched = await fetchSpec(url, ctx);
      text = fetched.text;
      sha = fetched.sha256;
    } catch (err) {
      // Detect "server isn't running" so we can give an actionable hint later.
      if (/ECONNREFUSED|fetch failed|connect|ENOTFOUND|EAI_AGAIN/i.test(String(err))) {
        connectionRefused = true;
      }
      continue; // unreachable candidate — try next
    }

    let raw: RawDoc;
    try {
      raw = parseSpecText(text, url);
    } catch {
      continue; // e.g. a swagger-ui HTML page — not a spec
    }

    if (isSwaggerConfig(raw)) return loadGrouped(raw, url, ctx);
    if (isSpecLike(raw)) {
      const { doc, version } = await toDocument(raw, url);
      return { document: doc, version, sourceUrls: [url], sha256: sha };
    }
    // parsed but not a spec — keep probing
  }

  if (connectionRefused) {
    throw new EngineError(
      'SPEC_UNREACHABLE',
      `The API at ${opts.baseUrl} doesn't appear to be running.`,
      `Start the server, then try again. (Tried ${tried.length} spec locations at ${opts.baseUrl}.)`,
    );
  }
  throw new EngineError(
    'SPEC_UNREACHABLE',
    opts.openApiUrl
      ? `No OpenAPI spec at the configured openApiUrl (${candidates[0]}).`
      : `Couldn't find an OpenAPI spec at ${opts.baseUrl}.`,
    `The server is reachable but no spec was found. Tried: ${tried.join(', ')}. ` +
      `Set "openApiUrl" in .api-tester/config.json if the spec lives elsewhere.`,
  );
}
