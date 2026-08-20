# Installing Swagger API Tester

Swagger API Tester is a Claude Desktop / Claude Code **plugin**. It bundles an MCP
server and a deterministic API-testing engine. You do **not** need Claude Code, a
terminal, Swagger UI, or a browser to use it — just Claude Desktop.

> **Format note (verified against current docs — see `docs/PLUGIN_FORMAT_NOTES.md`):**
> Claude Desktop installs plugins through **marketplaces** using the same plugin
> format as the Claude Code CLI. There is **no separate `.mcpb`/`.dxt` upload
> flow**. To install locally, point Desktop at the local marketplace in this repo.

## 1. Build the bundle

```bash
npm install
npm run build      # produces dist/mcp-server.js (self-contained)
npm run validate   # checks plugin.json, .mcp.json, marketplace.json, dist/
```

The shipped server is a single bundled file — no runtime `npm install` is needed
by the installed plugin.

## 2. Add the local marketplace to Claude Desktop

1. Open Claude Desktop.
2. Click the **+** next to the prompt box → **Plugins** → **Add marketplace**
   (or run `/plugin marketplace add <path>` in Claude Code).
3. Point it at the **`marketplace/`** directory of this repo (the directory that
   contains `.claude-plugin/marketplace.json`).
4. Open the plugin browser (**+ → Plugins → Add plugin**), find
   **Swagger API Tester**, and install it.
5. In **Manage plugins**, set the plugin options (all optional):
   - **API base URL** — the simplest path. Type e.g. `http://localhost:8080` and
     you're done: no project files, no `project_path`, nothing else needed.
   - **OpenAPI URL** — only if the spec is at a non-standard path (usually
     auto-discovered).
   - **Backend project path** — point at your repo to pick up `config.json`,
     `testValues`, auth, or code auto-detection (Spring Boot / Quarkus / Micronaut).
   - **Allow non-loopback targets** — leave off unless you are deliberately
     testing a remote host (config must *also* set `allowRemoteTargets: true`).

   **The quickest setup is just "API base URL".** Everything else is for richer
   projects (generated test data, auth profiles, per-endpoint overrides).

## 3. Configure your backend project

**For a standard Spring Boot project you don't need any config file at all.** The
engine auto-detects everything from the code: the port from
`application.properties`/`application.yml` (default `8080`), the context path, and
the springdoc spec path (default `/v3/api-docs`). Just make sure the app is
running and point the plugin at the project (the `project_path` setting, or run
from inside the repo). The server still has to be up — auto-detection only infers
*where* it listens.

Create `.api-tester/config.json` **only to override** a non-standard setup
(custom host, Docker port mapping, a reverse proxy, auth):

```jsonc
{
  // The running API to test (loopback only unless you opt into remote).
  "baseUrl": "http://localhost:8080",
  // Optional — auto-discovered if omitted.
  "openApiUrl": "http://localhost:8080/v3/api-docs"
}
```

Precedence: `config.json` > `API_TESTER.md` > auto-detection. Put secrets in
`.api-tester/config.local.json` (gitignored) or reference the macOS Keychain with
`${keychain:service/account}` / an env var with `${env:NAME}`.

## 4. Use it

Ask Claude, in plain language:

- "Test `GET /api/users/{id}`"
- "Test `POST /api/users`"
- "Test all endpoints"
- "Test all GET endpoints"
- "Run the API tests"

Claude calls one of exactly two tools — `test_endpoint` or `test_all` — and shows
a compact result. Detailed, sanitized results stay available through the
`apitest://runs/{runId}` resources.

## Distribution options

- **Local marketplace** (above) — best for development and personal use.
- **Archive** — `npm run package` produces `build/swagger-api-tester-plugin.tgz`
  containing the bundle + manifests (no `node_modules`).
- **Git marketplace** — host this repo and add its URL as a marketplace; the
  plugin `source` in `marketplace/.claude-plugin/marketplace.json` resolves to the
  repo root.

There is intentionally **no** `.mcpb`/`.dxt` "custom upload" step — that format
does not exist in the current Claude Desktop. If a future Desktop adds one, it can
wrap this same bundle unchanged.
