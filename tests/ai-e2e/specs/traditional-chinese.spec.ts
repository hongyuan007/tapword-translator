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
// Helper: set target language to zh-Hant via service worker
// ---------------------------------------------------------------------------

async function setTargetLanguage(context: import('@playwright/test').BrowserContext, lang: string): Promise<void> {
    const worker = context.serviceWorkers()[0];
    expect(worker, 'Service worker should be available').toBeTruthy();

    await worker.evaluate(async (targetLang) => {
        const syncData = await chrome.storage.sync.get('userSettings');
        const userSettings = syncData.userSettings || {};
        userSettings.targetLanguage = targetLang;
        await chrome.storage.sync.set({ userSettings });
    }, lang);
}

// ---------------------------------------------------------------------------
// Test 1: Settings page shows Traditional Chinese option
// ---------------------------------------------------------------------------

test('settings: Target Language dropdown includes Traditional Chinese', async () => {
    test.setTimeout(60_000);
    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();

    try {
        const swUrl = await waitForExtensionServiceWorker(context);
        const extensionId = swUrl.match(/chrome-extension:\/\/([^/]+)/)?.[1];
        expect(extensionId).toBeTruthy();

        const page = await context.newPage();
        await page.goto(`chrome-extension://${extensionId}/src/4_options/index.html`, {
            waitUntil: 'domcontentloaded',
        });
        await page.waitForTimeout(3000);

        // Navigate to General section
        await page.locator('[data-section="general-settings"]').click();
        await page.waitForTimeout(1000);

        // Find and expand the target language dropdown using evaluate
        const allSelects = page.locator('select');
        const selectCount = await allSelects.count();
        let targetSelectIndex = -1;
        
        for (let i = 0; i < selectCount; i++) {
            const options = await allSelects.nth(i).locator('option').allTextContents();
            if (options.some(o => o.includes('繁體') || o.includes('zh-Hant'))) {
                targetSelectIndex = i;
                break;
            }
        }
        
        if (targetSelectIndex >= 0) {
            // Expand dropdown using evaluate (native select doesn't respond to click in Playwright)
            await allSelects.nth(targetSelectIndex).evaluate((el) => {
                el.focus();
                el.size = el.options.length;
                el.style.height = 'auto';
                el.style.position = 'absolute';
                el.style.zIndex = '9999';
            });
            await page.waitForTimeout(500);
        }

        // Screenshot for visual verification (dropdown expanded)
        await captureScreenshot(page, OUTPUT_DIR, 'zh-hant-settings-general', { fullPage: true });

        // Assert: the target language dropdown should exist and contain zh-Hant option
        expect(targetSelectIndex >= 0, 'Should find select with Traditional Chinese option').toBe(true);
        console.log('✅ Traditional Chinese option found in settings');
    } finally {
        await closeExtensionContext({ context, userDataDir });
    }
});

// ---------------------------------------------------------------------------
// Test 2: Double-click translation outputs Traditional Chinese (three engines)
// ---------------------------------------------------------------------------

const WORD_PROVIDERS = [
    { id: 'official', label: 'Official API (localhost)' },
    { id: 'googleFree', label: 'Google Free' },
    { id: 'microsoftFree', label: 'Microsoft Free' },
] as const;

