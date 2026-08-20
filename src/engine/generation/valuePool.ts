/**
 * ValuePool (build-prompt §35/§36 — the V2 ValuePoolSource + harvesting seam).
 *
 * Harvests real identifier values from responses so that later requests can fill
 * path/query parameters the generator otherwise cannot (free-form `{id}`/`{key}`
 * strings that would become NO_TEST_DATA). Producers (GET collections, creates)
 * put ids into the pool; consumers pull them via the ParamResolver chain.
 *
 * Keys are normalized (lowercased, alphanumerics only). When harvesting a bare
 * `id` from a resource, we also store it under resource-scoped keys (e.g. an `id`
 * from `/users` is also stored as `userid`), so a `{userId}` parameter resolves.
 */

const MAX_DEPTH = 5;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isParamSegment(seg: string): boolean {
  return /^\{.+\}$/.test(seg) || /^:.+/.test(seg);
}

/** The last static (non-parameter) path segment — the "resource". */
export function resourceSegment(path: string): string {
  const statics = path
    .split('/')
    .filter((s) => s.length > 0 && !isParamSegment(s));
  return statics.length ? statics[statics.length - 1]! : '';
}

function singular(word: string): string {
  if (/ies$/i.test(word)) return word.slice(0, -3) + 'y';
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
}

function isScalarId(value: unknown): value is string | number {
  return (
    (typeof value === 'string' && value.length > 0) ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

export class ValuePool {
  private readonly store = new Map<string, unknown[]>();

  /** Store a value under a (normalized) key; keeps insertion order, dedups. */
  put(key: string, value: unknown): void {
    if (value === undefined || value === null) return;
    const k = normalizeKey(key);
    if (!k) return;
    const arr = this.store.get(k) ?? [];
    if (!arr.some((v) => v === value)) {
      arr.push(value);
      this.store.set(k, arr);
    }
  }

  /** Most-recently harvested value for a key, or undefined. */
  get(key: string): unknown {
    const arr = this.store.get(normalizeKey(key));
    return arr && arr.length ? arr[arr.length - 1] : undefined;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Number of distinct keys held (for tests/observability). */
  size(): number {
    return this.store.size;
  }

  /** Harvest id-like scalar fields from a response body of the given endpoint. */
  harvest(body: unknown, path: string): void {
    const resource = resourceSegment(path);
    this.walk(body, resource, 0);
  }

  private walk(node: unknown, resource: string, depth: number): void {
    if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) this.walk(item, resource, depth + 1);
      return;
    }
    for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
      if (isScalarId(value)) {
        // Harvest every scalar field by its exact name (so `key`/`slug`/`code`
        // params resolve too). Lookup is by exact param name, so this is precise.
        this.put(name, value);
        // A bare `id` is also stored under resource-scoped keys so a `{userId}`
        // parameter resolves from a `/users` collection's `id` field.
        if (name.toLowerCase() === 'id' && resource) {
          this.put(`${resource}id`, value);
          this.put(`${singular(resource)}id`, value);
        }
      } else if (value && typeof value === 'object') {
        this.walk(value, resource, depth + 1);
      }
    }
  }
}
