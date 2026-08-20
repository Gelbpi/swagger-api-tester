/**
 * Ajv-backed schema validation (build-prompt §21, §32).
 *
 * OpenAPI schemas are normalized to JSON Schema 2020-12 (SchemaNormalizer) before
 * compilation. Compiled validators are cached by a caller-provided key
 * (operationId + status + content-type) so they are built once (§32).
 */
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { normalizeSchema } from '../openapi/schemaNormalizer.js';
import type { ValidationErrorDetail } from '../types/result.js';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrorDetail[];
}

function mapErrors(errors: ValidateFunction['errors']): ValidationErrorDetail[] {
  if (!errors) return [];
  const seen = new Set<string>();
  const out: ValidationErrorDetail[] = [];
  for (const e of errors) {
    const path = e.instancePath || '/';
    const message = `${path}: ${e.message ?? 'invalid'}`;
    if (seen.has(message)) continue; // dedupe (§40)
    seen.add(message);
    out.push({ path, message });
  }
  return out;
}

export class SchemaValidator {
  private readonly ajv: Ajv2020;
  private readonly cache = new Map<string, ValidateFunction>();

  constructor() {
    this.ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
    addFormats(this.ajv);
  }

  /** Compile a normalized validator for an OpenAPI schema, cached by key. */
  compile(openApiSchema: unknown, cacheKey?: string): ValidateFunction {
    if (cacheKey) {
      const hit = this.cache.get(cacheKey);
      if (hit) return hit;
    }
    const fn = this.ajv.compile(normalizeSchema(openApiSchema));
    if (cacheKey) this.cache.set(cacheKey, fn);
    return fn;
  }

  validate(openApiSchema: unknown, data: unknown, cacheKey?: string): ValidationResult {
    const fn = this.compile(openApiSchema, cacheKey);
    const valid = fn(data) as boolean;
    return { valid, errors: valid ? [] : mapErrors(fn.errors) };
  }
}
