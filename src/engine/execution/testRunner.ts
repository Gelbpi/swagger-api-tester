/**
 * TestRunner concurrency pool (build-prompt §34, §9).
 *
 * Runs up to `getLimit()` workers at once, continuing past individual failures
 * (a worker that throws yields a caller-provided fallback via the catch handler).
 * `getLimit()` is read on every scheduling decision so the runner can react to a
 * mid-run concurrency reduction (429 policy, §30). Honors an AbortSignal: once
 * aborted, no new workers are launched and unstarted slots resolve to undefined.
 */
export interface RunPoolOptions {
  getLimit: () => number;
  signal?: AbortSignal;
}

export function runPool<T>(
  count: number,
  worker: (index: number) => Promise<T>,
  opts: RunPoolOptions,
): Promise<Array<T | undefined>> {
  const results: Array<T | undefined> = new Array(count).fill(undefined);
  let next = 0;
  let active = 0;

  return new Promise((resolve) => {
    const schedule = (): void => {
      if (active === 0 && (next >= count || opts.signal?.aborted)) {
        resolve(results);
        return;
      }
      while (!opts.signal?.aborted && active < Math.max(1, getLimitSafe(opts)) && next < count) {
        const index = next++;
        active++;
        Promise.resolve()
          .then(() => worker(index))
          .then((r) => {
            results[index] = r;
          })
          .catch(() => {
            results[index] = undefined;
          })
          .finally(() => {
            active--;
            schedule();
          });
      }
      // If aborted with nothing active, finish.
      if (active === 0) resolve(results);
    };
    schedule();
  });
}

function getLimitSafe(opts: RunPoolOptions): number {
  const n = opts.getLimit();
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}
