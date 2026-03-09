/**
 * @file issue-35-scroll-drift.spec.ts
 *
 * Reproduction test for GitHub Issue #35:
 * "codex文档网页，悬浮翻译会随着页面滑动发生漂移"
 *
 * The tooltip should stay precisely below its anchor text after any amount of
 * scrolling.  Two page structures are covered:
 *
 *   1. Window scroll   — body has `overflow-x: hidden`; the window itself scrolls.
 *                        Mirrors developers.openai.com layout.
 *   2. Container scroll — html/body are `overflow: hidden`; a child div scrolls.
 *                        Mirrors many SPA / Next.js docs layouts.
 *
 * In both cases we:
 *   a. Trigger a word translation (double-click → loading tooltip appears immediately).
 *   b. Record the gap between tooltip.top and anchor.bottom.
 *   c. Scroll incrementally (3 steps of 200 px each).
 *   d. After each step assert the gap has not drifted by more than DRIFT_THRESHOLD_PX.
 */

import * as http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium, expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXTENSION_DIST_PATH = path.resolve(process.cwd(), 'dist');
const MANIFEST_PATH      = path.join(EXTENSION_DIST_PATH, 'manifest.json');
const TEST_HTML_DIR      = path.resolve(process.cwd(), 'tests/html');
const LOCAL_HOST         = '127.0.0.1';

const DEFAULT_BROWSER_CHANNEL  = 'msedge';
const BROWSER_CHANNEL_ENV_KEY  = 'PW_EXTENSION_CHANNEL';
const EXTENSION_LOAD_TIMEOUT   = 15_000;
const POLLING_INTERVAL_MS      = 500;

/**
 * Maximum allowed vertical drift (px) between the gap measured before and after
 * each incremental scroll. A value larger than this indicates the tooltip is no
 * longer correctly tracking its anchor.
 */
const DRIFT_THRESHOLD_PX = 5;

/** How far (px) to scroll on each incremental step. */
const SCROLL_STEP_PX = 200;

/** Number of scroll steps to perform. */
const SCROLL_STEPS = 3;

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

type LocalServer = { baseUrl: string; server: http.Server };

async function createLocalServer(): Promise<LocalServer> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            const name     = req.url === '/' ? 'test_page.html' : req.url!.slice(1);
            const filePath = path.join(TEST_HTML_DIR, name);
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
            const addr = server.address();
            if (typeof addr === 'object' && addr) {
                resolve({ baseUrl: `http://${LOCAL_HOST}:${addr.port}`, server });
            } else {
                reject(new Error('Failed to bind server'));
            }
        });
    });
}

function closeServer(server: http.Server): Promise<void> {
    return new Promise(r => server.close(() => r()));
}

async function waitForServiceWorker(
    ctx: Awaited<ReturnType<typeof chromium.launchPersistentContext>>
): Promise<string> {
    const deadline = Date.now() + EXTENSION_LOAD_TIMEOUT;
    while (Date.now() < deadline) {
        const sw = ctx.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
        if (sw) return sw.url();
        await new Promise(r => setTimeout(r, POLLING_INTERVAL_MS));
    }
    return '';
}

// ---------------------------------------------------------------------------
// Shared test logic
// ---------------------------------------------------------------------------

interface DriftMeasurement {
    /** Viewport-relative rect of the first .ai-translator-anchor element. */
    anchorRect:  { top: number; bottom: number; left: number; right: number };
    /** Viewport-relative rect of the first .ai-translator-tooltip element. */
    tooltipRect: { top: number; bottom: number; left: number; right: number };
    /** tooltip.top - anchor.bottom  (should be ~verticalOffset ≈ 2 px). */
    verticalGap: number;
    /** Horizontal distance between tooltip centre and anchor centre. */
    horizontalDelta: number;
    /** Current window.scrollY at the time of measurement. */
    windowScrollY: number;
    /** scrollTop of the inner scroll container (0 for window-scroll pages). */
    containerScrollTop: number;
}

