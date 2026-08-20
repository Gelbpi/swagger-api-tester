/**
 * Compact result projection (build-prompt §8, §40).
 *
 * Projects a detailed TestRecord down to the compact shape returned by the MCP
 * tools. Full successful bodies are never included; a bodyExcerpt is attached
 * only for non-PASS results.
 */
import type { CompactTestResult } from '../types/result.js';
import type { TestRecord } from '../types/run.js';

export function detailsUri(runId: string, testId: string): string {
  return `apitest://runs/${runId}/${testId}`;
}

export function toCompactResult(record: TestRecord): CompactTestResult {
  const bodyExcerpt = record.outcome !== 'PASS' ? (record.response?.bodyExcerpt ?? null) : null;
  return {
    testId: record.testId,
    runId: record.runId,
    outcome: record.outcome,
    reason: record.reason,
    explanation: record.explanation,
    method: record.method,
    path: record.path,
    expectedStatus: record.expectedStatus,
    actualStatus: record.actualStatus,
    durationMs: record.durationMs,
    validationErrors: record.validationErrors,
    bodyExcerpt,
    detailsUri: detailsUri(record.runId, record.testId),
  };
}
