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
