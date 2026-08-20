/**
 * Single-test executor (build-prompt §9, §26–§33).
 *
 * Runs one endpoint end to end and returns a fully sanitized TestRecord:
 * gate by risk/config -> resolve auth -> build request (self-validated) ->
 * apply auth -> target guard -> (dryRun stops here) -> execute with
 * timeout/retry + 429/503 policy -> evaluate response -> classify.
 *
 * Shared by test_endpoint and test_all; the risk gate flags differ per tool.
 */
import type { Endpoint } from '../types/endpoint.js';
import type { ExplicitOverrides } from '../types/request.js';
import type { TestRecord, SanitizedRequest, SanitizedResponse } from '../types/run.js';
import type { HttpFetchImpl } from '../types/http.js';
import type { EngineContext } from './context.js';
import { classifyRisk } from './riskClassifier.js';
import { buildRequest } from '../generation/requestBuilder.js';
import { applyAuthMaterial, AuthError } from '../auth/authManager.js';
import { assertTargetAllowed } from '../http/targetGuard.js';
import { resolveExpectedStatus } from '../validation/statusResolver.js';
import { evaluateResponse } from '../validation/responseValidator.js';
import { classifyResponse } from './classifier.js';
import { classifyNegative, type NegativeCase } from './negativeCases.js';
import { sendRequest, HttpClientError } from '../http/httpClient.js';
import { rateLimitPolicy } from '../http/retryPolicy.js';
import { EngineError } from '../types/errors.js';
import { maskString, sanitizeHeaders, sanitizeValue } from '../results/sanitizer.js';

const BODY_EXCERPT_MAX = 800;

/**
 * True if the endpoint declares a non-empty security requirement. Operation-level
 * `security` overrides the document's global `security`; an empty requirement
 * object (`{}`) means "auth optional" and does not count.
 */
function endpointRequiresAuth(ctx: EngineContext, endpoint: Endpoint): boolean {
  const opSecurity = endpoint.operation.security;
  const globalSecurity = (ctx.spec.document as { security?: unknown }).security;
  const effective = opSecurity !== undefined ? opSecurity : globalSecurity;
  return (
    Array.isArray(effective) &&
    effective.some((req) => req && typeof req === 'object' && Object.keys(req).length > 0)
  );
}

/** Which risk classes may actually execute. */
export interface RiskGate {
  allowMutating: boolean;
  allowSideEffecting: boolean;
  allowDestructive: boolean;
  skipDeprecated: boolean;
}

