/**
 * @file issue-35-repro-real-site.spec.ts
 *
 * Visual reproduction test for GitHub Issue #35:
 * On the OpenAI Codex docs page, the floating tooltip drifts upward
 * as the page scrolls (body-scroll layout, window.scrollY stays 0).
 *
 * This test opens the **real** OpenAI Codex docs page, selects "extra
 * instructions" from the subtitle, waits for the translation annotation to
 * appear, then scrolls incrementally and takes screenshots at each step so
 * the drift can be observed visually.
 *
 * Unlike issue-35-scroll-drift.spec.ts (which uses local fixtures and
 * hard-asserts on drift thresholds), this spec is intentionally a
 * **no-assertion reproduction** — it exists to capture screenshots that
 * confirm the bug is present before a fix is applied.
 *
 * NOTE: This test is skipped by default because it depends on a live
 * external website and has no assertions. Run it explicitly with:
 *   RUN_REAL_SITE_TESTS=1 npm run test:e2e:headed -- tests/e2e/specs/issue-35-repro-real-site.spec.ts
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXTENSION_DIST_PATH = path.resolve(process.cwd(), 'dist');
const MANIFEST_PATH       = path.join(EXTENSION_DIST_PATH, 'manifest.json');

const DEFAULT_BROWSER_CHANNEL = 'msedge';
const BROWSER_CHANNEL_ENV_KEY = 'PW_EXTENSION_CHANNEL';

const EXTENSION_LOAD_TIMEOUT_MS = 15_000;
const POLLING_INTERVAL_MS       = 500;

/** Target page — the exact URL from the bug report. */
const TARGET_URL = 'https://developers.openai.com/codex/guides/agents-md/';

/**
 * Text to search for and select on the page.
 * Taken from the page subtitle: "Give Codex extra instructions and context …"
 */
const TARGET_PHRASE = 'extra instructions';

/** Pixels to scroll on each step. */
const SCROLL_STEP_PX = 80;

/** Screenshot output directory. */
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'tests/e2e/screenshots');

