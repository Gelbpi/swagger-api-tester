package com.example.api.core;

import io.restassured.RestAssured;
import io.restassured.specification.RequestSpecification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.testng.annotations.BeforeClass;

/**
 * Parent of every test class: wires the shared spec and failure logging.
 */
public abstract class BaseTest {

    protected final Logger log = LoggerFactory.getLogger(getClass());
    protected RequestSpecification spec;

    @BeforeClass(alwaysRun = true)
    public void setUpSpec() {
        RestAssured.enableLoggingOfRequestAndResponseIfValidationFails();
        RestAssured.useRelaxedHTTPSValidation();
        spec = SpecFactory.request();
    }
}
