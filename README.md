# Swagger API Tester

A **Claude Desktop plugin** that deterministically tests a local REST API from its
OpenAPI/Swagger specification — no terminal, no Swagger UI, no manual request
building. Ask Claude to *"test `POST /api/users`"* or *"test all endpoints"* and a
local engine does all the mechanical work: it reads the spec, generates a valid
request, sends it, and validates the response against the documented contract.

```
Claude Desktop → Plugin → MCP server (stdio) → Testing engine → your local API
```

Claude only picks a tool, passes arguments, and reads a compact result. It never
sees the OpenAPI document or large response bodies — the engine handles parsing,
data generation, HTTP, validation, and classification.

## Two tools, nothing more

| Tool | Purpose |
|------|---------|
| `test_endpoint` | Test one endpoint (`method` + `path`, everything else optional). |
| `test_all` | Test a whole spec with filters; read-only unless `mutations` is enabled. |

Detailed, **secret-sanitized** results are exposed as resources:
`apitest://runs/{runId}` and `apitest://runs/{runId}/{testId}`.

## What the engine guarantees

- **Deterministic generation** — the same spec + operation always yields the same
  request (seeded, never `Math.random`). Values respect `example`/`default`/`enum`/
  `const`/`format`/constraints; generated requests are self-validated before send.
- **Honest result model** — every test is exactly one of `PASS`, `FAIL`,
  `INCONCLUSIVE`, `SKIPPED`, `ENGINE_ERROR`, each with a machine-readable reason.
  Business-rule rejections are never reported as contract failures; engine/network
  problems are never reported as API failures.
- **Safe by default** — `test_all` is read-only (only GET/HEAD/OPTIONS run) unless
  you enable mutations; destructive/side-effecting operations need explicit
  permission. Non-loopback targets require *two* opt-in flags; `prod`/`live`/
  `staging` hosts are always refused.
- **No secret leakage** — Bearer/JWT/Basic/API keys and known token shapes are
  masked in every output, resource, and error (property-tested).

## Quick start

See **[INSTALL.md](./INSTALL.md)**. In short:

```bash
npm install
npm run build        # bundle dist/mcp-server.js (self-contained)
npm run validate     # validate the plugin package
npm test             # run the full test suite (unit + integration)
```

Then add the local `marketplace/` to Claude Desktop and install the plugin.

Configure your backend with `.api-tester/config.json`:

```jsonc
{
  "baseUrl": "http://localhost:8080",
  "openApiUrl": "http://localhost:8080/v3/api-docs"   // optional; auto-discovered
}
```

## Development

- `npm run gates` — typecheck + lint + architecture check + tests (run after every change).
- Architecture rule: `src/mcp → src/engine` only; the engine never imports MCP
  (enforced by ESLint, a script, and a test).
- Reference: `docs/PLUGIN_FORMAT_NOTES.md` records the verified plugin format.

## Repository layout

```
src/engine/   deterministic testing engine (MCP-independent)
src/mcp/      thin MCP surface: two tools + run resources + compact formatter
test/         unit + integration tests (Fastify mock API over real HTTP)
marketplace/  local marketplace manifest for Desktop install
```

> This repository also contains a separate, pre-existing Java (REST Assured +
> TestNG) test-scaffold under `src/test/` that happens to share the name. It is
> unrelated to the plugin and is not required to build or run it.
