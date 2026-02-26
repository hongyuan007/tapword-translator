import * as http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';

// Constants
const EXTENSION_DIST_PATH = path.resolve(process.cwd(), 'dist');
const MANIFEST_PATH = path.join(EXTENSION_DIST_PATH, 'manifest.json');
const TEST_HTML_DIRECTORY = path.resolve(process.cwd(), 'tests/html');
const TEST_PAGE_FILE_NAME = 'issue-14-dark-mode.html';
const LOCAL_HOST = '127.0.0.1';
const DEFAULT_BROWSER_CHANNEL = 'msedge';
const BROWSER_CHANNEL_ENV_KEY = 'PW_EXTENSION_CHANNEL';
const EXTENSION_LOAD_TIMEOUT_MS = 15_000;
const POLLING_INTERVAL_MS = 500;
const EXTENSION_ENABLED_FLAGS = [
    '--enable-unsafe-extension-debugging',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--disable-extensions-except=' + EXTENSION_DIST_PATH,
    '--load-extension=' + EXTENSION_DIST_PATH,
];

// Helper to start local server
async function createLocalHtmlServer() {
    return new Promise<{ server: http.Server, baseUrl: string }>((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            const fileName = req.url === '/' ? TEST_PAGE_FILE_NAME : req.url!.substring(1);
            const filePath = path.join(TEST_HTML_DIRECTORY, fileName);
            try {
                const content = await fs.readFile(filePath);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(content);
            } catch (err) {
                console.error(`Failed to serve ${fileName}:`, err);
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        server.listen(0, LOCAL_HOST, () => {
            const address = server.address();
            if (typeof address === 'object' && address) {
                resolve({
                    baseUrl: `http://${LOCAL_HOST}:${address.port}`,
                    server,
                });
            } else {
                reject(new Error('Failed to get server address'));
            }
        });
    });
}

async function waitForExtensionServiceWorker(context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>): Promise<string> {
    const startTime = Date.now();
    while (Date.now() - startTime < EXTENSION_LOAD_TIMEOUT_MS) {
        const serviceWorkers = context.serviceWorkers();
        const extensionServiceWorker = serviceWorkers.find((worker) => worker.url().startsWith('chrome-extension://'));
        if (extensionServiceWorker) {
            return extensionServiceWorker.url();
        }
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
    }
    return '';
}

test('Issue #14: Dark mode translation visibility', async () => {
    // 1. Setup
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tapword-e2e-dark-mode-'));
    const { server, baseUrl } = await createLocalHtmlServer();
    
    try {
        const browserChannel = process.env[BROWSER_CHANNEL_ENV_KEY] ?? DEFAULT_BROWSER_CHANNEL;
        // 2. Launch browser with extension
        const context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            channel: browserChannel,
            args: EXTENSION_ENABLED_FLAGS,
        });

        const page = await context.newPage();

        // Listen to console logs
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

        // 3. Wait for extension to initialize (Crucial step from SKILL.md)
        console.log('Waiting for extension service worker...');
        const swUrl = await waitForExtensionServiceWorker(context);
        console.log(`Extension service worker found at: ${swUrl}`);
        if (!swUrl) {
            const workers = context.serviceWorkers();
            console.log('Current service workers:', workers.map(w => w.url()));
            throw new Error('Extension service worker not found within timeout');
        }
        await page.waitForTimeout(2000); // Wait a bit more for initialization within SW

        // 4. Navigate to test page
        await page.goto(baseUrl);

        // 5. Interact: Select text to trigger translation
        // We select the word "dark" in the paragraph
        const paragraph = page.locator('#test-paragraph');
        await paragraph.dblclick({ position: { x: 50, y: 10 } }); // Rough double click to select a word
        
        // Alternatively, robust text selection:
        await page.evaluate(() => {
            const p = document.getElementById('test-paragraph');
            if (p) {
                const range = document.createRange();
                range.selectNodeContents(p); // Select all text in paragraph
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
                // Trigger mouseup to simulate end of selection
                p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            }
        });

        // 6. Wait for translation popup
        console.log('Waiting for tooltip...');
        const tooltip = page.locator('.ai-translator-tooltip');
        try {
            await expect(tooltip).toBeVisible({ timeout: 5000 });
            console.log('Tooltip visible!');
        } catch (e) {
            console.log('Tooltip NOT visible. Dumping body HTML snippet:');
            const bodyHtml = await page.innerHTML('body');
            console.log(bodyHtml.substring(0, 500)); // First 500 chars
            throw e;
        }
        
        // Check computed style
        const color = await tooltip.evaluate((el) => {
            return window.getComputedStyle(el).color;
        });
        console.log(`Tooltip computed color: ${color}`);

        // 7. Capture Screenshot
        const screenshotPath = path.resolve(process.cwd(), 'tests/e2e/screenshots/issue-14-dark-mode.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Screenshot saved to: ${screenshotPath}`);

        // 8. Visual Assertion (Optional/Manual verification)
        // In a real automated test, we'd check computed styles.
        // For reproduction, the screenshot is key.

    } finally {
        server.close();
        // context.close() is handled by test runner teardown usually, but good practice
    }
});
test('Issue #14: Live Site Reproduction - Nuxt Docs', async () => {
    test.setTimeout(120_000);

    // 1. Setup
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tapword-e2e-dark-mode-live-'));
    let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;
    // Note: We don't need createLocalHtmlServer here as we are testing a live site
    
    try {
        const browserChannel = process.env[BROWSER_CHANNEL_ENV_KEY] ?? DEFAULT_BROWSER_CHANNEL;
        // 2. Launch browser with extension
        context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            channel: browserChannel,
            args: EXTENSION_ENABLED_FLAGS,
        });

        const page = await context.newPage();

        // Listen to console logs
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

        // 3. Wait for extension to initialize
        console.log('Waiting for extension service worker...');
        const swUrl = await waitForExtensionServiceWorker(context);
        console.log(`Extension service worker found at: ${swUrl}`);
        if (!swUrl) {
            const workers = context.serviceWorkers();
            console.log('Current service workers:', workers.map(w => w.url()));
            throw new Error('Extension service worker not found within timeout');
        }
        await page.waitForTimeout(2000); 

        // 4. Navigate to live site with retry
        const targetUrl = 'https://nuxt.com/docs/4.x/getting-started/introduction';
        console.log(`Navigating to ${targetUrl}...`);
        
        // Simple retry logic for navigation
        for (let i = 0; i < 3; i++) {
            try {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                break;
            } catch (e) {
                console.log(`Navigation attempt ${i+1} failed: ${e}`);
                if (i === 2) throw e;
                await page.waitForTimeout(2000);
            }
        }
        
        // Wait a bit for full load and hydration
        await page.waitForTimeout(3000);

        // Screenshot initial state
        const initialScreenshotPath = path.resolve(process.cwd(), 'tests/e2e/screenshots/issue-14-live-initial.png');
        await page.screenshot({ path: initialScreenshotPath });
        console.log(`Initial screenshot saved to: ${initialScreenshotPath}`);

        // 5. Interact: Find specific text "intuitive" in the body text (which is a link/colored text)
        // This targets the specific case shown in the user screenshot where colored link text fails.
        // We use a robust text selection on the body content.
        
        console.log('Searching for target text "intuitive"...');
        const targetLocator = page.getByText('intuitive', { exact: false }).first();
        
        // Wait for it to be visible and scroll to it
        await expect(targetLocator).toBeVisible();
        await targetLocator.scrollIntoViewIfNeeded();
        // Add a bit of offset to scroll to make sure it's not at the very edge
        await page.evaluate(() => window.scrollBy(0, -100));
        await page.waitForTimeout(500);
        
        // Use evaluate to select the specific word node more reliably than dblclick on complex elements
        await targetLocator.evaluate((el) => {
            // Find the text node containing "intuitive"
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let node = walker.nextNode();
            while (node) {
                if (node.textContent && node.textContent.includes('intuitive')) {
                    const range = document.createRange();
                    const start = node.textContent.indexOf('intuitive');
                    range.setStart(node, start);
                    range.setEnd(node, start + 'intuitive'.length);
                    const selection = window.getSelection();
                    selection?.removeAllRanges();
                    selection?.addRange(range);
                    // Trigger mouseup to simulate user selection end
                    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    return;
                }
                node = walker.nextNode();
            }
        });

        // 6. Wait for translation trigger (Icon or Tooltip)
        console.log('Waiting for translation trigger...');
        const icon = page.locator('.ai-translator-icon');
        const tooltip = page.locator('.ai-translator-tooltip');
        
        // Wait for either icon or tooltip. Usually icon appears first for selection.
        try {
            await Promise.race([
                expect(icon).toBeVisible({ timeout: 5000 }),
                expect(tooltip).toBeVisible({ timeout: 5000 })
            ]);
        } catch (e) {
            console.log('Neither icon nor tooltip appeared immediately.');
        }

        if (await icon.isVisible()) {
            console.log('Icon visible, clicking it...');
            await icon.click();
        } else {
            console.log('Icon not visible, checking if tooltip is already there...');
        }

        // 7. Wait for translation popup and verify
        console.log('Waiting for tooltip...');
        await expect(tooltip).toBeVisible({ timeout: 12_000 });
        console.log('Tooltip visible!');

        const anchor = page.locator('.ai-translator-anchor').last();
        await expect(anchor).toBeVisible({ timeout: 12_000 });

        // Re-center anchor + tooltip right before screenshots.
        // Some pages auto-scroll during async rendering, which can move tooltip out of viewport.
        await page.evaluate(() => {
            const anchorElement = document.querySelector('.ai-translator-anchor:last-of-type') as HTMLElement | null;
            const tooltipElement = document.querySelector('.ai-translator-tooltip') as HTMLElement | null;
            if (!anchorElement || !tooltipElement) {
                return;
            }

            const anchorRect = anchorElement.getBoundingClientRect();
            const tooltipRect = tooltipElement.getBoundingClientRect();

            const top = Math.min(anchorRect.top, tooltipRect.top);
            const bottom = Math.max(anchorRect.bottom, tooltipRect.bottom);
            const currentCenterY = (top + bottom) / 2;
            const viewportCenterY = window.innerHeight / 2;
            const deltaY = currentCenterY - viewportCenterY;

            window.scrollBy({ top: deltaY, left: 0, behavior: 'instant' as ScrollBehavior });
        });

        await page.waitForTimeout(200);

        // Check computed style
        const color = await tooltip.evaluate((el) => {
            return window.getComputedStyle(el).color;
        });
        console.log(`Tooltip computed color on live site: ${color}`);

        // Capture focused screenshots first (more reliable for visual proof)
        const tooltipScreenshotPath = path.resolve(process.cwd(), 'tests/e2e/screenshots/issue-14-live-tooltip.png');
        await tooltip.screenshot({ path: tooltipScreenshotPath });

        const clipRect = await page.evaluate(() => {
            const anchorElement = document.querySelector('.ai-translator-anchor:last-of-type') as HTMLElement | null;
            const tooltipElement = document.querySelector('.ai-translator-tooltip') as HTMLElement | null;
            if (!anchorElement || !tooltipElement) {
                return null;
            }

            const a = anchorElement.getBoundingClientRect();
            const t = tooltipElement.getBoundingClientRect();
            const padding = 20;

            const left = Math.min(a.left, t.left) - padding;
            const top = Math.min(a.top, t.top) - padding;
            const right = Math.max(a.right, t.right) + padding;
            const bottom = Math.max(a.bottom, t.bottom) + padding;

            return {
                x: Math.max(0, left + window.scrollX),
                y: Math.max(0, top + window.scrollY),
                width: Math.max(1, right - left),
                height: Math.max(1, bottom - top),
            };
        });

        if (clipRect) {
            const contextClipPath = path.resolve(process.cwd(), 'tests/e2e/screenshots/issue-14-live-context-clip.png');
            await page.screenshot({ path: contextClipPath, clip: clipRect });
            console.log(`Context clip screenshot saved to: ${contextClipPath}`);
        }

        const focusedScreenshotPath = path.resolve(process.cwd(), 'tests/e2e/screenshots/issue-14-live-reproduction-focused.png');
        await page.screenshot({ path: focusedScreenshotPath });

        // Capture viewport reproduction image (faster and stable)
        const screenshotPath = path.resolve(process.cwd(), 'tests/e2e/screenshots/issue-14-live-reproduction.png');
        await page.screenshot({ path: screenshotPath });

        console.log(`Reproduction screenshot saved to: ${screenshotPath}`);
        console.log(`Tooltip screenshot saved to: ${tooltipScreenshotPath}`);

    } finally {
        if (context) {
            await context.close();
        }
    }
});
