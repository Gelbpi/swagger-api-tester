// Bundles the MCP server into a single ESM file for shipping inside the plugin.
// Target: node20, platform=node, format=esm. Runtime deps are bundled so the
// installed plugin does not need `npm install`.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'src/mcp/bin.ts')],
  outfile: resolve(root, 'dist/mcp-server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  // Node built-ins resolved at runtime; everything else is bundled.
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

console.log('Bundled dist/mcp-server.js');