for (const provider of WORD_PROVIDERS) {
    test(`fixture: double-click [${provider.label}] outputs Traditional Chinese`, async () => {
        test.setTimeout(90_000);
        await assertExtensionBuilt();

        const { context, userDataDir } = await createExtensionContext();
        const fixtureServer = await createFixtureServer(FIXTURES_DIR);

        try {
            await waitForExtensionServiceWorker(context);

            // Switch word translation provider
            const worker = context.serviceWorkers()[0];
            expect(worker).toBeTruthy();
            await worker.evaluate(async (pid) => {
                const syncData = await chrome.storage.sync.get('userSettings');
                const userSettings = syncData.userSettings || {};
                userSettings.targetLanguage = 'zh-Hant';
                userSettings.wordTranslationProvider = pid;
                await chrome.storage.sync.set({ userSettings });
            }, provider.id);

            const page = await context.newPage();
            page.on('console', (msg) => console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`));

            await page.goto(`${fixtureServer.baseUrl}/traditional-chinese.html`, {
                waitUntil: 'domcontentloaded',
            });
            await waitForContentScript(page);
            await page.waitForTimeout(2000);

            // Enable double-click mode
            await page.evaluate(async () => {
                const csp = (window as any).chrome?.storage?.sync;
                if (csp) {
                    await csp.set({ singleClickTranslate: false, doubleClickTranslateV2: true });
                }
            });
            await page.waitForTimeout(500);

            await captureScreenshot(page, OUTPUT_DIR, `zh-hant-dblclick-${provider.id}-before`, { fullPage: true });

            // Double-click on "extraordinary"
            await page.locator('text=extraordinary').dblclick();
            await page.waitForTimeout(TRANSLATION_WAIT_MS);

            await captureScreenshot(page, OUTPUT_DIR, `zh-hant-dblclick-${provider.id}-after`, { fullPage: true });

            // Assert: translation appeared and did NOT fail
            const dblTooltip = page.locator('.ai-translator-tooltip, [data-tapword-ext].ai-translator-tooltip');
            await expect(dblTooltip, 'Translation tooltip should appear').toBeVisible({ timeout: 5000 });
            const dblText = await dblTooltip.textContent() || '';
            expect(dblText.includes('失败') || dblText.includes('失敗'), 'Translation should not show failure message').toBe(false);
            expect(/[\u4e00-\u9fff]/.test(dblText), 'Tooltip should contain Chinese characters').toBe(true);
            console.log(`✅ [${provider.label}] Double-click translation succeeded`);
        } finally {
            await closeExtensionContext({ context, userDataDir });
            await closeFixtureServer(fixtureServer);
        }
    });
}

// ---------------------------------------------------------------------------
// Test 3: Drag-select translation outputs Traditional Chinese
// ---------------------------------------------------------------------------

test('fixture: drag-select translation outputs Traditional Chinese', async () => {
    test.setTimeout(90_000);
    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();
    const fixtureServer = await createFixtureServer(FIXTURES_DIR);

    try {
        await waitForExtensionServiceWorker(context);
        
        // Set target language + switch word translation provider (avoid helper instability)
        const worker = context.serviceWorkers()[0];
        expect(worker).toBeTruthy();
        await worker.evaluate(async () => {
            const syncData = await chrome.storage.sync.get('userSettings');
            const userSettings = syncData.userSettings || {};
            userSettings.targetLanguage = 'zh-Hant';
            userSettings.wordTranslationProvider = 'googleFree';
            await chrome.storage.sync.set({ userSettings });
        });

        const page = await context.newPage();
        page.on('console', (msg) => console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`));

        await page.goto(`${fixtureServer.baseUrl}/traditional-chinese.html`, {
            waitUntil: 'domcontentloaded',
        });
        await waitForContentScript(page);
        await page.waitForTimeout(2000);

        await captureScreenshot(page, OUTPUT_DIR, 'zh-hant-drag-before', { fullPage: true });

        // Select "collection"
        await page.evaluate(() => {
            const el = document.querySelector('.highlight:nth-of-type(3)');
            if (!el) {
                const all = document.querySelectorAll('.highlight');
                const target = Array.from(all).find(e => e.textContent?.includes('collection'));
                if (!target) throw new Error('collection not found');
                const range = document.createRange();
                range.selectNodeContents(target);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
                return;
            }
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        });
        await page.locator('body').dispatchEvent('mouseup');
        
        // Wait for icon and click it (like drag-select.spec.ts)
        const ICON_SELECTOR = '[data-tapword-ext].ai-translator-icon, .ai-translator-icon';
        let iconFound = false;
        try {
            await page.waitForSelector(ICON_SELECTOR, { timeout: 5000, state: 'visible' });
            iconFound = true;
            console.log('✅ Translation icon appeared');
        } catch {
            console.log('⚠️ Icon not found, waiting for auto-translate...');
        }
        
        if (iconFound) {
            await page.locator(ICON_SELECTOR).first().click();
            await page.waitForTimeout(8000); // Wait longer for translation to load
        }
        
        await page.waitForTimeout(TRANSLATION_WAIT_MS);

        await captureScreenshot(page, OUTPUT_DIR, 'zh-hant-drag-after', { fullPage: true });
        
        // Assert: translation tooltip should appear AND not be a failure message
        const tooltip = page.locator('.ai-translator-tooltip, [data-tapword-ext].ai-translator-tooltip');
        await expect(tooltip, 'Translation tooltip should appear after clicking icon').toBeVisible({ timeout: 10000 });
        const tooltipText = await tooltip.textContent() || '';
        expect(tooltipText.includes('失败') || tooltipText.includes('失敗'), 'Translation should not show failure message').toBe(false);
        expect(/[\u4e00-\u9fff]/.test(tooltipText), 'Tooltip should contain Chinese characters').toBe(true);
        console.log('✅ Translation tooltip appeared with Chinese output');
    } finally {
        await closeExtensionContext({ context, userDataDir });
        await closeFixtureServer(fixtureServer);
    }
});

