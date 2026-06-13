import { shouldTriggerTranslationAsync } from "@/1_content/utils/languageValidator"
import { describe, expect, it, vi } from "vitest"

// Mock languageDetector
vi.mock("@/1_content/utils/languageDetector", () => ({
    detectSourceLanguageAsync: vi.fn()
}))
import { detectSourceLanguageAsync } from "@/1_content/utils/languageDetector"

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

describe("shouldTriggerTranslationAsync", () => {
    it("returns true when target language is not Chinese", async () => {
        expect(await shouldTriggerTranslationAsync("有些中文", "en")).toBe(true)
    })

    it("returns true when target is Chinese but text is not Chinese", async () => {
        expect(await shouldTriggerTranslationAsync("Hello world", "zh")).toBe(true)
        expect(await shouldTriggerTranslationAsync("123456", "zh")).toBe(true)
    })

    it("returns false when target is Chinese and text is Chinese", async () => {
        expect(await shouldTriggerTranslationAsync("你好世界", "zh")).toBe(false)
        expect(await shouldTriggerTranslationAsync("这是一段测试文本", "zh-CN")).toBe(false)
    })

    it("returns true when Japanese kana is present in Chinese target", async () => {
        expect(await shouldTriggerTranslationAsync("こんにちは", "zh")).toBe(true)
        expect(await shouldTriggerTranslationAsync("カタカナ", "zh")).toBe(true)
        expect(await shouldTriggerTranslationAsync("日本語のテスト", "zh")).toBe(true)
    })

    it("handles mixed content based on ratio (threshold 0.05)", async () => {
        // Mostly Chinese -> Suppress (2/4 = 50% > 5%)
        expect(await shouldTriggerTranslationAsync("你好ab", "zh")).toBe(false)
        // Very low CJK ratio -> Show (1/30 = 3.3% < 5%)
        expect(await shouldTriggerTranslationAsync("你abcdefghijklmnopqrstuvwxyz", "zh")).toBe(true)
    })

    it("suppresses English selection if context is Chinese (Target: zh)", async () => {
        vi.mocked(detectSourceLanguageAsync).mockResolvedValue({ lang: "zh", blockContextLang: "zh" })
        // "iPhone" is English, but context is Chinese
        expect(await shouldTriggerTranslationAsync("iPhone", "zh", "我们正在讨论 iPhone 15 Pro 的新功能")).toBe(false)
    })

    it("does not suppress English selection on mostly English context with a small Chinese snippet", async () => {
        const mixedEnglishContext = [
            "Release v0.4.2 ships translation latency improvements and iframe support.",
            "Features include MTranServer and Bing Translate integration.",
            "A linked PR title says 添加Mtranserver与必应翻译支持, but the page content is otherwise English.",
        ].join(" ")

        expect(await shouldTriggerTranslationAsync("support", "zh", mixedEnglishContext)).toBe(true)
    })

    it("suppresses English selection if context is detected as 'auto' with high CJK density (Target: zh)", async () => {
        vi.mocked(detectSourceLanguageAsync).mockResolvedValue({ lang: "auto", blockContextLang: "zh" })
        // "openclaw" is English, context is a Chinese paragraph that also contains the Latin word.
        // detectSourceLanguageAsync returns "auto" (mixed CJK+Latin), but the context is CJK-dominant.
        const chineseParagraph = "这是一段关于openclaw这个话题的中文内容，大家都很感兴趣这个项目。"
        expect(await shouldTriggerTranslationAsync("openclaw", "zh", chineseParagraph)).toBe(false)
    })

    it("suppresses refactor inside a Chinese-dominant mixed phrase", async () => {
        const mixedChineseContext = "本次迭代中，已完成3个API接口的refactor，代码质量大幅提升。"

        expect(await shouldTriggerTranslationAsync("refactor", "zh", mixedChineseContext)).toBe(false)
    })

    it("does not suppress on Japanese context when target is zh and context is 'auto' with Kana", async () => {
        vi.mocked(detectSourceLanguageAsync).mockResolvedValue({ lang: "auto", blockContextLang: "ja" })
        // Japanese page (has Kana) with an English word: should NOT be suppressed for a Chinese user
        const japaneseContext = "これはiPhoneに関する日本語のテキストです。最新モデルが人気です。"
        expect(await shouldTriggerTranslationAsync("iPhone", "zh", japaneseContext)).toBe(true)
    })

    it("shows English selection if context is English (Target: zh)", async () => {
        vi.mocked(detectSourceLanguageAsync).mockResolvedValue({ lang: "en", blockContextLang: "en" })
        // "iPhone" is English, context is English
        expect(await shouldTriggerTranslationAsync("iPhone", "zh", "We are discussing iPhone 15 Pro")).toBe(true)
    })

    it("handles empty strings safely", async () => {
        expect(await shouldTriggerTranslationAsync("", "zh")).toBe(true)
    })

    describe("Page Metadata Detection", () => {
        it("suppresses when html lang declares zh", async () => {
            stubDocumentLanguageSignals({ htmlLang: "zh-CN" })

            expect(await shouldTriggerTranslationAsync("Release", "zh")).toBe(false)
            vi.unstubAllGlobals()
        })

        it("uses xml:lang when html lang is missing", async () => {
            // Use zh-CN (simplified) so that isSameLanguage("zh-cn", "zh") → true → suppress.
            // With zh-TW, the new logic correctly differentiates traditional ≠ simplified → trigger.
            stubDocumentLanguageSignals({ xmlLang: "zh-CN" })

            expect(await shouldTriggerTranslationAsync("Release", "zh")).toBe(false)
            vi.unstubAllGlobals()
        })

        it("uses og:locale when html metadata is absent", async () => {
            stubDocumentLanguageSignals({ ogLocale: "zh_CN" })

            expect(await shouldTriggerTranslationAsync("Release", "zh")).toBe(false)
            vi.unstubAllGlobals()
        })

        it("uses content-language when stronger metadata is absent", async () => {
            stubDocumentLanguageSignals({ contentLanguage: "zh-CN, en" })

            expect(await shouldTriggerTranslationAsync("Release", "zh")).toBe(false)
            vi.unstubAllGlobals()
        })

        it("does not let weaker metadata override html lang", async () => {
            stubDocumentLanguageSignals({
                htmlLang: "en",
                ogLocale: "zh_CN",
                contentLanguage: "zh-CN",
            })

            expect(await shouldTriggerTranslationAsync("Release", "zh", "Mostly English page text")).toBe(true)
            vi.unstubAllGlobals()
        })
    })

    describe("Language Specific Suppression", () => {
        it("suppresses Japanese text (Kana) when target is Japanese", async () => {
            expect(await shouldTriggerTranslationAsync("こんにちは", "ja")).toBe(false)
            expect(await shouldTriggerTranslationAsync("日本語のテスト", "ja")).toBe(false)
        })

        it("shows pure Kanji text when target is Japanese", async () => {
            expect(await shouldTriggerTranslationAsync("学生", "ja")).toBe(true)
        })

        it("shows non-Japanese text when target is Japanese", async () => {
            expect(await shouldTriggerTranslationAsync("Hello", "ja")).toBe(true)
        })

        it("suppresses Korean text (Hangul) when target is Korean", async () => {
            expect(await shouldTriggerTranslationAsync("안녕하세요", "ko")).toBe(false)
            expect(await shouldTriggerTranslationAsync("한국어", "ko")).toBe(false)
        })

        it("shows non-Korean text when target is Korean", async () => {
            expect(await shouldTriggerTranslationAsync("Hello", "ko")).toBe(true)
        })

        it("suppresses Russian text (Cyrillic) when target is Russian", async () => {
            expect(await shouldTriggerTranslationAsync("Привет", "ru")).toBe(false)
            expect(await shouldTriggerTranslationAsync("Русский", "ru")).toBe(false)
        })

        it("shows non-Russian text when target is Russian", async () => {
            expect(await shouldTriggerTranslationAsync("Hello", "ru")).toBe(true)
        })
    })

    describe("Async Context Detection (Generic Languages)", () => {
        it("always returns true for English target regardless of context", async () => {
            expect(await shouldTriggerTranslationAsync("Hola", "en")).toBe(true)
        })

        it("suppresses when context language matches target language (e.g., Spanish)", async () => {
            vi.mocked(detectSourceLanguageAsync).mockResolvedValue({ lang: "es", blockContextLang: "es" })
            // Context matches target 'es' -> Suppress
            expect(await shouldTriggerTranslationAsync("Hola", "es", "Hola mundo esta es una prueba")).toBe(false)
        })

        it("shows translation when context language differs from target (e.g., Spanish)", async () => {
            vi.mocked(detectSourceLanguageAsync).mockResolvedValue({ lang: "en", blockContextLang: "en" })
            // Context 'en' != Target 'es' -> Show
            expect(await shouldTriggerTranslationAsync("Hello", "es", "Hello world this is a test")).toBe(true)
        })

        it("shows translation if no context is provided for generic languages", async () => {
            // No context provided -> default to true
            expect(await shouldTriggerTranslationAsync("Hola", "es")).toBe(true)
        })
    })
})
