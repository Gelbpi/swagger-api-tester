/**
 * EndpointRegistry (build-prompt §3/§19).
 *
 * Flattens a loaded OpenAPI document into a deterministic list of endpoints.
 * Path-level parameters are merged with operation-level parameters (operation
 * wins on the same name+in). Any residual `$ref`s are resolved via RefResolver.
 */
import type { OpenAPIV3 } from 'openapi-types';
import type { Endpoint, HttpMethod } from '../types/endpoint.js';
import { HTTP_METHODS } from '../types/endpoint.js';
import type { OpenApiDocument } from '../types/openapi.js';
import { RefResolver, isRef } from './refResolver.js';

function paramKey(p: OpenAPIV3.ParameterObject): string {
  return `${p.in}:${p.name}`;
}

export class EndpointRegistry {
  private readonly endpoints: Endpoint[];
  private readonly byKey = new Map<string, Endpoint>();

  constructor(private readonly document: OpenApiDocument) {
    const resolver = new RefResolver(document);
    this.endpoints = this.build(resolver);
    for (const ep of this.endpoints) this.byKey.set(`${ep.method} ${ep.path}`, ep);
  }

  private resolveParams(
    raw: unknown,
    resolver: RefResolver,
  ): OpenAPIV3.ParameterObject[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((p) => (isRef(p) ? resolver.deref<OpenAPIV3.ParameterObject>(p) : (p as OpenAPIV3.ParameterObject)));
  }

  private build(resolver: RefResolver): Endpoint[] {
    const doc = this.document as OpenAPIV3.Document;
    const out: Endpoint[] = [];
    const paths = doc.paths ?? {};

    for (const path of Object.keys(paths).sort()) {
      const item = paths[path];
      if (!item) continue;
      const pathItem = (isRef(item) ? resolver.deref<OpenAPIV3.PathItemObject>(item) : item) as OpenAPIV3.PathItemObject;
      const sharedParams = this.resolveParams(pathItem.parameters, resolver);

      for (const method of HTTP_METHODS) {
        const key = method.toLowerCase();
        const op = (pathItem as Record<string, unknown>)[key] as OpenAPIV3.OperationObject | undefined;
        if (!op) continue;

        const opParams = this.resolveParams(op.parameters, resolver);
        const merged = new Map<string, OpenAPIV3.ParameterObject>();
        for (const p of sharedParams) merged.set(paramKey(p), p);
        for (const p of opParams) merged.set(paramKey(p), p);

        const requestBody =
          op.requestBody && isRef(op.requestBody)
            ? resolver.deref<OpenAPIV3.RequestBodyObject>(op.requestBody)
            : (op.requestBody as OpenAPIV3.RequestBodyObject | undefined);

        out.push({
          method: method as HttpMethod,
          path,
          ...(op.operationId ? { operationId: op.operationId } : {}),
          ...(op.summary ? { summary: op.summary } : {}),
          tags: Array.isArray(op.tags) ? op.tags : [],
          deprecated: op.deprecated === true,
          parameters: [...merged.values()],
          ...(requestBody ? { requestBody } : {}),
          responses: op.responses ?? {},
          operation: op,
        });
      }
    }
    return out;
  }

  list(): readonly Endpoint[] {
    return this.endpoints;
  }

  /** Exact (method, path) lookup. */
  get(method: HttpMethod, path: string): Endpoint | undefined {
    return this.byKey.get(`${method} ${path}`);
  }

  /** Distinct templated paths present in the spec. */
  paths(): string[] {
    return [...new Set(this.endpoints.map((e) => e.path))];
  }
}
