/**
 * Translation Overlap Detector Tests
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectOverlappingTranslations } from '@/1_content/utils/translationOverlapDetector';
import * as constants from '@/1_content/constants';
import { createTestDOM, createRangeFromText, cleanupDOM } from './test-helpers';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper function to format and print test results for manual inspection.
 * @param testName - The name of the test case.
 * @param result - The actual result from the function call.
 * @param domContent - The HTML content used for the test.
 * @param range - The range used for the test.
 */
function formatTestResult(
    testName: string,
    result: any,
    domContent: string,
    range: Range | null
) {
    console.log(`\n--- Test Case: ${testName} ---`);
    console.log('DOM Content:\n', domContent.trim());
    if (range) {
        console.log('\nSelection Range:', range.toString());
    }
    console.log('\nOverlapping Anchors:', JSON.stringify(result, null, 2));
    console.log('--------------------------------------\n');
}

/**
 * Creates a translation anchor element for testing.
 * @param id - The ID of the anchor.
 * @param text - The text content of the anchor.
 * @returns The anchor element as a string.
 */
function createAnchor(id: string, text: string): string {
    return `<span id="${id}" class="${constants.CSS_CLASSES.ANCHOR}">${text}</span>`;
}

// ============================================================================
// Test Suite
// ============================================================================ 

