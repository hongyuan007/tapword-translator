import { describe, it, expect, vi, beforeEach } from 'vitest';
import { captureScreenshot } from './screenshot';
import type { Page } from 'playwright';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockPage(): Page {
    const screenshot = vi.fn().mockResolvedValue(Buffer.from('mock-screenshot-data'));

    return {
        screenshot,
    } as unknown as Page;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shared/screenshot', () => {
    let mockPage: ReturnType<typeof createMockPage>;
    const outputDir = '/tmp/test-output';
    const label = 'test-scenario';

    beforeEach(() => {
        mockPage = createMockPage();
        vi.clearAllMocks();
    });

    describe('captureScreenshot', () => {
        // --- Default (fullPage) behaviour -----------------------------------

        it('should capture fullPage screenshot by default (no opts)', async () => {
            await captureScreenshot(mockPage, outputDir, label);

            expect(mockPage.screenshot).toHaveBeenCalledTimes(1);
            expect(mockPage.screenshot).toHaveBeenCalledWith(
                expect.objectContaining({ fullPage: true }),
            );
        });

        it('should capture fullPage when opts is an empty object', async () => {
            await captureScreenshot(mockPage, outputDir, label, {});

            expect(mockPage.screenshot).toHaveBeenCalledWith(
                expect.objectContaining({ fullPage: true }),
            );
        });

        it('should capture fullPage when opts.fullPage is explicitly true', async () => {
            await captureScreenshot(mockPage, outputDir, label, { fullPage: true });

            expect(mockPage.screenshot).toHaveBeenCalledWith(
                expect.objectContaining({ fullPage: true }),
            );
        });

        // --- Clip (partial) screenshot behaviour ----------------------------

        it('should capture partial screenshot when clip option is provided', async () => {
            const clip = { x: 100, y: 200, width: 300, height: 400 };

            await captureScreenshot(mockPage, outputDir, label, { clip });

            expect(mockPage.screenshot).toHaveBeenCalledWith(
                expect.objectContaining({
                    clip,
                    fullPage: false,
                }),
            );
        });

        it('should not send fullPage: true when clip is set', async () => {
            const clip = { x: 0, y: 0, width: 100, height: 100 };

            await captureScreenshot(mockPage, outputDir, label, { clip });

            const callArg = mockPage.screenshot.mock.calls[0]?.[0];
            expect(callArg).toBeDefined();
            expect(callArg.fullPage).not.toBe(true);
        });

        it('should accept clip with zero-origin coordinates', async () => {
            const clip = { x: 0, y: 0, width: 500, height: 300 };

            await captureScreenshot(mockPage, outputDir, label, { clip });

            expect(mockPage.screenshot).toHaveBeenCalledTimes(1);
        });

        // --- Return value ---------------------------------------------------

        it('should return a string (file path)', async () => {
            const result = await captureScreenshot(mockPage, outputDir, label);

            expect(typeof result).toBe('string');
        });

        it('should return a path that includes outputDir', async () => {
            const result = await captureScreenshot(mockPage, outputDir, label);

            expect(result).toContain(outputDir);
        });

        it('should return a path that includes the label', async () => {
            const result = await captureScreenshot(mockPage, outputDir, label);

            expect(result).toContain(label);
        });

        it('should return a path ending with .png extension', async () => {
            const result = await captureScreenshot(mockPage, outputDir, label);

            expect(result).toMatch(/\.png$/);
        });

        it('should return a non-empty path', async () => {
            const result = await captureScreenshot(mockPage, outputDir, label);

            expect(result.length).toBeGreaterThan(0);
        });

        // --- Edge cases -----------------------------------------------------

        it('should handle empty label gracefully', async () => {
            const result = await captureScreenshot(mockPage, outputDir, '');

            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });

        it('should handle special characters in label', async () => {
            const specialLabel = 'test/scenario:with*special?chars';

            const result = await captureScreenshot(mockPage, outputDir, specialLabel);

            expect(typeof result).toBe('string');
            expect(mockPage.screenshot).toHaveBeenCalledTimes(1);
        });
    });
});
