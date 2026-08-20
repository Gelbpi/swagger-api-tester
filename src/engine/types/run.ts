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
