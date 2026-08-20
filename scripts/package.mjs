// Builds, validates, and packs the shippable plugin archive (build-prompt §46, §50).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

run('node', ['scripts/build.mjs']);
run('node', ['scripts/validate-plugin.mjs']);

const outDir = join(root, 'build');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const archive = join(outDir, 'swagger-api-tester-plugin.tgz');

// Only ship what the installed plugin needs at runtime (bundle + manifests +
// docs). node_modules is NOT shipped — the bundle is self-contained.
run('tar', [
  '-czf',
  archive,
  '.claude-plugin/plugin.json',
  '.mcp.json',
  'dist/mcp-server.js',
  'README.md',
  'INSTALL.md',
  'API_TESTER.example.md',
  'package.json',
]);

console.log(`\nPackaged: ${archive}`);
