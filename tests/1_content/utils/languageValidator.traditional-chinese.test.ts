/**
 * Traditional Chinese Support — TDD Tests for languageValidator
 *
 * These tests validate the behavior described in proposal.md (方案 B):
 * - zh-Hant target language should be differentiated from zh (Simplified)
 * - Simplified Chinese pages should NOT suppress Traditional Chinese translation
 * - Traditional Chinese pages SHOULD suppress Traditional Chinese translation
 * - normalizeLanguageTag should preserve full BCP 47 tags (not truncate to "zh")
 *
 * Expected: Feature-specific tests FAIL (red) until implementation is done.
 * Regression tests for existing languages should PASS (green).
 *
 * Proposal: docs/plan/y2026/month06/m06-traditional-chinese-support/proposal.md
 */

import { shouldTriggerTranslationAsync } from "@/1_content/utils/languageValidator"
import { describe, expect, it, vi, afterEach } from "vitest"

// Mock languageDetector (same pattern as languageValidator.unit.test.ts)
vi.mock("@/1_content/utils/languageDetector", () => ({
    detectSourceLanguageAsync: vi.fn(),
}))

/**
 * Stub document language signals for page-level language detection.
 * Same pattern as existing languageValidator.unit.test.ts
 */
function stubDocumentLanguageSignals(options: {
    htmlLang?: string
    xmlLang?: string
    ogLocale?: string
    contentLanguage?: string
}) {
    vi.stubGlobal("document", {
        documentElement: {
            lang: options.htmlLang ?? "",
            getAttribute: (name: string) => (name === "xml:lang" ? options.xmlLang ?? "" : ""),
        },
        querySelector: (selector: string) => {
            if (selector === 'meta[property="og:locale"]' && options.ogLocale) {
                return {
                    getAttribute: (name: string) => (name === "content" ? options.ogLocale ?? "" : ""),
                }
            }
            if (selector === 'meta[http-equiv="content-language"]' && options.contentLanguage) {
                return {
                    getAttribute: (name: string) => (name === "content" ? options.contentLanguage ?? "" : ""),
                }
            }
            return null
        },
    })
}

