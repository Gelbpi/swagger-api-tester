/**
 * Persisted run/test records (build-prompt §38, §41).
 *
 * These are the DETAILED, fully sanitized records behind the MCP resources.
 * They must never contain secrets and never embed the OpenAPI document.
 */
import type { Outcome, Reason, ValidationErrorDetail } from './result.js';
import type { RiskClass } from '../execution/riskClassifier.js';

export interface SanitizedRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  query: Array<[string, string]>;
  contentType?: string;
  body?: unknown;
}

export interface SanitizedResponse {
  status: number;
  headers: Record<string, string>;
  contentType?: string;
  bodyExcerpt?: string;
}

export interface TestRecord {
  testId: string;
  runId: string;
  outcome: Outcome;
  reason: Reason | null;
  explanation: string | null;
  method: string;
  path: string;
  operationId?: string;
  risk: RiskClass;
  expectedStatus: number | null;
  actualStatus: number | null;
  expectationLogic: string;
  durationMs: number | null;
  validationErrors: ValidationErrorDetail[];
  authProfile?: string;
  dryRun: boolean;
  request?: SanitizedRequest;
  response?: SanitizedResponse;
}

/** A resource the tester created via a POST, tracked for teardown (§#11). */
export interface CreatedResource {
  /** The collection path the POST targeted, e.g. /users. */
  collectionPath: string;
  id: unknown;
}

/** Outcome of one compensating DELETE during teardown. */
export interface TeardownResult {
  method: string;
  path: string;
  status: number | null;
  ok: boolean;
  note?: string;
}

export interface RunTotals {
  total: number;
  passed: number;
  failed: number;
  inconclusive: number;
  skipped: number;
  engineError: number;
}

export interface RunRecord {
  runId: string;
  createdAt: string;
  baseUrl: string;
  openApiUrl?: string;
  mutations: boolean;
  durationMs: number;
  totals: RunTotals;
  warnings: string[];
  tests: TestRecord[];
  /** Compensating DELETEs performed after a mutation run (§#11 teardown). */
  teardown?: TeardownResult[];
}

export function emptyTotals(): RunTotals {
  return { total: 0, passed: 0, failed: 0, inconclusive: 0, skipped: 0, engineError: 0 };
}

export function tallyOutcome(totals: RunTotals, outcome: Outcome): void {
  totals.total += 1;
  if (outcome === 'PASS') totals.passed += 1;
  else if (outcome === 'FAIL') totals.failed += 1;
  else if (outcome === 'INCONCLUSIVE') totals.inconclusive += 1;
  else if (outcome === 'SKIPPED') totals.skipped += 1;
  else totals.engineError += 1;
}