describe('detectOverlappingTranslations', () => {
    beforeEach(() => {
        cleanupDOM();
    });

    afterEach(() => {
        cleanupDOM();
    });

    describe('Simple HTML and Range Scenarios', () => {
        it('should not detect overlap when selection is outside any anchor', () => {
            const testName = 'No Overlap';
            const anchor = createAnchor('anchor1', 'brown fox');
            const html = `<p>The quick ${anchor} jumps over the lazy dog.</p>`;
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'The quick');
            const result = detectOverlappingTranslations(range!);

            formatTestResult(testName, result, html, range);
            expect(result).toEqual([]);
        });

        it('should detect overlap when selection fully contains an anchor', () => {
            const testName = 'Selection Contains Anchor';
            const anchor = createAnchor('anchor1', 'fox');
            const html = `<p>The quick brown ${anchor} jumps over the lazy dog.</p>`;
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'brown fox jumps');
            const result = detectOverlappingTranslations(range!);

            formatTestResult(testName, result, html, range);
            expect(result).toEqual(['anchor1']);
        });

        it('should detect overlap when selection is fully inside an anchor', () => {
            const testName = 'Selection Inside Anchor';
            const anchor = createAnchor('anchor1', 'quick brown fox');
            const html = `<p>The ${anchor} jumps over the lazy dog.</p>`;
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'brown');
            const result = detectOverlappingTranslations(range!);

            formatTestResult(testName, result, html, range);
            expect(result).toEqual(['anchor1']);
        });

        it('should detect overlap when selection partially overlaps the start of an anchor', () => {
            const testName = 'Partial Overlap at Start';
            const anchor = createAnchor('anchor1', 'brown fox');
            const html = `<p>The quick ${anchor} jumps over the lazy dog.</p>`;
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'quick brown');
            const result = detectOverlappingTranslations(range!);

            formatTestResult(testName, result, html, range);
            expect(result).toEqual(['anchor1']);
        });

        it('should detect overlap when selection partially overlaps the end of an anchor', () => {
            const testName = 'Partial Overlap at End';
            const anchor = createAnchor('anchor1', 'brown fox');
            const html = `<p>The quick ${anchor} jumps over the lazy dog.</p>`;
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'fox jumps');
            const result = detectOverlappingTranslations(range!);

            formatTestResult(testName, result, html, range);
            expect(result).toEqual(['anchor1']);
        });
    });

    describe('Complex HTML and Range Scenarios', () => {
        it('should detect overlap in nested HTML structures', () => {
            const testName = 'Nested HTML';
            const anchor = createAnchor('anchor1', '<em>brown</em> fox');
            const html = `<p>The <strong>quick ${anchor}</strong> jumps over the lazy dog.</p>`;
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'quick brown fox');
            const result = detectOverlappingTranslations(range!);

            formatTestResult(testName, result, html, range);
            expect(result).toEqual(['anchor1']);
        });

        it('should detect overlap when selection spans multiple elements', () => {
            const testName = 'Selection Spans Elements';
            const anchor = createAnchor('anchor1', 'brown');
            const html = `<p>The <span>quick</span> ${anchor} <span>fox</span> jumps over the lazy dog.</p>`;
            const container = createTestDOM(html);
            const range = document.createRange();
            const quickNode = container.querySelector('span:first-child')!.firstChild!;
            const foxNode = container.querySelector('span:last-child')!.firstChild!;
            range.setStart(quickNode, 0);
            range.setEnd(foxNode, 3);
            const result = detectOverlappingTranslations(range);

            formatTestResult(testName, result, html, range);
            expect(result).toEqual(['anchor1']);
        });
    });

    describe('Multiple Anchors and Overlapping Scenarios', () => {
        it('should detect multiple overlapping anchors', () => {
            const testName = 'Multiple Overlapping Anchors';
            const anchor1 = createAnchor('anchor1', 'quick');
            const anchor2 = createAnchor('anchor2', 'brown');
            const html = `<p>The ${anchor1} ${anchor2} fox jumps over the lazy dog.</p>`;
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'quick brown fox');
            const result = detectOverlappingTranslations(range!);

            formatTestResult(testName, result, html, range);
            expect(result).toEqual(['anchor1', 'anchor2']);
        });

        it('should detect nested anchors (range contains both)', () => {
            const testName = 'Nested Anchors - Outer Selected';
            const anchor2 = createAnchor('anchor2', 'brown');
            const anchor1 = createAnchor('anchor1', `quick ${anchor2} fox`);
            const html = `<p>The ${anchor1} jumps over the lazy dog.</p>`;
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'quick brown fox');
            const result = detectOverlappingTranslations(range!);

            formatTestResult(testName, result, html, range);
            expect(result).toContain('anchor1');
            expect(result).toContain('anchor2');
        });

        it('should detect nested anchors (range contains inner)', () => {
            const testName = 'Nested Anchors - Inner Selected';
            const anchor2 = createAnchor('anchor2', 'brown');
            const anchor1 = createAnchor('anchor1', `quick ${anchor2} fox`);
            const html = `<p>The ${anchor1} jumps over the lazy dog.</p>`;
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'brown');
            const result = detectOverlappingTranslations(range!);

            formatTestResult(testName, result, html, range);
            expect(result).toContain('anchor1');
            expect(result).toContain('anchor2');
        });
    });

    describe('Edge Cases', () => {
        it('should not detect overlap for adjacent selections', () => {
            const testName = 'Adjacent Selection';
            const anchor = createAnchor('anchor1', 'brown');
            const html = `<p>The quick ${anchor} fox jumps over the lazy dog.</p>`;
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'quick ');
            const result = detectOverlappingTranslations(range!);

            formatTestResult(testName, result, html, range);
            expect(result).toEqual([]);
        });

        it('should return an empty array when no anchors are present', () => {
            const testName = 'No Anchors';
            const html = `<p>The quick brown fox jumps over the lazy dog.</p>`;
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'fox');
            const result = detectOverlappingTranslations(range!);

            formatTestResult(testName, result, html, range);
            expect(result).toEqual([]);
        });

        it('should handle an empty range', () => {
            const testName = 'Empty Range';
            const anchor = createAnchor('anchor1', 'brown');
            const html = `<p>The quick ${anchor} fox jumps over the lazy dog.</p>`;
            const container = createTestDOM(html);
            const range = document.createRange();
            const p = container.querySelector('p')!.firstChild!;
            range.setStart(p, 0);
            range.collapse(true);
            const result = detectOverlappingTranslations(range);

            formatTestResult(testName, result, html, range);
            expect(result).toEqual([]);
        });
    });
});
