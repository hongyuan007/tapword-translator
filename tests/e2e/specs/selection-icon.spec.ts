import * as http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium, expect, test } from '@playwright/test';

const EXTENSION_DIST_PATH = path.resolve(process.cwd(), 'dist');
const MANIFEST_PATH = path.join(EXTENSION_DIST_PATH, 'manifest.json');
const TEST_HTML_DIRECTORY = path.resolve(process.cwd(), 'tests/html');
const TEST_PAGE_FILE_NAME = 'test_page.html';
const LOCAL_HOST = '127.0.0.1';
const DEFAULT_BROWSER_CHANNEL = 'msedge';
const BROWSER_CHANNEL_ENV_KEY = 'PW_EXTENSION_CHANNEL';
const EXTENSION_LOAD_TIMEOUT_MS = 15_000;
const POLLING_INTERVAL_MS = 500;
const ICON_VISIBLE_TIMEOUT_MS = 8_000;
const EXTENSION_ENABLED_FLAGS = [
    '--enable-unsafe-extension-debugging',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--disable-extensions-except=' + EXTENSION_DIST_PATH,
    '--load-extension=' + EXTENSION_DIST_PATH,
];

// Helper to generate a unique test ID
const generateTestId = () => {
    const now = new Date();
    return `test-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
};

type LocalServerHandle = {
    server: http.Server;
    baseUrl: string;
};

async function createLocalHtmlServer(): Promise<LocalServerHandle> {
    const htmlContent = await fs.readFile(path.join(TEST_HTML_DIRECTORY, TEST_PAGE_FILE_NAME), 'utf8');

    const server = http.createServer((request, response) => {
        const requestPath = request.url ?? '/';
        if (requestPath === '/' || requestPath === `/${TEST_PAGE_FILE_NAME}`) {
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(htmlContent);
            return;
        }

        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not Found');
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, LOCAL_HOST, () => {
            server.off('error', reject);
            resolve();
        });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve local server address');
    }

    return {
        server,
        baseUrl: `http://${LOCAL_HOST}:${address.port}`,
    };
}

async function closeLocalHtmlServer(server: http.Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
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

test('shows translation icon after selecting text on local test page', async () => {
    const testId = generateTestId();
    console.log(`Running test with ID: ${testId}`);

    await expect(async () => {
        await fs.access(MANIFEST_PATH);
    }).not.toThrow();

    const browserChannel = process.env[BROWSER_CHANNEL_ENV_KEY] ?? DEFAULT_BROWSER_CHANNEL;
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tapword-e2e-'));
    const localServer = await createLocalHtmlServer();

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        channel: browserChannel,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: EXTENSION_ENABLED_FLAGS,
    });

    // Close welcome/update page if it appears to avoid test interference
    context.on('page', async (page) => {
        try {
            await page.waitForLoadState('domcontentloaded');
            if (page.url().includes('update_v0_4_0.html')) {
                console.log(`Closing welcome page: ${page.url()}`);
                await page.close();
            }
        } catch (e) {
            // Ignore errors if page closes too fast
        }
    });

    try {
        const extensionServiceWorkerUrl = await waitForExtensionServiceWorker(context);
        expect(extensionServiceWorkerUrl).toContain('chrome-extension://');

        const page = await context.newPage();

        await page.goto(`${localServer.baseUrl}/${TEST_PAGE_FILE_NAME}`, { waitUntil: 'domcontentloaded' });

        // Wait for content script to initialize by checking for injected CSS variables
        await page.waitForFunction(() => {
            const val = getComputedStyle(document.documentElement).getPropertyValue('--ai-translator-underline-offset');
            return val && val.trim() !== '';
        }, null, { timeout: 5000 });

        const selectionApplied = await page.evaluate(() => {
            const targetElement = document.querySelector('.highlight-es');
            if (!targetElement || !targetElement.firstChild) {
                return false;
            }

            const range = document.createRange();
            range.selectNodeContents(targetElement);

            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);

            const rect = range.getBoundingClientRect();
            const mouseupEvent = new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2,
            });

            targetElement.dispatchEvent(mouseupEvent);
            document.dispatchEvent(mouseupEvent);
            return true;
        });

        expect(selectionApplied).toBe(true);

        const translationIcon = page.locator('.ai-translator-icon.visible').first();
        await expect(translationIcon).toBeVisible({ timeout: ICON_VISIBLE_TIMEOUT_MS });
        
        // Take a screenshot with unique ID
        const screenshotPath = path.resolve(process.cwd(), `tests/e2e/screenshots/${testId}-1.png`);
        await page.screenshot({ path: screenshotPath });
        console.log(`Screenshot saved to: ${screenshotPath}`);

    } finally {
        await context.close();
        await closeLocalHtmlServer(localServer.server);
        await fs.rm(userDataDir, { recursive: true, force: true });
    }
});
