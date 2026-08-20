/**
 * Shared engine context (build-prompt §9 steps 1-4).
 *
 * Resolves project -> config -> settings (profile) -> baseUrl/openApiUrl ->
 * loaded spec -> endpoint registry -> auth manager. Used by BOTH test_endpoint
 * and test_all so the resolution logic lives in exactly one place. Throws
 * categorized EngineErrors that callers convert into ENGINE_ERROR results.
 */
import { loadConfigOptional, applyProfile } from '../config/loader.js';
import type { Settings } from '../config/schema.js';
import { resolveProject } from '../project/resolver.js';
import { readApiTesterMd } from '../project/apiTesterMd.js';
import { autoDetectProject } from '../project/autoDetect.js';
import { loadOpenApi } from '../openapi/loadOpenApi.js';
import { EndpointRegistry } from '../openapi/endpointRegistry.js';
import { AuthManager } from '../auth/authManager.js';
import { SchemaValidator } from '../validation/schemaValidator.js';
import { assertTargetAllowed } from '../http/targetGuard.js';
import { EngineError } from '../types/errors.js';
import type { HttpFetcher, LoadedSpec } from '../types/openapi.js';
import type { HttpFetchImpl } from '../types/http.js';
import { sendRequest } from '../http/httpClient.js';

export interface PrepareContextInput {
  project?: string;
  pluginProjectPath?: string;
  /** Working directory for upward project search (defaults to process.cwd()). */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  dataDir?: string;
  now?: () => number;
  /** Injectable fetcher for spec discovery (tests). */
  specFetcher?: HttpFetcher;
  /** Injectable transport for auth/login HTTP calls (tests). */
  httpFetchImpl?: HttpFetchImpl;
  refreshSpec?: boolean;
  profile?: string;
}

export interface EngineContext {
  /** Undefined in URL-only mode (base_url set, no project on disk). */
  projectDir?: string;
  settings: Settings;
  baseUrl: string;
  openApiUrl?: string;
  spec: LoadedSpec;
  registry: EndpointRegistry;
  authManager: AuthManager;
  validator: SchemaValidator;
  warnings: string[];
  env: NodeJS.ProcessEnv;
  now: () => number;
}

function nonEmpty(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export async function prepareContext(input: PrepareContextInput): Promise<EngineContext> {
  const env = input.env ?? process.env;
  const now = input.now ?? Date.now;

  // A base URL supplied via the plugin settings (userConfig base_url) lets the
  // user skip having a project on disk entirely.
  const envBaseUrl = nonEmpty(env.API_TESTER_BASE_URL);
  const envOpenApiUrl = nonEmpty(env.API_TESTER_OPENAPI_URL);

  // Resolve the project directory. If none can be found but we already have a
  // base URL from the plugin settings, run in URL-only mode (no project needed).
  let projectDir: string | undefined;
  try {
    projectDir = resolveProject({
      ...(input.project ? { project: input.project } : {}),
      ...(input.pluginProjectPath ? { pluginProjectPath: input.pluginProjectPath } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      env,
    }).projectDir;
  } catch (err) {
    if (!envBaseUrl) throw err;
    projectDir = undefined;
  }

  let warnings: string[] = [];
  let settings: Settings = {};
  let apiMdBaseUrl: string | undefined;
  let apiMdOpenApiUrl: string | undefined;
  if (projectDir) {
    const loaded = await loadConfigOptional(projectDir);
    warnings = loaded.warnings;
    settings = applyProfile(loaded.config, input.profile);
    const apiMd = readApiTesterMd(projectDir);
    if (apiMd?.warnings.length) warnings.push(...apiMd.warnings);
    apiMdBaseUrl = apiMd?.baseUrl;
    apiMdOpenApiUrl = apiMd?.openApiUrl;
  }

  // Precedence: config.json > plugin base_url > API_TESTER.md > auto-detect.
  // So a plain Spring Boot/Quarkus/Micronaut repo needs no config file at all,
  // and a URL typed into the plugin settings needs no project at all.
  let baseUrl = settings.baseUrl ?? envBaseUrl ?? apiMdBaseUrl;
  let openApiUrl = settings.openApiUrl ?? envOpenApiUrl ?? apiMdOpenApiUrl;
  if (projectDir && (!baseUrl || !openApiUrl)) {
    const detected = autoDetectProject(projectDir);
    if (!baseUrl && detected.baseUrl) {
      baseUrl = detected.baseUrl;
      warnings.push(...detected.notes);
    }
    if (!openApiUrl && detected.openApiUrl) openApiUrl = detected.openApiUrl;
  }
  if (!baseUrl) {
    throw new EngineError(
      'CONFIG_INVALID',
      'Could not determine the API base URL.',
      'Set base_url in the plugin settings, add .api-tester/config.json with a "baseUrl", or run inside a Spring Boot/Quarkus/Micronaut project.',
    );
  }

  assertTargetAllowed(baseUrl, {
    ...(settings.allowRemoteTargets !== undefined ? { allowRemoteTargets: settings.allowRemoteTargets } : {}),
    env,
  });

  const spec = await loadOpenApi({
    baseUrl,
    ...(openApiUrl ? { openApiUrl } : {}),
    ...(input.specFetcher ? { fetcher: input.specFetcher } : {}),
    ...(input.dataDir ? { dataDir: input.dataDir } : {}),
    refreshSpec: input.refreshSpec ?? false,
  });

  return {
    ...(projectDir ? { projectDir } : {}),
    settings,
    baseUrl,
    ...(openApiUrl ? { openApiUrl } : {}),
    spec,
    registry: new EndpointRegistry(spec.document),
    authManager: new AuthManager(settings.auth?.profiles ?? {}, {
      now,
      baseUrl,
      ...(input.httpFetchImpl
        ? { httpSend: (req) => sendRequest(req, { fetchImpl: input.httpFetchImpl! }) }
        : {}),
    }),
    validator: new SchemaValidator(),
    warnings,
    env,
    now,
  };
}
