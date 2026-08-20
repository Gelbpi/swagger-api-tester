import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engineDir = join(repoRoot, 'src', 'engine');

const FORBIDDEN = [
  /from\s+['"][^'"]*\/mcp(\/|['"])/,
  /from\s+['"]@modelcontextprotocol\//,
  /import\s*\(\s*['"][^'"]*\/mcp(\/|['"])/,
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('architecture: mandatory dependency direction (build-prompt §5)', () => {
  it('src/engine never imports src/mcp or the MCP SDK', () => {
    const violations: string[] = [];
    for (const file of walk(engineDir)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (FORBIDDEN.some((re) => re.test(line))) violations.push(`${file}:${i + 1}`);
        });
    }
    expect(violations).toEqual([]);
  });
});
