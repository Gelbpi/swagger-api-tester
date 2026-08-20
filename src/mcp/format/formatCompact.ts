/**
 * Compact text formatting for the MCP tools (build-prompt §40, §42).
 *
 * Aggressively small: no OpenAPI document, no full success bodies, deduped and
 * collapsed failures, bounded examples. The text is what Claude reads; the
 * structured content mirrors it for programmatic use.
 */
import type { CompactTestResult, Outcome } from '../../engine/types/result.js';
import type { CollapsedGroup, TestAllSummary } from '../../engine/types/summary.js';

const ICON: Record<Outcome, string> = {
  PASS: '✅',
  FAIL: '❌',
  INCONCLUSIVE: '◐',
  SKIPPED: '⚠',
  ENGINE_ERROR: '⛔',
};

export function formatEndpointResult(r: CompactTestResult): string {
  const lines: string[] = [];
  lines.push(`${ICON[r.outcome]} ${r.method} ${r.path} — ${r.outcome}`);
  if (r.reason) lines.push(`reason: ${r.reason}`);
  if (r.expectedStatus !== null || r.actualStatus !== null) {
    lines.push(`expected ${r.expectedStatus ?? '?'}, got ${r.actualStatus ?? '—'}`);
  }
  if (r.explanation) lines.push(r.explanation);
  for (const e of r.validationErrors.slice(0, 5)) lines.push(`  ${e.message}`);
  if (r.validationErrors.length > 5) lines.push(`  (+${r.validationErrors.length - 5} more)`);
  if (r.bodyExcerpt) lines.push(`body: ${r.bodyExcerpt.slice(0, 300)}`);
  if (r.durationMs !== null) lines.push(`${r.durationMs}ms`);
  lines.push(`details: ${r.detailsUri}`);
  return lines.join('\n');
}

function formatGroup(g: CollapsedGroup): string {
  const first = g.examples[0];
  const head = first ? `${ICON[g.outcome]} ${first.method} ${first.path}` : `${ICON[g.outcome]} (group)`;
  const parts = [head];
  if (first?.actualStatus !== null && first?.actualStatus !== undefined) {
    parts.push(`  status ${first.actualStatus}${g.reason ? ` — ${g.reason}` : ''}`);
  } else if (g.reason) {
    parts.push(`  ${g.reason}`);
  }
  if (first?.explanation) parts.push(`  ${first.explanation}`);
  for (const e of g.validationErrors.slice(0, 3)) parts.push(`    ${e.message}`);
  if (g.count > 1) parts.push(`  (x${g.count} similar)`);
  return parts.join('\n');
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatRunSummary(s: TestAllSummary): string {
  const lines: string[] = [];
  lines.push('API TEST SUMMARY');
  lines.push('');
  lines.push(`Target:   ${s.baseUrl}`);
  if (s.openApiUrl) lines.push(`OpenAPI:  ${s.openApiUrl}`);
  lines.push(`Run:      ${s.runId}`);
  lines.push(`Duration: ${seconds(s.durationMs)}`);
  lines.push(`Mutations: ${s.mutations ? 'on' : 'off'}`);
  lines.push('');
  lines.push(`Total ${s.totals.total}`);
  lines.push(`Passed ${s.totals.passed}`);
  lines.push(`Failed ${s.totals.failed}`);
  lines.push(`Inconclusive ${s.totals.inconclusive}`);
  lines.push(`Skipped ${s.totals.skipped}`);
  if (s.totals.engineError > 0) lines.push(`Engine errors ${s.totals.engineError}`);

  if (s.failures.length) {
    lines.push('');
    lines.push('FAILED');
    for (const g of s.failures) lines.push('', formatGroup(g));
    if (s.truncated) lines.push('', `(+${s.droppedFailureGroups} more failure group(s) — see ${s.detailsUri})`);
  }
  if (s.inconclusive.length) {
    lines.push('');
    lines.push('INCONCLUSIVE');
    for (const g of s.inconclusive) lines.push('', formatGroup(g));
  }
  if (s.skipped.length) {
    lines.push('');
    lines.push('SKIPPED');
    for (const g of s.skipped) lines.push('', formatGroup(g));
  }
  if (s.teardown) {
    lines.push('');
    lines.push(`Teardown: deleted ${s.teardown.deleted}/${s.teardown.attempted} created resource(s)` + (s.teardown.failed ? `, ${s.teardown.failed} failed` : ''));
  }
  if (s.warnings.length) {
    lines.push('');
    lines.push('Notes:');
    for (const w of s.warnings.slice(0, 5)) lines.push(`  - ${w}`);
  }
  lines.push('');
  lines.push(`details: ${s.detailsUri}`);
  return lines.join('\n');
}
