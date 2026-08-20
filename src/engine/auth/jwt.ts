/**
 * JWT inspection (build-prompt §25).
 *
 * Decodes the payload to inspect `exp`. We NEVER verify the signature — this is
 * only used to avoid sending an already-expired token.
 */

export interface JwtPayload {
  exp?: number;
  [k: string]: unknown;
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

export function isJwt(token: string): boolean {
  return JWT_SHAPE.test(token) && token.startsWith('eyJ');
}

export function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? (payload as JwtPayload) : null;
  } catch {
    return null;
  }
}

/** True if the payload has a numeric `exp` in the past (seconds since epoch). */
export function isExpired(payload: JwtPayload, nowMs: number): boolean {
  return typeof payload.exp === 'number' && payload.exp * 1000 <= nowMs;
}
