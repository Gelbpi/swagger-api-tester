package com.example.api.config;

import java.io.InputStream;
import java.util.Properties;

/**
 * Single source of truth for runtime settings.
 * Resolution order: -D system property -> config.properties -> default.
 */
public final class Config {

    private static final Properties PROPS = load();

    private Config() {
    }

    private static Properties load() {
        Properties p = new Properties();
        try (InputStream in = Config.class.getClassLoader().getResourceAsStream("config.properties")) {
            if (in != null) {
                p.load(in);
            }
        } catch (Exception e) {
            throw new IllegalStateException("Cannot read config.properties", e);
        }
        return p;
    }

    public static String get(String key, String defaultValue) {
        String fromCli = System.getProperty(key);
        if (fromCli != null && !fromCli.isBlank()) {
            return fromCli;
        }
        return PROPS.getProperty(key, defaultValue);
    }

    public static String get(String key) {
        String value = get(key, null);
        if (value == null) {
            throw new IllegalStateException("Missing required config key: " + key);
        }
        return value;
    }

    public static int getInt(String key, int defaultValue) {
        String value = get(key, null);
        return value == null || value.isBlank() ? defaultValue : Integer.parseInt(value.trim());
    }

    public static boolean getBoolean(String key, boolean defaultValue) {
        String value = get(key, null);
        return value == null || value.isBlank() ? defaultValue : Boolean.parseBoolean(value.trim());
    }

    public static String baseUrl() {
        return get("base.url");
    }

    public static String basePath() {
        return get("base.path", "");
    }

    public static int timeoutMs() {
        return getInt("timeout.ms", 15000);
    }

    public static String openApiSpec() {
        return get("openapi.spec", "openapi/swagger.json");
    }

    public static AuthType authType() {
        return AuthType.from(get("auth.type", "none"));
    }

    public enum AuthType {
        NONE, BEARER, BASIC, APIKEY;

        static AuthType from(String raw) {
            return valueOf(raw.trim().toUpperCase());
        }
    }
}