const EXTENSION_FLAGS = [
    '--enable-unsafe-extension-debugging',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--disable-extensions-except=' + EXTENSION_DIST_PATH,
    '--load-extension='            + EXTENSION_DIST_PATH,
    '--lang=zh-CN',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForServiceWorker(
    ctx: Awaited<ReturnType<typeof chromium.launchPersistentContext>>
): Promise<string> {
    const deadline = Date.now() + EXTENSION_LOAD_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const sw = ctx.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
        if (sw) return sw.url();
        await new Promise(r => setTimeout(r, POLLING_INTERVAL_MS));
    }
    return '';
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.setTimeout(120_000);

const RUN_REAL_SITE = !!process.env['RUN_REAL_SITE_TESTS'];
test.skip(!RUN_REAL_SITE, 'Skipped by default (live external site, no assertions). Set RUN_REAL_SITE_TESTS=1 to run.');

test('Issue #35 [real site]: screenshot tooltip drift on openai.com/codex docs', async () => {
    // Verify the extension dist exists before launching the browser
    await fs.access(MANIFEST_PATH);
    // Ensure screenshot directory exists (Playwright does not create it automatically)
    await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

    const channel     = process.env[BROWSER_CHANNEL_ENV_KEY] ?? DEFAULT_BROWSER_CHANNEL;
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tapword-e2e-35-real-'));

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        channel,
        args: EXTENSION_FLAGS,
        locale: 'zh-CN',
        viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();
    page.on('console', m => console.log(`[PAGE ${m.type()}] ${m.text()}`));
    page.on('pageerror', e => console.log(`[PAGE ERROR] ${e.message}`));

    try {
        // 1. Extension service worker must be up
        const swUrl = await waitForServiceWorker(context);
        console.log(`[repro] service worker: ${swUrl}`);

        // 2. Navigate to the real docs page
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

        // 3. Wait for the content script to inject its CSS variable
        await page.waitForFunction(() => {
            const val = getComputedStyle(document.documentElement)
                .getPropertyValue('--ai-translator-underline-offset');
            return val.trim() !== '';
        }, null, { timeout: 10_000 });

        // 4. Give the background service a moment to fully initialise
        await page.waitForTimeout(800);

        // 5. Find the first word of the target phrase ("extra") in the page,
        //    get its viewport-relative bounding rect, and use page.mouse.click()
        //    to produce a trusted click event. This triggers handleSingleClick()
        //    in the extension (singleClickTranslate: true path).
        const clickPoint = await page.evaluate((phrase) => {
            const firstWord = phrase.split(' ')[0]; // "extra"

            function findTextNode(root: Node, text: string): { node: Text; index: number } | null {
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                let node: Node | null;
                while ((node = walker.nextNode())) {
                    const idx = (node as Text).nodeValue?.indexOf(text) ?? -1;
                    if (idx !== -1) return { node: node as Text, index: idx };
                }
                return null;
            }

            const result = findTextNode(document.body, phrase);
            if (!result) return null;

            // Create a range over just the first word so we get a tight bounding rect
            const range = document.createRange();
            range.setStart(result.node, result.index);
            range.setEnd(result.node, result.index + firstWord.length);
            const rect = range.getBoundingClientRect();

            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }, TARGET_PHRASE);

        if (!clickPoint) {
            console.warn(`[repro] Could not find "${TARGET_PHRASE}" on the page. Taking a fallback screenshot.`);
            await page.screenshot({ path: `${SCREENSHOT_DIR}/issue-35-real-fallback.png` });
            return;
        }

        console.log(`[repro] Clicking "${TARGET_PHRASE}" at (${clickPoint.x.toFixed(0)}, ${clickPoint.y.toFixed(0)})`);

        // 6. Physical mouse click — creates a trusted event that handleSingleClick accepts
        await page.mouse.click(clickPoint.x, clickPoint.y);

        // 7. Wait for a tooltip to appear (loading or completed state)
        const tooltip = page.locator('.ai-translator-tooltip').first();
        const tooltipVisible = await tooltip.isVisible({ timeout: 10_000 }).catch(() => false);

        if (!tooltipVisible) {
            console.warn('[repro] Tooltip did not appear. Taking a fallback screenshot.');
            await page.screenshot({ path: `${SCREENSHOT_DIR}/issue-35-real-no-tooltip.png` });
            return;
        }

        // 8. Wait for the loading state to complete
        const loading = page.locator('.ai-translator-tooltip.loading, .ai-translator-loading');
        if (await loading.count() > 0) {
            console.log('[repro] Waiting for translation to finish…');
            await loading.waitFor({ state: 'hidden', timeout: 20_000 });
        }
        await page.waitForTimeout(300);

        // 9. Screenshot: initial state (translation visible, no scroll yet)
        await page.screenshot({
            path: `${SCREENSHOT_DIR}/issue-35-real-step-0-initial.png`,
            fullPage: false,
        });
        console.log('[repro] Screenshot 0: initial state saved');

        // 10. Scroll down in steps and take a screenshot after each step.
        //     The real OpenAI docs page uses an inner container scroll, so
        //     window.scrollBy() has no effect. page.mouse.wheel() fires a
        //     wheel event that the browser dispatches to the correct element.
        for (let step = 1; step <= 5; step++) {
            await page.mouse.wheel(0, SCROLL_STEP_PX);
            await page.waitForTimeout(300);

            await page.screenshot({
                path: `${SCREENSHOT_DIR}/issue-35-real-step-${step}-scroll${step * SCROLL_STEP_PX}px.png`,
                fullPage: false,
            });
            console.log(`[repro] Screenshot ${step}: after scrolling ${step * SCROLL_STEP_PX}px`);
        }

        console.log('[repro] All screenshots saved to', SCREENSHOT_DIR);

    } finally {
        await context.close();
        await fs.rm(userDataDir, { recursive: true, force: true });
    }
});
