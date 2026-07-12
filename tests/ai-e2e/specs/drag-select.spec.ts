import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { captureScreenshot } from '../shared/screenshot';
import { verifyWithAI } from '../shared/ai-verifier';
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

        // Wait for the translation icon to appear
        const icon = page.locator('[data-tapword-ext].ai-translator-icon, .ai-translator-icon');
        await expect(icon.first()).toBeVisible({ timeout: ICON_TIMEOUT_MS });

        // Click the icon to trigger translation
        await icon.first().click();

        // Wait for translation UI
        const translationUI = page.locator('.ai-translator-modal, .ai-translator-tooltip');
        await expect(translationUI.first()).toBeVisible({ timeout: TRANSLATION_TIMEOUT_MS });

        // Screenshot: after translation appears
        const afterShot = await captureScreenshot(page, OUTPUT_DIR, 'drag-after', {
            fullPage: true,
        });

        // AI verification
        const result = await verifyWithAI({
            scenario: 'drag-select',
            operation: 'Select a word via JS Selection API, click the floating translation icon',
            expectedBehavior:
                'A translation icon should appear near the selected text. After clicking it, a translation modal or tooltip should show the Chinese translation.',
            screenshots: [beforeShot, afterShot],
        });

        expect(result.passed, result.reason).toBe(true);
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

        // Wait for icon
        const icon = page.locator('[data-tapword-ext].ai-translator-icon, .ai-translator-icon');
        await expect(icon.first()).toBeVisible({ timeout: ICON_TIMEOUT_MS });

        await icon.first().click();

        const translationUI = page.locator('.ai-translator-modal, .ai-translator-tooltip');
        await expect(translationUI.first()).toBeVisible({ timeout: TRANSLATION_TIMEOUT_MS });

        // Screenshot: after
        const afterShot = await captureScreenshot(page, OUTPUT_DIR, 'real-drag-after', {
            fullPage: true,
        });

        const result = await verifyWithAI({
            scenario: 'drag-select',
            operation: 'Select heading text on example.com, click translation icon',
            expectedBehavior:
                'Translation icon appears after selection. Clicking shows Chinese translation in a modal or tooltip.',
            screenshots: [beforeShot, afterShot],
        });

        expect(result.passed, result.reason).toBe(true);
    } finally {
        await closeExtensionContext({ context, userDataDir });
    }
});
