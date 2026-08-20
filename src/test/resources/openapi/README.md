Поклади сюди свою специфікацію: `swagger.json` (або `openapi.yaml`)
і за потреби поправ ключ `openapi.spec` у `config.properties`.

Далі з неї підтягуються:
- список ендпоінтів для покриття (`SpecCoverageTest`);
- JSON-схеми відповідей для `matchesJsonSchema`.
