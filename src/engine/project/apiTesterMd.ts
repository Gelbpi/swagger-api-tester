/**
 * API_TESTER.md reader (build-prompt §15).
 *
 * Optional and NEVER authoritative — config.json always has higher precedence.
 * Recognized sections: `## Base URL`, `## OpenAPI`, `## Skip`, `## Test Values`,
 * `## Notes`. All extracted text is masked; Notes are truncated to ~500 chars.
 * Credential-like content triggers a warning.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { maskString } from '../results/sanitizer.js';

const NOTES_MAX = 500;

export interface ApiTesterMd {
  baseUrl?: string;
  openApiUrl?: string;
  skip?: string[];
  testValues?: Record<string, unknown>;
  notes?: string;
  warnings: string[];
}

interface Section {
  title: string;
  body: string;
}

function splitSections(md: string): Section[] {
  const lines = md.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section | undefined;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { title: m[1]!.trim().toLowerCase(), body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) sections.push(current);
  return sections;
}

/** First non-empty, non-fence content line (URLs often sit in a code fence). */
function firstValue(body: string): string | undefined {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('```')) continue;
    return line.replace(/^[-*]\s+/, '').replace(/^`|`$/g, '').trim();
  }
  return undefined;
}

function listItems(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, '').replace(/^`|`$/g, '').trim())
    .filter(Boolean);
}

function fencedJson(body: string): Record<string, unknown> | undefined {
  const m = /```(?:json|jsonc)?\s*\n([\s\S]*?)\n```/.exec(body);
  if (!m) return undefined;
  try {
    const parsed = JSON.parse(m[1]!);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Parse raw markdown text. Exposed for tests. */
export function parseApiTesterMd(md: string): ApiTesterMd {
  const warnings: string[] = [];
  if (maskString(md) !== md) {
    warnings.push(
      'API_TESTER.md appears to contain credential-like strings; they were masked and must not be committed. Put secrets in config.local.json or the Keychain instead.',
    );
  }

  const result: ApiTesterMd = { warnings };
  for (const { title, body } of splitSections(md)) {
    switch (title) {
      case 'base url': {
        const v = firstValue(body);
        if (v) result.baseUrl = maskString(v);
        break;
      }
      case 'openapi': {
        const v = firstValue(body);
        if (v) result.openApiUrl = maskString(v);
        break;
      }
      case 'skip': {
        const items = listItems(body).map(maskString);
        if (items.length) result.skip = items;
        break;
      }
      case 'test values': {
        const json = fencedJson(body);
        if (json) result.testValues = json;
        break;
      }
      case 'notes': {
        const text = maskString(body.trim());
        if (text) {
          result.notes = text.length > NOTES_MAX ? text.slice(0, NOTES_MAX) + '…' : text;
        }
        break;
      }
      default:
        break;
    }
  }
  return result;
}

/** Read API_TESTER.md from a project directory, if present. */
export function readApiTesterMd(projectDir: string): ApiTesterMd | undefined {
  const path = join(projectDir, 'API_TESTER.md');
  if (!existsSync(path)) return undefined;
  return parseApiTesterMd(readFileSync(path, 'utf8'));
}
