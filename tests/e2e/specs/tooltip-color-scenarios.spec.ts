import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { chromium, expect, test, type Locator, type Page } from '@playwright/test';

const EXTENSION_DIST_PATH = path.resolve(process.cwd(), 'dist');
const MANIFEST_PATH = path.join(EXTENSION_DIST_PATH, 'manifest.json');
const TEST_HTML_DIRECTORY = path.resolve(process.cwd(), 'tests/html');
const TEST_PAGE_FILE_NAME = 'tooltip-color-scenarios.html';
const SCREENSHOT_DIRECTORY = path.resolve(process.cwd(), 'tests/e2e/screenshots');

const LOCAL_HOST = '127.0.0.1';
const DEFAULT_BROWSER_CHANNEL = 'msedge';
const BROWSER_CHANNEL_ENV_KEY = 'PW_EXTENSION_CHANNEL';
const EXTENSION_LOAD_TIMEOUT_MS = 15_000;
const POLLING_INTERVAL_MS = 500;

const BLACK_TEXT_COLOR = 'rgb(0, 0, 0)';
const WHITE_TEXT_COLOR = 'rgb(255, 255, 255)';

const EXTENSION_ENABLED_FLAGS = [
    '--enable-unsafe-extension-debugging',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--disable-extensions-except=' + EXTENSION_DIST_PATH,
    '--load-extension=' + EXTENSION_DIST_PATH,
];

type LocalServerHandle = {
    baseUrl: string;
    server: http.Server;
};

type ColorScenario = {
    id: string;
    description: string;
    selector: string;
    expectedColor: string;
};

const COLOR_SCENARIOS: ColorScenario[] = [
    {
        id: 'light-on-light',
        description: 'Light background should choose black tooltip text',
        selector: '#case-light-on-light',
        expectedColor: BLACK_TEXT_COLOR,
    },
    {
        id: 'light-text-on-dark',
        description: 'Dark background should choose white tooltip text',
        selector: '#case-light-text-on-dark',
        expectedColor: WHITE_TEXT_COLOR,
    },
    {
        id: 'dark-root-light-card',
        description: 'Dark root with white card should keep black tooltip text',
        selector: '#case-dark-root-light-card',
        expectedColor: BLACK_TEXT_COLOR,
    },
    {
        id: 'transparent-dark-fallback',
        description: 'Transparent tree in dark scheme should fallback to white tooltip text',
        selector: '#case-transparent-dark-fallback',
        expectedColor: WHITE_TEXT_COLOR,
    },
];

function createRunId(): string {
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    return `tooltip-color-${timestamp}`;
}

async function createLocalHtmlServer(): Promise<LocalServerHandle> {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            const fileName = req.url === '/' ? TEST_PAGE_FILE_NAME : req.url!.substring(1);
            const filePath = path.join(TEST_HTML_DIRECTORY, fileName);

            try {
                const content = await fs.readFile(filePath);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(content);
            } catch (error) {
                console.error(`Failed to serve ${fileName}:`, error);
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
                return;
            }

            reject(new Error('Failed to get local server address'));
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

async function selectScenarioText(page: Page, selector: string): Promise<void> {
    const target = page.locator(selector);
    await expect(target).toBeVisible({ timeout: 10_000 });
    await target.scrollIntoViewIfNeeded();

    await target.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);

        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    });
}

async function openTooltip(page: Page): Promise<Locator> {
    const icon = page.locator('.ai-translator-icon');
    const tooltip = page.locator('.ai-translator-tooltip');

    await Promise.race([
        expect(icon).toBeVisible({ timeout: 8_000 }),
        expect(tooltip).toBeVisible({ timeout: 8_000 }),
    ]);

    if (await icon.isVisible()) {
        await icon.click();
    }

    await expect(tooltip).toBeVisible({ timeout: 12_000 });
    return tooltip;
}

async function saveScenarioScreenshot(
    page: Page,
    scenario: ColorScenario,
    runId: string,
): Promise<string> {
    const screenshotPath = path.join(SCREENSHOT_DIRECTORY, `${runId}-${scenario.id}.png`);

    const clipRect = await page.evaluate((targetSelector) => {
        const targetElement = document.querySelector(targetSelector) as HTMLElement | null;
        const tooltipElement = document.querySelector('.ai-translator-tooltip') as HTMLElement | null;

        if (!targetElement || !tooltipElement) {
            return null;
        }

        const targetRect = targetElement.getBoundingClientRect();
        const tooltipRect = tooltipElement.getBoundingClientRect();
        const padding = 20;

        const left = Math.min(targetRect.left, tooltipRect.left) - padding;
        const top = Math.min(targetRect.top, tooltipRect.top) - padding;
        const right = Math.max(targetRect.right, tooltipRect.right) + padding;
        const bottom = Math.max(targetRect.bottom, tooltipRect.bottom) + padding;

        return {
            x: Math.max(0, left + window.scrollX),
            y: Math.max(0, top + window.scrollY),
            width: Math.max(1, right - left),
            height: Math.max(1, bottom - top),
        };
    }, scenario.selector);

    if (clipRect) {
        await page.screenshot({ path: screenshotPath, clip: clipRect });
    } else {
        await page.screenshot({ path: screenshotPath });
    }

    return screenshotPath;
}

test('Tooltip color chooses high-contrast text in multiple scenarios', async () => {
    test.setTimeout(180_000);

    await expect(async () => {
        await fs.access(MANIFEST_PATH);
    }).not.toThrow();

    await fs.mkdir(SCREENSHOT_DIRECTORY, { recursive: true });

    const runId = createRunId();
    const browserChannel = process.env[BROWSER_CHANNEL_ENV_KEY] ?? DEFAULT_BROWSER_CHANNEL;
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tapword-e2e-tooltip-color-'));
    const localServer = await createLocalHtmlServer();

    let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;

    try {
        context = await chromium.launchPersistentContext(userDataDir, {
            headless: false,
            channel: browserChannel,
            args: EXTENSION_ENABLED_FLAGS,
        });

        const page = await context.newPage();
        page.on('console', (message) => console.log('PAGE LOG:', message.text()));
        page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message));

        const extensionServiceWorkerUrl = await waitForExtensionServiceWorker(context);
        expect(extensionServiceWorkerUrl).toContain('chrome-extension://');
        await page.waitForTimeout(2000);

        for (const scenario of COLOR_SCENARIOS) {
            await page.goto(`${localServer.baseUrl}/${TEST_PAGE_FILE_NAME}`, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(400);

            await selectScenarioText(page, scenario.selector);
            const tooltip = await openTooltip(page);

            const computedColor = await tooltip.evaluate((element) => window.getComputedStyle(element).color);
            console.log(
                `[Scenario ${scenario.id}] expected=${scenario.expectedColor}, actual=${computedColor}, detail=${scenario.description}`,
            );

            expect(computedColor).toBe(scenario.expectedColor);

            const screenshotPath = await saveScenarioScreenshot(page, scenario, runId);
            console.log(`[Scenario ${scenario.id}] screenshot=${screenshotPath}`);
        }
    } finally {
        if (context) {
            await context.close();
        }
        await closeLocalHtmlServer(localServer.server);
        await fs.rm(userDataDir, { recursive: true, force: true });
    }
});
