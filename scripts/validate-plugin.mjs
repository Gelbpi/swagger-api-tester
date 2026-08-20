// Validates the plugin package (build-prompt §50). Exits non-zero on any problem.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const check = (cond, msg) => {
  if (!cond) errors.push(msg);
};

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch (e) {
    errors.push(`Cannot read/parse ${rel}: ${e.message}`);
    return undefined;
  }
}

// 1. plugin.json
const plugin = readJson('.claude-plugin/plugin.json');
if (plugin) {
  check(/^[a-z0-9-]+$/.test(plugin.name), 'plugin.json: name must be kebab-case');
  check(plugin.name === 'swagger-api-tester', 'plugin.json: name must be "swagger-api-tester"');
  check(typeof plugin.version === 'string', 'plugin.json: version required');
  check(typeof plugin.description === 'string', 'plugin.json: description required');
  check(plugin.author && typeof plugin.author.name === 'string', 'plugin.json: author.name required');
  check(!!plugin.userConfig?.base_url, 'plugin.json: userConfig.base_url required');
  check(!!plugin.userConfig?.project_path, 'plugin.json: userConfig.project_path required');
  check(!!plugin.userConfig?.allow_remote, 'plugin.json: userConfig.allow_remote required');
}

// 2. .mcp.json
const mcp = readJson('.mcp.json');
if (mcp) {
  const server = mcp.mcpServers?.['swagger-api-tester'];
  check(!!server, '.mcp.json: mcpServers["swagger-api-tester"] required');
  if (server) {
    check(server.command === 'node', '.mcp.json: command must be "node"');
    check(
      Array.isArray(server.args) && server.args.some((a) => a.includes('${CLAUDE_PLUGIN_ROOT}') && a.includes('dist/mcp-server.js')),
      '.mcp.json: args must reference ${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js',
    );
  }
}

// 3. bundle present
check(existsSync(join(root, 'dist/mcp-server.js')), 'dist/mcp-server.js missing — run `npm run build`');

// 4. marketplace.json
const market = readJson('marketplace/.claude-plugin/marketplace.json');
if (market) {
  check(typeof market.name === 'string', 'marketplace.json: name required');
  check(market.owner && typeof market.owner.name === 'string', 'marketplace.json: owner.name required');
  const entry = market.plugins?.find((p) => p.name === 'swagger-api-tester');
  check(!!entry, 'marketplace.json: must list plugin "swagger-api-tester"');
  check(entry && typeof entry.source === 'string', 'marketplace.json: plugin entry needs a source');
}

// 5. only plugin.json inside .claude-plugin/
import('node:fs').then(({ readdirSync }) => {
  const inside = readdirSync(join(root, '.claude-plugin'));
  const allowedInside = new Set(['plugin.json', 'marketplace.json']);
  const unexpected = inside.filter((f) => !allowedInside.has(f));
  check(
    unexpected.length === 0,
    `.claude-plugin/ may only contain plugin.json (+ optional marketplace.json); found extra: ${unexpected.join(', ')}`,
  );

  if (errors.length) {
    console.error('Plugin validation FAILED:');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('Plugin validation passed.');
});
