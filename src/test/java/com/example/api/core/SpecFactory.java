package com.example.api.core;

import com.example.api.config.Config;
import io.qameta.allure.restassured.AllureRestAssured;
import io.restassured.builder.RequestSpecBuilder;
import io.restassured.builder.ResponseSpecBuilder;
import io.restassured.config.HttpClientConfig;
import io.restassured.config.RestAssuredConfig;
import io.restassured.filter.log.LogDetail;
import io.restassured.http.ContentType;
import io.restassured.specification.RequestSpecification;
import io.restassured.specification.ResponseSpecification;

/**
 * Builds the shared request/response specifications used by every test.
 */
public final class SpecFactory {

    private SpecFactory() {
    }

    public static RequestSpecification request() {
        RestAssuredConfig config = RestAssuredConfig.config()
                .httpClient(HttpClientConfig.httpClientConfig()
                        .setParam("http.connection.timeout", Config.timeoutMs())
                        .setParam("http.socket.timeout", Config.timeoutMs()));

        RequestSpecBuilder builder = new RequestSpecBuilder()
                .setBaseUri(Config.baseUrl())
                .setBasePath(Config.basePath())
                .setContentType(ContentType.JSON)
                .setAccept(ContentType.JSON)
                .setConfig(config)
                .addFilter(new AllureRestAssured());

        if (Config.getBoolean("log.all", false)) {
            builder.log(LogDetail.ALL);
        }

        applyAuth(builder);
        return builder.build();
    }

    private static void applyAuth(RequestSpecBuilder builder) {
        switch (Config.authType()) {
            case BEARER -> builder.addHeader("Authorization", "Bearer " + Config.get("auth.token"));
            case BASIC -> builder.setAuth(io.restassured.RestAssured.preemptive()
                    .basic(Config.get("auth.username"), Config.get("auth.password")));
            case APIKEY -> builder.addHeader(
                    Config.get("auth.apikey.header", "X-API-Key"),
                    Config.get("auth.apikey.value"));
            case NONE -> {
                // no auth
            }
        }
    }

    public static ResponseSpecification ok() {
        return status(200);
    }

    public static ResponseSpecification status(int expected) {
        return new ResponseSpecBuilder()
                .expectStatusCode(expected)
                .expectResponseTime(org.hamcrest.Matchers.lessThan((long) Config.timeoutMs()))
                .build();
    }
}
