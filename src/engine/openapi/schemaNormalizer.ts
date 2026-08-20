/**
 * SchemaNormalizer (build-prompt §17).
 *
 * Converts an OpenAPI 3.0 schema object into a JSON Schema 2020-12 schema that
 * Ajv can compile. OpenAPI 3.1 is already 2020-12-compatible and passes through
 * (its keywords are left intact). Handled conversions:
 *   - nullable: true          -> add "null" to type (or anyOf with {type:null})
 *   - exclusiveMinimum (bool) -> numeric exclusiveMinimum (3.0 -> 2020-12)
 *   - exclusiveMaximum (bool) -> numeric exclusiveMaximum
 *   - strip OpenAPI-only keywords (nullable, discriminator, xml, example,
 *     externalDocs, deprecated)
 *
 * Cyclic (self-referential) schemas are broken with a per-path ancestor set and
 * a hard depth limit (build-prompt §20): beyond the limit the node becomes `{}`
 * (accept-anything), yielding a finite schema Ajv can compile.
 */

export type JsonSchema = boolean | Record<string, unknown>;

export interface NormalizeOptions {
  /** Max nesting depth before a subschema is collapsed to `{}`. */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 40;

/** OpenAPI-only keywords that are not valid JSON Schema 2020-12 validation keywords. */
const STRIP_KEYWORDS = ['nullable', 'discriminator', 'xml', 'externalDocs', 'example', 'deprecated'];

const SUBSCHEMA_OBJECT_MAPS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const SUBSCHEMA_ARRAYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
const SUBSCHEMA_SINGLE = ['items', 'not', 'if', 'then', 'else', 'contains', 'propertyNames', 'additionalItems'];

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function normalizeNode(
  schema: unknown,
  depth: number,
  ancestors: Set<object>,
  maxDepth: number,
): JsonSchema {
  if (typeof schema === 'boolean') return schema;
  if (!isObj(schema)) return {};
  if (ancestors.has(schema) || depth > maxDepth) return {}; // break cycles / cap depth

  ancestors.add(schema);
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (STRIP_KEYWORDS.includes(key)) continue;

    if (key === 'additionalProperties' || key === 'unevaluatedProperties') {
      out[key] =
        typeof value === 'boolean' ? value : normalizeNode(value, depth + 1, ancestors, maxDepth);
    } else if (SUBSCHEMA_SINGLE.includes(key)) {
      out[key] = normalizeNode(value, depth + 1, ancestors, maxDepth);
    } else if (SUBSCHEMA_ARRAYS.includes(key) && Array.isArray(value)) {
      out[key] = value.map((v) => normalizeNode(v, depth + 1, ancestors, maxDepth));
    } else if (SUBSCHEMA_OBJECT_MAPS.includes(key) && isObj(value)) {
      const mapped: Record<string, JsonSchema> = {};
      for (const [k, v] of Object.entries(value)) {
        mapped[k] = normalizeNode(v, depth + 1, ancestors, maxDepth);
      }
      out[key] = mapped;
    } else if (key === 'examples' && !Array.isArray(value)) {
      // 3.0 non-array "examples" is not a valid 2020-12 annotation; drop it.
      continue;
    } else {
      out[key] = value;
    }
  }

  // exclusiveMinimum / exclusiveMaximum: 3.0 boolean form -> 2020-12 numeric.
  for (const [ex, base] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    if (typeof out[ex] === 'boolean') {
      if (out[ex] === true && typeof out[base] === 'number') {
        out[ex] = out[base];
        delete out[base];
      } else {
        delete out[ex];
      }
    }
  }

  ancestors.delete(schema);
  return applyNullable(out, Boolean((schema as { nullable?: unknown }).nullable));
}

/** Apply OpenAPI 3.0 `nullable` semantics to a normalized node. */
function applyNullable(node: Record<string, unknown>, nullable: boolean): JsonSchema {
  if (!nullable) return node;
  const type = node.type;
  if (typeof type === 'string') {
    node.type = [type, 'null'];
  } else if (Array.isArray(type)) {
    if (!type.includes('null')) node.type = [...type, 'null'];
  } else {
    return { anyOf: [node, { type: 'null' }] };
  }
  return node;
}

/** Normalize an OpenAPI schema into a compilable JSON Schema 2020-12 schema. */
export function normalizeSchema(schema: unknown, opts: NormalizeOptions = {}): JsonSchema {
  return normalizeNode(schema, 0, new Set<object>(), opts.maxDepth ?? DEFAULT_MAX_DEPTH);
}
