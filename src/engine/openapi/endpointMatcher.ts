/**
 * Endpoint matcher (build-prompt §19).
 *
 * Resolves a (method, path) request against the registry in a fixed order:
 *   1. exact;
 *   2. template-normalized ({id} ~ {userId} ~ :id ~ a concrete value);
 *   3. prefix-insensitive (one path has extra leading segments, e.g. /api);
 *   4. case-insensitive;
 *   5. edit-distance (<= 2).
 *
 * The first tier that produces matches wins. A single match resolves; multiple
 * equally-plausible matches are returned as candidates — the engine never guesses.
 */
import type { Endpoint, HttpMethod } from '../types/endpoint.js';
import type { EndpointRegistry } from './endpointRegistry.js';

export interface MatchResult {
  match?: Endpoint;
  candidates: Endpoint[];
  tier?: 'exact' | 'template' | 'prefix' | 'case-insensitive' | 'edit-distance';
}

function normalizePath(p: string): string {
  let s = p.split('?')[0]!.split('#')[0]!.trim();
  if (!s.startsWith('/')) s = '/' + s;
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function segs(p: string): string[] {
  return normalizePath(p).split('/').filter((x) => x.length > 0);
}

function isParamSeg(seg: string): boolean {
  return /^\{.+\}$/.test(seg) || /^:.+/.test(seg);
}

/** A segment matches if literally equal or either side is a path parameter. */
function segMatch(a: string, b: string): boolean {
  return a === b || isParamSeg(a) || isParamSeg(b);
}

function templateMatch(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((s, i) => segMatch(s, b[i]!));
}

/**
 * Suffix match: the shorter path aligns with the trailing segments of the longer
 * (the difference is a leading prefix, e.g. `/api`). To avoid a lone parameter
 * swallowing an unrelated literal, the deepest overlapping segment must be a
 * literal-literal or param-param match — never literal-vs-param.
 */
function suffixMatch(a: string[], b: string[]): boolean {
  const n = Math.min(a.length, b.length);
  if (n === 0 || a.length === b.length) return false;
  const at = a.slice(a.length - n);
  const bt = b.slice(b.length - n);
  if (!at.every((s, i) => segMatch(s, bt[i]!))) return false;
  const lastA = at[n - 1]!;
  const lastB = bt[n - 1]!;
  return lastA === lastB || (isParamSeg(lastA) && isParamSeg(lastB));
}

function templateKey(p: string): string {
  return (
    '/' +
    segs(p)
      .map((s) => (isParamSeg(s) ? '{}' : s))
      .join('/')
  );
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[n]!;
}

function decide(
  hits: Endpoint[],
  tier: NonNullable<MatchResult['tier']>,
): MatchResult | undefined {
  if (hits.length === 0) return undefined;
  if (hits.length === 1) return { match: hits[0]!, candidates: hits, tier };
  return { candidates: hits, tier };
}

export function matchEndpoint(
  registry: EndpointRegistry,
  method: HttpMethod,
  path: string,
): MatchResult {
  const eps = registry.list().filter((e) => e.method === method);
  const target = normalizePath(path);
  const tSegs = segs(target);
  const tKey = templateKey(target);

  const tiers: Array<[NonNullable<MatchResult['tier']>, (e: Endpoint) => boolean]> = [
    ['exact', (e) => normalizePath(e.path) === target],
    ['template', (e) => templateMatch(segs(e.path), tSegs)],
    ['prefix', (e) => suffixMatch(segs(e.path), tSegs)],
    ['case-insensitive', (e) => templateKey(e.path).toLowerCase() === tKey.toLowerCase()],
    ['edit-distance', (e) => levenshtein(templateKey(e.path), tKey) <= 2],
  ];

  for (const [tier, pred] of tiers) {
    const result = decide(eps.filter(pred), tier);
    if (result) return result;
  }
  return { candidates: [] };
}
