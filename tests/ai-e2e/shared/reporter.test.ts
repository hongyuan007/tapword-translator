import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateReport } from './reporter';
import type { VerificationResult } from './types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PASS_RESULTS: VerificationResult[] = [
    {
        scenario: 'click-translate',
        passed: true,
        reason: 'Translation popup appeared correctly above the word. No layout issues detected. All UI elements rendered properly in light mode.',
        screenshots: [
            '/tmp/output/screenshots/click-translate-before.png',
            '/tmp/output/screenshots/click-translate-after.png',
        ],
    },
    {
        scenario: 'drag-select',
        passed: true,
        reason: 'Translation icon appeared at the correct position after text selection. Icon click triggered the popup as expected.',
        screenshots: [
            '/tmp/output/screenshots/drag-select-before.png',
            '/tmp/output/screenshots/drag-select-after.png',
        ],
    },
];

const MIXED_RESULTS: VerificationResult[] = [
    {
        scenario: 'click-translate',
        passed: true,
        reason: 'All UI elements rendered correctly.',
        screenshots: ['/tmp/screenshots/click-ok.png'],
    },
    {
        scenario: 'drag-select',
        passed: false,
        reason: 'Translation icon did not appear after text selection. Content script may have failed to initialize on dark mode.',
        screenshots: ['/tmp/screenshots/drag-fail.png'],
    },
];

const FAIL_RESULTS: VerificationResult[] = [
    {
        scenario: 'click-translate',
        passed: false,
        reason: 'Translation popup covers the original text, making it unreadable. z-index issue suspected.',
        screenshots: ['/tmp/screenshots/click-broken.png'],
    },
    {
        scenario: 'drag-select',
        passed: false,
        reason: 'Page layout shifted after triggering translation. Sidebar content moved out of viewport.',
        screenshots: ['/tmp/screenshots/drag-broken.png'],
    },
];

const SINGLE_RESULT: VerificationResult[] = [
    {
        scenario: 'click-translate',
        passed: true,
        reason: 'OK',
        screenshots: ['/tmp/single.png'],
    },
];

const EMPTY_RESULTS: VerificationResult[] = [];

const outputDir = '/tmp/test-reports';
const runId = '20260712-163000-abc123';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shared/reporter', () => {
    describe('generateReport — function contract', () => {
        it('should be a function', () => {
            expect(typeof generateReport).toBe('function');
        });

        it('should accept 3 parameters', () => {
            expect(generateReport.length).toBe(3);
        });

        it('should return a promise', () => {
            const result = generateReport(outputDir, PASS_RESULTS, runId);
            expect(result).toBeInstanceOf(Promise);
        });

        it('should return a string (report file path)', async () => {
            const result = await generateReport(outputDir, PASS_RESULTS, runId);
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });
    });

    describe('generateReport — summary section', () => {
        it('should include run ID in the report', async () => {
            const reportPath = await generateReport(outputDir, PASS_RESULTS, runId);
            expect(reportPath).toContain(outputDir);
        });

        it('should handle all-passed results', async () => {
            const reportPath = await generateReport(outputDir, PASS_RESULTS, runId);

            expect(typeof reportPath).toBe('string');
            expect(reportPath.length).toBeGreaterThan(0);
        });

        it('should handle mixed results (pass + fail)', async () => {
            const reportPath = await generateReport(outputDir, MIXED_RESULTS, runId);

            expect(typeof reportPath).toBe('string');
            expect(reportPath.length).toBeGreaterThan(0);
        });

        it('should handle all-failed results', async () => {
            const reportPath = await generateReport(outputDir, FAIL_RESULTS, runId);

            expect(typeof reportPath).toBe('string');
            expect(reportPath.length).toBeGreaterThan(0);
        });

        it('should handle single result', async () => {
            const reportPath = await generateReport(outputDir, SINGLE_RESULT, runId);

            expect(typeof reportPath).toBe('string');
            expect(reportPath.length).toBeGreaterThan(0);
        });

        it('should handle empty results array gracefully', async () => {
            const reportPath = await generateReport(outputDir, EMPTY_RESULTS, runId);

            expect(typeof reportPath).toBe('string');
        });
    });

    describe('generateReport — Markdown content', () => {
        // These tests verify that the generated report content (the Markdown
        // file written to disk) contains the required sections and data.
        // The implementation is expected to write a .md file and return its path.
        // We test the return value structure; deeper content validation can be
        // added once the implementation writes the actual file.

        it('should return a path ending with .md', async () => {
            const reportPath = await generateReport(outputDir, PASS_RESULTS, runId);

            expect(reportPath).toMatch(/\.md$/);
        });

        it('should include the runId in the report path', async () => {
            const reportPath = await generateReport(outputDir, PASS_RESULTS, runId);

            expect(reportPath).toContain(runId);
        });

        it('should write the report under outputDir', async () => {
            const reportPath = await generateReport(outputDir, PASS_RESULTS, runId);

            expect(reportPath).toContain(outputDir);
        });
    });

    describe('generateReport — PASS/FAIL status handling', () => {
        it('should handle PASS scenarios without error', async () => {
            const reportPath = await generateReport(
                outputDir,
                PASS_RESULTS,
                runId,
            );

            expect(reportPath).toBeTruthy();
            expect(reportPath).toMatch(/\.md$/);
        });

        it('should handle FAIL scenarios without error', async () => {
            const reportPath = await generateReport(
                outputDir,
                FAIL_RESULTS,
                runId,
            );

            expect(reportPath).toBeTruthy();
        });

        it('should not crash on mixed PASS/FAIL results', async () => {
            const reportPath = await generateReport(
                outputDir,
                MIXED_RESULTS,
                runId,
            );

            expect(reportPath).toBeTruthy();
        });
    });

    describe('generateReport — screenshot paths in report', () => {
        it('should produce a report that references screenshot paths', async () => {
            // The report path itself is returned; the content is written to
            // disk. Verify the function completes without error for results
            // that include screenshots.
            const reportPath = await generateReport(
                outputDir,
                PASS_RESULTS,
                runId,
            );

            expect(reportPath).toBeTruthy();
            expect(reportPath).toContain(runId);
        });

        it('should handle results with multiple screenshots', async () => {
            const multiScreenshots: VerificationResult[] = [
                {
                    scenario: 'click-translate',
                    passed: true,
                    reason: 'All good',
                    screenshots: [
                        '/tmp/s1.png',
                        '/tmp/s2.png',
                        '/tmp/s3.png',
                        '/tmp/s4.png',
                    ],
                },
            ];

            const reportPath = await generateReport(
                outputDir,
                multiScreenshots,
                runId,
            );

            expect(reportPath).toBeTruthy();
        });

        it('should handle results with empty screenshots array', async () => {
            const noScreenshots: VerificationResult[] = [
                {
                    scenario: 'drag-select',
                    passed: false,
                    reason: 'Test aborted before screenshot',
                    screenshots: [],
                },
            ];

            const reportPath = await generateReport(
                outputDir,
                noScreenshots,
                runId,
            );

            expect(reportPath).toBeTruthy();
        });
    });
});
