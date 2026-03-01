
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
const TRANSLATION_TIMEOUT_MS = 10_000;

const EXTENSION_ENABLED_FLAGS = [
    '--enable-unsafe-extension-debugging',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--disable-extensions-except=' + EXTENSION_DIST_PATH,
    '--load-extension=' + EXTENSION_DIST_PATH,
];

// Helper to generate a unique test ID
const generateTestId = () => {
    const now = new Date();
    return `test-single-click-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
};

type LocalServerHandle = {
    baseUrl: string;
    server: http.Server;
};

// Start a local HTTP server to serve the test page
async function createLocalHtmlServer(): Promise<LocalServerHandle> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            const filePath = path.join(TEST_HTML_DIRECTORY, req.url === '/' ? TEST_PAGE_FILE_NAME : req.url!.substring(1));
            try {
                const content = await fs.readFile(filePath);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(content);
            } catch (err) {
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

function closeLocalHtmlServer(server: http.Server): Promise<void> {
    return new Promise((resolve) => {
        server.close(() => resolve());
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

test('triggers translation popup on single click', async () => {
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
        serviceWorkers: 'block', // Experiment: block service workers to force network requests? No, extension relies on it.
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

    // Intercept Service Worker requests if possible? 
    // Playwright route on context applies to pages. 
    // Extension background requests might not be intercepted by page.route() if they originate from SW.
    // Try context.route() instead.
    await context.route('**', route => route.continue()); // Initialize routing?
    
    // REMOVED: Mock interception. We are testing against the real backend (or whatever the extension is configured to use).
    // Ensure the environment running this test has access to the internet and necessary credentials if required.

    try {
        const extensionServiceWorkerUrl = await waitForExtensionServiceWorker(context);
        expect(extensionServiceWorkerUrl).toContain('chrome-extension://');

        const page = await context.newPage();

        // Log all requests to debug missing interceptions
        page.on('request', request => console.log('>>', request.method(), request.url()));

        await page.goto(`${localServer.baseUrl}/${TEST_PAGE_FILE_NAME}`, { waitUntil: 'domcontentloaded' });

        // Wait for content script to initialize
        await page.waitForFunction(() => {
            const val = getComputedStyle(document.documentElement).getPropertyValue('--ai-translator-underline-offset');
            return val && val.trim() !== '';
        }, null, { timeout: 5000 });

        // WAIT FOR BACKGROUND SERVICES INITIALIZATION
        // The background script needs time to initialize AuthService, APIService, etc.
        // Without this, early requests fail with "API service not initialized".
        await page.waitForTimeout(500);

        // Simulate single click on a word
        // We use the first paragraph's first word for simplicity or a specific element
        // Let's click on the word "English" in the h2 tag for a clear target, 
        // or a specific word in the paragraph.
        // The test page has: <p class="highlight">This is a test ...</p>
        
        // Let's target the word "test" inside the highlight paragraph.
        // Since we can't easily click a specific text node without complex selectors, 
        // we'll rely on Playwright's text locator.
        const wordLocator = page.locator('.highlight').getByText('test', { exact: true }).first();
        // However, "This is a test paragraph" is a single text node usually.
        // We might need to click on a specific coordinate or assume the word structure.
        // A better approach for the test page might be wrapping a word in a span, 
        // but let's try clicking the center of the element first or use a text selector.
        
        // Let's click on a specific word. We'll pick "important text" which is inside a span with class "highlight"
        // The first .highlight element contains "important text"
        const targetWord = page.locator('.highlight').first();
        await targetWord.click();

        // Wait for ANY translation result UI to appear (Modal OR Tooltip)
        const translationUI = page.locator('.ai-translator-modal, .ai-translator-tooltip');
        await expect(translationUI.first()).toBeVisible({ timeout: TRANSLATION_TIMEOUT_MS });
        
        // Log what we found
        if (await page.locator('.ai-translator-modal').isVisible()) {
            console.log('Found Modal');
        } else if (await page.locator('.ai-translator-tooltip').isVisible()) {
             console.log('Found Tooltip');
        }

        // Check if the mock translation result is displayed
        // We accept either the real translation (if connected) or error/loading state
        const uiText = await translationUI.first().textContent();
        console.log(`Translation UI Content (Initial): ${uiText}`);
        
        // Assert that the UI is not empty
        expect(uiText).toBeTruthy();

        // Wait for loading state to finish (if applicable)
        // Assumption: The loading state usually has a specific class or indicator.
        // Based on css classes: .ai-translator-loading or .loading inside tooltip
        const loadingIndicator = page.locator('.ai-translator-loading, .ai-translator-tooltip.loading');
        
        if (await loadingIndicator.count() > 0) {
            console.log('Waiting for loading to finish...');
            await expect(loadingIndicator).toHaveCount(0, { timeout: 15000 });
        }
        
        // Wait a small buffer for UI update after loading disappears
        await page.waitForTimeout(500);

        // Capture final state
        const finalText = await translationUI.first().textContent();
        console.log(`Translation UI Content (Final): ${finalText}`);

        // Take a screenshot
        const screenshotPath = path.resolve(process.cwd(), `tests/e2e/screenshots/${testId}-1.png`);
        await page.screenshot({ path: screenshotPath });
        console.log(`Screenshot saved to: ${screenshotPath}`);
        
    } finally {
        await context.close();
        await closeLocalHtmlServer(localServer.server);
        await fs.rm(userDataDir, { recursive: true, force: true });
    }
});
