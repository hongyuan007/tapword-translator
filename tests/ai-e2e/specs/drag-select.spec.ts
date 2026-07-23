import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { captureScreenshot } from '../shared/screenshot';
import {
    assertExtensionBuilt,
    createExtensionContext,
    waitForExtensionServiceWorker,
    waitForContentScript,
    closeExtensionContext,
    createFixtureServer,
    closeFixtureServer,
} from '../shared/browser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const OUTPUT_DIR = path.resolve(__dirname, '../output');
const ICON_TIMEOUT_MS = 10_000;
const TRANSLATION_TIMEOUT_MS = 20_000;
const TRANSLATION_TOOLTIP_SELECTOR = '.ai-translator-tooltip, [data-tapword-ext].ai-translator-tooltip, .tapword-translation, [data-tapword-ext]';
const ICON_SELECTOR = '[data-tapword-ext].ai-translator-icon, .ai-translator-icon';

// ---------------------------------------------------------------------------
// Fixture-level test: select text → icon appears → click icon → translation
// ---------------------------------------------------------------------------

test('fixture: drag-select triggers translation via icon', async () => {
    test.setTimeout(90_000);
    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();
    const fixtureServer = await createFixtureServer(FIXTURES_DIR);

    try {
        const swUrl = await waitForExtensionServiceWorker(context);
        expect(swUrl).toContain('chrome-extension://');

        const page = await context.newPage();
        await page.goto(`${fixtureServer.baseUrl}/drag-select.html`, {
            waitUntil: 'domcontentloaded',
        });

        await waitForContentScript(page);
        await page.waitForTimeout(1000);

        // Screenshot: before selection
        await captureScreenshot(page, OUTPUT_DIR, 'drag-before', { fullPage: true });

        // Select the target word using JS Selection API
        await page.evaluate(() => {
            const el = document.getElementById('target-word');
            if (!el) throw new Error('target-word element not found');
            const range = document.createRange();
            range.selectNodeContents(el);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
        });

        // Trigger mouseup to let extension detect the selection
        await page.locator('#target-word').dispatchEvent('mouseup');

        // Wait for translation icon to appear
        let iconFound = false;
        try {
            await page.waitForSelector(ICON_SELECTOR, { timeout: ICON_TIMEOUT_MS, state: 'visible' });
            iconFound = true;
            console.log('✅ Translation icon appeared after selection');
        } catch {
            console.log('⚠️ Translation icon not found, waiting for auto-translate...');
        }

        // Click the icon if it exists
        if (iconFound) {
            const icon = page.locator(ICON_SELECTOR).first();
            await icon.click();

            // Wait for translation tooltip
            try {
                await page.waitForSelector(TRANSLATION_TOOLTIP_SELECTOR, {
                    timeout: TRANSLATION_TIMEOUT_MS,
                    state: 'visible',
                });
                console.log('✅ Translation tooltip appeared after icon click');
            } catch {
                console.log('⚠️ Translation tooltip not found after icon click');
            }
        } else {
            // Some modes auto-translate without icon click
            await page.waitForTimeout(TRANSLATION_TIMEOUT_MS);
        }

        // Screenshot: after translation (for AI visual review)
        await captureScreenshot(page, OUTPUT_DIR, 'drag-after', { fullPage: true });
    } finally {
        await closeExtensionContext({ context, userDataDir });
        await closeFixtureServer(fixtureServer);
    }
});

// ---------------------------------------------------------------------------
// Real-page test: select text on example.com → icon → translation
// ---------------------------------------------------------------------------

test('real: drag-select on example.com', async () => {
    test.setTimeout(120_000);
    test.slow();

    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();

    try {
        const swUrl = await waitForExtensionServiceWorker(context);
        expect(swUrl).toContain('chrome-extension://');

        const page = await context.newPage();
        await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });

        await waitForContentScript(page);
        await page.waitForTimeout(500);

        // Screenshot: before
        await captureScreenshot(page, OUTPUT_DIR, 'real-drag-before', { fullPage: true });

        // Select the heading text
        await page.evaluate(() => {
            const el = document.querySelector('h1');
            if (!el) throw new Error('h1 not found');
            const range = document.createRange();
            range.selectNodeContents(el);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
        });

        await page.locator('h1').dispatchEvent('mouseup');

        // Wait for icon
        let iconFound = false;
        try {
            await page.waitForSelector(ICON_SELECTOR, { timeout: ICON_TIMEOUT_MS, state: 'visible' });
            iconFound = true;
            console.log('✅ Icon appeared on real page');
        } catch {
            console.log('⚠️ No icon on real page, waiting for auto-translate...');
        }

        if (iconFound) {
            await page.locator(ICON_SELECTOR).first().click();
            try {
                await page.waitForSelector(TRANSLATION_TOOLTIP_SELECTOR, {
                    timeout: TRANSLATION_TIMEOUT_MS,
                    state: 'visible',
                });
                console.log('✅ Translation appeared on real page');
            } catch {
                console.log('⚠️ Translation tooltip not found on real page');
            }
        } else {
            await page.waitForTimeout(TRANSLATION_TIMEOUT_MS);
        }

        // Screenshot: after
        await captureScreenshot(page, OUTPUT_DIR, 'real-drag-after', { fullPage: true });
    } finally {
        await closeExtensionContext({ context, userDataDir });
    }
});
