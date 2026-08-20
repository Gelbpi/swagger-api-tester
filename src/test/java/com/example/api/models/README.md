POJO для request/response тіл. Використовуй Lombok:

```java
@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class User {
    private Long id;
    private String username;
}
```

Коли з'явиться swagger.json — моделі можна згенерувати
плагіном `openapi-generator-maven-plugin` замість ручного написання.
