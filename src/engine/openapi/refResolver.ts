/**
 * Local JSON-Reference resolution (build-prompt §19/§43).
 *
 * The loaded document is already dereferenced for reading, but $refs can still
 * appear (bundled specs, self-referential component schemas). This resolver
 * follows local `#/...` pointers with cycle detection.
 */
import { EngineError } from '../types/errors.js';

/** Decode a single JSON Pointer token (~1 -> /, ~0 -> ~). */
function decodeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Resolve a local `#/a/b/c` reference against a root document. */
export function resolveRef(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#/') && ref !== '#') {
    throw new EngineError('SPEC_INVALID', `Only local JSON references are supported, got "${ref}".`);
  }
  if (ref === '#') return root;
  const parts = ref.slice(2).split('/').map(decodeToken);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      throw new EngineError('SPEC_INVALID', `Unresolvable reference "${ref}" (at "${part}").`);
    }
  }
  return cur;
}

export function isRef(node: unknown): node is { $ref: string } {
  return (
    !!node &&
    typeof node === 'object' &&
    typeof (node as { $ref?: unknown }).$ref === 'string'
  );
}

export class RefResolver {
  constructor(private readonly root: unknown) {}

  resolve(ref: string): unknown {
    return resolveRef(this.root, ref);
  }

  /**
   * Follow a chain of `$ref`s until a concrete node is reached. Throws on a
   * circular `$ref` chain (a schema that references itself only via $ref).
   */
  deref<T = unknown>(node: unknown): T {
    const seen = new Set<string>();
    let cur = node;
    while (isRef(cur)) {
      const ref = cur.$ref;
      if (seen.has(ref)) {
        throw new EngineError('SPEC_INVALID', `Circular $ref chain at "${ref}".`);
      }
      seen.add(ref);
      cur = this.resolve(ref);
    }
    return cur as T;
  }
}
