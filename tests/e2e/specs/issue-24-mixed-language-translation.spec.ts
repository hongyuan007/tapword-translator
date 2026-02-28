/**
 * E2E Reproduction Test – Issue #24
 *
 * BUG: On mixed Chinese/English pages, selecting an English word produces an
 * English translation instead of Chinese.
 *
 * ROOT CAUSE HYPOTHESIS:
 *   getSurroundingTextForDetection() returns the surrounding Chinese block text,
 *   which causes detectSourceLanguageAsync() to report "zh" as the source.
 *   resolveTargetLanguage("zh", "zh") then sees source == target and applies
 *   the zh→en fallback, so the target becomes "en" – wrong result.
 *
 * EXPECTED BEHAVIOR:
 *   Translating the English word "performance" inside a Chinese paragraph
 *   should produce a Chinese translation (output contains CJK characters).
 *
 * HOW TO RUN:
 *   npm run test:e2e:headed -- tests/e2e/specs/issue-24-mixed-language-translation.spec.ts
 */

import * as http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium, expect, test } from '@playwright/test';

// ─── Constants ───────────────────────────────────────────────────────────────

const EXTENSION_DIST_PATH = path.resolve(process.cwd(), 'dist');
const MANIFEST_PATH = path.join(EXTENSION_DIST_PATH, 'manifest.json');
const TEST_HTML_DIRECTORY = path.resolve(process.cwd(), 'tests/html');
const FIXTURE_FILE = 'issue-24-mixed-language.html';
const LOCAL_HOST = '127.0.0.1';

const DEFAULT_BROWSER_CHANNEL = 'msedge';
const BROWSER_CHANNEL_ENV_KEY = 'PW_EXTENSION_CHANNEL';

const EXTENSION_LOAD_TIMEOUT_MS = 15_000;
const POLLING_INTERVAL_MS = 500;
const TRANSLATION_TIMEOUT_MS = 15_000;

// CJK Unicode ranges used to verify that the output contains Chinese characters.
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf]/;

const EXTENSION_ENABLED_FLAGS = [
    '--enable-unsafe-extension-debugging',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--disable-extensions-except=' + EXTENSION_DIST_PATH,
    '--load-extension=' + EXTENSION_DIST_PATH,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

type LocalServerHandle = { baseUrl: string; server: http.Server };

async function createLocalHtmlServer(): Promise<LocalServerHandle> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            const filePath = path.join(
                TEST_HTML_DIRECTORY,
                req.url === '/' ? FIXTURE_FILE : req.url!.substring(1),
            );
            try {
                const content = await fs.readFile(filePath);
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(content);
            } catch {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        server.listen(0, LOCAL_HOST, () => {
            const address = server.address();
            if (typeof address === 'object' && address) {
                resolve({ baseUrl: `http://${LOCAL_HOST}:${address.port}`, server });
            } else {
                reject(new Error('Failed to get server address'));
            }
        });
    });
}

function closeLocalHtmlServer(server: http.Server): Promise<void> {
    return new Promise((resolve) => server.close(() => resolve()));
}

async function waitForExtensionServiceWorker(
    context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
): Promise<string> {
    const deadline = Date.now() + EXTENSION_LOAD_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const sw = context
            .serviceWorkers()
            .find((w) => w.url().startsWith('chrome-extension://'));
        if (sw) return sw.url();
        await new Promise((r) => setTimeout(r, POLLING_INTERVAL_MS));
    }
    return '';
}

// ─── Test ────────────────────────────────────────────────────────────────────

