/**
 * Deterministic merge of grouped springdoc API documents (build-prompt §16).
 *
 * Callers pass the group documents in a deterministic order (sorted by group
 * name). Paths and component maps are combined; on key conflict the earlier
 * document wins (first-writer), so the result is stable regardless of network
 * timing. Path items sharing a path have their HTTP methods merged.
 */
import type { OpenApiDocument } from '../types/openapi.js';

type Dict = Record<string, unknown>;

function asDict(v: unknown): Dict | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : undefined;
}

const COMPONENT_MAPS = [
  'schemas',
  'responses',
  'parameters',
  'examples',
  'requestBodies',
  'headers',
  'securitySchemes',
  'links',
  'callbacks',
] as const;

/** Merge `src` into `dst` without overriding existing keys. */
function mergeMissing(dst: Dict, src: Dict): void {
  for (const key of Object.keys(src).sort()) {
    if (!(key in dst)) dst[key] = src[key];
  }
}

export function mergeDocuments(docs: OpenApiDocument[]): OpenApiDocument {
  if (docs.length === 0) throw new Error('mergeDocuments requires at least one document');
  if (docs.length === 1) return docs[0]!;

  const base = structuredClone(docs[0]!) as Dict;
  const paths = (asDict(base.paths) ?? {}) as Dict;
  base.paths = paths;
  const components = (asDict(base.components) ?? {}) as Dict;
  base.components = components;

  for (let i = 1; i < docs.length; i++) {
    const doc = docs[i]! as Dict;

    const docPaths = asDict(doc.paths);
    if (docPaths) {
      for (const path of Object.keys(docPaths).sort()) {
        const existing = asDict(paths[path]);
        const incoming = asDict(docPaths[path]);
        if (existing && incoming) mergeMissing(existing, incoming);
        else if (!(path in paths)) paths[path] = docPaths[path];
      }
    }

    const docComponents = asDict(doc.components);
    if (docComponents) {
      for (const mapName of COMPONENT_MAPS) {
        const incoming = asDict(docComponents[mapName]);
        if (!incoming) continue;
        const target = (asDict(components[mapName]) ?? {}) as Dict;
        components[mapName] = target;
        mergeMissing(target, incoming);
      }
    }

    if (Array.isArray(doc.tags)) {
      if (!Array.isArray(base.tags)) base.tags = [];
      const tags = base.tags as Dict[];
      const seen = new Set(tags.map((t) => t.name));
      for (const tag of doc.tags as Dict[]) {
        if (!seen.has(tag.name)) {
          tags.push(tag);
          seen.add(tag.name);
        }
      }
    }
  }

  return base as unknown as OpenApiDocument;
}
