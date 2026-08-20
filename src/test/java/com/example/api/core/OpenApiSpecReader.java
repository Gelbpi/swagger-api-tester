package com.example.api.core;

import com.example.api.config.Config;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Minimal reader over the OpenAPI/Swagger document so tests can be
 * generated from — and checked against — the contract itself.
 */
public final class OpenApiSpecReader {

    private final JsonNode root;

    public OpenApiSpecReader() {
        this(Config.openApiSpec());
    }

    public OpenApiSpecReader(String resourcePath) {
        this.root = read(resourcePath);
    }

    private static JsonNode read(String resourcePath) {
        try (InputStream in = OpenApiSpecReader.class.getClassLoader().getResourceAsStream(resourcePath)) {
            if (in == null) {
                throw new IllegalStateException(
                        "OpenAPI spec not found on classpath: " + resourcePath
                                + " — put it under src/test/resources/openapi/");
            }
            ObjectMapper mapper = resourcePath.endsWith(".yaml") || resourcePath.endsWith(".yml")
                    ? new ObjectMapper(new YAMLFactory())
                    : new ObjectMapper();
            return mapper.readTree(in);
        } catch (Exception e) {
            throw new IllegalStateException("Cannot parse OpenAPI spec: " + resourcePath, e);
        }
    }

    /** @return every operation declared in the spec, e.g. GET /pet/{petId} */
    public List<Operation> operations() {
        List<Operation> result = new ArrayList<>();
        JsonNode paths = root.path("paths");
        Iterator<Map.Entry<String, JsonNode>> pathIt = paths.fields();
        while (pathIt.hasNext()) {
            Map.Entry<String, JsonNode> pathEntry = pathIt.next();
            Iterator<Map.Entry<String, JsonNode>> methodIt = pathEntry.getValue().fields();
            while (methodIt.hasNext()) {
                Map.Entry<String, JsonNode> methodEntry = methodIt.next();
                String method = methodEntry.getKey().toUpperCase();
                if (!HTTP_METHODS.contains(method)) {
                    continue;
                }
                result.add(new Operation(
                        method,
                        pathEntry.getKey(),
                        methodEntry.getValue().path("operationId").asText(""),
                        methodEntry.getValue().path("summary").asText("")));
            }
        }
        return result;
    }

    private static final List<String> HTTP_METHODS =
            List.of("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS");

    public JsonNode raw() {
        return root;
    }

    public record Operation(String method, String path, String operationId, String summary) {
        @Override
        public String toString() {
            return method + " " + path;
        }
    }
}