export interface ExecuteOneInput {
  ctx: EngineContext;
  endpoint: Endpoint;
  runId: string;
  index: number;
  gate: RiskGate;
  explicit?: ExplicitOverrides;
  /** When set, run a documented-error negative case instead of the happy path (#7). */
  negativeCase?: NegativeCase;
  authProfile?: string;
  expectStatus?: number;
  dryRun?: boolean;
  includeResponseBody?: boolean;
  httpFetchImpl?: HttpFetchImpl;
  sleep?: (ms: number) => Promise<void>;
  onRateLimit?: () => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function baseRecord(input: ExecuteOneInput, testId: string): TestRecord {
  const { endpoint } = input;
  return {
    testId,
    runId: input.runId,
    outcome: 'ENGINE_ERROR',
    reason: null,
    explanation: null,
    method: endpoint.method,
    path: endpoint.path,
    ...(endpoint.operationId ? { operationId: endpoint.operationId } : {}),
    risk: classifyRisk(endpoint),
    expectedStatus: null,
    actualStatus: null,
    expectationLogic: '',
    durationMs: null,
    validationErrors: [],
    dryRun: input.dryRun === true,
  };
}

function sanitizeRequest(req: {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  query: Array<[string, string]>;
  contentType?: string;
  body?: unknown;
}): SanitizedRequest {
  return {
    method: req.method,
    url: maskString(req.url),
    path: req.path,
    headers: sanitizeHeaders(req.headers),
    query: req.query.map(([k, v]) => [k, maskString(v)] as [string, string]),
    ...(req.contentType ? { contentType: req.contentType } : {}),
    ...(req.body !== undefined ? { body: sanitizeValue(req.body) } : {}),
  };
}

function makeTestId(input: ExecuteOneInput): string {
  const slug = `${input.endpoint.method}_${input.endpoint.path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `t_${String(input.index).padStart(3, '0')}_${slug}`;
}

export async function executeOne(input: ExecuteOneInput): Promise<TestRecord> {
  const { ctx, endpoint, gate } = input;
  const testId = makeTestId(input);
  const record = baseRecord(input, testId);

  const skip = (reason: TestRecord['reason'], explanation: string): TestRecord => ({
    ...record,
    outcome: 'SKIPPED',
    reason,
    explanation,
  });
  const engineError = (reason: TestRecord['reason'], explanation: string): TestRecord => ({
    ...record,
    outcome: 'ENGINE_ERROR',
    reason,
    explanation,
  });

  // config.skip
  const key = `${endpoint.method} ${endpoint.path}`;
  if (ctx.settings.skip?.some((s) => s === key || s === endpoint.path)) {
    return skip('EXCLUDED_BY_CONFIG', 'excluded by config.skip');
  }

  // deprecation (bulk runs only)
  if (endpoint.deprecated && gate.skipDeprecated) {
    return skip('DEPRECATED_OPERATION', 'operation is deprecated');
  }

  // risk gate
  switch (record.risk) {
    case 'MUTATING':
      if (!gate.allowMutating) return skip('MUTATIONS_DISABLED', 'mutations are disabled; set mutations to enable');
      break;
    case 'SIDE_EFFECTING':
      if (!gate.allowSideEffecting) return skip('SIDE_EFFECT_RISK', 'side-effecting operation; requires explicit permission');
      break;
    case 'DESTRUCTIVE':
      if (!gate.allowDestructive) return skip('DESTRUCTIVE_OPERATION', 'destructive operation; set mutations/confirmation to enable');
      break;
    default:
      break;
  }

  // auth
  const profileName = input.authProfile ?? ctx.settings.defaultAuthProfile;
  let hasCredentials = false;
  let material = null;
  try {
    material = await ctx.authManager.resolve(profileName);
    hasCredentials = material !== null;
  } catch (err) {
    if (err instanceof AuthError) return skip(err.reason, err.message);
    throw err;
  }
  if (profileName) record.authProfile = profileName;

  const neg = input.negativeCase;

  // expected status (a negative case expects its documented error code)
  const expected = neg
    ? { status: neg.targetStatus, logic: `negative test (${neg.strategy}): ${neg.description}`, onlyDefault: false }
    : resolveExpectedStatus(endpoint, {
        ...(input.expectStatus !== undefined ? { expectStatus: input.expectStatus } : {}),
        ...(ctx.settings.expectations ? { expectations: ctx.settings.expectations } : {}),
      });
  record.expectedStatus = expected.status;
  record.expectationLogic = expected.logic;

  // For a negative case, merge its bad inputs as explicit overrides (explicit
  // body bypasses self-validation, which is what we want here).
  const effectiveExplicit: ExplicitOverrides | undefined = neg
    ? {
        ...input.explicit,
        ...(neg.pathParams ? { pathParams: { ...input.explicit?.pathParams, ...neg.pathParams } } : {}),
        ...(neg.body !== undefined ? { body: neg.body } : {}),
      }
    : input.explicit;

  // build request (+ self-validation §21)
  const build = buildRequest({
    endpoint,
    baseUrl: ctx.baseUrl,
    ...(ctx.settings.testValues ? { testValues: ctx.settings.testValues } : {}),
    ...(ctx.settings.requestOverrides?.[key] ? { requestOverride: ctx.settings.requestOverrides[key] } : {}),
    ...(effectiveExplicit ? { explicit: effectiveExplicit } : {}),
    validator: ctx.validator,
    pool: ctx.valuePool,
    ...(ctx.settings.seed !== undefined ? { seed: ctx.settings.seed } : {}),
  });
  if (!build.ok) return skip(build.reason, build.explanation);
  const request = build.request;

  // apply auth then rebuild URL/query
  applyAuthMaterial(material, request.headers, request.query);
  const qs = new URLSearchParams(request.query).toString();
  request.url = `${ctx.baseUrl.replace(/\/$/, '')}${request.path}${qs ? `?${qs}` : ''}`;

  const sanitizedRequest = sanitizeRequest(request);
  record.request = sanitizedRequest;

  // target guard on the final URL (§27)
  try {
    assertTargetAllowed(request.url, {
      ...(ctx.settings.allowRemoteTargets !== undefined ? { allowRemoteTargets: ctx.settings.allowRemoteTargets } : {}),
      env: ctx.env,
    });
  } catch (err) {
    if (err instanceof EngineError) return engineError(err.reason, err.message);
    throw err;
  }

  // dryRun: never send (§28)
  if (input.dryRun) {
    return { ...record, outcome: 'SKIPPED', reason: null, explanation: 'dry run — request not sent' };
  }

  // execute with timeout/retry + 429/503 policy
  const httpReq = {
    method: endpoint.method,
    url: request.url,
    headers: request.headers,
    ...(request.bodyString !== undefined ? { body: request.bodyString } : {}),
    timeoutMs: ctx.settings.timeoutMs ?? 10_000,
  };
  const sleep = input.sleep ?? defaultSleep;

  let alreadyRetried = false;
  let authRetried = false;
  for (;;) {
    let res;
    try {
      res = await sendRequest(httpReq, input.httpFetchImpl ? { fetchImpl: input.httpFetchImpl } : {});
    } catch (err) {
      if (err instanceof HttpClientError) {
        if (err.kind === 'timeout') {
          return {
            ...record,
            outcome: 'FAIL',
            reason: 'TIMEOUT_EXCEEDED',
            explanation: `timeout after ${httpReq.timeoutMs}ms`,
          };
        }
        const reason =
          err.kind === 'dns' ? 'DNS_FAILURE' : err.kind === 'tls' ? 'TLS_ERROR' : 'CONNECTION_REFUSED';
        return engineError(reason, err.message);
      }
      throw err;
    }

    // 429 / 503 policy
    const policy = rateLimitPolicy(res.status, res.headers['retry-after'] ?? null, ctx.now(), alreadyRetried);
    if (policy.halveConcurrency) input.onRateLimit?.();
    if (policy.action === 'retry') {
      alreadyRetried = true;
      await sleep(policy.delayMs);
      continue;
    }
    if (policy.action === 'skip_rate_limited') {
      return { ...record, outcome: 'SKIPPED', reason: 'RATE_LIMITED', explanation: 'still rate limited after retry', actualStatus: res.status, durationMs: res.durationMs };
    }
    if (policy.action === 'fail_server') {
      return { ...record, outcome: 'FAIL', reason: 'SERVER_ERROR', explanation: `server returned ${res.status}`, actualStatus: res.status, durationMs: res.durationMs };
    }

    // Refresh-on-401 for dynamic login profiles: the cached token may be stale.
    // Invalidate it, re-authenticate, re-apply the header, and retry once (§25).
    if (
      (res.status === 401 || res.status === 403) &&
      !authRetried &&
      profileName &&
      ctx.authManager.isRefreshable(profileName)
    ) {
      authRetried = true;
      ctx.authManager.invalidate(profileName);
      try {
        const fresh = await ctx.authManager.resolve(profileName);
        Object.assign(httpReq.headers, fresh?.headers ?? {});
      } catch (err) {
        if (err instanceof AuthError) return skip(err.reason, err.message);
        throw err;
      }
      continue;
    }

    // Harvest ids from any successful response so later requests can reuse them
    // for path/query params (§36). Best-effort; ignores non-JSON bodies.
    if (res.status >= 200 && res.status < 300 && res.bodyText) {
      try {
        ctx.valuePool.harvest(JSON.parse(res.bodyText), endpoint.path);
      } catch {
        /* non-JSON body — nothing to harvest */
      }
    }

    // evaluate + classify
    const contentType = res.headers['content-type'] ?? '';
    const evaluation = evaluateResponse(endpoint, res.status, contentType, res.bodyText, {
      validator: ctx.validator,
    });
    const classification = neg
      ? classifyNegative({
          targetStatus: neg.targetStatus,
          actualStatus: res.status,
          ...(evaluation.documentedResponseKey !== undefined ? { documentedResponseKey: evaluation.documentedResponseKey } : {}),
          schemaChecked: evaluation.schemaChecked,
          schemaValid: evaluation.schemaValid,
          validationErrors: evaluation.validationErrors,
        })
      : classifyResponse({
          expectedStatus: expected.status,
          actualStatus: res.status,
          onlyDefault: expected.onlyDefault,
          ...(evaluation.documentedResponseKey !== undefined ? { documentedResponseKey: evaluation.documentedResponseKey } : {}),
          contentDocumented: evaluation.contentDocumented,
          contentTypeOk: evaluation.contentTypeOk,
          schemaChecked: evaluation.schemaChecked,
          schemaValid: evaluation.schemaValid,
          hasCredentials,
          endpointRequiresAuth: endpointRequiresAuth(ctx, endpoint),
          strictStatus: ctx.settings.strictStatus ?? true,
          validationErrors: evaluation.validationErrors,
        });

    const includeBody = classification.outcome !== 'PASS' || input.includeResponseBody === true;
    const response: SanitizedResponse = {
      status: res.status,
      headers: sanitizeHeaders(res.headers),
      ...(evaluation.actualContentType ? { contentType: evaluation.actualContentType } : {}),
      ...(includeBody && res.bodyText
        ? { bodyExcerpt: maskString(res.bodyText).slice(0, BODY_EXCERPT_MAX) }
        : {}),
    };

    return {
      ...record,
      outcome: classification.outcome,
      reason: classification.reason,
      explanation: classification.explanation,
      actualStatus: res.status,
      durationMs: res.durationMs,
      validationErrors: classification.validationErrors,
      response,
    };
  }
}
