package com.example.demo;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** A small, well-documented REST resource for the engine to exercise. */
@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping
    public List<User> list() {
        return List.of(new User(1, "Ada", "ada@example.com"), new User(2, "Linus", "linus@example.com"));
    }

    @GetMapping("/{id}")
    public User get(@PathVariable long id) {
        return new User(id, "User-" + id, "user" + id + "@example.com");
    }

    @PostMapping
    public ResponseEntity<User> create(@RequestBody User body) {
        User created = new User(99, body.getName() == null ? "anon" : body.getName(), body.getEmail());
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable long id) {
        return ResponseEntity.noContent().build();
    }
}
