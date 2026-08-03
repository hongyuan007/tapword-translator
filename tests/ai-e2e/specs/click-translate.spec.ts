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
const TRANSLATION_WAIT_MS = 15_000;

// ---------------------------------------------------------------------------
// Test 1: Double-click translation on fixture page
// ---------------------------------------------------------------------------

test('fixture: double-click triggers word translation', async () => {
    test.setTimeout(90_000);

    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();
    const fixtureServer = await createFixtureServer(FIXTURES_DIR);

    try {
        await waitForExtensionServiceWorker(context);

        const page = await context.newPage();
        page.on('console', (msg) => console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`));

        await page.goto(`${fixtureServer.baseUrl}/click-translate.html`, {
            waitUntil: 'domcontentloaded',
        });

        await waitForContentScript(page);
        await page.waitForTimeout(1000);

        // Ensure only double-click translation mode is enabled (mutual exclusion)
        await page.evaluate(async () => {
            const csp = (window as any).chrome?.storage?.sync;
            if (csp) {
                await csp.set({
                    singleClickTranslate: false,
                    doubleClickTranslateV2: true,
                });
                console.log('[E2E] doubleClickTranslateV2=true, singleClickTranslate=false');
            }
        });
        await page.waitForTimeout(500);

        await captureScreenshot(page, OUTPUT_DIR, 'dblclick-before', { fullPage: true });

        // Double-click on "extraordinary"
        const targetWord = page.locator('text=extraordinary');
        await targetWord.dblclick();

        await page.waitForTimeout(TRANSLATION_WAIT_MS);

        await captureScreenshot(page, OUTPUT_DIR, 'dblclick-after', { fullPage: true });
    } finally {
        await closeExtensionContext({ context, userDataDir });
        await closeFixtureServer(fixtureServer);
    }
});

// ---------------------------------------------------------------------------
// Test 2: Single-click translation — inject a span around target word, then click its center
// ---------------------------------------------------------------------------

test('fixture: single-click triggers word translation', async () => {
    test.setTimeout(90_000);

    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();
    const fixtureServer = await createFixtureServer(FIXTURES_DIR);

    try {
        await waitForExtensionServiceWorker(context);

        const page = await context.newPage();
        page.on('console', (msg) => console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`));

        await page.goto(`${fixtureServer.baseUrl}/click-translate.html`, {
            waitUntil: 'domcontentloaded',
        });

        await waitForContentScript(page);
        await page.waitForTimeout(1000);

        // Ensure only single-click translation mode is enabled (mutual exclusion)
        await page.evaluate(async () => {
            const csp = (window as any).chrome?.storage?.sync;
            if (csp) {
                await csp.set({
                    singleClickTranslate: true,
                    doubleClickTranslateV2: false,
                });
                console.log('[E2E] singleClickTranslate=true, doubleClickTranslateV2=false');
            }
        });
        await page.waitForTimeout(500);

        await captureScreenshot(page, OUTPUT_DIR, 'single-click-before', { fullPage: true });

        // Wrap "quality" in a span with ID so we can get exact coordinates
        const coords = await page.evaluate(() => {
            // Find the text node containing "quality" and wrap it
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const node = walker.currentNode;
                const text = node.textContent || '';
                const idx = text.indexOf('quality');
                if (idx >= 0 && node.parentElement) {
                    const range = document.createRange();
                    range.setStart(node, idx);
                    range.setEnd(node, idx + 'quality'.length);
                    const rect = range.getBoundingClientRect();
                    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                }
            }
            return null;
        });

        console.log('Quality word coords:', coords);
        expect(coords).not.toBeNull();

        // Click at the exact center of "quality"
        await page.mouse.click(coords.x, coords.y);

        await page.waitForTimeout(TRANSLATION_WAIT_MS);

        await captureScreenshot(page, OUTPUT_DIR, 'single-click-after', { fullPage: true });
    } finally {
        await closeExtensionContext({ context, userDataDir });
        await closeFixtureServer(fixtureServer);
    }
});

// ---------------------------------------------------------------------------
// Test 3: Real page double-click on wikipedia
// ---------------------------------------------------------------------------

test('real: double-click on wikipedia.org', async () => {
    test.setTimeout(120_000);
    test.slow();

    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();

    try {
        await waitForExtensionServiceWorker(context);

        const page = await context.newPage();
        page.on('console', (msg) => console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`));

        await page.goto('https://en.wikipedia.org/wiki/Language', {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
        });
        await waitForContentScript(page);
        await page.waitForTimeout(2000);

        await captureScreenshot(page, OUTPUT_DIR, 'real-dblclick-before', { fullPage: true });

        // Double-click on first paragraph
        const firstPara = page.locator('p').first();
        await firstPara.dblclick();

        await page.waitForTimeout(TRANSLATION_WAIT_MS);

        await captureScreenshot(page, OUTPUT_DIR, 'real-dblclick-after', { fullPage: true });
    } finally {
        await closeExtensionContext({ context, userDataDir });
    }
});
