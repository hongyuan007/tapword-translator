import { describe, it, expect, beforeAll } from 'vitest';
import { verifyWithAI } from './ai-verifier';
import type { VerificationContext, VerificationResult } from './types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PASS_CONTEXT: VerificationContext = {
    scenario: 'click-translate',
    operation: 'Click on the highlighted English word "important"',
    expectedBehavior:
        'A translation popup should appear above the word. ' +
        'The popup must be visually intact (no CSS layout issues). ' +
        'Page content outside the popup must not be altered or shifted.',
    screenshots: [
        '/tmp/output/screenshots/click-translate-before.png',
        '/tmp/output/screenshots/click-translate-after.png',
    ],
    codeChanges: 'Changed translation popup z-index from 9999 to 2147483647',
};

const PASS_CONTEXT_MINIMAL: VerificationContext = {
    scenario: 'drag-select',
    operation: 'Select text and click the translate icon',
    expectedBehavior: 'Translation icon appears next to selection',
    screenshots: ['/tmp/screenshots/drag-after.png'],
};

const FAIL_CONTEXT: VerificationContext = {
    scenario: 'click-translate',
    operation: 'Click on highlighted word',
    expectedBehavior: 'Translation popup should appear',
    screenshots: ['/tmp/screenshots/broken.png'],
};

const DRAG_CONTEXT: VerificationContext = {
    scenario: 'drag-select',
    operation: 'Mouse-drag select "hello world" text, release mouse',
    expectedBehavior:
        'A translation icon should appear near the end of the selection. ' +
        'Icon should be clickable and visually distinguishable.',
    screenshots: [
        '/tmp/screenshots/drag-before.png',
        '/tmp/screenshots/drag-after.png',
    ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('shared/ai-verifier', () => {
    describe('verifyWithAI — function contract', () => {
        it('should be a function', () => {
            expect(typeof verifyWithAI).toBe('function');
        });

        it('should accept at least 1 parameter (context)', () => {
            // Arity check via .length
            expect(verifyWithAI.length).toBeGreaterThanOrEqual(1);
        });

        it('should not require more than 2 parameters', () => {
            expect(verifyWithAI.length).toBeLessThanOrEqual(2);
        });

        it('should return a promise', () => {
            const result = verifyWithAI(PASS_CONTEXT);
            expect(result).toBeInstanceOf(Promise);
        });
    });

    describe('verifyWithAI — result shape (VerificationResult)', () => {
        let result: VerificationResult;

        beforeAll(async () => {
            result = await verifyWithAI(PASS_CONTEXT);
        });

        it('should include scenario field as string', () => {
            expect(typeof result.scenario).toBe('string');
        });

        it('should include passed field as boolean', () => {
            expect(typeof result.passed).toBe('boolean');
        });

        it('should include reason field as non-empty string', () => {
            expect(typeof result.reason).toBe('string');
            expect(result.reason.length).toBeGreaterThan(0);
        });

        it('should include screenshots field as an array', () => {
            expect(Array.isArray(result.screenshots)).toBe(true);
        });
    });

    describe('verifyWithAI — PASS scenario', () => {
        it('should return passed=true for a valid context', async () => {
            const result = await verifyWithAI(PASS_CONTEXT);

            expect(result.passed).toBe(true);
        });

        it('should echo input scenario in the result', async () => {
            const result = await verifyWithAI(PASS_CONTEXT);

            expect(result.scenario).toBe(PASS_CONTEXT.scenario);
        });

        it('should echo input screenshots in the result', async () => {
            const result = await verifyWithAI(PASS_CONTEXT);

            expect(result.screenshots).toEqual(PASS_CONTEXT.screenshots);
        });

        it('should return a descriptive reason for PASS', async () => {
            const result = await verifyWithAI(PASS_CONTEXT);

            expect(result.reason).toBeTruthy();
            // Reason should be more than just "OK" — meaningful explanation
            expect(result.reason.length).toBeGreaterThan(5);
        });
    });

    describe('verifyWithAI — FAIL scenario', () => {
        it('should return passed=false when UI has issues', async () => {
            const result = await verifyWithAI(FAIL_CONTEXT);

            expect(result.passed).toBe(false);
        });

        it('should return a reason explaining the failure', async () => {
            const result = await verifyWithAI(FAIL_CONTEXT);

            expect(result.reason).toBeTruthy();
            expect(result.reason.length).toBeGreaterThan(5);
        });
    });

    describe('verifyWithAI — input context construction', () => {
        it('should work with click-translate scenario', async () => {
            const result = await verifyWithAI(PASS_CONTEXT);

            expect(result.scenario).toBe('click-translate');
        });

        it('should work with drag-select scenario', async () => {
            const result = await verifyWithAI(DRAG_CONTEXT);

            expect(result.scenario).toBe('drag-select');
        });

        it('should accept context with optional codeChanges field', async () => {
            const contextWithChanges: VerificationContext = {
                ...PASS_CONTEXT_MINIMAL,
                codeChanges: 'diff --git a/src/popup.ts ...',
            };

            const result = await verifyWithAI(contextWithChanges);

            expect(result.passed).toBeDefined();
            expect(result.scenario).toBe('drag-select');
        });

        it('should work with minimal context (no codeChanges)', async () => {
            const result = await verifyWithAI(PASS_CONTEXT_MINIMAL);

            expect(result.passed).toBeDefined();
            expect(result.scenario).toBe('drag-select');
        });

        it('should accept context with single screenshot', async () => {
            const singleScreenshot: VerificationContext = {
                scenario: 'click-translate',
                operation: 'Click word',
                expectedBehavior: 'Popup appears',
                screenshots: ['/tmp/single.png'],
            };

            const result = await verifyWithAI(singleScreenshot);

            expect(result.screenshots).toEqual(['/tmp/single.png']);
            expect(result.passed).toBeDefined();
        });

        it('should accept context with multiple screenshots', async () => {
            const multiScreenshots: VerificationContext = {
                scenario: 'click-translate',
                operation: 'Click word',
                expectedBehavior: 'Popup appears',
                screenshots: [
                    '/tmp/before.png',
                    '/tmp/after.png',
                    '/tmp/detail.png',
                ],
            };

            const result = await verifyWithAI(multiScreenshots);

            expect(result.screenshots).toHaveLength(3);
        });
    });

    describe('verifyWithAI — model parameter', () => {
        it('should work with default model (no second argument)', async () => {
            const result = await verifyWithAI(PASS_CONTEXT);

            expect(result.passed).toBeDefined();
            expect(result.reason).toBeTruthy();
        });

        it('should accept an explicit model string', async () => {
            const result = await verifyWithAI(PASS_CONTEXT, 'codex/gpt-5.6');

            expect(result.passed).toBeDefined();
            expect(result.reason).toBeTruthy();
        });

        it('should accept a custom model override', async () => {
            const result = await verifyWithAI(
                PASS_CONTEXT_MINIMAL,
                'openai/gpt-4o',
            );

            expect(result.passed).toBeDefined();
        });
    });
});
