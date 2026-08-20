/**
 * test_endpoint orchestrator (build-prompt §8, Phase 7).
 *
 * Connects the full pipeline for a single endpoint and persists the run. The
 * user explicitly asked for this endpoint, so mutations are permitted; but
 * side-effecting/destructive operations still require confirmSideEffects=true.
 */
import type { CompactTestResult } from '../types/result.js';
import type { HttpFetcher } from '../types/openapi.js';
import type { HttpFetchImpl } from '../types/http.js';
import type { ExplicitOverrides } from '../types/request.js';
import { HTTP_METHODS, type HttpMethod } from '../types/endpoint.js';
import { emptyTotals, tallyOutcome, type RunRecord, type TestRecord } from '../types/run.js';
import { prepareContext } from './context.js';
import { executeOne, type RiskGate } from './executeOne.js';
import { matchEndpoint } from '../openapi/endpointMatcher.js';
import { RunStore } from '../results/runStore.js';
import { makeRunId } from '../results/ids.js';
import { toCompactResult } from '../results/compact.js';
import { EngineError } from '../types/errors.js';
import type { EngineErrorReason, Reason } from '../types/result.js';

export interface TestEndpointInput {
  method: string;
  path: string;
  project?: string;
  body?: unknown;
  query?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
  headers?: Record<string, string>;
  authProfile?: string;
  expectStatus?: number;
  profile?: string;
  refreshSpec?: boolean;
  dryRun?: boolean;
  confirmSideEffects?: boolean;
  includeResponseBody?: boolean;
  // Injection / environment
  pluginProjectPath?: string;
  env?: NodeJS.ProcessEnv;
  dataDir?: string;
  now?: () => number;
  specFetcher?: HttpFetcher;
  httpFetchImpl?: HttpFetchImpl;
  sleep?: (ms: number) => Promise<void>;
}

export interface TestEndpointResult {
  compact: CompactTestResult;
  runId: string;
}

function errorRecord(
  runId: string,
  method: string,
  path: string,
  reason: Reason | null,
  explanation: string,
  outcome: 'ENGINE_ERROR' | 'SKIPPED' = 'ENGINE_ERROR',
): TestRecord {
  return {
    testId: 't_001',
    runId,
    outcome,
    reason,
    explanation,
    method,
    path,
    risk: 'READ',
    expectedStatus: null,
    actualStatus: null,
    expectationLogic: '',
    durationMs: null,
    validationErrors: [],
    dryRun: false,
  };
}

function persist(
  store: RunStore,
  runId: string,
  createdAt: string,
  baseUrl: string,
  openApiUrl: string | undefined,
  mutations: boolean,
  warnings: string[],
  record: TestRecord,
): void {
  const totals = emptyTotals();
  tallyOutcome(totals, record.outcome);
  const run: RunRecord = {
    runId,
    createdAt,
    baseUrl,
    ...(openApiUrl ? { openApiUrl } : {}),
    mutations,
    durationMs: record.durationMs ?? 0,
    totals,
    warnings,
    tests: [record],
  };
  store.saveRun(run);
}

export async function testEndpoint(input: TestEndpointInput): Promise<TestEndpointResult> {
  const now = input.now ?? Date.now;
  const runId = makeRunId(now());
  const store = new RunStore(input.dataDir);
  const createdAt = new Date(now()).toISOString();
  const method = input.method.toUpperCase();

  // Resolve the whole context; any EngineError becomes an ENGINE_ERROR result.
  let ctx;
  try {
    ctx = await prepareContext({
      ...(input.project ? { project: input.project } : {}),
      ...(input.pluginProjectPath ? { pluginProjectPath: input.pluginProjectPath } : {}),
      ...(input.env ? { env: input.env } : {}),
      ...(input.dataDir ? { dataDir: input.dataDir } : {}),
      now,
      ...(input.specFetcher ? { specFetcher: input.specFetcher } : {}),
      ...(input.httpFetchImpl ? { httpFetchImpl: input.httpFetchImpl } : {}),
      refreshSpec: input.refreshSpec ?? false,
      ...(input.profile ? { profile: input.profile } : {}),
    });
  } catch (err) {
    const reason: EngineErrorReason = err instanceof EngineError ? err.reason : 'GENERATOR_ERROR';
    const record = errorRecord(runId, method, input.path, reason, err instanceof Error ? err.message : String(err));
    persist(store, runId, createdAt, '', undefined, false, [], record);
    return { compact: toCompactResult(record), runId };
  }

  if (!HTTP_METHODS.includes(method as HttpMethod)) {
    const record = errorRecord(runId, method, input.path, 'GENERATOR_ERROR', `Unsupported HTTP method "${input.method}".`);
    persist(store, runId, createdAt, ctx.baseUrl, ctx.openApiUrl, false, ctx.warnings, record);
    return { compact: toCompactResult(record), runId };
  }

  const match = matchEndpoint(ctx.registry, method as HttpMethod, input.path);
  if (!match.match) {
    const explanation =
      match.candidates.length > 0
        ? `No unique match for ${method} ${input.path}. Candidates: ${match.candidates
            .map((c) => `${c.method} ${c.path}`)
            .join(', ')}`
        : `No endpoint matches ${method} ${input.path}.`;
    const record = errorRecord(runId, method, input.path, 'GENERATOR_ERROR', explanation);
    persist(store, runId, createdAt, ctx.baseUrl, ctx.openApiUrl, false, ctx.warnings, record);
    return { compact: toCompactResult(record), runId };
  }

  const gate: RiskGate = {
    allowMutating: true,
    allowSideEffecting: input.confirmSideEffects === true,
    allowDestructive: input.confirmSideEffects === true,
    skipDeprecated: false,
  };

  const explicit: ExplicitOverrides = {
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.query ? { query: input.query } : {}),
    ...(input.pathParams ? { pathParams: input.pathParams } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
  };

  const record = await executeOne({
    ctx,
    endpoint: match.match,
    runId,
    index: 1,
    gate,
    ...(Object.keys(explicit).length ? { explicit } : {}),
    ...(input.authProfile ? { authProfile: input.authProfile } : {}),
    ...(input.expectStatus !== undefined ? { expectStatus: input.expectStatus } : {}),
    ...(input.dryRun ? { dryRun: input.dryRun } : {}),
    ...(input.includeResponseBody ? { includeResponseBody: input.includeResponseBody } : {}),
    ...(input.httpFetchImpl ? { httpFetchImpl: input.httpFetchImpl } : {}),
    ...(input.sleep ? { sleep: input.sleep } : {}),
  });

  persist(store, runId, createdAt, ctx.baseUrl, ctx.openApiUrl, gate.allowMutating, ctx.warnings, record);
  return { compact: toCompactResult(record), runId };
}
