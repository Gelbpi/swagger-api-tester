/**
 * test_all orchestrator (build-prompt §9, §34, §40).
 *
 * Resolves context, builds a deterministic plan, classifies risk, runs with
 * bounded concurrency (continuing past individual failures), aggregates and
 * collapses identical results, persists the full run, and returns a compact
 * summary. Default is read-only: mutations off unless explicitly enabled.
 */
import type { HttpFetcher } from '../types/openapi.js';
import type { HttpFetchImpl } from '../types/http.js';
import type { TestRecord } from '../types/run.js';
import { emptyTotals, tallyOutcome, type RunRecord } from '../types/run.js';
import type { CollapsedGroup, ResultExample, TestAllSummary } from '../types/summary.js';
import type { ValidationErrorDetail } from '../types/result.js';
import { prepareContext } from './context.js';
import { buildPlan, type PlanFilters } from './planBuilder.js';
import { executeOne, type RiskGate } from './executeOne.js';
import { buildNegativeCases, type NegativeCase } from './negativeCases.js';
import { runPool } from './testRunner.js';
import { RunStore } from '../results/runStore.js';
import { makeRunId } from '../results/ids.js';
import { detailsUri } from '../results/compact.js';
import { EngineError } from '../types/errors.js';
import type { EngineErrorReason } from '../types/result.js';

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_FAILURES = 25;

export interface TestAllInput extends PlanFilters {
  project?: string;
  authProfile?: string;
  profile?: string;
  mutations?: boolean;
  maxParallelRequests?: number;
  refreshSpec?: boolean;
  dryRun?: boolean;
  maxFailuresReturned?: number;
  /** Also test documented error responses (400/404/...) with deliberate bad input (#7). */
  negativeTests?: boolean;
  // Injection / environment
  pluginProjectPath?: string;
  env?: NodeJS.ProcessEnv;
  dataDir?: string;
  now?: () => number;
  specFetcher?: HttpFetcher;
  httpFetchImpl?: HttpFetchImpl;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export interface TestAllResult {
  summary: TestAllSummary;
  runId: string;
}

function cancelledRecord(endpointMethod: string, endpointPath: string, runId: string, index: number): TestRecord {
  return {
    testId: `t_${String(index).padStart(3, '0')}_cancelled`,
    runId,
    outcome: 'ENGINE_ERROR',
    reason: 'CANCELLED',
    explanation: 'run cancelled before this endpoint executed',
    method: endpointMethod,
    path: endpointPath,
    risk: 'READ',
    expectedStatus: null,
    actualStatus: null,
    expectationLogic: '',
    durationMs: null,
    validationErrors: [],
    dryRun: false,
  };
}

function collapse(records: TestRecord[], runId: string, limit?: number): {
  groups: CollapsedGroup[];
  dropped: number;
} {
  const byKey = new Map<string, CollapsedGroup>();
  for (const r of records) {
    const key = `${r.outcome}|${r.reason ?? ''}|${r.actualStatus ?? ''}`;
    let group = byKey.get(key);
    if (!group) {
      group = { outcome: r.outcome, reason: r.reason, count: 0, examples: [], validationErrors: [] };
      byKey.set(key, group);
    }
    group.count += 1;
    if (group.examples.length < 3) {
      const example: ResultExample = {
        method: r.method,
        path: r.path,
        actualStatus: r.actualStatus,
        explanation: r.explanation,
        detailsUri: detailsUri(runId, r.testId),
      };
      group.examples.push(example);
    }
    if (group.validationErrors.length === 0 && r.validationErrors.length > 0) {
      group.validationErrors = dedupeErrors(r.validationErrors);
    }
  }
  const all = [...byKey.values()].sort((a, b) => b.count - a.count);
  if (limit === undefined || all.length <= limit) return { groups: all, dropped: 0 };
  return { groups: all.slice(0, limit), dropped: all.length - limit };
}

function dedupeErrors(errors: ValidationErrorDetail[]): ValidationErrorDetail[] {
  const seen = new Set<string>();
  const out: ValidationErrorDetail[] = [];
  for (const e of errors) {
    if (seen.has(e.message)) continue;
    seen.add(e.message);
    out.push(e);
  }
  return out.slice(0, 10);
}

export async function testAll(input: TestAllInput): Promise<TestAllResult> {
  const now = input.now ?? Date.now;
  const runId = makeRunId(now());
  const store = new RunStore(input.dataDir);
  const createdAt = new Date(now()).toISOString();

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
    const totals = emptyTotals();
    tallyOutcome(totals, 'ENGINE_ERROR');
    const summary: TestAllSummary = {
      runId,
      baseUrl: '',
      durationMs: 0,
      mutations: false,
      totals,
      failures: [],
      inconclusive: [],
      skipped: [
        {
          outcome: 'ENGINE_ERROR',
          reason,
          count: 1,
          examples: [{ method: '', path: '', actualStatus: null, explanation: err instanceof Error ? err.message : String(err), detailsUri: detailsUri(runId, 't_setup') }],
          validationErrors: [],
        },
      ],
      truncated: false,
      droppedFailureGroups: 0,
      warnings: [],
      detailsUri: `apitest://runs/${runId}`,
    };
    return { summary, runId };
  }

