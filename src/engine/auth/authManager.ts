/**
 * AuthManager (build-prompt §25, §37).
 *
 * V1 supports STATIC credentials only: Bearer JWT, Basic, API key (header/query/
 * cookie), and Cookie. Values may contain ${env:}/${keychain:} placeholders and
 * are resolved (and registered for masking) here. `resolve` is intentionally
 * async — a deliberate V2 extension seam for login/bootstrap flows (NOT V1).
 *
 * A JWT-shaped bearer token is decoded (never verified); if expired it is not
 * sent and resolution fails with AUTH_UNAVAILABLE.
 */
import type { AuthProfile } from '../config/schema.js';
import { registerSecret } from '../results/sanitizer.js';
import { resolveSecrets } from './secrets.js';
import { decodeJwtPayload, isExpired, isJwt } from './jwt.js';

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

export interface AuthManagerOptions {
  now?: () => number;
}

export class AuthManager {
  constructor(
    private readonly profiles: Record<string, AuthProfile> = {},
    private readonly opts: AuthManagerOptions = {},
  ) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
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
    return this.materialize(profile);
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
