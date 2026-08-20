/**
 * Remote target protection (build-prompt §27).
 *
 * Loopback targets are always allowed. Non-loopback targets require BOTH
 * `allowRemoteTargets=true` (config) AND `API_TESTER_ALLOW_REMOTE=1` (env).
 * Targets whose host contains prod / live / staging are always refused, even on
 * loopback. Applies to both test_endpoint and test_all.
 */
import { EngineError } from '../types/errors.js';

const FORBIDDEN_HOST_KEYWORDS = ['prod', 'live', 'staging'];

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return h.endsWith('.localhost');
}

export interface TargetGuardOptions {
  allowRemoteTargets?: boolean;
  env?: NodeJS.ProcessEnv;
}

/** Throw TARGET_REFUSED_BY_POLICY if the URL is not permitted; otherwise return. */
export function assertTargetAllowed(rawUrl: string, opts: TargetGuardOptions = {}): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new EngineError('TARGET_REFUSED_BY_POLICY', `Invalid target URL "${rawUrl}".`);
  }
  const host = url.hostname.toLowerCase();

  for (const kw of FORBIDDEN_HOST_KEYWORDS) {
    if (host.includes(kw)) {
      throw new EngineError(
        'TARGET_REFUSED_BY_POLICY',
        `Refusing to target host "${url.hostname}" (contains "${kw}").`,
        'This engine will not test production/live/staging-looking hosts.',
      );
    }
  }

  if (isLoopbackHost(host)) return;

  const env = opts.env ?? process.env;
  const envAllows = env.API_TESTER_ALLOW_REMOTE === '1';
  if (opts.allowRemoteTargets === true && envAllows) return;

  throw new EngineError(
    'TARGET_REFUSED_BY_POLICY',
    `Refusing non-loopback target "${url.hostname}".`,
    'Set allowRemoteTargets:true in config AND API_TESTER_ALLOW_REMOTE=1 in the environment to permit remote targets.',
  );
}
