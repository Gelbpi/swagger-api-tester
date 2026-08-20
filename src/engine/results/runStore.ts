/**
 * Run persistence (build-prompt §38).
 *
 * Stores complete, sanitized runs under ${CLAUDE_PLUGIN_DATA}/runs so detailed
 * results remain available through the MCP resources. This is also the substrate
 * for a future runDiff (NOT implemented in V1). Records are sanitized before they
 * ever reach here, but we defensively re-run the sanitizer on write.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataDir } from '../cache/specCache.js';
import { sanitizeValue } from './sanitizer.js';
import type { RunRecord, TestRecord } from '../types/run.js';

export class RunStore {
  private readonly dir: string;

  constructor(dataDir?: string) {
    this.dir = join(resolveDataDir(dataDir), 'runs');
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private path(runId: string): string {
    // runId is engine-generated (r_<timestamp>); guard against traversal anyway.
    const safe = runId.replace(/[^a-zA-Z0-9_-]/g, '');
    return join(this.dir, `${safe}.json`);
  }

  saveRun(run: RunRecord): void {
    this.ensureDir();
    const sanitized = sanitizeValue(run) as RunRecord;
    writeFileSync(this.path(run.runId), JSON.stringify(sanitized, null, 2));
  }

  getRun(runId: string): RunRecord | undefined {
    const p = this.path(runId);
    if (!existsSync(p)) return undefined;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as RunRecord;
    } catch {
      return undefined;
    }
  }

  getTest(runId: string, testId: string): TestRecord | undefined {
    return this.getRun(runId)?.tests.find((t) => t.testId === testId);
  }
}
