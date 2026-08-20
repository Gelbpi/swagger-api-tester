import { describe, expect, it } from 'vitest';
import { runPool } from '../../src/engine/execution/testRunner.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('runPool (build-prompt §34)', () => {
  it('respects the concurrency limit and returns ordered results', async () => {
    let active = 0;
    let maxActive = 0;
    const results = await runPool(
      10,
      async (i) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await delay(5);
        active--;
        return i;
      },
      { getLimit: () => 3 },
    );
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('continues past a worker that throws (fallback undefined)', async () => {
    const results = await runPool(
      4,
      async (i) => {
        if (i === 2) throw new Error('boom');
        return i;
      },
      { getLimit: () => 2 },
    );
    expect(results[2]).toBeUndefined();
    expect(results.filter((x) => x !== undefined)).toEqual([0, 1, 3]);
  });

  it('a limit of 1 forces sequential execution', async () => {
    let active = 0;
    let maxActive = 0;
    await runPool(
      5,
      async (i) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await delay(2);
        active--;
        return i;
      },
      { getLimit: () => 1 },
    );
    expect(maxActive).toBe(1);
  });

  it('an already-aborted signal launches nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    let ran = 0;
    const results = await runPool(
      5,
      async (i) => {
        ran++;
        return i;
      },
      { getLimit: () => 3, signal: controller.signal },
    );
    expect(ran).toBe(0);
    expect(results).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
