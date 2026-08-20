/**
 * OpenAPI discovery (build-prompt §16).
 *
 * If `openApiUrl` is configured it is used directly. Otherwise a fixed ordered
 * list of well-known paths is probed (Springdoc/Swagger defaults). File
 * extensions are NOT trusted — the caller inspects content, not the URL.
 */

/** Ordered probe list — do not reorder without reason (determinism). */
export const PROBE_PATHS: readonly string[] = [
  '/v3/api-docs',
  '/v3/api-docs.yaml',
  '/v3/api-docs/swagger-config',
  '/api-docs',
  '/openapi.json',
  '/openapi.yaml',
  '/openapi',
  '/q/openapi', // Quarkus
  '/q/openapi.yaml',
  '/swagger.json',
  '/swagger.yaml',
  '/v2/api-docs',
  '/swagger-ui/index.html',
  '/swagger-ui.html',
];

/** Resolve a possibly-relative reference against a base URL. */
export function resolveUrl(base: string, ref: string): string {
  try {
    return new URL(ref).toString();
  } catch {
    return new URL(ref, base.endsWith('/') ? base : base + '/').toString();
  }
}

/** The ordered list of candidate spec URLs to try. */
export function candidateSpecUrls(baseUrl: string, openApiUrl?: string): string[] {
  if (openApiUrl) return [resolveUrl(baseUrl, openApiUrl)];
  return PROBE_PATHS.map((p) => resolveUrl(baseUrl, p));
}
