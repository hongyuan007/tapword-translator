import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium, expect, test } from '@playwright/test';

const EXTENSION_DIST_PATH = path.resolve(process.cwd(), 'dist');
const MANIFEST_PATH = path.join(EXTENSION_DIST_PATH, 'manifest.json');
const EXTENSION_ENABLED_FLAGS = [
    '--enable-unsafe-extension-debugging',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--disable-extensions-except=' + EXTENSION_DIST_PATH,
    '--load-extension=' + EXTENSION_DIST_PATH,
];
const DEFAULT_BROWSER_CHANNEL = 'msedge';
const BROWSER_CHANNEL_ENV_KEY = 'PW_EXTENSION_CHANNEL';
const EXTENSION_PAGE_WAIT_MS = 3_000;
const EXTENSION_LOAD_TIMEOUT_MS = 15_000;
const POLLING_INTERVAL_MS = 500;

function getExtensionsPageUrl(browserChannel: string): string {
    if (browserChannel === 'msedge') {
        return 'edge://extensions/';
    }
    return 'chrome://extensions/';
}

test('loads unpacked extension in persistent Chrome context', async () => {
    await expect(async () => {
        await fs.access(MANIFEST_PATH);
    }).not.toThrow();

    const browserChannel = process.env[BROWSER_CHANNEL_ENV_KEY] ?? DEFAULT_BROWSER_CHANNEL;
    const extensionsPageUrl = getExtensionsPageUrl(browserChannel);
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tapword-e2e-'));

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        channel: browserChannel,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: EXTENSION_ENABLED_FLAGS,
    });

    try {
        let extensionServiceWorkerUrl = '';
        const startTime = Date.now();

        while (Date.now() - startTime < EXTENSION_LOAD_TIMEOUT_MS) {
            const serviceWorkers = context.serviceWorkers();
            const matchedServiceWorker = serviceWorkers.find((worker) => worker.url().startsWith('chrome-extension://'));
            if (matchedServiceWorker) {
                extensionServiceWorkerUrl = matchedServiceWorker.url();
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
        }

        expect(extensionServiceWorkerUrl).toContain('chrome-extension://');

        const page = await context.newPage();
        await page.goto(extensionsPageUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(EXTENSION_PAGE_WAIT_MS);

        await expect(page).toHaveURL(extensionsPageUrl);

        if (browserChannel === 'chrome') {
            const loadedExtensionsCount = await page.evaluate(() => {
                const manager = document.querySelector('extensions-manager');
                const managerRoot = manager?.shadowRoot;
                const list = managerRoot?.querySelector('extensions-item-list')?.shadowRoot;
                return list?.querySelectorAll('extensions-item').length ?? 0;
            });
            expect(loadedExtensionsCount).toBeGreaterThan(0);
        }
    } finally {
        await context.close();
        await fs.rm(userDataDir, { recursive: true, force: true });
    }
});
