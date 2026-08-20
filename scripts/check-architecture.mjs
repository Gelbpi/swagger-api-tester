// Enforces the mandatory dependency direction: src/mcp -> src/engine only.
// Scans src/engine/** for any import that reaches into the MCP layer or the
// MCP SDK. Exits non-zero (fails the build) on violation.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engineDir = join(root, 'src', 'engine');

const FORBIDDEN = [
  /from\s+['"][^'"]*\/mcp(\/|['"])/,
  /from\s+['"]@modelcontextprotocol\//,
  /import\s*\(\s*['"][^'"]*\/mcp(\/|['"])/,
];

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of walk(engineDir)) {
  const src = readFileSync(file, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (FORBIDDEN.some((re) => re.test(line))) {
      violations.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length > 0) {
  console.error('Architecture violation: src/engine must not import src/mcp or the MCP SDK.');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}

console.log('Architecture check passed: src/engine is free of MCP dependencies.');
