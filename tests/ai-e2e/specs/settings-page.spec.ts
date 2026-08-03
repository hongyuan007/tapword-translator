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
const OPTIONS_PATH = 'src/4_options/index.html';

// Settings page navigation tabs — matching data-section values in options.html
const SETTINGS_SECTIONS = [
    { id: 'general-settings', label: 'General' },
    { id: 'appearance-settings', label: 'Appearance' },
    { id: 'translation-engine-settings', label: 'Translation Engine' },
    { id: 'display-settings', label: 'Text' },
    { id: 'audio-settings', label: 'Audio' },
    { id: 'advanced-settings', label: 'Advanced' },
];

// ---------------------------------------------------------------------------
// Test 1: Settings page — all sections render correctly
// ---------------------------------------------------------------------------

test('settings: all sections render with controls', async () => {
    test.setTimeout(90_000);

    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();

    try {
        const swUrl = await waitForExtensionServiceWorker(context);
        const extensionId = swUrl.match(/chrome-extension:\/\/([^/]+)/)?.[1];
        expect(extensionId, 'Extension ID should be extractable').toBeTruthy();

        const page = await context.newPage();
        page.on('console', (msg) => console.log(`[SETTINGS ${msg.type().toUpperCase()}] ${msg.text()}`));

        await page.goto(`chrome-extension://${extensionId}/${OPTIONS_PATH}`, {
            waitUntil: 'domcontentloaded',
        });

        await page.waitForTimeout(3000);

        // Assert nav items exist (fast-fail if page is blank)
        const navCount = await page.locator('.nav-item').count();
        expect(navCount, 'Settings page should have navigation items').toBeGreaterThanOrEqual(SETTINGS_SECTIONS.length);

        // Screenshot: initial state
        await captureScreenshot(page, OUTPUT_DIR, 'settings-general', { fullPage: true });

        // Iterate through each settings section
        for (const section of SETTINGS_SECTIONS) {
            const navItem = page.locator(`[data-section="${section.id}"]`).first();
            await navItem.click();
            await page.waitForTimeout(1500);
            await captureScreenshot(page, OUTPUT_DIR, `settings-${section.id}`, { fullPage: true });
            console.log(`✅ Captured ${section.label} section`);
        }
    } finally {
        await closeExtensionContext({ context, userDataDir });
    }
});

// ---------------------------------------------------------------------------
// Test 2: Settings page — General section controls are interactive
// ---------------------------------------------------------------------------

test('settings: General section shows all trigger options', async () => {
    test.setTimeout(60_000);

    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();

    try {
        const swUrl = await waitForExtensionServiceWorker(context);
        const extensionId = swUrl.match(/chrome-extension:\/\/([^/]+)/)?.[1];
        expect(extensionId, 'Extension ID should be extractable').toBeTruthy();

        const page = await context.newPage();
        page.on('console', (msg) => console.log(`[SETTINGS ${msg.type().toUpperCase()}] ${msg.text()}`));

        await page.goto(`chrome-extension://${extensionId}/${OPTIONS_PATH}`, {
            waitUntil: 'domcontentloaded',
        });

        await page.waitForTimeout(3000);

        // Navigate to General section
        await page.locator('[data-section="general-settings"]').click();
        await page.waitForTimeout(1000);

        // Assert checkboxes exist in General section (fast-fail)
        const checkboxes = page.locator('input[type="checkbox"]');
        const checkboxCount = await checkboxes.count();
        expect(checkboxCount, 'General section should have configuration checkboxes').toBeGreaterThan(0);
        console.log(`Found ${checkboxCount} checkboxes in General section`);

        await captureScreenshot(page, OUTPUT_DIR, 'settings-general-controls', { fullPage: true });
    } finally {
        await closeExtensionContext({ context, userDataDir });
    }
});
