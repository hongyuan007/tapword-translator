import * as http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { createFixtureServer, closeFixtureServer, type FixtureServer } from './fixture-server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXTENSION_DIST_PATH = path.resolve(process.cwd(), 'dist');
const MANIFEST_PATH = path.join(EXTENSION_DIST_PATH, 'manifest.json');
const DEFAULT_BROWSER_CHANNEL = 'msedge';
const BROWSER_CHANNEL_ENV_KEY = 'PW_EXTENSION_CHANNEL';
const EXTENSION_LOAD_TIMEOUT_MS = 15_000;
const POLLING_INTERVAL_MS = 500;
const CONTENT_SCRIPT_TIMEOUT_MS = 8_000;

const EXTENSION_ENABLED_FLAGS = [
    '--enable-unsafe-extension-debugging',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--disable-extensions-except=' + EXTENSION_DIST_PATH,
    '--load-extension=' + EXTENSION_DIST_PATH,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtensionContext {
    context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>;
    userDataDir: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify that the extension has been built (dist/manifest.json exists).
 * Throws if the build is missing.
 */
export async function assertExtensionBuilt(): Promise<void> {
    await fs.access(MANIFEST_PATH);
}

/**
 * Resolve the browser channel from environment variable or use default.
 */
export function getBrowserChannel(): string {
    return process.env[BROWSER_CHANNEL_ENV_KEY] ?? DEFAULT_BROWSER_CHANNEL;
}

/**
 * Create a persistent browser context with the TapWord extension loaded.
 *
 * Uses `launchPersistentContext` with MV3-compatible flags and forced
 * `zh-CN` locale (so `targetLanguage` defaults to Chinese).
 *
 * @returns An object holding the context and the temp user-data directory.
 */
export async function createExtensionContext(): Promise<ExtensionContext> {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tapword-ai-e2e-'));
    const browserChannel = getBrowserChannel();

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        channel: browserChannel,
        ignoreDefaultArgs: ['--disable-extensions'],
        args: EXTENSION_ENABLED_FLAGS,
        locale: 'zh-CN',
    });

    // Route all requests — mirrors the working test pattern.
    await context.route('**', (route) => route.continue());

    // Auto-close welcome/update pages to avoid interference.
    context.on('page', async (page) => {
        try {
            await page.waitForLoadState('domcontentloaded');
            if (page.url().includes('update_v0_4_0.html') || page.url().includes('welcome')) {
                await page.close();
            }
        } catch {
            // Page may close too fast — ignore.
        }
    });

    return { context, userDataDir };
}

/**
 * Wait for the extension's service worker to register.
 *
 * @returns The service worker URL (empty string on timeout).
 */
export async function waitForExtensionServiceWorker(
    context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
): Promise<string> {
    const startTime = Date.now();
    while (Date.now() - startTime < EXTENSION_LOAD_TIMEOUT_MS) {
        const worker = context
            .serviceWorkers()
            .find((w) => w.url().startsWith('chrome-extension://'));
        if (worker) {
            return worker.url();
        }
        await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
    }
    return '';
}

/**
 * Wait for the content script to inject CSS variables into the page,
 * signalling that the extension is fully initialised on the page.
 */
export async function waitForContentScript(
    page: Awaited<ReturnType<ReturnType<typeof chromium.launchPersistentContext>['newPage']>>,
): Promise<void> {
    await page.waitForFunction(
        () => {
            const val = getComputedStyle(document.documentElement).getPropertyValue(
                '--ai-translator-underline-offset',
            );
            return val && val.trim() !== '';
        },
        null,
        { timeout: CONTENT_SCRIPT_TIMEOUT_MS },
    );
}

/**
 * Clean up an extension context: close browser and remove the temp directory.
 */
export async function closeExtensionContext(extCtx: ExtensionContext): Promise<void> {
    try {
        await extCtx.context.close();
    } finally {
        await fs.rm(extCtx.userDataDir, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { createFixtureServer, closeFixtureServer, type FixtureServer };
