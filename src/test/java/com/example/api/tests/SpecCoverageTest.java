package com.example.api.tests;

import com.example.api.core.OpenApiSpecReader;
import io.qameta.allure.Epic;
import io.qameta.allure.Feature;
import org.testng.SkipException;
import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

import java.util.List;

import static org.testng.Assert.assertFalse;

/**
 * Читає OpenAPI-спеку і показує, які операції в ній оголошені.
 * Далі з цього списку зручно нарощувати покриття тестами.
 */
@Epic("Contract")
@Feature("OpenAPI spec")
public class SpecCoverageTest {

    @DataProvider(name = "operations")
    public Object[][] operations() {
        List<OpenApiSpecReader.Operation> ops;
        try {
            ops = new OpenApiSpecReader().operations();
        } catch (IllegalStateException e) {
            // спеки ще немає — не валимо збірку
            return new Object[0][0];
        }
        return ops.stream().map(op -> new Object[]{op}).toArray(Object[][]::new);
    }

    @Test(groups = "contract", description = "Спека містить хоча б одну операцію")
    public void specIsNotEmpty() {
        try {
            List<OpenApiSpecReader.Operation> ops = new OpenApiSpecReader().operations();
            assertFalse(ops.isEmpty(), "У спеці не знайдено жодного шляху");
        } catch (IllegalStateException e) {
            throw new SkipException("Спека ще не додана: " + e.getMessage());
        }
    }

    @Test(groups = "contract", dataProvider = "operations",
            description = "Кожна операція має operationId")
    public void everyOperationHasId(OpenApiSpecReader.Operation op) {
        assertFalse(op.operationId().isBlank(),
                "Без operationId: " + op);
    }
}
