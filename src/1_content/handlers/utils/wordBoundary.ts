/**
 * Shared word-boundary definitions for selection classification and range expansion.
 */

// A word boundary is defined as whitespace, punctuation, symbols, OR any CJK character.
// This ensures that when handling mixed strings (e.g. "App的"), Latin words don't
// expand to include adjacent CJK characters.
export const WORD_BOUNDARY_REGEX = /[\s\p{P}\p{S}\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af\u3130-\u318f]/u