/**
 * Measure anchor ↔ tooltip spatial relationship in a single evaluate call.
 * Returns `null` if either element is missing from the DOM.
 */
async function measure(
    page: import('@playwright/test').Page,
    containerSelector: string | null = null
): Promise<DriftMeasurement | null> {
    return page.evaluate((sel) => {
        const anchor  = document.querySelector('.ai-translator-anchor') as HTMLElement | null;
        const tooltip = document.querySelector('.ai-translator-tooltip') as HTMLElement | null;
        if (!anchor || !tooltip) return null;

        const ar = anchor.getBoundingClientRect();
        const tr = tooltip.getBoundingClientRect();

        const container = sel ? (document.querySelector(sel) as HTMLElement | null) : null;

        return {
            anchorRect:         { top: ar.top, bottom: ar.bottom, left: ar.left, right: ar.right },
            tooltipRect:        { top: tr.top, bottom: tr.bottom, left: tr.left, right: tr.right },
            verticalGap:        tr.top - ar.bottom,
            horizontalDelta:    (tr.left + tr.right) / 2 - (ar.left + ar.right) / 2,
            windowScrollY:      window.scrollY,
            containerScrollTop: container ? container.scrollTop : 0,
        };
    }, containerSelector);
}

/**
 * Core drift test.  Navigates to `htmlFile`, triggers a word translation,
 * then scrolls `scrollSteps × scrollStepPx` pixels using `scrollFn`.
 * After each step the gap between tooltip and anchor must not deviate from
 * the initial gap by more than `DRIFT_THRESHOLD_PX`.
 */
