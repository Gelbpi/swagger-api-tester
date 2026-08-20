/**
 * Secret placeholder resolution (build-prompt §14).
 *
 * Supported placeholders inside config strings:
 *   ${env:NAME}                  -> process.env.NAME
 *   ${keychain:service/account}  -> macOS Keychain via the `security` CLI
 *
 * Resolved literal values are registered with the sanitizer so they can never
 * leak into logs, results, resources, or error messages. We deliberately use the
 * `security` CLI (never keytar / native modules), per the spec.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { registerSecret } from '../results/sanitizer.js';

const execFileAsync = promisify(execFile);

const PLACEHOLDER = /\$\{(env|keychain):([^}]+)\}/g;

export class SecretResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretResolutionError';
  }
}

async function readKeychain(serviceAndAccount: string): Promise<string> {
  const slash = serviceAndAccount.indexOf('/');
  if (slash <= 0 || slash === serviceAndAccount.length - 1) {
    throw new SecretResolutionError(
      `Invalid keychain reference "${serviceAndAccount}"; expected "service/account".`,
    );
  }
  const service = serviceAndAccount.slice(0, slash);
  const account = serviceAndAccount.slice(slash + 1);
  try {
    const { stdout } = await execFileAsync('security', [
      'find-generic-password',
      '-s',
      service,
      '-a',
      account,
      '-w',
    ]);
    // `-w` prints the password with a trailing newline.
    return stdout.replace(/\n$/, '');
  } catch {
    throw new SecretResolutionError(
      `Keychain item not found for service "${service}" account "${account}".`,
    );
  }
}

function readEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new SecretResolutionError(`Environment variable "${name}" is not set.`);
  }
  return value;
}

/** True if the string contains at least one `${env:}`/`${keychain:}` placeholder. */
export function hasSecretPlaceholder(input: string): boolean {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(input);
}

/**
 * Resolve every placeholder in `input`. Each resolved value is registered with
 * the sanitizer. Strings without placeholders are returned unchanged.
 */
export async function resolveSecrets(input: string): Promise<string> {
  const matches = [...input.matchAll(PLACEHOLDER)];
  if (matches.length === 0) return input;

  let out = input;
  for (const m of matches) {
    const kind = m[1] as 'env' | 'keychain';
    const ref = (m[2] ?? '').trim();
    const value = kind === 'env' ? readEnv(ref) : await readKeychain(ref);
    registerSecret(value);
    out = out.split(m[0]).join(value);
  }
  return out;
}
