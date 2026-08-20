/**
 * Swagger 2.0 -> OpenAPI 3.0 conversion (build-prompt §16).
 * Uses swagger2openapi with minor-error patching enabled.
 */
import { convertObj } from 'swagger2openapi';
import type { OpenAPIV2, OpenAPIV3 } from 'openapi-types';
import { EngineError } from '../types/errors.js';
import type { RawDoc } from './parse.js';

export async function convertSwagger2(doc: RawDoc): Promise<OpenAPIV3.Document> {
  try {
    const result = await convertObj(doc as unknown as OpenAPIV2.Document, {
      patch: true,
      warnOnly: true,
      anchors: true,
    });
    return result.openapi;
  } catch (err) {
    throw new EngineError(
      'SPEC_INVALID',
      `Failed to convert Swagger 2.0 to OpenAPI 3.0: ${String(err)}`,
    );
  }
}
