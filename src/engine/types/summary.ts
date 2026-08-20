/**
 * Compact test_all summary (build-prompt §40, §42).
 *
 * Identical results collapse into a single group with a count and a few
 * examples, so "12 endpoints x 401" is one line, not twelve.
 */
import type { Outcome, Reason, ValidationErrorDetail } from './result.js';
import type { RunTotals } from './run.js';

export interface ResultExample {
  method: string;
  path: string;
  actualStatus: number | null;
  explanation: string | null;
  detailsUri: string;
}

export interface CollapsedGroup {
  outcome: Outcome;
  reason: Reason | null;
  count: number;
  examples: ResultExample[];
  validationErrors: ValidationErrorDetail[];
}

export interface TestAllSummary {
  runId: string;
  baseUrl: string;
  openApiUrl?: string;
  durationMs: number;
  mutations: boolean;
  totals: RunTotals;
  failures: CollapsedGroup[];
  inconclusive: CollapsedGroup[];
  skipped: CollapsedGroup[];
  /** True if some failure groups were dropped to respect maxFailuresReturned. */
  truncated: boolean;
  droppedFailureGroups: number;
  warnings: string[];
  detailsUri: string;
  /** Compensating-DELETE summary when teardown ran (§#11). */
  teardown?: { attempted: number; deleted: number; failed: number };
}
