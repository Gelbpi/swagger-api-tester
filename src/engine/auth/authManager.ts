/**
 * AuthManager (build-prompt §25, §37).
 *
 * Supports static credentials (Bearer/Basic/API key/Cookie) AND a dynamic `login`
 * profile that POSTs credentials to a login endpoint, extracts the token, caches
 * it, and refreshes on demand (executeOne invalidates + retries once on 401/403).
 * `resolve` is async by design — this is the V2 seam the login flow fills.
 *
 * Values may contain ${env:}/${keychain:} placeholders and are resolved (and
 * registered for masking) here. A JWT-shaped token is decoded (never verified);
 * an expired one is not sent.
 */
import type { AuthProfile } from '../config/schema.js';
import type { HttpMethod } from '../types/endpoint.js';
import type { HttpRequest, HttpResponse } from '../types/http.js';
import { registerSecret } from '../results/sanitizer.js';
import { resolveSecrets } from './secrets.js';
import { decodeJwtPayload, isExpired, isJwt } from './jwt.js';
import { sendRequest } from '../http/httpClient.js';

export type AuthErrorReason = 'AUTH_PROFILE_MISSING' | 'AUTH_UNAVAILABLE';

export class AuthError extends Error {
  readonly reason: AuthErrorReason;
  constructor(reason: AuthErrorReason, message: string) {
    super(message);
    this.name = 'AuthError';
    this.reason = reason;
  }
}

/** Concrete auth material to merge into an outgoing request. */
export interface AuthMaterial {
  headers: Record<string, string>;
  query: Array<[string, string]>;
  cookies: string[];
}

const EMPTY = (): AuthMaterial => ({ headers: {}, query: [], cookies: [] });

export type HttpSend = (req: HttpRequest) => Promise<HttpResponse>;

export interface AuthManagerOptions {
  now?: () => number;
  /** Base URL used to resolve a relative loginUrl. */
  baseUrl?: string;
  /** HTTP sender for the login call (injectable for tests). */
  httpSend?: HttpSend;
}

interface CacheEntry {
  material: AuthMaterial;
  /** Expiry in ms since epoch (from the token's JWT exp), if known. */
  exp?: number;
}

/** Resolve a JSON pointer ("/a/b/0") against a parsed object. */
function getByPointer(root: unknown, pointer: string): unknown {
  const path = pointer.replace(/^#/, '');
  if (path === '' || path === '/') return root;
  const parts = path.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur: unknown = root;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Recursively resolve ${env:}/${keychain:} placeholders in string leaves. */
async function resolveObjectSecrets(value: unknown): Promise<unknown> {
  if (typeof value === 'string') return resolveSecrets(value);
  if (Array.isArray(value)) return Promise.all(value.map(resolveObjectSecrets));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = await resolveObjectSecrets(v);
    }
    return out;
  }
  return value;
}

