Один клас на ресурс API. Приклад:

```java
public class UserClient extends BaseClient {
    public Response getById(long id) {
        return get("/users/{id}", id);
    }
}
```

Тести не роблять `given()` напряму — вони ходять через клієнти.
