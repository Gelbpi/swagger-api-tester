/**
 * Endpoint model produced from a loaded spec (build-prompt §3/§19).
 */
import type { OpenAPIV3 } from 'openapi-types';

export const HTTP_METHODS = [
  'GET',
  'PUT',
  'POST',
  'DELETE',
  'OPTIONS',
  'HEAD',
  'PATCH',
  'TRACE',
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface Endpoint {
  method: HttpMethod;
  /** Templated path exactly as it appears in the spec, e.g. /users/{id}. */
  path: string;
  operationId?: string;
  summary?: string;
  tags: string[];
  deprecated: boolean;
  /** Path-level + operation-level parameters, merged (operation wins). */
  parameters: OpenAPIV3.ParameterObject[];
  requestBody?: OpenAPIV3.RequestBodyObject;
  responses: OpenAPIV3.ResponsesObject;
  operation: OpenAPIV3.OperationObject;
}
