/**
 * Traditional Chinese Support — TDD Tests for Storage and Display Layers
 *
 * Tests:
 * - detectBrowserLanguage should map zh-TW/zh-HK/zh-Hant browsers to zh-Hant
 * - SUPPORTED_LANGUAGES should include zh-Hant (indirect via detectBrowserLanguage)
 * - LANGUAGE_NAME_MAP should include zh-Hant → "繁體中文" (via getLanguageDisplayName)
 *
 * Expected: Feature-specific tests FAIL (red) until implementation.
 * Regression tests for existing languages should PASS (green).
 *
 * Proposal: docs/plan/y2026/month06/m06-traditional-chinese-support/proposal.md
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

// Mock platformDetector to avoid chrome.runtime.getPlatformInfo calls.
// storageManager imports getPlatformOS and PLATFORMS from this module.
vi.mock("@/0_common/utils/platformDetector", () => ({
    getPlatformOS: vi.fn().mockResolvedValue("mac"),
    PLATFORMS: { MAC: "mac", WIN: "windows", LINUX: "linux", OTHER: "other" },
}))

import { getUserSettings } from "@/0_common/utils/storageManager"
import { getLanguageDisplayName } from "@/0_common/utils/languageDisplay"

describe("Traditional Chinese Support — Storage and Display", () => {
    // ================================================================
    // Chrome API mock setup
    // ================================================================
    let mockChromeStorageGet: ReturnType<typeof vi.fn>
    let mockChromeStorageSet: ReturnType<typeof vi.fn>

    beforeEach(() => {
        // Default: no stored settings (simulates new user)
        mockChromeStorageGet = vi.fn((_key: string, callback: (result: any) => void) => {
            callback({})
        })
        mockChromeStorageSet = vi.fn((_data: any, callback: () => void) => {
            if (callback) callback()
        })

        global.chrome = {
            storage: {
                sync: {
                    get: mockChromeStorageGet,
                    set: mockChromeStorageSet,
                },
                local: {
                    get: vi.fn(),
                    set: vi.fn(),
                },
            },
            runtime: {
                lastError: undefined as any,
            },
        } as any
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    // ================================================================
    // detectBrowserLanguage — indirect tests via getUserSettings()
    // detectBrowserLanguage is private; we observe its effect on the
    // targetLanguage field of a new user's settings.
    // ================================================================
    describe("detectBrowserLanguage — zh-TW/zh-HK/zh-Hant browser → zh-Hant target", () => {
        it("navigator.language = 'zh-TW' → targetLanguage = 'zh-Hant'", async () => {
            // RED: Currently detectBrowserLanguage does split("-")[0] → "zh" (simplified).
            // After fix: precise match for zh-TW → "zh-Hant".
            vi.stubGlobal("navigator", {
                language: "zh-TW",
                languages: ["zh-TW", "zh", "en"],
            })

            const settings = await getUserSettings()
            expect(settings.targetLanguage).toBe("zh-Hant")
        })

        it("navigator.language = 'zh-HK' → targetLanguage = 'zh-Hant'", async () => {
            // RED: Currently detectBrowserLanguage does split("-")[0] → "zh" (simplified).
            // After fix: precise match for zh-HK → "zh-Hant".
            vi.stubGlobal("navigator", {
                language: "zh-HK",
                languages: ["zh-HK", "zh", "en"],
            })

            const settings = await getUserSettings()
            expect(settings.targetLanguage).toBe("zh-Hant")
        })

        it("navigator.language = 'zh-Hant' → targetLanguage = 'zh-Hant'", async () => {
            // RED: Currently "zh-Hant".split("-")[0] → "zh", which is in SUPPORTED_LANGUAGES.
            // After fix: "zh-Hant" should be in SUPPORTED_LANGUAGES and matched directly.
            vi.stubGlobal("navigator", {
                language: "zh-Hant",
                languages: ["zh-Hant", "zh", "en"],
            })

            const settings = await getUserSettings()
            expect(settings.targetLanguage).toBe("zh-Hant")
        })
    })

    describe("detectBrowserLanguage — regression for existing languages", () => {
        it("navigator.language = 'zh-CN' → targetLanguage = 'zh' (regression)", async () => {
            vi.stubGlobal("navigator", {
                language: "zh-CN",
                languages: ["zh-CN", "zh", "en"],
            })

            const settings = await getUserSettings()
            expect(settings.targetLanguage).toBe("zh")
        })

        it("navigator.language = 'en-US' → targetLanguage = 'en' (regression)", async () => {
            vi.stubGlobal("navigator", {
                language: "en-US",
                languages: ["en-US", "en"],
            })

            const settings = await getUserSettings()
            expect(settings.targetLanguage).toBe("en")
        })

        it("navigator.language = 'ja' → targetLanguage = 'ja' (regression)", async () => {
            vi.stubGlobal("navigator", {
                language: "ja",
                languages: ["ja", "en"],
            })

            const settings = await getUserSettings()
            expect(settings.targetLanguage).toBe("ja")
        })
    })

    // ================================================================
    // LANGUAGE_NAME_MAP — zh-Hant display name
    // getLanguageDisplayName tries Intl.DisplayNames first, then falls
    // back to LANGUAGE_NAME_MAP. These tests verify the overall behavior
    // is correct for zh-Hant.
    // ================================================================
    describe("getLanguageDisplayName — zh-Hant display name", () => {
        it("getLanguageDisplayName('zh-Hant') should not return raw code", () => {
            const name = getLanguageDisplayName("zh-Hant")
            // Should return a human-readable name, not the raw code "zh-Hant"
            expect(name).not.toBe("zh-Hant")
        })

        it("getLanguageDisplayName('zh-Hant', 'en') should not return raw code", () => {
            const name = getLanguageDisplayName("zh-Hant", "en")
            expect(name).not.toBe("zh-Hant")
        })

        it("getLanguageDisplayName('zh-Hant', 'zh') should contain Traditional Chinese characters", () => {
            const name = getLanguageDisplayName("zh-Hant", "zh")
            // Should contain 繁體 or 繁体 characters
            expect(name).toMatch(/繁[體体]/)
        })
    })
})
