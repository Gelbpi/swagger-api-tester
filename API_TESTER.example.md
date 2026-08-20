# API_TESTER.md (example)

This file is **optional**. The engine works without it, and `.api-tester/config.json`
always wins over anything here. Never put real secrets in this file — it is not a
secure store and it is often committed. Use `config.local.json` or the macOS
Keychain (`${keychain:service/account}`) for credentials.

## Base URL

```
http://localhost:8080
```

## OpenAPI

```
http://localhost:8080/v3/api-docs
```

## Skip

- DELETE /api/users/{id}
- POST /api/admin/purge

## Test Values

```json
{
  "path": { "id": 1, "userId": "11111111-1111-1111-1111-111111111111" },
  "query": { "page": 0, "size": 20 }
}
```

## Notes

Anything here is masked and truncated to ~500 characters, and is only attached to
engine errors and failure-containing summaries. Do not paste tokens here.
