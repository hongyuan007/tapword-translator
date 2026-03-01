
/**
 * Range Adjuster Tests
 *
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { trimBoundaryWhitespace, expandToWordBoundaries, adjustSelectionRange, type TrimResult } from '@/1_content/handlers/utils/rangeAdjuster';
import { createRangeFromText, createTestDOM, cleanupDOM } from './test-helpers';

/**
 * Helper function to format and print test results for manual inspection.
 * @param testName - The name of the test case.
 * @param result - The actual result from the function call.
 * @param domContent - The HTML content used for the test.
 * @param originalRange - The original Range object before adjustment.
 */
function formatTestResult(
    testName: string,
    result: TrimResult,
    domContent: string,
    originalRange: Range
) {
    console.log(`\n--- Test Case: ${testName} ---`);
    console.log('DOM Content:\n', domContent.trim());
    console.log('Original Range Text:', `"${originalRange.toString()}"`);
    console.log('\nTrim Result:', JSON.stringify({
        adjusted: result.adjusted,
        hadLeadingWhitespace: result.hadLeadingWhitespace,
        hadTrailingWhitespace: result.hadTrailingWhitespace,
        range: result.range.toString()
    }, null, 2));
    console.log('--------------------------------------\n');
}

/**
 * Helper function to format and print test results for expansion/adjustment for manual inspection.
 * @param testName - The name of the test case.
 * @param result - The actual result from the function call.
 * @param domContent - The HTML content used for the test.
 * @param originalRange - The original Range object before adjustment.
 */
function formatTestResultForExpand(
    testName: string,
    result: { range: Range; adjusted: boolean },
    domContent: string,
    originalRange: Range
) {
    console.log(`\n--- Test Case: ${testName} ---`);
    console.log('DOM Content:\n', domContent.trim());
    console.log('Original Range Text:', `"${originalRange.toString()}"`);
    console.log('\nExpand/Adjust Result:', JSON.stringify({
        adjusted: result.adjusted,
        range: result.range.toString()
    }, null, 2));
    console.log('--------------------------------------\n');
}

