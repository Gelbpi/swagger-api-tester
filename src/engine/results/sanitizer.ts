/**
 * Secret sanitization (build-prompt §14).
 *
 * Secrets must never appear in logs, MCP results/resources, source control, the
 * API_TESTER.md echo, or error messages. Masking works three ways:
 *   1. exact known-secret literals (registered as they are resolved);
 *   2. sensitive header/field names (value replaced regardless of shape);
 *   3. known secret shapes (JWT, Bearer, sk-*, ghp_*, AKIA*, xox*, ...).
 *
 * The registry is process-global and additive: once a value is known to be a
 * secret it is masked everywhere for the life of the run.
 */

const MASK = '***REDACTED***';

/** Exact secret literals discovered at resolution time. */
const knownSecrets = new Set<string>();

/** Header names whose values are always masked (compared case-insensitively). */
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-amz-security-token',
  'api-key',
  'apikey',
]);

/** Object/field names whose values are always masked. */
const SENSITIVE_FIELD_NAMES = [
  'password',
  'passwd',
  'secret',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apikey',
  'api_key',
  'authorization',
  'clientsecret',
  'client_secret',
  'privatekey',
  'private_key',
  'sessionid',
  'session_id',
];

/** Known secret shapes. Order matters only for readability. */
const SECRET_PATTERNS: RegExp[] = [
  // JSON Web Token: header.payload.signature (base64url segments).
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
  // Bearer <token>
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  // Basic <base64>
  /\bBasic\s+[A-Za-z0-9+/]{8,}=*/gi,
  // OpenAI-style
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  // GitHub personal access tokens
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/g,
  // AWS access key id
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Slack tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
];

/** Register a literal secret so it is masked everywhere it appears. */
export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 4) knownSecrets.add(value);
}

/** For tests: forget all registered literal secrets (patterns are unaffected). */
export function resetRegisteredSecrets(): void {
  knownSecrets.clear();
}

function isSensitiveFieldName(name: string): boolean {
  const norm = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_FIELD_NAMES.some((s) => norm.includes(s.replace(/[^a-z0-9]/g, '')));
}

/** Mask secrets inside a free-form string. */
export function maskString(input: string): string {
  let out = input;
  for (const secret of knownSecrets) {
    if (secret && out.includes(secret)) out = out.split(secret).join(MASK);
  }
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, MASK);
  }
  return out;
}

/** Mask a headers map by name and by value shape. Returns a new object. */
export function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(headers)) {
    if (raw === undefined) continue;
    const value = Array.isArray(raw) ? raw.join(', ') : raw;
    out[name] = SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) ? MASK : maskString(value);
  }
  return out;
}

/**
 * Deep-sanitize an arbitrary JSON-ish value: mask by field name and by value
 * shape. Cycles are guarded. Returns a new structure (input is not mutated).
 */
export function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return maskString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, seen));

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveFieldName(key) ? MASK : sanitizeValue(v, seen);
  }
  return out;
}

export { MASK };