describe("Traditional Chinese Support — shouldTriggerTranslationAsync", () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    // ================================================================
    // 正常路径（should trigger = true）
    // ================================================================
    describe("Normal paths — translation should trigger", () => {
        it("English text with zh-Hant target → true", async () => {
            // English text should always trigger translation regardless of target language.
            // This test passes even before the fix (zh-Hant→zh, English text → true).
            expect(await shouldTriggerTranslationAsync("Hello world", "zh-Hant")).toBe(true)
        })

        it("Simplified Chinese text with zh-Hant target → true (简繁应区分)", async () => {
            // RED: Currently zh-Hant → split("-")[0] → "zh", Chinese text detected → suppressed (false)
            // After fix: Simplified Chinese ≠ Traditional Chinese → should trigger (true)
            expect(await shouldTriggerTranslationAsync("你好世界", "zh-Hant")).toBe(true)
        })

        it("Simplified Chinese page (zh-CN) + English selection + zh-Hant target → true", async () => {
            stubDocumentLanguageSignals({ htmlLang: "zh-CN" })
            // RED: Currently zh-CN → normalize → "zh", zh-Hant → split → "zh" → match → suppressed (false)
            // After fix: zh-CN (simplified) ≠ zh-Hant (traditional) → should trigger (true)
            expect(await shouldTriggerTranslationAsync("iPhone", "zh-Hant")).toBe(true)
        })
    })

    // ================================================================
    // 异常路径（should suppress = false）
    // ================================================================
    describe("Suppression paths — translation should NOT trigger", () => {
        it("Traditional Chinese text with zh-Hant target → false (same language)", async () => {
            // Text is Traditional Chinese, target is Traditional Chinese → suppress.
            // Currently passes (both sides truncate to "zh" → Chinese text detected → suppress).
            // After fix: should still pass (isSameLanguage("zh-Hant", "zh-Hant") → true → suppress).
            expect(await shouldTriggerTranslationAsync("測試繁體中文", "zh-Hant")).toBe(false)
        })

        it("Traditional Chinese page (zh-TW) + English selection + zh-Hant target → false", async () => {
            stubDocumentLanguageSignals({ htmlLang: "zh-TW" })
            // Page is Traditional Chinese, target is Traditional Chinese → suppress.
            // Currently passes (both truncate to "zh" → page declares "zh" → suppress).
            // After fix: should still pass (isSameLanguage("zh-TW", "zh-Hant") → true → suppress).
            expect(await shouldTriggerTranslationAsync("Release", "zh-Hant")).toBe(false)
        })
    })

    // ================================================================
    // normalizeLanguageTag — preserves full BCP 47 tags
    // Tested indirectly via getPageDeclaredLanguage behavior
    // ================================================================
    describe("normalizeLanguageTag — preserves full BCP 47 tags (indirect)", () => {
        it("Traditional Chinese page (zh-Hant) + English selection + Simplified target (zh) → true", async () => {
            stubDocumentLanguageSignals({ htmlLang: "zh-Hant" })
            // RED: Currently normalizeLanguageTag("zh-Hant") → "zh", matches target "zh" → suppressed (false)
            // After fix: normalizeLanguageTag("zh-Hant") → "zh-Hant" ≠ "zh" → trigger (true)
            expect(await shouldTriggerTranslationAsync("Release", "zh")).toBe(true)
        })

        it("Traditional Chinese page (zh-TW) + English selection + Simplified target (zh) → true", async () => {
            stubDocumentLanguageSignals({ htmlLang: "zh-TW" })
            // RED: Currently normalizeLanguageTag("zh-TW") → "zh", matches target "zh" → suppressed (false)
            // After fix: zh-TW (traditional) ≠ zh (simplified) → trigger (true)
            expect(await shouldTriggerTranslationAsync("Release", "zh")).toBe(true)
        })
    })

    // ================================================================
    // isSameLanguage — indirect behavioral tests
    // Validates the Chinese simplified/traditional differentiation logic
    // ================================================================
    describe("isSameLanguage logic — indirect behavioral tests", () => {
        it("zh-CN page + English + zh target → false (same: both simplified)", async () => {
            stubDocumentLanguageSignals({ htmlLang: "zh-CN" })
            // Regression: Simplified page + Simplified target → suppress (false)
            expect(await shouldTriggerTranslationAsync("Release", "zh")).toBe(false)
        })

        it("zh-TW page + English + zh-Hant target → false (same: both traditional)", async () => {
            stubDocumentLanguageSignals({ htmlLang: "zh-TW" })
            // Traditional page + Traditional target → suppress (false)
            // Currently passes accidentally (both → "zh"), should pass correctly after fix.
            expect(await shouldTriggerTranslationAsync("Release", "zh-Hant")).toBe(false)
        })

        it("zh-CN page + English + zh-Hant target → true (different: simplified vs traditional)", async () => {
            stubDocumentLanguageSignals({ htmlLang: "zh-CN" })
            // RED: Currently both truncate to "zh" → suppressed (false)
            // After fix: zh-CN (simplified) ≠ zh-Hant (traditional) → trigger (true)
            expect(await shouldTriggerTranslationAsync("Release", "zh-Hant")).toBe(true)
        })

        it("zh-Hans page + English + zh-Hant target → true (different: simplified vs traditional)", async () => {
            stubDocumentLanguageSignals({ htmlLang: "zh-Hans" })
            // RED: Currently normalizeLanguageTag("zh-Hans") → "zh", zh-Hant → "zh" → match → suppressed (false)
            // After fix: zh-Hans (simplified) ≠ zh-Hant (traditional) → trigger (true)
            expect(await shouldTriggerTranslationAsync("Release", "zh-Hant")).toBe(true)
        })
    })

    // ================================================================
    // isSameLanguage — direct tests (waiting for implementation)
    // These tests will be enabled after isSameLanguage is exported.
    // Until then, we test the behavior indirectly via shouldTriggerTranslationAsync above.
    // ================================================================
    describe.todo("isSameLanguage (direct unit tests — waiting for export)", () => {
        // Proposal defines isSameLanguage with the following expected behavior:
        // - zh-CN vs zh-Hant → false (simplified page ≠ traditional target)
        // - zh-TW vs zh-Hant → true (traditional page = traditional target)
        // - zh-Hans vs zh-Hant → false (simplified page ≠ traditional target)
        // - zh vs zh-Hant → false (bare zh treated as simplified)
        // - en vs en → true (regression)
        // - ja vs en → false (regression)
        // - ko vs ja → false (regression)
        //
        // Enable these tests once isSameLanguage is implemented and exported from
        // languageValidator.ts or a new module.
        it.todo("zh-CN vs zh-Hant → false")
        it.todo("zh-TW vs zh-Hant → true")
        it.todo("zh-Hans vs zh-Hant → false")
        it.todo("zh vs zh-Hant → false (bare zh treated as simplified)")
        it.todo("en vs en → true (regression)")
        it.todo("ja vs en → false (regression)")
        it.todo("ko vs ja → false (regression)")
    })

    // ================================================================
    // 回归验证（确保现有语言不受影响）
    // ================================================================
    describe("Regression — existing languages unchanged", () => {
        it("Simplified Chinese text + zh target → false (suppress)", async () => {
            expect(await shouldTriggerTranslationAsync("你好世界", "zh")).toBe(false)
        })

        it("English text + en target → true", async () => {
            expect(await shouldTriggerTranslationAsync("Hello", "en")).toBe(true)
        })

        it("Japanese text + ja target → false (suppress)", async () => {
            expect(await shouldTriggerTranslationAsync("こんにちは", "ja")).toBe(false)
        })

        it("English text + zh target → true (not Chinese text)", async () => {
            expect(await shouldTriggerTranslationAsync("Hello world", "zh")).toBe(true)
        })

        it("Korean text + ko target → false (suppress)", async () => {
            expect(await shouldTriggerTranslationAsync("안녕하세요", "ko")).toBe(false)
        })

        it("Russian text + ru target → false (suppress)", async () => {
            expect(await shouldTriggerTranslationAsync("Привет", "ru")).toBe(false)
        })
    })
})
