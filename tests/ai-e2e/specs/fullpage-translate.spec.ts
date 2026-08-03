import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from '@playwright/test';

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const OUTPUT_DIR = path.resolve(__dirname, '../output');
const FLOATING_BALL_SELECTOR = '.tw-fab-main';
const FLOATING_BALL_CONTAINER_SELECTOR = '.tw-fab-container';
const FLOATING_BALL_WAIT_MS = 8_000;
const TRANSLATION_WAIT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helper: enable floating ball + switch provider via service worker
// ---------------------------------------------------------------------------

async function setupFloatingBall(context: import('@playwright/test').BrowserContext): Promise<void> {
    const worker = context.serviceWorkers()[0];
    expect(worker, 'Service worker should be available').toBeTruthy();

    await worker.evaluate(async () => {
        // Enable floating ball
        await chrome.storage.local.set({
            floatingButtonConfig: {
                enabled: true,
                position: 0.66,
                disabledSites: [],
                iconVariant: 'v5',
                iconColor: '#ED6D8F',
            },
        });
        // Switch full-page provider to Microsoft Free (avoids JWT auth issues in test env)
        const syncData = await chrome.storage.sync.get('userSettings');
        const userSettings = syncData.userSettings || {};
        userSettings.fullPageTranslationProvider = 'microsoftFree';
        await chrome.storage.sync.set({ userSettings });
    });
}

// ---------------------------------------------------------------------------
// Test 1: Full-page translation on fixture page via floating ball
// ---------------------------------------------------------------------------

test('fixture: floating ball triggers full-page translation', async () => {
    test.setTimeout(120_000);

    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();
    const fixtureServer = await createFixtureServer(FIXTURES_DIR);

    try {
        await waitForExtensionServiceWorker(context);
        await setupFloatingBall(context);

        const page = await context.newPage();
        page.on('console', (msg) => console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`));

        await page.goto(`${fixtureServer.baseUrl}/fullpage-translate.html`, {
            waitUntil: 'domcontentloaded',
        });

        await waitForContentScript(page);
        await page.waitForTimeout(3000);

        // Screenshot: before full-page translation
        await captureScreenshot(page, OUTPUT_DIR, 'fullpage-before', { fullPage: true });

        // Assert floating ball is visible (fast-fail if not)
        await page.waitForSelector(FLOATING_BALL_CONTAINER_SELECTOR, {
            timeout: FLOATING_BALL_WAIT_MS,
            state: 'visible',
        });
        console.log('✅ Floating ball appeared on page');

        // Click the floating ball to trigger full-page translation
        await page.locator(FLOATING_BALL_SELECTOR).click();
        console.log('🖱️ Clicked floating ball');

        // Wait for translation to process
        await page.waitForTimeout(TRANSLATION_WAIT_MS);

        // Scroll down to trigger lazy-loaded content translation
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(5000);

        // Scroll back to top for the screenshot
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(2000);

        // Assert that translation content was injected (fast-fail if not)
        const translationBlocks = await page.locator('.tapword-translated-content-wrapper').count();
        expect(translationBlocks, 'Should have translation blocks after full-page translation').toBeGreaterThan(0);

        // Screenshot: after full-page translation
        await captureScreenshot(page, OUTPUT_DIR, 'fullpage-after', { fullPage: true });
    } finally {
        await closeExtensionContext({ context, userDataDir });
        await closeFixtureServer(fixtureServer);
    }
});

// ---------------------------------------------------------------------------
// Test 2: Full-page translation on a real page (wikipedia)
// ---------------------------------------------------------------------------

test('real: floating ball full-page translation on wikipedia.org', async () => {
    test.setTimeout(180_000);
    test.slow();

    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();

    try {
        await waitForExtensionServiceWorker(context);
        await setupFloatingBall(context);

        const page = await context.newPage();
        page.on('console', (msg) => console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`));

        await page.goto('https://en.wikipedia.org/wiki/Renewable_energy', {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });
        await waitForContentScript(page);
        await page.waitForTimeout(3000);

        // Screenshot: before
        await captureScreenshot(page, OUTPUT_DIR, 'real-fullpage-before', { fullPage: true });

        // Assert floating ball is visible (fast-fail if not)
        await page.waitForSelector(FLOATING_BALL_CONTAINER_SELECTOR, {
            timeout: FLOATING_BALL_WAIT_MS,
            state: 'visible',
        });
        console.log('✅ Floating ball appeared on wikipedia');

        // Click floating ball
        await page.locator(FLOATING_BALL_SELECTOR).click();
        console.log('🖱️ Clicked floating ball on wikipedia');

        // Wait for initial batch of translations
        await page.waitForTimeout(TRANSLATION_WAIT_MS);

        // Screenshot: after (viewport only — wikipedia full-page is too tall)
        await captureScreenshot(page, OUTPUT_DIR, 'real-fullpage-after', { fullPage: false });
    } finally {
        await closeExtensionContext({ context, userDataDir });
    }
});
