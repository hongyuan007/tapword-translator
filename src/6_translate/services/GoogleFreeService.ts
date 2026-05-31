/**
 * Google Free Translation Service
 *
 * Provides translation using Google's legacy gtx API (no key required).
 */

import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("GoogleFreeService")

const GOOGLE_GTX_URL = "https://translate.googleapis.com/translate_a/single"
const REQUEST_TIMEOUT_MS = 10000

/** Language code mapping for Google Translate */
const LANGUAGE_CODE_MAP: Record<string, string> = {
    "zh-Hant": "zh-TW",
}

function mapLanguageCode(lang: string): string {
    return LANGUAGE_CODE_MAP[lang] ?? lang
}

/**
 * Translate text using Google free gtx translation API.
 * @param text - Text to translate
 * @param targetLang - Target language code (e.g., "zh", "en")
 */
export async function translateWithGoogleFree(text: string, targetLang: string): Promise<string> {
    const mappedLang = mapLanguageCode(targetLang)
    const url = `${GOOGLE_GTX_URL}?client=gtx&sl=auto&tl=${encodeURIComponent(mappedLang)}&dt=t&q=${encodeURIComponent(text)}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
        const response = await fetch(url, {
            method: "GET",
            signal: controller.signal,
        })

        if (!response.ok) {
            throw new Error(`Google Translate API error: ${response.status}`)
        }

        // Response format: nested arrays where result[0][i][0] are translation fragments
        const data = (await response.json()) as Array<unknown>
        const segments = data[0] as Array<[string, ...unknown[]]>
        if (!Array.isArray(segments)) {
            throw new Error("Google Translate returned unexpected format")
        }

        const result = segments.map((item) => item[0] ?? "").join("")
        if (!result) {
            throw new Error("Google Translate returned empty result")
        }

        logger.debug("Google Translate result:", { targetLang: mappedLang, result })
        return result
    } finally {
        clearTimeout(timer)
    }
}

/** Error class for Google Free translation errors */
export class GoogleFreeError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "GoogleFreeError"
    }
}
