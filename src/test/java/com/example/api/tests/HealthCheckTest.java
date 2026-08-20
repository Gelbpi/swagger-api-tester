package com.example.api.tests;

import com.example.api.core.BaseTest;
import io.qameta.allure.Epic;
import io.qameta.allure.Feature;
import io.qameta.allure.Severity;
import io.qameta.allure.SeverityLevel;
import io.restassured.response.Response;
import org.testng.annotations.Test;

import static io.restassured.RestAssured.given;
import static org.testng.Assert.assertTrue;

@Epic("Infrastructure")
@Feature("Health check")
public class HealthCheckTest extends BaseTest {

    @Test(groups = "smoke", description = "API відповідає на базовому URL")
    @Severity(SeverityLevel.BLOCKER)
    public void apiIsReachable() {
        Response response = given().spec(spec).get("/");
        log.info("GET / -> {}", response.statusCode());
        assertTrue(response.statusCode() < 500,
                "API повернув 5xx: " + response.statusCode());
    }
}
