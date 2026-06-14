/**
 * OpenAI-Compatible LLM Client
 *
 * OpenAI-compatible client for calling LLM APIs with JSON response enforcement
 */

import OpenAI, { APIConnectionTimeoutError, RateLimitError, BadRequestError } from "openai"
import * as loggerModule from "@/0_common/utils/logger"
import type { LLMConfig, ChatMessage } from "../../types/GenerateTypes"
import * as constants from "../../constants/GenerateConstants"

const logger = loggerModule.createLogger("8_generate/OpenAICompatibleClient")

/**
 * OpenAI-Compatible LLM Client
 *
 * Provides a unified interface for calling OpenAI-compatible LLM APIs.
 * Supports providers like OpenAI, Qwen, Gemini, etc.
 */
export class OpenAICompatibleClient {
    private client: OpenAI
    private model: string
    private temperature: number
    private maxTokens: number

    /**
     * Create a new LLM client instance
     * @param config LLM provider configuration
     */
    constructor(config: LLMConfig) {
        if (!config.apiKey || !config.baseUrl || !config.model) {
            throw new Error("Missing required LLM configuration: apiKey, baseUrl, or model")
        }

        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseUrl,
            timeout: config.timeout || constants.DEFAULT_TIMEOUT,
            dangerouslyAllowBrowser: true, // Allow in browser extension context
        })

        this.model = config.model
        this.temperature = config.temperature ?? constants.DEFAULT_TEMPERATURE
        this.maxTokens = config.maxTokens ?? constants.DEFAULT_MAX_TOKENS

        logger.info(`Initialized OpenAICompatibleClient with model: ${this.model}`)
    }

    /**
     * Generate completion from LLM
     *
     * @param messages Array of chat messages (system, user, assistant)
     * @returns Generated content as string (JSON format)
     * @throws Error for various failure scenarios (timeout, rate limit, etc.)
     */
    async generate(messages: ChatMessage[]): Promise<string> {
        try {
            logger.debug(`Sending request to LLM (model: ${this.model}, messages: ${messages.length})`)

            const isNewModel = constants.NEW_MODEL_PATTERN.test(this.model)

            const completion = await this.client.chat.completions.create({
                model: this.model,
                messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
                temperature: this.temperature,
                ...(isNewModel
                    ? { max_completion_tokens: this.maxTokens }
                    : { max_tokens: this.maxTokens }),
                response_format: { type: "json_object" },
            })

            const content = completion.choices[0]?.message?.content

            if (!content) {
                throw new Error("Invalid LLM response: empty content")
            }

            logger.debug(`Received response from LLM (length: ${content.length})`)
            return content
        } catch (error) {
            logger.error("LLM generation error:", error)

            if (error instanceof RateLimitError) {
                throw new Error("Rate limit exceeded. Please try again later.")
            }

            if (error instanceof BadRequestError) {
                if (error.code === "data_inspection_failed" || error.message.includes("inappropriate")) {
                    throw new Error("Content moderation failed. The input may contain inappropriate content.")
                }
                throw new Error(`Bad request: ${error.message}`)
            }

            if (error instanceof APIConnectionTimeoutError) {
                throw new Error("Request timeout. Please check your network connection and try again.")
            }

            // Re-throw if already an Error
            if (error instanceof Error) {
                throw error
            }

            // Generic error
            throw new Error("LLM generation failed. Please try again.")
        }
    }

    /**
     * Generate plain-text completion from LLM (no JSON response_format enforced)
     *
     * @param messages Array of chat messages (system, user, assistant)
     * @returns Generated content as string (plain text / XML)
     * @throws Error for various failure scenarios (timeout, rate limit, etc.)
     */
    async generateText(messages: ChatMessage[]): Promise<string> {
        try {
            logger.debug(`Sending text request to LLM (model: ${this.model}, messages: ${messages.length})`)

            const completion = await this.client.chat.completions.create({
                model: this.model,
                messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
                temperature: this.temperature,
                max_tokens: this.maxTokens,
            })

            const content = completion.choices[0]?.message?.content

            if (!content) {
                throw new Error("Invalid LLM response: empty content")
            }

            logger.debug(`Received text response from LLM (length: ${content.length})`)
            return content
        } catch (error) {
            logger.error("LLM text generation error:", error)

            if (error instanceof RateLimitError) {
                throw new Error("Rate limit exceeded. Please try again later.")
            }

            if (error instanceof BadRequestError) {
                if (error.code === "data_inspection_failed" || error.message.includes("inappropriate")) {
                    throw new Error("Content moderation failed. The input may contain inappropriate content.")
                }
                throw new Error(`Bad request: ${error.message}`)
            }

            if (error instanceof APIConnectionTimeoutError) {
                throw new Error("Request timeout. Please check your network connection and try again.")
            }

            // Re-throw if already an Error
            if (error instanceof Error) {
                throw error
            }

            // Generic error
            throw new Error("LLM text generation failed. Please try again.")
        }
    }
}

/**
 * Create a new LLM client with configuration
 * @param config LLM provider configuration
 * @returns OpenAICompatibleClient instance
 */
export function createOpenAICompatibleClient(config: LLMConfig): OpenAICompatibleClient {
    return new OpenAICompatibleClient(config)
}
