import { detectSourceLanguageAsync } from "@/1_content/utils/languageDetector";
import { afterEach, describe, expect, it, vi } from "vitest";

// These tests run in Node env. We simulate `chrome` on globalThis.

function mockChromeDetectLanguage(lang: string) {
    const chromeMock = {
        i18n: {
            detectLanguage: vi.fn((text: string, cb: (res: chrome.i18n.LanguageDetectionResult) => void) => {
                cb({
                    isReliable: true,
                    languages: [
                        { language: lang, percentage: 95 },
                    ],
                })
            }),
        },
    } as unknown as typeof chrome
    ;(globalThis as any).chrome = chromeMock
    return chromeMock
}

describe("detectSourceLanguageAsync (with mocked chrome)", () => {
    const originalChrome = (globalThis as any).chrome

    afterEach(() => {
        // Restore original chrome after each test
        if (originalChrome === undefined) {
            delete (globalThis as any).chrome
        } else {
            ;(globalThis as any).chrome = originalChrome
        }
        vi.restoreAllMocks()
    })

    it("uses chrome.i18n.detectLanguage when available", async () => {
        const chromeMock = mockChromeDetectLanguage("fr")
        const { lang } = await detectSourceLanguageAsync("Ceci est une phrase de test.")
        expect(lang).toBe("fr")
        expect(chromeMock.i18n.detectLanguage).toHaveBeenCalled()
    })

    it("falls back to franc-min when chrome is unavailable", async () => {
        delete (globalThis as any).chrome
        const { lang } = await detectSourceLanguageAsync("Ceci est une phrase de test.")
        // franc should detect French → fr
        expect(lang).toBe("fr")
    })

    it("returns 'en' for empty input without calling APIs", async () => {
        const chromeMock = mockChromeDetectLanguage("es")
        const { lang } = await detectSourceLanguageAsync("")
        expect(lang).toBe("en")
        expect(chromeMock.i18n.detectLanguage).not.toHaveBeenCalled()
    })
})
