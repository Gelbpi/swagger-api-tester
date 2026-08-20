package com.example.api.clients;

import com.example.api.core.SpecFactory;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;

import static io.restassured.RestAssured.given;

/**
 * Thin base for endpoint clients. One client per resource
 * (e.g. UserClient, OrderClient) keeps tests readable.
 */
public abstract class BaseClient {

    protected RequestSpecification api() {
        return given().spec(SpecFactory.request());
    }

    protected Response get(String path, Object... pathParams) {
        return api().get(path, pathParams);
    }

    protected Response post(String path, Object body, Object... pathParams) {
        return api().body(body).post(path, pathParams);
    }

    protected Response put(String path, Object body, Object... pathParams) {
        return api().body(body).put(path, pathParams);
    }

    protected Response patch(String path, Object body, Object... pathParams) {
        return api().body(body).patch(path, pathParams);
    }

    protected Response delete(String path, Object... pathParams) {
        return api().delete(path, pathParams);
    }
}
