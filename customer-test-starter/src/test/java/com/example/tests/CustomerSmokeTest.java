package com.example.tests;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.options.AriaRole;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static com.microsoft.playwright.assertions.PlaywrightAssertions.assertThat;

class CustomerSmokeTest {
    private static Playwright playwright;
    private static Browser browser;

    private BrowserContext context;
    private Page page;

    @BeforeAll
    static void launchBrowser() {
        playwright = Playwright.create();
        browser = playwright.chromium().launch();
    }

    @BeforeEach
    void openSite() {
        context = browser.newContext();
        page = context.newPage();
        String demoUrl = Path.of("src/test/resources/demo-site.html").toAbsolutePath().toUri().toString();
        page.navigate(setting("CUSTOMER_BASE_URL", demoUrl));
    }

    @AfterEach
    void closeContext() {
        if (context != null) {
            context.close();
        }
    }

    @AfterAll
    static void closeBrowser() {
        if (browser != null) {
            browser.close();
        }
        if (playwright != null) {
            playwright.close();
        }
    }

    @Test
    void homePageHasExpectedTitle() {
        assertThat(page).hasTitle(setting("CUSTOMER_TITLE", "Demo Store"));
    }

    @Test
    void homePageHasExpectedHeading() {
        String heading = setting("CUSTOMER_HEADING", "Welcome to the Demo Store");
        assertThat(page.getByRole(AriaRole.HEADING, new Page.GetByRoleOptions().setName(heading))).isVisible();
    }

    private static String setting(String name, String defaultValue) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? defaultValue : value;
    }
}
