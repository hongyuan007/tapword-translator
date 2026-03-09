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

### 2.4 Triggering Translation

The extension has **two independent trigger paths**, and the correct approach depends on which one is active:

#### Path A — `singleClickTranslate` (default ON): click a word directly
This is the most reliable path for tests. The extension's `handleSingleClick` handler listens for trusted `click` events and detects the word at the cursor position automatically.

**For local HTML fixtures** (word wrapped in `<span id="target-word">`):
```typescript
await page.locator('#target-word').click(); // trusted click → handleSingleClick fires
```

**For real websites** (no `id` wrapper available), find the text node's bounding rect first:
```typescript
const clickPoint = await page.evaluate((phrase) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
        const idx = (node as Text).nodeValue?.indexOf(phrase) ?? -1;
        if (idx !== -1) {
            const range = document.createRange();
            range.setStart(node as Text, idx);
            range.setEnd(node as Text, idx + phrase.split(' ')[0].length); // click the first word
            const r = range.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
    }
    return null;
}, 'target phrase');

if (clickPoint) {
    await page.mouse.click(clickPoint.x, clickPoint.y); // trusted physical click
}
```

> **Why not `page.evaluate(() => el.dispatchEvent(new MouseEvent('click',...)))`?**
> Events created with `new MouseEvent()` in the browser have `isTrusted === false`. The extension's click handler does NOT explicitly check `isTrusted`, but `page.locator.dispatchEvent()` and inline `element.dispatchEvent()` create synthetic events. Using `page.mouse.click()` or `page.locator().click()` always produces trusted events and is the safe choice.

#### Path B — Icon flow (drag selection → click icon)
When `showIcon: true` and `singleClickTranslate: false`, the user must drag-select text first and then click the floating icon.

Use `page.mouse` for a trusted drag — do **NOT** use the JS Selection API + synthetic `mouseup`, because the async `handleTextSelection` handler may read an already-collapsed selection:

```typescript
// Get start/end coordinates of the text span
const box = await page.locator('#target-word').boundingBox();
await page.mouse.move(box!.x, box!.y + box!.height / 2);
await page.mouse.down();
await page.mouse.move(box!.x + box!.width, box!.y + box!.height / 2);
await page.mouse.up(); // trusted mouseup → handleTextSelection fires

// Wait for icon, then click it
const icon = page.locator('.ai-translator-icon').first();
await expect(icon).toBeVisible({ timeout: 5_000 });
await icon.click();
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

## 6. Scrolling in Tests

Different pages use different scroll models. A naive `window.scrollBy()` will silently do nothing on sites where only an inner container scrolls (e.g. OpenAI docs, many Next.js / SPA layouts where `html` and `body` have `overflow: hidden`).

**Universal approach — use `page.mouse.wheel()`:**
```typescript
// Works for both window scroll AND inner-container scroll
await page.mouse.wheel(0, 200); // scroll 200px down
await page.waitForTimeout(120); // let extension's rAF-debounced repositioning run
```

**When `window.scrollBy()` is appropriate** (only for pages you fully control, e.g. local HTML fixtures where `body` is the scroll root):
```typescript
await page.evaluate(() => window.scrollBy(0, 200));
```

**When scrolling an explicit container** (local fixtures like `issue-35-container-scroll.html`):
```typescript
await page.evaluate(() =>
    document.getElementById('scroll-container')!.scrollBy(0, 200)
);
```

> **Scroll amount matters for tooltip drift tests**: Use small steps (≤ 100 px) so the anchor element stays inside the viewport. Large steps (300 px+) will push the anchor off-screen, making drift impossible to observe visually.

## 7. Common Pitfalls Checklist
- [ ] Did you reload the page after changing `chrome.storage`?
- [ ] Did you use `test.setTimeout(120_000)` for long tests?
- [ ] Did you close the `context` in a `finally` block?
- [ ] Are you using clipped screenshots (`screenshot({ clip: ... })`) to avoid viewport scrolling issues?
- [ ] Are you using `page.mouse.click()` or `page.locator().click()` (trusted events) instead of `element.dispatchEvent()` (untrusted, unreliable)?
- [ ] For scroll tests on real or SPA sites, are you using `page.mouse.wheel()` instead of `window.scrollBy()`?
- [ ] Is your scroll step small enough (≤ 100 px) to keep the anchor element in the viewport?