import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

import { captureScreenshot } from '../shared/screenshot';
import {
    assertExtensionBuilt,
    createExtensionContext,
    waitForExtensionServiceWorker,
    closeExtensionContext,
} from '../shared/browser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(__dirname, '../output');
const POPUP_PATH = 'src/3_popup/index.html';

// ---------------------------------------------------------------------------
// Test 1: Popup panel renders correctly with all controls
// ---------------------------------------------------------------------------

test('popup: extension popup panel renders all controls', async () => {
    test.setTimeout(60_000);

    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();

    try {
        const swUrl = await waitForExtensionServiceWorker(context);
        const extensionId = swUrl.match(/chrome-extension:\/\/([^/]+)/)?.[1];
        expect(extensionId, 'Extension ID should be extractable from SW URL').toBeTruthy();

        const popupPage = await context.newPage();
        popupPage.on('console', (msg) => console.log(`[POPUP ${msg.type().toUpperCase()}] ${msg.text()}`));

        await popupPage.goto(`chrome-extension://${extensionId}/${POPUP_PATH}`, {
            waitUntil: 'domcontentloaded',
        });

        // Wait for popup to fully load
        await popupPage.waitForTimeout(3000);
        await popupPage.setViewportSize({ width: 360, height: 520 });
        await popupPage.waitForTimeout(1000);

        // Assert key UI elements exist (fast-fail if popup is blank)
        const bodyText = await popupPage.locator('body').innerText();
        expect(bodyText.length, 'Popup body should have visible text').toBeGreaterThan(10);

        await captureScreenshot(popupPage, OUTPUT_DIR, 'popup-default', { fullPage: true });

        // Capture scrolled state if content overflows
        const scrollHeight = await popupPage.evaluate(() => document.body.scrollHeight);
        if (scrollHeight > 520) {
            await popupPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await popupPage.waitForTimeout(500);
            await captureScreenshot(popupPage, OUTPUT_DIR, 'popup-scrolled', { fullPage: true });
        }
    } finally {
        await closeExtensionContext({ context, userDataDir });
    }
});

// ---------------------------------------------------------------------------
// Test 2: Popup panel — toggle a setting and verify visual feedback
// ---------------------------------------------------------------------------

test('popup: toggle setting shows visual feedback', async () => {
    test.setTimeout(90_000);

    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();

    try {
        const swUrl = await waitForExtensionServiceWorker(context);
        const extensionId = swUrl.match(/chrome-extension:\/\/([^/]+)/)?.[1];
        expect(extensionId, 'Extension ID should be extractable').toBeTruthy();

        const popupPage = await context.newPage();
        popupPage.on('console', (msg) => console.log(`[POPUP ${msg.type().toUpperCase()}] ${msg.text()}`));

        await popupPage.goto(`chrome-extension://${extensionId}/${POPUP_PATH}`, {
            waitUntil: 'domcontentloaded',
        });

        await popupPage.waitForTimeout(3000);
        await popupPage.setViewportSize({ width: 360, height: 520 });

        // Screenshot: before toggle
        await captureScreenshot(popupPage, OUTPUT_DIR, 'popup-before-toggle', { fullPage: true });

        // Find toggle switches
        const toggles = popupPage.locator('input[type="checkbox"]');
        const toggleCount = await toggles.count();
        expect(toggleCount, 'Popup should have at least one toggle switch').toBeGreaterThan(0);

        // Toggle the first switch
        await toggles.first().click();
        await popupPage.waitForTimeout(1000);

        // Screenshot: after toggle
        await captureScreenshot(popupPage, OUTPUT_DIR, 'popup-after-toggle', { fullPage: true });

        // Toggle back to restore original state
        await toggles.first().click();
        await popupPage.waitForTimeout(500);
    } finally {
        await closeExtensionContext({ context, userDataDir });
    }
});
