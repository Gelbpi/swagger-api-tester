/**
 * Run/test identifier generation (build-prompt §42 example: r_20260819T0912).
 */

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** Format a timestamp as r_YYYYMMDDTHHmmss (UTC). */
export function makeRunId(nowMs: number): string {
  const d = new Date(nowMs);
  const stamp =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `r_${stamp}`;
}

/** Deterministic-ish, human-readable test id from method/path + an index. */
export function makeTestId(method: string, path: string, index: number): string {
  const slug = `${method}_${path}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `t_${pad(index, 3)}_${slug}`;
}
