/**
 * MTranServer Translation Service
 *
 * Provides translation using self-hosted MTranServer
 * @see https://github.com/xxnuo/MTranServer
 */

import * as loggerModule from "@/0_common/utils/logger"
import type { MTranserverSettings } from "@/0_common/types"

const logger = loggerModule.createLogger("MTranServerService")

const MTRANSERVER_TIMEOUT = 10000 // 10 seconds timeout

/**
 * MTranServer language code mapping
 * Maps extension language codes to MTranServer language codes
 */
const LANGUAGE_CODE_MAP: Record<string, string> = {
    zh: "zh-Hans",
    "zh-tw": "zh-Hant",
    "zh-Hant": "zh-Hant",
    en: "en",
    ja: "ja",
    ko: "ko",
    fr: "fr",
    es: "es",
    de: "de",
    ru: "ru",
    it: "it",
    pt: "pt",
    nl: "nl",
    pl: "pl",
    vi: "vi",
    tr: "tr",
    hi: "hi",
    th: "th",
    id: "id",
    ms: "ms",
    ar: "ar",
    he: "he",
    fa: "fa",
    uk: "uk",
    bg: "bg",
    cs: "cs",
    sk: "sk",
    ro: "ro",
    hu: "hu",
    hr: "hr",
    sr: "sr",
    sl: "sl",
    et: "et",
    lv: "lv",
    lt: "lt",
    fi: "fi",
    sv: "sv",
    da: "da",
    nb: "nb",
    nn: "nn",
    el: "el",
    ca: "ca",
    bn: "bn",
    ta: "ta",
    te: "te",
    ml: "ml",
    kn: "kn",
    gu: "gu",
    pa: "pa",
    mr: "mr",
    ne: "ne",
    si: "si",
    km: "km",
    lo: "lo",
    my: "my",
    ka: "ka",
    am: "am",
    ti: "ti",
    sw: "sw",
    zu: "zu",
    af: "af",
    sq: "sq",
    az: "az",
    be: "be",
    bs: "bs",
    eu: "eu",
    gl: "gl",
    is: "is",
    ga: "ga",
    lb: "lb",
    mk: "mk",
    mt: "mt",
    cy: "cy",
}

/**
 * Map extension language code to MTranServer language code
 * @param langCode Extension language code
 * @returns MTranServer language code
 */
function mapToMTranServerLanguage(langCode: string): string {
    // Return mapped code or fallback to the original code
    return LANGUAGE_CODE_MAP[langCode] || langCode
}

/**
 * MTranServer translation request
 */
interface MTranTranslateRequest {
    from: string
    to: string
    text: string
}

/**
 * MTranServer translation response
 */
interface MTranTranslateResponse {
    result: string
}

/**
 * Error thrown when MTranServer request fails
 */
export class MTranServerError extends Error {
    constructor(
        message: string,
        public statusCode?: number,
        public responseBody?: string
    ) {
        super(message)
        this.name = "MTranServerError"
    }
}

/**
 * Test MTranServer connection
 * @param settings MTranServer settings
 * @returns Promise resolving to true if connection successful
 */
export async function testMTranServerConnection(settings: MTranserverSettings): Promise<boolean> {
    const { url, key } = settings

    if (!url || !url.trim()) {
        throw new MTranServerError("MTranServer URL is required")
    }

    const endpoint = `${url.replace(/\/$/, "")}/translate`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), MTRANSERVER_TIMEOUT)

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(key && key.trim() ? { Authorization: `Bearer ${key.trim()}` } : {}),
            },
            body: JSON.stringify({
                from: "auto",
                to: "zh-Hans",
                text: "hello",
            } as MTranTranslateRequest),
            signal: controller.signal,
        })

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "")
            logger.error("MTranServer test failed:", response.status, errorBody)
            throw new MTranServerError(
                `MTranServer responded with status ${response.status}`,
                response.status,
                errorBody
            )
        }

        const data = await response.json()
        logger.info("MTranServer connection test successful:", data)
        return true
    } catch (error) {
        if (error instanceof MTranServerError) {
            throw error
        }
        if (error instanceof Error && error.name === "AbortError") {
            logger.error("MTranServer connection test timeout")
            throw new MTranServerError(`Failed to connect to MTranServer: Connection timeout after ${MTRANSERVER_TIMEOUT / 1000}s`)
        }
        logger.error("MTranServer connection test failed:", error)
        throw new MTranServerError(`Failed to connect to MTranServer: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
        clearTimeout(timeoutId)
    }
}

/**
 * Translate text using MTranServer
 * @param text Text to translate
 * @param targetLanguage Target language code
 * @param settings MTranServer settings
 * @returns Translated text
 */
export async function translateWithMTranServer(
    text: string,
    targetLanguage: string,
    settings: MTranserverSettings
): Promise<string> {
    const { url, key } = settings

    if (!url || !url.trim()) {
        throw new MTranServerError("MTranServer URL is required")
    }

    const endpoint = `${url.replace(/\/$/, "")}/translate`
    // Always use 'auto' for source language detection
    const toLang = mapToMTranServerLanguage(targetLanguage)

    const requestBody: MTranTranslateRequest = {
        from: "auto",
        to: toLang,
        text: text,
    }

    logger.info("Sending MTranServer translation request:", requestBody)

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), MTRANSERVER_TIMEOUT)

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(key && key.trim() ? { Authorization: `Bearer ${key.trim()}` } : {}),
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        })

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "")
            logger.error("MTranServer translation failed:", response.status, errorBody)
            throw new MTranServerError(
                `MTranServer responded with status ${response.status}`,
                response.status,
                errorBody
            )
        }

        const data = await response.json() as MTranTranslateResponse
        logger.info("MTranServer translation successful:", data.result)
        return data.result
    } catch (error) {
        if (error instanceof MTranServerError) {
            throw error
        }
        if (error instanceof Error && error.name === "AbortError") {
            logger.error("MTranServer translation timeout")
            throw new MTranServerError(`Failed to translate: Connection timeout after ${MTRANSERVER_TIMEOUT / 1000}s`)
        }
        logger.error("MTranServer translation error:", error)
        throw new MTranServerError(`Failed to translate: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
        clearTimeout(timeoutId)
    }
}
