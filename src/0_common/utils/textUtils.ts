
/**
 * Check if text is a single word (no spaces, simple term)
 *
 * Rules:
 * - No spaces (excluding leading/trailing whitespace)
 * - Allows hyphens for compound words like "self-aware"
 * - Allows apostrophes for contractions/possessives like "don't", "John's"
 * - Only alphabetic characters (a-z, A-Z)
 *
 * @param text The text to validate
 * @returns true if it's a single valid word, false otherwise
 *
 * @example
 * isSingleWord("hello")          // true
 * isSingleWord("hello world")    // false
 * isSingleWord("self-aware")     // true
 * isSingleWord("don't")          // true
 * isSingleWord("John's")         // true
 * isSingleWord("hello123")       // false (contains numbers)
 * isSingleWord("")               // false
 * isSingleWord("  hello  ")      // true (trimmed)
 */
export function isSingleWord(text: string): boolean {
    if (!text || text.trim().length === 0) {
        return false
    }

    const trimmed = text.trim()

    // Check for spaces (excluding leading/trailing)
    if (trimmed.includes(" ")) {
        return false
    }

    // Allow hyphens for compound words like "self-aware"
    // Allow apostrophes for contractions/possessives like "don't", "John's"
    // Only alphabetic characters (a-z, A-Z)
    const wordPattern = /^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$/i
    return wordPattern.test(trimmed)
}

/**
 * Check if text contains meaningful words (letters or numbers)
 *
 * @param text The text to validate
 * @returns true if text contains at least one letter or number
 */
export function containsMeaningfulWords(text: string | undefined): boolean {
    if (!text) {
        return false
    }
    // Check if the text contains any word characters (letters, numbers, etc.)
    // This regex matches any alphanumeric character including Unicode letters
    return /\p{L}|\p{N}/u.test(text)
}
