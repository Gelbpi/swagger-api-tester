import { describe, expect, it } from 'vitest';
import {
  ENGINE_ERROR_REASONS,
  FAIL_REASONS,
  INCONCLUSIVE_REASONS,
  REASON_CATEGORY,
  SKIPPED_REASONS,
} from '../../src/engine/types/result.js';

describe('reason enums (build-prompt §11)', () => {
  it('no reason appears in two categories', () => {
    const groups = [SKIPPED_REASONS, FAIL_REASONS, INCONCLUSIVE_REASONS, ENGINE_ERROR_REASONS];
    const seen = new Map<string, number>();
    for (const g of groups) for (const r of g) seen.set(r, (seen.get(r) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1);
    expect(dupes).toEqual([]);
  });

  it('REASON_CATEGORY maps every reason to its single bucket', () => {
    for (const r of SKIPPED_REASONS) expect(REASON_CATEGORY[r]).toBe('SKIPPED');
    for (const r of FAIL_REASONS) expect(REASON_CATEGORY[r]).toBe('FAIL');
    for (const r of INCONCLUSIVE_REASONS) expect(REASON_CATEGORY[r]).toBe('INCONCLUSIVE');
    for (const r of ENGINE_ERROR_REASONS) expect(REASON_CATEGORY[r]).toBe('ENGINE_ERROR');
  });
});
