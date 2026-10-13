# Customer website test starter (milestone 1)

Independent Java 17 + Maven + Playwright project. Two browser smoke tests check a local demo page's title and visible heading. The Edge extension in the parent folder is unrelated.

## Prerequisites

- JDK 17 or newer (`java -version`)
- Maven 3.9 or newer (`mvn -version`)
- Network access for initial Maven dependency and Chromium downloads

## Run

From `customer-test-starter`:

```powershell
mvn test-compile exec:java '-Dexec.mainClass=com.microsoft.playwright.CLI' '-Dexec.args=install chromium' '-Dexec.classpathScope=test'
mvn test
```

Maven prints results and writes JUnit XML and text reports to `target/surefire-reports/`. No customer credentials or external website are required for the demo.

## Configure a customer staging site

Set the URL and exact expected text in the same PowerShell session, then run `mvn test`:

```powershell
$env:CUSTOMER_BASE_URL = 'https://staging.example.com/'
$env:CUSTOMER_TITLE = 'Example Store'
$env:CUSTOMER_HEADING = 'Welcome to Example Store'
mvn test
```

Clear the variables with `Remove-Item Env:CUSTOMER_BASE_URL,Env:CUSTOMER_TITLE,Env:CUSTOMER_HEADING` to return to the demo. Only test websites you are authorized to access. These public-page smoke tests do not handle authentication; never commit customer credentials.

## Next milestone

Agree on one customer workflow and its expected results (for example, product search), then add a workflow test, failure artifacts, and a customer-friendly report.
