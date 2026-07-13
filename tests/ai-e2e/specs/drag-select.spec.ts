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
const TRANSLATION_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Fixture-level test
// ---------------------------------------------------------------------------

test('fixture: drag-select triggers translation via icon', async () => {
    test.setTimeout(60_000);
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
        await page.waitForTimeout(500); // Background services init

        // Screenshot: before selection
        const beforeShot = await captureScreenshot(page, OUTPUT_DIR, 'drag-before', {
            fullPage: true,
        });

        // Precise text selection using JS Selection API (per Skill guidelines)
        await page.evaluate(() => {
            const el = document.getElementById('target-word');
            if (!el) throw new Error('target-word element not found');
            const range = document.createRange();
            range.selectNodeContents(el);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
        });

        // Trigger the extension's mouseup handler
        await page.locator('#target-word').dispatchEvent('mouseup');

        // Wait for extension to respond (give time for icon and UI to appear)
        await page.waitForTimeout(ICON_TIMEOUT_MS + TRANSLATION_TIMEOUT_MS);

        // Click the icon to trigger translation (if icon exists)
        const icon = page.locator('[data-tapword-ext].ai-translator-icon, .ai-translator-icon');
        if (await icon.count() > 0) {
            await icon.first().click();
            await page.waitForTimeout(TRANSLATION_TIMEOUT_MS);
        }

        // Screenshot: after translation appears (will be verified by AI visual review)
        const afterShot = await captureScreenshot(page, OUTPUT_DIR, 'drag-after', {
            fullPage: true,
        });
    } finally {
        await closeExtensionContext({ context, userDataDir });
        await closeFixtureServer(fixtureServer);
    }
});

// ---------------------------------------------------------------------------
// Real-page test
// ---------------------------------------------------------------------------

test('real: drag-select on example.com', async () => {
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
        const beforeShot = await captureScreenshot(page, OUTPUT_DIR, 'real-drag-before', {
            fullPage: true,
        });

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

        // Wait for extension to respond
        await page.waitForTimeout(ICON_TIMEOUT_MS + TRANSLATION_TIMEOUT_MS);

        // Click icon if it exists
        const icon = page.locator('[data-tapword-ext].ai-translator-icon, .ai-translator-icon');
        if (await icon.count() > 0) {
            await icon.first().click();
            await page.waitForTimeout(TRANSLATION_TIMEOUT_MS);
        }

        // Screenshot: after
        const afterShotReal = await captureScreenshot(page, OUTPUT_DIR, 'real-drag-after', {
            fullPage: true,
        });
    } finally {
        await closeExtensionContext({ context, userDataDir });
    }
});
