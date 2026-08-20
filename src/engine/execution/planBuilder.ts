/**
 * PlanBuilder (build-prompt §34).
 *
 * Produces a deterministic TestPlan (endpoint list) from the registry, applying
 * include/exclude/method/tag filters. V1 ordering is path-then-method. The
 * TestRunner does not know WHY the plan is ordered — this keeps the door open
 * for V2 dependency-aware ordering without touching the runner.
 */
import type { Endpoint, HttpMethod } from '../types/endpoint.js';
import type { EndpointRegistry } from '../openapi/endpointRegistry.js';

export interface PlanFilters {
  include?: string[];
  exclude?: string[];
  methods?: string[];
  tags?: string[];
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesAny(patterns: string[], method: string, path: string): boolean {
  const key = `${method} ${path}`;
  return patterns.some((p) => {
    const re = globToRegExp(p.trim());
    return re.test(key) || re.test(path);
  });
}

export function buildPlan(registry: EndpointRegistry, filters: PlanFilters = {}): Endpoint[] {
  const methods = filters.methods?.map((m) => m.toUpperCase() as HttpMethod);
  const tags = filters.tags?.map((t) => t.toLowerCase());

  const filtered = registry.list().filter((ep) => {
    if (methods && !methods.includes(ep.method)) return false;
    if (tags && !ep.tags.some((t) => tags.includes(t.toLowerCase()))) return false;
    if (filters.include && !matchesAny(filters.include, ep.method, ep.path)) return false;
    if (filters.exclude && matchesAny(filters.exclude, ep.method, ep.path)) return false;
    return true;
  });

  // Deterministic: path, then method.
  return [...filtered].sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
  );
}
