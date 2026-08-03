/**
 * expandRangeToSentence Tests — Issue #41
 *
 * Tests for sentence range expansion with numeric comma and decimal period protection.
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { expandRangeToSentence } from '@/1_content/utils/contextExtractorV2';

// ============================================================================
// Helpers
// ============================================================================

function createTestDOM(html: string): HTMLElement {
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    return container;
}

function createRangeFromText(container: HTMLElement, searchText: string): Range | null {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    while ((node = walker.nextNode())) {
        const text = node.textContent || '';
        const index = text.indexOf(searchText);
        if (index !== -1) {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + searchText.length);
            return range;
        }
    }
    return null;
}

/** Extract text content from a Range, collapsing whitespace for comparison. */
function getRangeText(range: Range): string {
    return (range.toString() || '').replace(/\s+/g, ' ').trim();
}

// ============================================================================
// Tests
// ============================================================================

describe('expandRangeToSentence', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    describe('Numeric comma protection', () => {
        it('should not split at comma inside large number (10,000)', () => {
            const html = '<p>The company reported revenue of 10,000 dollars and plans to hire more staff next year.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'reported');
            const expanded = expandRangeToSentence(range!);
            expect(getRangeText(expanded)).toBe(
                'The company reported revenue of 10,000 dollars and plans to hire more staff next year.'
            );
        });

        it('should not split at commas in multi-group number (1,500,000)', () => {
            const html = '<p>The project budget of 1,500,000 dollars was approved by the board.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'budget');
            const expanded = expandRangeToSentence(range!);
            expect(getRangeText(expanded)).toBe(
                'The project budget of 1,500,000 dollars was approved by the board.'
            );
        });

        it('should handle multiple numbers with commas in one sentence', () => {
            const html = '<p>The cost is 1,000 and tax is 500 for a total of 1,500 dollars.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'cost');
            const expanded = expandRangeToSentence(range!);
            expect(getRangeText(expanded)).toBe(
                'The cost is 1,000 and tax is 500 for a total of 1,500 dollars.'
            );
        });

        it('should preserve real grammatical commas as soft boundaries', () => {
            const html = '<p>She ran quickly, then stopped at the corner and waited for the light.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'quickly');
            const expanded = expandRangeToSentence(range!);
            // The soft boundary at the real comma should still work
            expect(getRangeText(expanded)).toBe(
                'She ran quickly, then stopped at the corner and waited for the light.'
            );
        });

        it('should split at real comma but preserve numeric commas', () => {
            const html = '<p>The team sold 1,000 units, making a record profit this quarter.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'sold');
            const expanded = expandRangeToSentence(range!);
            expect(getRangeText(expanded)).toBe(
                'The team sold 1,000 units, making a record profit this quarter.'
            );
        });

        it('should handle number at sentence start (10,000 people)', () => {
            const html = '<p>10,000 people attended the event and enjoyed the show.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'attended');
            const expanded = expandRangeToSentence(range!);
            expect(getRangeText(expanded)).toBe(
                '10,000 people attended the event and enjoyed the show.'
            );
        });

        it('should handle very large number with multiple comma groups', () => {
            const html = '<p>The population reached 1,000,000,000 people worldwide.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'reached');
            const expanded = expandRangeToSentence(range!);
            expect(getRangeText(expanded)).toBe(
                'The population reached 1,000,000,000 people worldwide.'
            );
        });
    });

    describe('Decimal period protection', () => {
        it('should not split at decimal period (3.14)', () => {
            const html = '<p>The value of 3.14 is a well-known mathematical constant approximation.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'value');
            const expanded = expandRangeToSentence(range!);
            expect(getRangeText(expanded)).toBe(
                'The value of 3.14 is a well-known mathematical constant approximation.'
            );
        });

        it('should not split at decimal period (0.5)', () => {
            const html = '<p>The probability is 0.5 which means a fair coin toss outcome.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'probability');
            const expanded = expandRangeToSentence(range!);
            expect(getRangeText(expanded)).toBe(
                'The probability is 0.5 which means a fair coin toss outcome.'
            );
        });
    });

    describe('Mixed scenarios', () => {
        it('should handle CJK text with numeric commas', () => {
            const html = '<p>增长10,000人，计划明年继续扩展团队规模。</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, '增长');
            const expanded = expandRangeToSentence(range!);
            expect(getRangeText(expanded)).toBe(
                '增长10,000人，计划明年继续扩展团队规模。'
            );
        });
    });

    describe('Edge cases', () => {
        it('should handle collapsed range without crashing', () => {
            const html = '<p>Some text here.</p>';
            const container = createTestDOM(html);
            const range = document.createRange();
            range.setStart(container.firstChild!, 0);
            range.collapse(true);
            const expanded = expandRangeToSentence(range);
            expect(expanded).toBeDefined();
            // Should expand to at least some text since we're inside a <p>
            expect(getRangeText(expanded).length).toBeGreaterThan(0);
        });

        it('should handle empty DOM gracefully', () => {
            const container = createTestDOM('<p></p>');
            const range = document.createRange();
            range.setStart(container, 0);
            range.collapse(true);
            const expanded = expandRangeToSentence(range);
            expect(expanded).toBeDefined();
        });

        it('should still split at real sentence-ending periods', () => {
            const html = '<p>First sentence here. Second sentence with 10,000 items. Third sentence.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'Second');
            const expanded = expandRangeToSentence(range!);
            expect(getRangeText(expanded)).toBe(
                'Second sentence with 10,000 items.'
            );
        });
    });
});
