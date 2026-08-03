import { promises as fs } from 'fs';
import * as path from 'path';
import type { Page } from 'playwright';
import type { ScreenshotOptions } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Replace any character that is unsafe for filenames with a hyphen.
 * Allows: alphanumeric, hyphen, underscore, dot.
 */
function sanitizeLabel(label: string): string {
    return label
        .replace(/[^a-zA-Z0-9\-_.]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture a screenshot from a Playwright page and write it to disk.
 *
 * - When `opts.clip` is provided, captures a partial screenshot with
 *   `fullPage: false` (Playwright treats these as mutually exclusive).
 * - Without a clip, defaults to `fullPage: true`.
 *
 * @returns The absolute file path of the written PNG file.
 */
export async function captureScreenshot(
    page: Page,
    outputDir: string,
    label: string,
    opts?: ScreenshotOptions,
): Promise<string> {
    // Determine screenshot options — clip and fullPage are mutually exclusive.
    let screenshotOptions: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } };

    if (opts?.clip) {
        screenshotOptions = {
            clip: opts.clip,
            fullPage: false,
        };
    } else {
        screenshotOptions = {
            fullPage: opts?.fullPage ?? true,
        };
    }

    const buffer: Buffer = await page.screenshot(screenshotOptions as Parameters<Page['screenshot']>[0]);

    // Ensure the output directory exists.
    await fs.mkdir(outputDir, { recursive: true });

    // Build a safe filename.
    const sanitized = sanitizeLabel(label) || 'screenshot';
    const timestamp = Date.now();
    const filename = `${sanitized}-${timestamp}.png`;
    const filepath = path.join(outputDir, filename);

    await fs.writeFile(filepath, buffer);

    return filepath;
}