test('Issue #24: English word on Chinese page should produce Chinese translation', async () => {
    // Verify a built extension exists
    await expect(async () => fs.access(MANIFEST_PATH)).not.toThrow();

    const browserChannel = process.env[BROWSER_CHANNEL_ENV_KEY] ?? DEFAULT_BROWSER_CHANNEL;
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tapword-issue24-'));
    const localServer = await createLocalHtmlServer();

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        channel: browserChannel,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: [...EXTENSION_ENABLED_FLAGS, '--lang=zh-CN'],
        locale: 'zh-CN', // Force Chinese locale so extension defaults targetLanguage to 'zh'
    });

    // ── Attach SW log listeners immediately after launch ────────────────────
    // Must be done BEFORE waitForExtensionServiceWorker so we don't miss early log events.
    const attachSwListeners = (worker: any) => {
        worker.on('console', (msg: any) =>
            console.log(`[SW ${msg.type().toUpperCase()}] ${msg.text()}`),
        );
        worker.on('close', () => console.log('[SW STATUS] Worker closed'));
    };
    // Attach to any already-running workers (spawned during launch)
    context.serviceWorkers().forEach(attachSwListeners);
    // Attach to any future workers (restarts / updates)
    context.on('serviceworker', attachSwListeners);

    // Close any welcome/update page that might interfere
    context.on('page', async (page) => {
        try {
            await page.waitForLoadState('domcontentloaded');
            if (page.url().includes('update_v0_4_0.html')) {
                console.log(`[Setup] Closing welcome page: ${page.url()}`);
                await page.close();
            }
        } catch {
            // Ignore – page may close too fast
        }
    });

    try {
        // ── Wait for extension service worker ───────────────────────────────
        const swUrl = await waitForExtensionServiceWorker(context);
        expect(swUrl, 'Extension service worker should be running').toContain('chrome-extension://');
        console.log(`[Setup] Service Worker URL: ${swUrl}`);
        // Also attach to the confirmed SW directly (in case it was missed by the early forEach)
        const confirmedSw = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
        if (confirmedSw) attachSwListeners(confirmedSw);

        // ── Open the mixed-language fixture page ────────────────────────────
        const page = await context.newPage();

        // Capture content-script logs (they appear as page console messages)
        page.on('console', (msg) => console.log(`[PAGE ${msg.type().toUpperCase()}] ${msg.text()}`));
        page.on('pageerror', (err) => console.log(`[PAGE ERROR] ${err.message}`));

        const pageUrl = `${localServer.baseUrl}/${FIXTURE_FILE}`;
        console.log(`[Setup] Navigating to: ${pageUrl}`);
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });

        // Wait for the content script to inject its CSS variable (signals init)
        await page.waitForFunction(
            () => {
                const val = getComputedStyle(document.documentElement).getPropertyValue(
                    '--ai-translator-underline-offset',
                );
                return val && val.trim() !== '';
            },
            null,
            { timeout: 8_000 },
        );
        console.log('[Setup] Content script initialised.');

        // Give background services a moment to finish auth/API init
        await page.waitForTimeout(1_000);

        // ── Pre-seed user settings: set targetLanguage to "zh" ─────────────
        // Without this, a fresh English-locale browser defaults to targetLanguage:"en",
        // masking the real bug (which only surfaces when the user wants Chinese output).
        // chrome.storage is only accessible from an extension context, so we call it
        // through the service worker instead of from the test page.
        const serviceWorker = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
        expect(serviceWorker, 'Service worker must be available to seed storage').toBeTruthy();
        await serviceWorker!.evaluate(() => {
            return new Promise<void>((resolve) => {
                chrome.storage.sync.get(null, (current) => {
                    chrome.storage.sync.set({ ...current, targetLanguage: 'zh' }, () => resolve());
                });
            });
        });
        console.log('[Setup] targetLanguage pre-seeded to "zh" via service worker.');

        // Reload so the content script re-reads the updated setting from storage
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
            () => {
                const val = getComputedStyle(document.documentElement).getPropertyValue(
                    '--ai-translator-underline-offset',
                );
                return val && val.trim() !== '';
            },
            null,
            { timeout: 8_000 },
        );
        await page.waitForTimeout(500);
        console.log('[Setup] Page reloaded with targetLanguage:"zh" setting active.');

        // ── Select the target English word via JS Selection API ─────────────
        // We use JavaScript to set the Selection precisely to the text inside
        // #target-word so that no surrounding Chinese text is included.
        // This avoids the triple-click "paragraph expansion" problem.
        await page.evaluate(() => {
            const span = document.getElementById('target-word')!;
            const textNode = span.firstChild!;
            const range = document.createRange();
            range.setStart(textNode, 0);
            range.setEnd(textNode, textNode.textContent!.length);
            const sel = window.getSelection()!;
            sel.removeAllRanges();
            sel.addRange(range);
        });
        // Fire a mouseup on the span to trigger the content script's selection handler
        const targetSpan = page.locator('#target-word');
        await expect(targetSpan).toBeVisible();
        await targetSpan.dispatchEvent('mouseup');
        console.log('[Test] Programmatically selected "performance" and fired mouseup');

        // ── Wait for the translation icon to appear ────────────────────────
        const translationIcon = page.locator('.ai-translator-icon');
        await expect(translationIcon).toBeVisible({ timeout: 5_000 });
        console.log('[Test] Translation icon visible, clicking it…');

        // ── Click the icon to trigger translation ─────────────────────────
        await translationIcon.click();

        // ── Wait for the tooltip / modal to appear ─────────────────────────
        const translationUI = page.locator('.ai-translator-modal, .ai-translator-tooltip');
        await expect(translationUI.first()).toBeVisible({ timeout: TRANSLATION_TIMEOUT_MS });

        // ── Wait for loading state to disappear ───────────────────────────
        const loadingIndicator = page.locator(
            '.ai-translator-loading, .ai-translator-tooltip.loading',
        );
        if ((await loadingIndicator.count()) > 0) {
            console.log('[Test] Waiting for loading indicator to disappear…');
            await expect(loadingIndicator).toHaveCount(0, { timeout: TRANSLATION_TIMEOUT_MS });
        }

        await page.waitForTimeout(500); // brief buffer for UI update after loading

        // ── Assert the translation contains Chinese characters ─────────────
        const translationText = await translationUI.first().textContent();
        console.log(`[Test] Translation UI text: "${translationText}"`);

        // Screenshot for visual inspection
        const screenshotDir = path.resolve(process.cwd(), 'tests/e2e/screenshots');
        await fs.mkdir(screenshotDir, { recursive: true });
        const screenshotPath = path.join(screenshotDir, 'issue-24-result.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[Test] Screenshot saved: ${screenshotPath}`);

        // KEY ASSERTION: the tooltip should contain at least one Chinese character.
        // If the bug is present it will contain only English text and this will fail.
        expect(
            CJK_REGEX.test(translationText ?? ''),
            `Expected Chinese characters in translation output, but got: "${translationText}"`,
        ).toBe(true);

    } finally {
        await context.close();
        await closeLocalHtmlServer(localServer.server);
        await fs.rm(userDataDir, { recursive: true, force: true });
    }
});