describe('rangeAdjuster', () => {
    beforeEach(() => {
        cleanupDOM();
    });

    describe('trimBoundaryWhitespace', () => {
        it('should trim leading whitespace from a range', () => {
            const testName = 'Trim Leading Whitespace';
            const html = '<p>  word</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, '  word')!;
            const result = trimBoundaryWhitespace(range);

            formatTestResult(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.hadLeadingWhitespace).toBe(true);
            expect(result.range.toString()).toBe('word');
        });

        it('should trim trailing whitespace from a range', () => {
            const testName = 'Trim Trailing Whitespace';
            const html = '<p>word  </p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'word  ')!;
            const result = trimBoundaryWhitespace(range);

            formatTestResult(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.hadTrailingWhitespace).toBe(true);
            expect(result.range.toString()).toBe('word');
        });

        it('should trim both leading and trailing whitespace', () => {
            const testName = 'Trim Both Ends';
            const html = '<p>  word  </p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, '  word  ')!;
            const result = trimBoundaryWhitespace(range);

            formatTestResult(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('word');
        });

        it('should not adjust a range with no boundary whitespace', () => {
            const testName = 'No Whitespace';
            const html = '<p>word</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'word')!;
            const result = trimBoundaryWhitespace(range);

            formatTestResult(testName, result, html, range);
            expect(result.adjusted).toBe(false);
            expect(result.range.toString()).toBe('word');
        });

        it('should handle multiple types of whitespace characters', () => {
            const testName = 'Multiple Whitespace Types';
            const html = '<p>\t  \nword&nbsp; \r</p>';
            const container = createTestDOM(html);
            const p = container.querySelector('p')!;
            const range = document.createRange();
            range.selectNodeContents(p);
            const result = trimBoundaryWhitespace(range);

            formatTestResult(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('word');
        });

        it('should trim whitespace from a range spanning multiple elements', () => {
            const testName = 'Spanning Multiple Elements';
            const html = '<p><span>  word</span> and <span>another </span></p>';
            const container = createTestDOM(html);
            const p = container.querySelector('p')!;
            const span1 = p.children[0];
            const span2 = p.children[1];
            const range = document.createRange();
            range.setStart(span1.firstChild!, 0);
            range.setEnd(span2.firstChild!, 8);
            const result = trimBoundaryWhitespace(range);

            formatTestResult(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('word and another');
        });

        it('should return an empty range if it only contains whitespace', () => {
            const testName = 'Whitespace Only';
            const html = '<p>   </p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, '   ')!;
            const result = trimBoundaryWhitespace(range);

            formatTestResult(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('');
        });

        it('should handle ranges ending at the edge of a text node', () => {
            const testName = 'Range Ends at Edge';
            const html = '<p>word  </p>';
            const container = createTestDOM(html);
            const p = container.querySelector('p')!;
            const range = document.createRange();
            range.setStart(p.firstChild!, 0);
            range.setEnd(p.firstChild!, 6); // "word  "
            const result = trimBoundaryWhitespace(range);

            formatTestResult(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('word');
        });

        it('should handle ranges starting at the edge of a text node', () => {
            const testName = 'Range Starts at Edge';
            const html = '<p>  word</p>';
            const container = createTestDOM(html);
            const p = container.querySelector('p')!;
            const range = document.createRange();
            range.setStart(p.firstChild!, 0);
            range.setEnd(p.firstChild!, 6); // "  word"
            const result = trimBoundaryWhitespace(range);

            formatTestResult(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('word');
        });

        it('should correctly trim leading whitespace when the range starts in a text node inside another element', () => {
            const testName = 'Leading Whitespace in Child';
            const html = '<p>See <b>  word</b></p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, '  word')!;
            const result = trimBoundaryWhitespace(range);

            formatTestResult(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('word');
        });

        it('should correctly trim trailing whitespace when the range ends in a text node inside another element', () => {
            const testName = 'Trailing Whitespace in Child';
            const html = '<p>See <b>word  </b></p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'word  ')!;
            const result = trimBoundaryWhitespace(range);

            formatTestResult(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('word');
        });

        it('should handle a complex case with nested elements and mixed whitespace', () => {
            const testName = 'Complex Nested Elements';
            const html = '<p><span> &nbsp; <b>  word1</b> <i> word2 </i>  </span></p>';
            const container = createTestDOM(html);
            const span = container.querySelector('span')!;
            const range = document.createRange();
            range.selectNodeContents(span);
            const result = trimBoundaryWhitespace(range);

            formatTestResult(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('word1  word2');
        });
    });

    describe('expandToWordBoundaries', () => {
        it('should expand an incomplete word on the left', () => {
            const testName = 'Expand Left';
            const html = '<p>This is a testimonial.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'testimonial', 6, 0)!; // "onial"
            const result = expandToWordBoundaries(range);

            formatTestResultForExpand(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('testimonial');
        });

        it('should expand an incomplete word on the right', () => {
            const testName = 'Expand Right';
            const html = '<p>This is a testimonial.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'testimonial', 0, 4)!; // "testimo"
            const result = expandToWordBoundaries(range);

            formatTestResultForExpand(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('testimonial');
        });

        it('should expand a fragment with incomplete words on both sides', () => {
            const testName = 'Expand Both Sides';
            const html = '<p>This is a testimonial of a successful session.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'testimonial of a successful', 6, 3)!; // "onial of a success"
            const result = expandToWordBoundaries(range);

            formatTestResultForExpand(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('testimonial of a successful');
        });

        it('should expand a single character to the full word', () => {
            const testName = 'Expand Single Character';
            const html = '<p>The quick brown fox.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'q')!;
            const result = expandToWordBoundaries(range);

            formatTestResultForExpand(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('quick');
        });

        it('should expand to include hyphenated parts of a word', () => {
            const testName = 'Expand Hyphenated Word';
            const html = '<p>Additional donors include co-founders of cryptocurrency exchange Gemini.</p>';
            const container = createTestDOM(html);
            // Hyphen is NOT a word boundary, so "founders" WILL expand to "co-founders"
            const range = createRangeFromText(container, 'co-founders of cryptocurrency', 3, 0)!; // "founders of cryptocurrency"
            const result = expandToWordBoundaries(range);

            formatTestResultForExpand(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('co-founders of cryptocurrency');
        });

        describe('Complex HTML Scenarios', () => {
            it('should expand across a simple inline element', () => {
                const testName = 'Expand Across Simple Inline';
                const html = '<p>Hello <b>world</b>!</p>';
                const container = createTestDOM(html);
                const p = container.querySelector('p')!;
                const range = document.createRange();
                range.setStart(p.firstChild!, 3); // "lo "
                range.setEnd(p.querySelector('b')!.firstChild!, 3); // "wor"
                const result = expandToWordBoundaries(range);

                formatTestResultForExpand(testName, result, html, range);
                expect(result.adjusted).toBe(true);
                expect(result.range.toString()).toBe('Hello world');
            });

            it('should expand across multiple nested elements', () => {
                const testName = 'Expand Across Multiple Nested';
                const html = '<p>Click <i>here for <b>more</b></i> details</p>';
                const container = createTestDOM(html);
                const i = container.querySelector('i')!;
                const b = container.querySelector('b')!;
                const range = document.createRange();
                range.setStart(i.firstChild!, 2); // "re for "
                range.setEnd(b.firstChild!, 2); // "mo"
                const result = expandToWordBoundaries(range);

                formatTestResultForExpand(testName, result, html, range);
                expect(result.adjusted).toBe(true);
                expect(result.range.toString()).toBe('here for more');
            });

            it('should expand from inside a nested element to outside', () => {
                const testName = 'Expand From Inside to Outside';
                const html = '<p>This is <b>important</b> information</p>';
                const container = createTestDOM(html);
                const range = createRangeFromText(container, 'portan', 0, 0)!; // "portan" inside <b>
                const result = expandToWordBoundaries(range);

                formatTestResultForExpand(testName, result, html, range);
                expect(result.adjusted).toBe(true);
                expect(result.range.toString()).toBe('important');
            });

            it('should expand from outside a nested element to inside', () => {
                const testName = 'Expand From Outside to Inside';
                const html = '<p>Please <b>read this</b> carefully</p>';
                const container = createTestDOM(html);
                const p = container.querySelector('p')!;
                const b = container.querySelector('b')!;
                const range = document.createRange();
                range.setStart(p.firstChild!, 3); // "ase "
                range.setEnd(b.firstChild!, 7); // "read th"
                const result = expandToWordBoundaries(range);

                formatTestResultForExpand(testName, result, html, range);
                expect(result.adjusted).toBe(true);
                expect(result.range.toString()).toBe('Please read this');
            });

            it('should handle and exclude surrounding punctuation', () => {
                const testName = 'Expand and Handle Punctuation';
                const html = '<p>(See: <b>Figure 1</b>)</p>';
                const container = createTestDOM(html);
                const p = container.querySelector('p')!;
                const b = container.querySelector('b')!;
                const range = document.createRange();
                range.setStart(p.firstChild!, 2); // "ee: "
                range.setEnd(b.firstChild!, 4); // "Figu"
                const result = expandToWordBoundaries(range);

                formatTestResultForExpand(testName, result, html, range);
                expect(result.adjusted).toBe(true);
                expect(result.range.toString()).toBe('See: Figure');
            });

            it('should expand across different parent paragraphs', () => {
                const testName = 'Expand Across Paragraphs';
                const html = '<div><p>First paragraph.</p><p>Second paragraph.</p></div>';
                const container = createTestDOM(html);
                const p1 = container.querySelectorAll('p')[0];
                const p2 = container.querySelectorAll('p')[1];
                const range = document.createRange();
                range.setStart(p1.firstChild!, 7); // "aragraph."
                range.setEnd(p2.firstChild!, 4); // "Seco"
                const result = expandToWordBoundaries(range);

                formatTestResultForExpand(testName, result, html, range);
                expect(result.adjusted).toBe(true);
                expect(result.range.toString()).toBe('paragraph.Second');
            });

            it('should expand correctly when selection ends before a new element', () => {
                const testName = 'Expand Ends Before New Element';
                const html = '<p>Select this<b> and this</b></p>';
                const container = createTestDOM(html);
                const p = container.querySelector('p')!;
                const range = document.createRange();
                range.setStart(p.firstChild!, 2); // "lect "
                range.setEnd(p.firstChild!, 9); // "this"
                const result = expandToWordBoundaries(range);

                formatTestResultForExpand(testName, result, html, range);
                expect(result.adjusted).toBe(true);
                expect(result.range.toString()).toBe('Select this');
            });

            it('should expand correctly when selection starts after an element', () => {
                const testName = 'Expand Starts After Element';
                const html = '<p><b>Select this</b> and this</p>';
                const container = createTestDOM(html);
                const p = container.querySelector('p')!;
                const textNode = p.lastChild!;
                const range = document.createRange();
                range.setStart(textNode, 2); // "nd "
                range.setEnd(textNode, 8); // "this"
                const result = expandToWordBoundaries(range);

                formatTestResultForExpand(testName, result, html, range);
                expect(result.adjusted).toBe(true);
                expect(result.range.toString()).toBe('and this');
            });

            it('should expand backward across sibling elements when selection starts at the beginning of a text node', () => {
                const testName = 'Expand Backward Across Siblings with Mixed Nodes';
                const html = '<p>Some <span>irrelevant</span> text before <b>He</b>re is the word.</p>';
                const container = createTestDOM(html);
                const p = container.querySelector('p')!;
                const textNode = p.lastChild!; // The text node is "re is the word."
                
                expect(textNode.nodeType).toBe(Node.TEXT_NODE);
                expect(textNode.textContent!.startsWith('re ')).toBe(true);

                const range = document.createRange();
                range.setStart(textNode, 0);
                range.setEnd(textNode, 2); // Selects "re"
                
                const result = expandToWordBoundaries(range);

                formatTestResultForExpand(testName, result, html, range);
                expect(result.adjusted).toBe(true);
                expect(result.range.toString()).toBe('Here');
            });

            it('should expand forward across sibling elements when selection ends at the end of a text node', () => {
                const testName = 'Expand Forward Across Siblings with Mixed Nodes';
                const html = '<p>Some <span>irrelevant</span> text before He<b>re</b> is the word.</p>';
                const container = createTestDOM(html);
                const p = container.querySelector('p')!;
                const textNode = p.querySelector('b')!.previousSibling!;
                
                expect(textNode.nodeType).toBe(Node.TEXT_NODE);
                expect(textNode.textContent!.endsWith(' He')).toBe(true);

                const range = document.createRange();
                const textContent = textNode.textContent!;
                range.setStart(textNode, textContent.length - 2);
                range.setEnd(textNode, textContent.length); // Selects "He"
                
                const result = expandToWordBoundaries(range);

                formatTestResultForExpand(testName, result, html, range);
                expect(result.adjusted).toBe(true);
                expect(result.range.toString()).toBe('Here');
            });

            it('should expand across different sibling inline elements', () => {
                const testName = 'Expand Across Different Sibling Inline Elements';
                const html = '<p>This is <strong>really <em>important</em></strong> stuff.</p>';
                const container = createTestDOM(html);
                const strong = container.querySelector('strong')!;
                const em = container.querySelector('em')!;
                const range = document.createRange();
                range.setStart(strong.firstChild!, 3); // Starts with "ly "
                range.setEnd(em.firstChild!, 4); // Ends with "impo"
                
                const result = expandToWordBoundaries(range);

                formatTestResultForExpand(testName, result, html, range);
                expect(result.adjusted).toBe(true);
                expect(result.range.toString()).toBe('really important');
            });

            it('should not expand across block-level elements', () => {
                const testName = 'Do Not Expand Across Block-Level Elements';
                const html = `
                    <div>
                        <h1 dir="auto" class="post-title published title-X77sOw">How I Use Every Claude Code Feature</h1>
                        <h3 dir="auto" class="subtitle subtitle-HEEcLo">A brain dump of all the ways I've been using Claude Code.</h3>
                    </div>`;
                const container = createTestDOM(html);
                const h3 = container.querySelector('h3')!;
                const range = document.createRange();
                range.selectNodeContents(h3); // Selects "A brain dump of all the ways I've been using Claude Code."
                
                // Manually adjust the range to be just "A brain dump"
                range.setStart(h3.firstChild!, 0);
                range.setEnd(h3.firstChild!, 12);

                const result = expandToWordBoundaries(range);

                formatTestResultForExpand(testName, result, html, range);
                // This test expects that the expansion is contained within the h3 tag.
                // The current buggy implementation might fail this by expanding into the h1.
                // The `adjusted` flag might be true or false depending on whether it tries to expand,
                // but the final range text should NOT cross the h1 boundary.
                expect(result.range.toString()).toBe('A brain dump');
            });
        });
    });

    describe('adjustSelectionRange', () => {
        it('should trim whitespace and then expand an incomplete word', () => {
            const testName = 'Adjust: Trim and Expand Word';
            const html = '<p>This is a testimonial.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, ' testimonial', 8, 0)!; // " onial"
            const result = adjustSelectionRange(range);

            formatTestResultForExpand(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('testimonial');
        });

        it('should expand a fragment that has no boundary whitespace', () => {
            const testName = 'Adjust: Expand Fragment';
            const html = '<p>This is a testimonial of a successful session.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'testimonial of a successful', 6, 3)!; // "onial of a success"
            const result = adjustSelectionRange(range);

            formatTestResultForExpand(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('testimonial of a successful');
        });

        it('should only trim a fragment that has boundary whitespace', () => {
            const testName = 'Adjust: Trim Fragment';
            const html = '<p> a long phrase here </p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, ' a long phrase here ')!;
            const result = adjustSelectionRange(range);

            formatTestResultForExpand(testName, result, html, range);
            expect(result.adjusted).toBe(true);
            expect(result.range.toString()).toBe('a long phrase here');
        });

        it('should not adjust a complete word selection', () => {
            const testName = 'Adjust: No Change';
            const html = '<p>This is a word.</p>';
            const container = createTestDOM(html);
            const range = createRangeFromText(container, 'word')!;
            const result = adjustSelectionRange(range);

            formatTestResultForExpand(testName, result, html, range);
            expect(result.adjusted).toBe(false);
            expect(result.range.toString()).toBe('word');
        });
    });
});