async function runDriftTest(options: {
    page:            import('@playwright/test').Page;
    baseUrl:         string;
    htmlFile:        string;
    /**
     * JS expression evaluated once to bring the target word near the centre of
     * the viewport before translation is triggered.
     * e.g. `window.scrollTo(0, 300)`
     */
    initialScrollExpression: string;
    /** JS expression that scrolls one step during the drift check loop. */
    scrollExpression: string;
    /** CSS selector of the scroll container (for scrollTop reporting only). */
    containerSelector: string | null;
    screenshotPrefix: string;
}): Promise<void> {
    const { page, baseUrl, htmlFile, initialScrollExpression, scrollExpression, containerSelector, screenshotPrefix } = options;

    // Navigate
    await page.goto(`${baseUrl}/${htmlFile}`, { waitUntil: 'domcontentloaded' });

    // Wait for the content script to inject its CSS variable
    await page.waitForFunction(() => {
        const val = getComputedStyle(document.documentElement)
            .getPropertyValue('--ai-translator-underline-offset');
        return val.trim() !== '';
    }, null, { timeout: 8_000 });

    // Give background service a moment to fully initialise
    await page.waitForTimeout(500);

    // Scroll the page so the target word is near the middle of the viewport
    await page.evaluate((expr) => { (0, eval)(expr); }, initialScrollExpression);
    await page.waitForTimeout(80);

    // Single-click the target word — triggers the tapWord translation directly
    // (singleClickTranslate is true by default, so no icon step is needed)
    await page.locator('#target-word').click();

    // Wait for ANY tooltip to appear (loading, error, or success state)
    const tooltip = page.locator('.ai-translator-tooltip').first();
    await expect(tooltip).toBeVisible({ timeout: 8_000 });

    // ---------- Baseline measurement ----------
    const baseline = await measure(page, containerSelector);
    expect(baseline, 'Baseline measurement must succeed').not.toBeNull();

    console.log(`[${screenshotPrefix}] baseline:`, JSON.stringify(baseline));
    await page.screenshot({
        path: `tests/e2e/screenshots/${screenshotPrefix}-step-0.png`,
        fullPage: false,
    });

    // ---------- Incremental scroll + drift check ----------
    for (let step = 1; step <= SCROLL_STEPS; step++) {
        await page.evaluate((expr) => { (0, eval)(expr); }, scrollExpression);
        // Wait for the extension's rAF-debounced repositioning to run
        await page.waitForTimeout(120);

        const current = await measure(page, containerSelector);
        expect(current, `Measurement at step ${step} must succeed`).not.toBeNull();

        console.log(`[${screenshotPrefix}] step ${step}:`, JSON.stringify(current));
        await page.screenshot({
            path: `tests/e2e/screenshots/${screenshotPrefix}-step-${step}.png`,
            fullPage: false,
        });

        // Core assertion: the vertical gap must not have drifted
        const drift = Math.abs(current!.verticalGap - baseline!.verticalGap);
        expect(
            drift,
            `Step ${step}: tooltip drifted ${drift.toFixed(1)} px vertically ` +
            `(gap was ${baseline!.verticalGap.toFixed(1)} px, now ${current!.verticalGap.toFixed(1)} px). ` +
            `windowScrollY=${current!.windowScrollY}, containerScrollTop=${current!.containerScrollTop}`
        ).toBeLessThanOrEqual(DRIFT_THRESHOLD_PX);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.setTimeout(120_000);

test('Issue #35 [window scroll]: tooltip stays anchored after scrolling', async () => {
    await expect(async () => fs.access(MANIFEST_PATH)).not.toThrow();

    const channel     = process.env[BROWSER_CHANNEL_ENV_KEY] ?? DEFAULT_BROWSER_CHANNEL;
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tapword-e2e-35-win-'));
    const srv         = await createLocalServer();

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        channel,
        args: EXTENSION_FLAGS,
        locale: 'zh-CN',
    });
    const page = await context.newPage();
    page.on('console', m => console.log(`[PAGE ${m.type()}] ${m.text()}`));
    page.on('pageerror', e => console.log(`[PAGE ERROR] ${e.message}`));

    try {
        const swUrl = await waitForServiceWorker(context);
        expect(swUrl, 'Service worker must be found').toContain('chrome-extension://');

        await runDriftTest({
            page,
            baseUrl:                 srv.baseUrl,
            htmlFile:                'issue-35-scroll-drift.html',
            initialScrollExpression: `window.scrollTo(0, 300)`,
            scrollExpression:        `window.scrollBy(0, ${SCROLL_STEP_PX})`,
            containerSelector:       null,
            screenshotPrefix:        'issue-35-win',
        });
    } finally {
        await context.close();
        await closeServer(srv.server);
        await fs.rm(userDataDir, { recursive: true, force: true });
    }
});

test('Issue #35 [container scroll]: tooltip stays anchored after inner-div scrolling', async () => {
    await expect(async () => fs.access(MANIFEST_PATH)).not.toThrow();

    const channel     = process.env[BROWSER_CHANNEL_ENV_KEY] ?? DEFAULT_BROWSER_CHANNEL;
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tapword-e2e-35-ctr-'));
    const srv         = await createLocalServer();

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        channel,
        args: EXTENSION_FLAGS,
        locale: 'zh-CN',
    });
    const page = await context.newPage();
    page.on('console', m => console.log(`[PAGE ${m.type()}] ${m.text()}`));
    page.on('pageerror', e => console.log(`[PAGE ERROR] ${e.message}`));

    try {
        const swUrl = await waitForServiceWorker(context);
        expect(swUrl, 'Service worker must be found').toContain('chrome-extension://');

        await runDriftTest({
            page,
            baseUrl:                 srv.baseUrl,
            htmlFile:                'issue-35-container-scroll.html',
            initialScrollExpression: `document.getElementById('scroll-container').scrollTo(0, 300)`,
            scrollExpression:        `document.getElementById('scroll-container').scrollBy(0, ${SCROLL_STEP_PX})`,
            containerSelector:       '#scroll-container',
            screenshotPrefix:        'issue-35-ctr',
        });
    } finally {
        await context.close();
        await closeServer(srv.server);
        await fs.rm(userDataDir, { recursive: true, force: true });
    }
});
