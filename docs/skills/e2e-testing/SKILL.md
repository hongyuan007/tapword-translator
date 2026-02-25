---
name: e2e-testing
description: Guide for writing, running, and debugging Playwright E2E tests for the TapWord Translator Chrome extension. Use this skill when creating new E2E tests or fixing failing tests.
---

# E2E Testing Guide for TapWord Translator

This skill provides instructions for writing and running Playwright E2E tests for the TapWord Translator Chrome extension.

## When to use this skill
- When the user asks to write a new E2E test.
- When debugging failing E2E tests.
- When verifying UI interactions, background service initialization, and DOM manipulations that unit tests cannot capture.

## Running Tests
- **Run all E2E tests (Headed)**: `npm run test:e2e:headed` (Recommended for debugging)
- **Run specific test**: `npm run test:e2e:headed -- tests/e2e/specs/your-test.spec.ts`
- **Screenshots**: Saved in `tests/e2e/screenshots/` upon failure or manual capture.

## Writing Tests for AI Agents

When creating new specs in `tests/e2e/specs/`, follow these critical patterns:

1. **Local Server**: Use `createLocalHtmlServer()` to serve `tests/html/test_page.html`.
2. **Extension Loading**: Use `chromium.launchPersistentContext` with extension args to load the unpacked extension.
3. **Initialization Wait (CRITICAL)**: Always wait for the background service to warm up (`await page.waitForTimeout(2000)`) before interacting with the page. If you don't wait, you will encounter "API service not initialized" errors because the background worker needs time to initialize `AuthService` and `APIService`.
4. **UI Verification**: Use `page.locator()` to find extension UI elements (e.g., `.ai-translator-icon`, `.ai-translator-tooltip`).
5. **Handling Loading States**: When waiting for a translation to complete, wait for the loading indicator to disappear using `expect(locator).toHaveCount(0, { timeout: 15000 })` (e.g., waiting for `.ai-translator-loading` or `.ai-translator-tooltip.loading` to be removed).
6. **Screenshots**: Capture screenshots for visual verification at the end of the test.

## Example Test Structure
Refer to `tests/e2e/specs/single-click-translation.spec.ts` for a complete, working example of testing a translation flow against the real local backend.

## Troubleshooting & Best Practices (AI Agents Specific)

### 1. Robust Browser Launch
When launching the browser context, always use these flags to ensure the extension loads correctly and doesn't crash:

```typescript
const EXTENSION_ENABLED_FLAGS = [
    '--enable-unsafe-extension-debugging',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--disable-extensions-except=' + EXTENSION_DIST_PATH,
    '--load-extension=' + EXTENSION_DIST_PATH,
];

const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // Recommended for extensions to ensure proper rendering
    args: EXTENSION_ENABLED_FLAGS,
});
```

### 2. Service Worker Verification
Instead of a blind `waitForTimeout(2000)`, verify the service worker is actually running. Use this helper:

```typescript
async function waitForExtensionServiceWorker(context: any): Promise<string> {
    const startTime = Date.now();
    while (Date.now() - startTime < 15000) {
        const serviceWorkers = context.serviceWorkers();
        const extensionServiceWorker = serviceWorkers.find((worker) => worker.url().startsWith('chrome-extension://'));
        if (extensionServiceWorker) return extensionServiceWorker.url();
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return '';
}
```

### 3. Debugging Content Scripts
Always attach console listeners to see logs from the extension's content scripts inside the test runner output. This is critical for diagnosing why a translation might not trigger (e.g., selection validation failures).

```typescript
const page = await context.newPage();
page.on('console', msg => console.log('PAGE LOG:', msg.text()));
page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
```

### 4. HTML Fixtures
When creating reproduction HTML files in `tests/html/`, prefer generating them dynamically within the test or using `create_file` if they don't exist. Ensure `body` styles are explicitly set if testing theme-related issues, as defaults can vary.

### 5. Screenshot Reliability & Viewport Issues
When validating visual elements (like tooltips or highlights), the page might auto-scroll or render async content, moving elements out of the viewport.
- **Always re-center before screenshot**: Use `scrollIntoView` or custom JS scrolling logic immediately before `page.screenshot()`.
- **Use clip screenshots**: Compute the bounding box of relevant elements (e.g., `anchor + tooltip`) and use the `clip` option in `screenshot()` to guarantee they are captured, regardless of viewport position.
- **Avoid fullPage screenshots for large pages**: They can be slow and cause timeouts. Prefer viewport or clipped screenshots for specific element validation.

### 6. Test Timeouts
Network operations or live site tests may exceed the default timeout (30s).
- Use `test.setTimeout(120_000)` inside specific long-running tests.
- Always explicitly close the browser context (`await context.close()`) in a `finally` block to prevent "Worker teardown timeout" errors.
