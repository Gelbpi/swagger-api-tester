# Plugin Format Notes (Phase 0 verification)

Verified against the current official documentation on 2026-08-19 by fetching the
live pages under `https://code.claude.com/docs/en` (the canonical Claude Code /
Claude Desktop plugin docs). This file records what was confirmed and any
deviation from the assumptions baked into the build prompt.

## Sources
- Plugins guide — https://code.claude.com/docs/en/plugins.md
- Plugins reference — https://code.claude.com/docs/en/plugins-reference.md
- Marketplace guide — https://code.claude.com/docs/en/plugin-marketplaces.md
- Desktop guide — https://code.claude.com/docs/en/desktop.md

## 1. `.claude-plugin/plugin.json`
- Only `.claude-plugin/plugin.json` lives inside `.claude-plugin/`. All component
  dirs (`.mcp.json`, `commands/`, `agents/`, `skills/`, `hooks/`) live at the
  **plugin root**, not inside `.claude-plugin/`.
- Required: `name` (kebab-case). Optional: `displayName`, `version`,
  `description`, `author`, `keywords`, `homepage`, `repository`, `license`,
  `defaultEnabled`, `userConfig`, `dependencies`, and pointer fields
  (`mcpServers`, `commands`, `agents`, `skills`, `hooks`, `lspServers`).
- `author` is an **object**: `{ name (required), email?, url? }`.
- `userConfig` **exists** and is the supported install-time settings mechanism.
  Field schema: `{ type, title, description?, required?, sensitive?, default?,
  min?, max? }`. Types: `string`, `number`, `boolean`, `directory`, `file`.
  → We use it for `project_path` (type `directory`) and `allow_remote`
  (type `boolean`). This satisfies build-prompt §48.

## 2. MCP server declaration
- Declared via a top-level `.mcp.json` at plugin root (a `mcpServers` pointer in
  `plugin.json` is also supported, but we use the root `.mcp.json` as the prompt
  requires).
- `.mcp.json` shape: `{ "mcpServers": { "<name>": { "command", "args"?, "env"? } } }`.
- Path/env substitution variables — **all confirmed to exist**:
  - `${CLAUDE_PLUGIN_ROOT}` → plugin install dir (use for `dist/mcp-server.js`).
  - `${CLAUDE_PLUGIN_DATA}` → persistent per-plugin data dir that survives
    updates (use for spec cache + run store). Satisfies build-prompt §18/§49.
  - `${CLAUDE_PROJECT_DIR}` → project root.
- `userConfig` values substitute into `.mcp.json` string fields as
  `${user_config.<key>}` and are also exposed to hooks as
  `CLAUDE_PLUGIN_OPTION_<KEY>`. We inject `project_path` / `allow_remote` into
  the server `env` this way.

## 3. Marketplace
- `.claude-plugin/marketplace.json` at the marketplace repo root.
- Required: `name`, `owner` (`{ name, email?, url? }`), `plugins[]`.
- Each plugin entry requires `name` + `source`. `source` may be a relative path
  string (`"./"`) or an object (`github` / `url` / `git-subdir` / `npm` /
  `archive` / `command`).

## 4. Claude Desktop installation — DEVIATION FROM PROMPT (report, not redesign)
- Desktop installs plugins through the **+ → Plugins → Add plugin** browser,
  from configured marketplaces (git or local path). Scopes: user / project / local.
- **There is NO separate `.mcpb` / `.dxt` custom-upload bundle format.** Desktop
  uses the **same** plugin format as the CLI. Build-prompt §50 item 3 ("Desktop
  custom-plugin package") does not exist as a distinct mechanism today.
  - Impact: minimal. Local install is achieved by pointing Desktop at a local
    marketplace (`marketplace/.claude-plugin/marketplace.json`) whose plugin
    `source` is `"./"` back to this repo, or a git-hosted marketplace.
  - Required modification: distribution §50 ships (1) local marketplace and
    (2) a plain archive of the repo; we do **not** claim a `.mcpb`/`.dxt` upload
    flow. INSTALL.md will document the marketplace-based Desktop flow honestly.
- Plugin browser is unavailable in cloud/WSL sessions; for those, plugins are
  enabled via repo `.claude/settings.json` `enabledPlugins` (out of scope for V1).

## Conclusion
No **blocking** incompatibility with the fixed architecture. The only deviation
(Desktop custom-upload bundle) affects distribution packaging wording only, and
is handled by the local-marketplace flow. Proceeding to Phase 1.
