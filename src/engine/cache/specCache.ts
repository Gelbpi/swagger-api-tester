/**
 * OpenAPI spec cache (build-prompt §18).
 *
 * Keyed by spec URL. Persists ETag, Last-Modified, SHA-256 and the raw body so a
 * later run can issue a conditional GET and reuse the parsed representation on a
 * 304 or on an identical SHA-256. Stored under ${CLAUDE_PLUGIN_DATA} — NEVER
 * inside the plugin installation directory.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SpecCacheMeta {
  url: string;
  etag?: string;
  lastModified?: string;
  sha256: string;
  contentType?: string;
  savedAt: string;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Resolve the persistent data directory (${CLAUDE_PLUGIN_DATA} or ~/.api-tester). */
export function resolveDataDir(explicit?: string): string {
  return explicit ?? process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.api-tester');
}

export class SpecCache {
  private readonly dir: string;

  constructor(dataDir?: string) {
    this.dir = join(resolveDataDir(dataDir), 'spec-cache');
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private metaPath(url: string): string {
    return join(this.dir, `${sha256Hex(url)}.meta.json`);
  }

  private bodyPath(sha: string): string {
    return join(this.dir, `${sha}.body`);
  }

  getMeta(url: string): SpecCacheMeta | undefined {
    const path = this.metaPath(url);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as SpecCacheMeta;
    } catch {
      return undefined;
    }
  }

  getBody(sha: string): string | undefined {
    const path = this.bodyPath(sha);
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  }

  /** Store the raw body and its metadata. Returns the computed SHA-256. */
  put(
    url: string,
    text: string,
    meta: { etag?: string; lastModified?: string; contentType?: string; savedAt: string },
  ): SpecCacheMeta {
    this.ensureDir();
    const sha = sha256Hex(text);
    writeFileSync(this.bodyPath(sha), text);
    const record: SpecCacheMeta = {
      url,
      sha256: sha,
      savedAt: meta.savedAt,
      ...(meta.etag !== undefined ? { etag: meta.etag } : {}),
      ...(meta.lastModified !== undefined ? { lastModified: meta.lastModified } : {}),
      ...(meta.contentType !== undefined ? { contentType: meta.contentType } : {}),
    };
    writeFileSync(this.metaPath(url), JSON.stringify(record, null, 2));
    return record;
  }
}
