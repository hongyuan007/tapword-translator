
import { chromium, test } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('debug browser launch', async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'debug-browser-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: true, // Try headless first
    });
    const page = await context.newPage();
    await page.goto('https://example.com');
    await page.waitForTimeout(1000);
    await context.close();
});
