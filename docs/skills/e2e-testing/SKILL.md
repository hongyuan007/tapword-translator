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

## 1. Running Tests
- **Build Extension (CRITICAL)**: `npm run build` must be run before any E2E tests, otherwise Playwright will load an outdated or missing `dist/` folder.
- **Run all E2E tests (Headed)**: `npm run test:e2e:headed` (Recommended for debugging)
- **Run specific test**: `npm run test:e2e:headed -- tests/e2e/specs/your-test.spec.ts`
- **Screenshots**: Saved in `tests/e2e/screenshots/` upon failure or manual capture.

## 2. Writing Tests: Critical Patterns for AI Agents

When creating new specs in `tests/e2e/specs/`, you **MUST** follow these architectural patterns to avoid common extension-testing pitfalls.

### 2.1 Browser Context & Locale
Always force `zh-CN` locale. This ensures the extension defaults `targetLanguage` to `zh` (Chinese) without needing manual storage seeding.

```typescript
const EXTENSION_ENABLED_FLAGS = [
    '--enable-unsafe-extension-debugging',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--disable-extensions-except=' + EXTENSION_DIST_PATH,
    '--load-extension=' + EXTENSION_DIST_PATH,
    '--lang=zh-CN', // Force locale to Chinese so targetLanguage defaults to 'zh'
];

const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: EXTENSION_ENABLED_FLAGS,
    locale: 'zh-CN', // Set Playwright context locale as well
});
```

### 2.2 Initialization Wait Strategy
The extension has two layers of initialization. You must wait for **both**:
1. **Service Worker**: Wait for it to start.
2. **Content Script**: Wait for it to inject CSS variables into the page.

**Do NOT use `waitForTimeout(2000)` alone.**

```typescript
// 1. Wait for Service Worker
await waitForExtensionServiceWorker(context);

// 2. Wait for Content Script (check for injected CSS variable)
await page.waitForFunction(() => {
    const val = getComputedStyle(document.documentElement).getPropertyValue('--ai-translator-underline-offset');
    return val && val.trim() !== '';
}, null, { timeout: 8000 });
```

### 2.3 Accessing Extension APIs (`chrome.*`)
The test page (`page`) is a regular web page and **cannot** access `chrome.*` APIs. You must run these in the Service Worker context.

**❌ Wrong:**
```typescript
await page.evaluate(() => chrome.storage.sync.set({ ... })); // Throws Error
```

**✅ Correct:**
```typescript
const worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
await worker.evaluate(() => chrome.storage.sync.set({ ... }));
// RELOAD page after changing settings so content script picks them up!
await page.reload();
```

### 2.4 Precise Text Selection
`click({ clickCount: 3 })` often selects the whole paragraph. Use the **JS Selection API** to strictly select the target word.

```typescript
await page.evaluate(() => {
    const el = document.getElementById('target-word');
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
});
// Trigger the extension's mouseup handler
await page.locator('#target-word').dispatchEvent('mouseup');
```

## 3. Debugging & Logging

### 3.1 Content Script Logs (Fully Capturable)
Attach listeners immediately after creating the page.
```typescript
page.on('console', msg => console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`));
page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));
```

### 3.2 Background Logs (NOT Capturable in Console)
**Limitation**: Playwright cannot capture `console.log` from MV3 Service Workers in Chrome/Edge channels.
- **Workaround**: Rely on Content Script logs. The content script logs the full request/response payloads exchanged with the background.
- **Status check**: You CAN capture `worker.on('close')` to detect crashes/restarts.

## 4. Helper Functions Reference

### `waitForExtensionServiceWorker`
```typescript
async function waitForExtensionServiceWorker(context: any): Promise<string> {
    const startTime = Date.now();
    while (Date.now() - startTime < 15000) {
        const worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
        if (worker) return worker.url();
        await new Promise(r => setTimeout(r, 500));
    }
    return '';
}
```

## 5. HTML Fixtures
- Store fixtures in `tests/html/`.
- Use **`<span id="target-word">`** to wrap test targets for precise selection.
- Use `createLocalHtmlServer()` to serve them (file:// protocol is often restricted).

## 6. Common Pitfalls Checklist
- [ ] Did you reload the page after changing `chrome.storage`?
- [ ] Did you use `test.setTimeout(120_000)` for long tests?
- [ ] Did you close the `context` in a `finally` block?
- [ ] Are you using clipped screenshots (`screenshot({ clip: ... })`) to avoid viewport scrolling issues?