export class AuthManager {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly profiles: Record<string, AuthProfile> = {},
    private readonly opts: AuthManagerOptions = {},
  ) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** True if the profile can be refreshed (re-authenticated) on a 401/403. */
  isRefreshable(profileName: string): boolean {
    return this.profiles[profileName]?.type === 'login';
  }

  /** Drop any cached credentials for a profile so the next resolve re-authenticates. */
  invalidate(profileName: string): void {
    this.cache.delete(profileName);
  }

  /** Resolve auth material for a profile name (null = no auth). */
  async resolve(profileName?: string): Promise<AuthMaterial | null> {
    if (!profileName) return null;
    const profile = this.profiles[profileName];
    if (!profile) {
      throw new AuthError(
        'AUTH_PROFILE_MISSING',
        `Auth profile "${profileName}" is not defined in config.auth.profiles.`,
      );
    }
    if (profile.type === 'login') {
      const cached = this.cache.get(profileName);
      if (cached && (cached.exp === undefined || cached.exp > this.now())) return cached.material;
      const entry = await this.login(profile);
      this.cache.set(profileName, entry);
      return entry.material;
    }
    return this.materialize(profile);
  }

  private async login(profile: Extract<AuthProfile, { type: 'login' }>): Promise<CacheEntry> {
    const contentType = profile.contentType ?? 'application/json';
    const method = (profile.method ?? 'POST') as HttpMethod;
    const url = this.resolveLoginUrl(profile.loginUrl);

    const bodyObj = (await resolveObjectSecrets(profile.body ?? {})) as Record<string, unknown>;
    const body =
      method === 'GET'
        ? undefined
        : contentType === 'application/x-www-form-urlencoded'
          ? new URLSearchParams(
              Object.entries(bodyObj).map(([k, v]) => [k, String(v)] as [string, string]),
            ).toString()
          : JSON.stringify(bodyObj);

    const send = this.opts.httpSend ?? sendRequest;
    const req: HttpRequest = {
      method,
      url,
      headers: body !== undefined ? { 'Content-Type': contentType } : {},
      ...(body !== undefined ? { body } : {}),
    };

    let res: HttpResponse;
    try {
      res = await send(req);
    } catch (err) {
      throw new AuthError('AUTH_UNAVAILABLE', `Login request to ${url} failed: ${String(err)}`);
    }
    if (res.status < 200 || res.status >= 300) {
      throw new AuthError('AUTH_UNAVAILABLE', `Login endpoint ${url} returned HTTP ${res.status}.`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(res.bodyText);
    } catch {
      throw new AuthError('AUTH_UNAVAILABLE', `Login response from ${url} was not JSON.`);
    }
    const token = getByPointer(parsed, profile.tokenPath);
    if (typeof token !== 'string' || token.length === 0) {
      throw new AuthError(
        'AUTH_UNAVAILABLE',
        `No token found at "${profile.tokenPath}" in the login response.`,
      );
    }
    registerSecret(token);

    const headerName = profile.headerName ?? 'Authorization';
    const headerValue = (profile.headerFormat ?? 'Bearer {token}').replace('{token}', token);
    const material = EMPTY();
    material.headers[headerName] = headerValue;

    let exp: number | undefined;
    if (isJwt(token)) {
      const payload = decodeJwtPayload(token);
      if (payload && typeof payload.exp === 'number') exp = payload.exp * 1000;
    }
    return exp !== undefined ? { material, exp } : { material };
  }

  private resolveLoginUrl(loginUrl: string): string {
    try {
      return new URL(loginUrl).toString();
    } catch {
      const base = this.opts.baseUrl ?? 'http://localhost';
      return new URL(loginUrl, base.endsWith('/') ? base : base + '/').toString();
    }
  }

  private async materialize(profile: AuthProfile): Promise<AuthMaterial> {
    const material = EMPTY();
    switch (profile.type) {
      case 'bearer': {
        const token = await resolveSecrets(profile.token);
        if (isJwt(token)) {
          const payload = decodeJwtPayload(token);
          if (payload && isExpired(payload, this.now())) {
            throw new AuthError('AUTH_UNAVAILABLE', 'Bearer token is expired; not sending it.');
          }
        }
        material.headers.Authorization = `Bearer ${token}`;
        break;
      }
      case 'basic': {
        const username = await resolveSecrets(profile.username);
        const password = await resolveSecrets(profile.password);
        const encoded = Buffer.from(`${username}:${password}`).toString('base64');
        registerSecret(encoded);
        material.headers.Authorization = `Basic ${encoded}`;
        break;
      }
      case 'apikey': {
        const value = await resolveSecrets(profile.value);
        if (profile.in === 'header') material.headers[profile.name] = value;
        else if (profile.in === 'query') material.query.push([profile.name, value]);
        else material.cookies.push(`${profile.name}=${value}`);
        break;
      }
      case 'cookie': {
        const value = await resolveSecrets(profile.value);
        material.cookies.push(profile.name ? `${profile.name}=${value}` : value);
        break;
      }
      case 'login':
        // Handled in resolve() (cached); never reached here.
        break;
    }
    return material;
  }
}

/** Merge resolved auth material into a header/query/cookie set (helper for §7). */
export function applyAuthMaterial(
  material: AuthMaterial | null,
  headers: Record<string, string>,
  query: Array<[string, string]>,
): void {
  if (!material) return;
  Object.assign(headers, material.headers);
  query.push(...material.query);
  if (material.cookies.length) {
    const existing = headers.Cookie ? [headers.Cookie] : [];
    headers.Cookie = [...existing, ...material.cookies].join('; ');
  }
}