  const mutations = input.mutations ?? ctx.settings.mutations ?? false;
  const gate: RiskGate = {
    allowMutating: mutations,
    allowSideEffecting: mutations && ctx.settings.allowSideEffecting === true,
    allowDestructive: mutations && ctx.settings.allowSideEffecting === true,
    skipDeprecated: true,
  };

  const filters: PlanFilters = {
    ...(input.include ? { include: input.include } : {}),
    ...(input.exclude ? { exclude: input.exclude } : {}),
    ...(input.methods ? { methods: input.methods } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
    // Producers (collections/creates) before consumers so the ValuePool is
    // populated before {id}-style parameters need it.
    order: 'producers-first',
  };
  const plan = buildPlan(ctx.registry, filters);

  // Expand into work items: the happy path per endpoint, plus (when enabled) one
  // per documented-error negative case (#7).
  const work: Array<{ endpoint: (typeof plan)[number]; negativeCase?: NegativeCase }> = [];
  for (const endpoint of plan) {
    work.push({ endpoint });
    if (input.negativeTests) {
      for (const negativeCase of buildNegativeCases(endpoint)) work.push({ endpoint, negativeCase });
    }
  }

  let currentLimit =
    input.maxParallelRequests ?? ctx.settings.maxParallelRequests ?? DEFAULT_CONCURRENCY;
  const onRateLimit = (): void => {
    currentLimit = Math.max(1, Math.floor(currentLimit / 2));
  };

  const started = now();
  const results = await runPool<TestRecord>(
    work.length,
    (i) =>
      executeOne({
        ctx,
        endpoint: work[i]!.endpoint,
        runId,
        index: i + 1,
        gate,
        onRateLimit,
        ...(work[i]!.negativeCase ? { negativeCase: work[i]!.negativeCase } : {}),
        ...(input.authProfile ? { authProfile: input.authProfile } : {}),
        ...(input.dryRun ? { dryRun: input.dryRun } : {}),
        ...(input.httpFetchImpl ? { httpFetchImpl: input.httpFetchImpl } : {}),
        ...(input.sleep ? { sleep: input.sleep } : {}),
      }),
    { getLimit: () => currentLimit, ...(input.signal ? { signal: input.signal } : {}) },
  );

  const records: TestRecord[] = results.map((r, i) =>
    r ?? cancelledRecord(work[i]!.endpoint.method, work[i]!.endpoint.path, runId, i + 1),
  );

  const totals = emptyTotals();
  for (const r of records) tallyOutcome(totals, r.outcome);

  const run: RunRecord = {
    runId,
    createdAt,
    baseUrl: ctx.baseUrl,
    ...(ctx.openApiUrl ? { openApiUrl: ctx.openApiUrl } : {}),
    mutations,
    durationMs: now() - started,
    totals,
    warnings: ctx.warnings,
    tests: records,
  };
  store.saveRun(run);

  const maxFailures = input.maxFailuresReturned ?? DEFAULT_MAX_FAILURES;
  const failures = collapse(
    records.filter((r) => r.outcome === 'FAIL' || r.outcome === 'ENGINE_ERROR'),
    runId,
    maxFailures,
  );
  const inconclusive = collapse(records.filter((r) => r.outcome === 'INCONCLUSIVE'), runId);
  const skipped = collapse(records.filter((r) => r.outcome === 'SKIPPED'), runId);

  const summary: TestAllSummary = {
    runId,
    baseUrl: ctx.baseUrl,
    ...(ctx.openApiUrl ? { openApiUrl: ctx.openApiUrl } : {}),
    durationMs: run.durationMs,
    mutations,
    totals,
    failures: failures.groups,
    inconclusive: inconclusive.groups,
    skipped: skipped.groups,
    truncated: failures.dropped > 0,
    droppedFailureGroups: failures.dropped,
    warnings: ctx.warnings,
    detailsUri: `apitest://runs/${runId}`,
  };
  return { summary, runId };
}
