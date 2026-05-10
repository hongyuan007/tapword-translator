/**
 * Full-Text Batch Generation Service
 *
 * Translates an array of text segments using a local LLM with XML batch strategy.
 * Mirrors the cloud backend full_text_batch service.
 */

import * as loggerModule from "@/0_common/utils/logger"
import type { LLMConfig, ChatMessage } from "../types/GenerateTypes"
import * as promptLoaderModule from "../utils/promptLoader"
import * as templateRendererModule from "../utils/templateRenderer"
import * as languageUtilsModule from "../utils/languageUtils"
import * as constants from "../constants/GenerateConstants"
import { OpenAICompatibleClient } from "./llm/OpenAICompatibleClient"

const logger = loggerModule.createLogger("FullTextBatchGenerationService")

// ============================================================================
// XML Utilities
// ============================================================================

/** Escape special XML characters in text content */
function escapeXml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
}

/** Unescape XML entities in translated content */
function unescapeXml(text: string): string {
    return text
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
}

// ============================================================================
// XML Response Parsing
// ============================================================================

/**
 * Parse LLM XML response into ordered translation array.
 * Uses iterative primary strategy with regex fallback.
 */
function parseXmlResponse(raw: string, expectedCount: number): string[] {
    const result: string[] = new Array(expectedCount).fill("")

    // Primary: iterative tag-by-tag extraction
    let searchPos = 0
    let matchCount = 0

    while (searchPos < raw.length) {
        const prefix = '<segment id="'
        const prefixIdx = raw.indexOf(prefix, searchPos)
        if (prefixIdx === -1) break

        const idStart = prefixIdx + prefix.length
        const quoteEnd = raw.indexOf('"', idStart)
        if (quoteEnd === -1) break

        const idStr = raw.slice(idStart, quoteEnd)
        const id = parseInt(idStr, 10)
        if (isNaN(id) || id < 0 || id >= expectedCount) {
            searchPos = quoteEnd + 1
            continue
        }

        const contentStart = raw.indexOf(">", quoteEnd)
        if (contentStart === -1) break

        const contentEnd = raw.indexOf("</segment>", contentStart + 1)
        if (contentEnd === -1) break

        result[id] = unescapeXml(raw.slice(contentStart + 1, contentEnd))
        matchCount++
        searchPos = contentEnd + "</segment>".length
    }

    if (matchCount === expectedCount) {
        return result
    }

    // Fallback: regex extraction
    logger.warn(`Primary XML parse got ${matchCount}/${expectedCount} segments, trying regex fallback`)
    const regex = /<segment id="(\d+)">([\s\S]*?)<\/segment>/g
    let match: RegExpExecArray | null
    let fallbackCount = 0
    const fallbackResult: string[] = new Array(expectedCount).fill("")

    while ((match = regex.exec(raw)) !== null) {
        const id = parseInt(match[1]!, 10)
        if (!isNaN(id) && id >= 0 && id < expectedCount) {
            fallbackResult[id] = unescapeXml(match[2]!)
            fallbackCount++
        }
    }

    if (fallbackCount !== expectedCount) {
        throw new Error(`XML segment count mismatch: expected ${expectedCount}, got ${fallbackCount}`)
    }

    return fallbackResult
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Translate a batch of texts using a local LLM
 *
 * @param texts - Source text segments
 * @param sourceLanguage - Source language code (e.g. "en")
 * @param targetLanguage - Target language code (e.g. "zh-CN")
 * @param config - LLM provider configuration
 * @returns Translated strings in the same order as input
 */
export async function generateFullTextBatch(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string,
    config: LLMConfig,
): Promise<string[]> {
    const service = new FullTextBatchGenerationService(config)
    await service.initialize()
    return service.translateBatch({ texts, sourceLanguage, targetLanguage })
}

/**
 * Full-Text Batch Generation Service
 *
 * Class-based service with pre-initialized prompts and LLM client.
 */
export class FullTextBatchGenerationService {
    private client: OpenAICompatibleClient
    private systemPrompt: string | null = null
    private userPromptTemplate: string | null = null

    constructor(config: LLMConfig) {
        this.client = new OpenAICompatibleClient(config)
        logger.info("FullTextBatchGenerationService initialized")
    }

    /** Load prompt templates from resources (call once before translateBatch) */
    async initialize(): Promise<void> {
        logger.debug("Loading prompts for full_text_batch")
        this.systemPrompt = await promptLoaderModule.loadSystemPrompt(constants.TASK_FULL_TEXT_BATCH)
        this.userPromptTemplate = await promptLoaderModule.loadUserPromptTemplate(constants.TASK_FULL_TEXT_BATCH)
        logger.info("Full-text batch prompts loaded successfully")
    }

    /**
     * Translate an array of text segments
     *
     * @param request - Batch translation request
     * @returns Array of translated strings (same length and order as input)
     */
    async translateBatch(request: {
        texts: string[]
        sourceLanguage: string
        targetLanguage: string
    }): Promise<string[]> {
        if (!this.systemPrompt || !this.userPromptTemplate) {
            throw new Error("Service not initialized. Call initialize() first.")
        }

        const { texts, sourceLanguage, targetLanguage } = request

        const { sourceName, targetName } = languageUtilsModule.getLanguageNames(sourceLanguage, targetLanguage)

        // Assemble XML input
        const xmlInput = texts
            .map((text, i) => `<segment id="${i}">${escapeXml(text)}</segment>`)
            .join("\n")

        // Render user prompt
        const userPrompt = templateRendererModule.renderTemplate(this.userPromptTemplate, {
            sourceLanguage: sourceName,
            targetLanguage: targetName,
            count: String(texts.length),
            text: xmlInput,
        })

        // Load language-specific fewshot examples
        const fewshotMessages = await promptLoaderModule.loadFewshot(constants.TASK_FULL_TEXT_BATCH, targetLanguage)

        // Build message sequence
        const messages: ChatMessage[] = [
            { role: "system", content: this.systemPrompt },
            ...fewshotMessages,
            { role: "user", content: userPrompt },
        ]

        logger.debug("Sending full-text batch request", {
            sourceLanguage,
            targetLanguage,
            segmentCount: texts.length,
        })

        const rawContent = await this.client.generateText(messages)

        const translations = parseXmlResponse(rawContent, texts.length)

        logger.info("Full-text batch translation completed", {
            segmentCount: texts.length,
        })

        return translations
    }
}
