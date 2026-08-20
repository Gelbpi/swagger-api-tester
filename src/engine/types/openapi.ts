/**
 * OpenAPI-related shared types (build-prompt §16/§17).
 *
 * We normalize everything to an OpenAPI 3.x document (Swagger 2.0 is converted
 * up-front). Downstream phases consume `LoadedSpec`.
 */
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types';

export type OpenApiDocument = OpenAPIV3.Document | OpenAPIV3_1.Document;

export type SpecVersion = '2.0' | '3.0' | '3.1';

/** A fully loaded, validated, dereferenced spec ready for the engine. */
export interface LoadedSpec {
  document: OpenApiDocument;
  /** The originating spec version (before any conversion). */
  version: SpecVersion;
  /** The URL(s) the spec was assembled from (grouped springdoc APIs -> many). */
  sourceUrls: string[];
  /** SHA-256 of the raw bytes that produced this document (assembled specs: of the join). */
  sha256: string;
}

/** Minimal fetch surface so the engine is testable without real network I/O. */
export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type HttpFetcher = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<FetchResponse>;