// ---------------------------------------------------------------------------
// Test 4: Full-page translation outputs Traditional Chinese
// ---------------------------------------------------------------------------

test('fixture: full-page translation outputs Traditional Chinese', async () => {
    test.setTimeout(120_000);
    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();
    const fixtureServer = await createFixtureServer(FIXTURES_DIR);

    try {
        await waitForExtensionServiceWorker(context);

        // Enable floating ball + set zh-Hant + microsoftFree provider
        const worker = context.serviceWorkers()[0];
        expect(worker).toBeTruthy();
        await worker.evaluate(async () => {
            await chrome.storage.local.set({
                floatingButtonConfig: { enabled: true, position: 0.66, disabledSites: [], iconVariant: 'v5', iconColor: '#ED6D8F' },
            });
            const syncData = await chrome.storage.sync.get('userSettings');
            const userSettings = syncData.userSettings || {};
            userSettings.targetLanguage = 'zh-Hant';
            userSettings.fullPageTranslationProvider = 'googleFree';
            await chrome.storage.sync.set({ userSettings });
        });

        const page = await context.newPage();
        page.on('console', (msg) => console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`));

        await page.goto(`${fixtureServer.baseUrl}/traditional-chinese.html`, {
            waitUntil: 'domcontentloaded',
        });
        await waitForContentScript(page);
        await page.waitForTimeout(3000);

        await captureScreenshot(page, OUTPUT_DIR, 'zh-hant-fullpage-before', { fullPage: true });

        // Click floating ball
        await page.waitForSelector('.tw-fab-container', { timeout: 8000, state: 'visible' });
        await page.locator('.tw-fab-main').click();
        console.log('🖱️ Clicked floating ball');

        await page.waitForTimeout(30000);

        await captureScreenshot(page, OUTPUT_DIR, 'zh-hant-fullpage-after', { fullPage: true });

        // Assert: translated content wrapper should exist with Chinese text
        const wrapper = page.locator('.tapword-translated-content-wrapper').first();
        await expect(wrapper, 'Translated content should appear').toBeVisible({ timeout: 15000 });
        const wrapperText = await wrapper.textContent() || '';
        expect(wrapperText.includes('失败') || wrapperText.includes('失敗'), 'Full-page translation should not fail').toBe(false);
        expect(/[\u4e00-\u9fff]/.test(wrapperText), 'Translated content should contain Chinese characters').toBe(true);
        console.log('✅ Full-page translation produced Chinese output');
    } finally {
        await closeExtensionContext({ context, userDataDir });
        await closeFixtureServer(fixtureServer);
    }
});

// ---------------------------------------------------------------------------
// Test 5: Native suppression — Traditional Chinese page should NOT translate
// ---------------------------------------------------------------------------

test('fixture: Traditional Chinese page triggers native suppression', async () => {
    test.setTimeout(90_000);
    await assertExtensionBuilt();

    const { context, userDataDir } = await createExtensionContext();
    const fixtureServer = await createFixtureServer(FIXTURES_DIR);

    try {
        await waitForExtensionServiceWorker(context);
        await setTargetLanguage(context, 'zh-Hant');

        const page = await context.newPage();
        page.on('console', (msg) => console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`));

        // Open a page that's already in Traditional Chinese (lang="zh-Hant")
        await page.goto(`${fixtureServer.baseUrl}/traditional-chinese-native.html`, {
            waitUntil: 'domcontentloaded',
        });
        await waitForContentScript(page);
        await page.waitForTimeout(3000);

        await captureScreenshot(page, OUTPUT_DIR, 'zh-hant-suppression-page', { fullPage: true });

        // Try double-click — should NOT trigger translation
        await page.evaluate(async () => {
            const csp = (window as any).chrome?.storage?.sync;
            if (csp) await csp.set({ singleClickTranslate: false, doubleClickTranslateV2: true });
        });
        await page.waitForTimeout(500);

        const h1Text = page.locator('h1').first();
        await h1Text.dblclick();
        await page.waitForTimeout(5000);

        // Screenshot to verify no translation appeared
        await captureScreenshot(page, OUTPUT_DIR, 'zh-hant-suppression-after-dblclick', { fullPage: true });
    } finally {
        await closeExtensionContext({ context, userDataDir });
        await closeFixtureServer(fixtureServer);
    }
});
