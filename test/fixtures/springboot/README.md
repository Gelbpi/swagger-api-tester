# Spring Boot + springdoc fixture

A real Spring Boot 3.4 app with springdoc-openapi, used to exercise the engine
against a genuine springdoc `/v3/api-docs` endpoint (build-prompt §44).

## Build & run

```bash
cd test/fixtures/springboot
mvn -DskipTests package          # builds target/springboot-fixture.jar
java -jar target/springboot-fixture.jar   # serves on http://localhost:8080
# OpenAPI at http://localhost:8080/v3/api-docs
```

## Automated test

`test/integration/springboot.int.test.ts` spawns the jar on a random port and
runs `test_endpoint` / `test_all` against it. It **skips automatically** when the
jar has not been built, so `npm test` still passes on machines without JDK/Maven.
Build the jar (above) to enable it.

## What the engine finds (and why)

Verified live during development:

| Call | Result | Why |
|------|--------|-----|
| `GET /api/users/{id}` | `PASS` (200) | body matches the `User` schema |
| `GET /api/users` | `PASS` (200) | array of `User` validates |
| `POST /api/users` | `FAIL / STATUS_MISMATCH` | controller returns **201**, but springdoc documents only **200** — a genuine doc/impl mismatch the tester correctly flags |
| `DELETE /api/users/{id}` (no confirm) | `SKIPPED / DESTRUCTIVE_OPERATION` | destructive; needs `confirmSideEffects` |
| `test_all` (default) | 2 passed, 2 skipped | read-only by default; POST/DELETE skipped |

The POST/DELETE mismatches are a good demonstration that the engine performs real
contract checking rather than just "did it 2xx".
