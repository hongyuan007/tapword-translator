/**
 * OpenAICompatibleClient Unit Test — useMaxCompletionTokens flag
 *
 * Verifies that the client sends `max_completion_tokens` when
 * `useMaxCompletionTokens` is true, and `max_tokens` otherwise.
 *
 * These tests are written BEFORE the implementation change (TDD red phase).
 * They are expected to FAIL until the source code is updated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ChatMessage } from "@/8_generate/types/GenerateTypes"

// ── Mock openai module ──────────────────────────────────────────────
const mockCreate = vi.fn()

vi.mock("openai", () => {
    return {
        default: class MockOpenAI {
            chat = {
                completions: {
                    create: mockCreate,
                },
            }
        },
        APIConnectionTimeoutError: class {},
        RateLimitError: class {},
        BadRequestError: class {},
    }
})

import { OpenAICompatibleClient } from "@/8_generate/services/llm/OpenAICompatibleClient"
import type { LLMConfig } from "@/8_generate/types/GenerateTypes"

// ── Helpers ─────────────────────────────────────────────────────────

const baseConfig: LLMConfig = {
    apiKey: "test-key",
    baseUrl: "https://api.test.com/v1",
    model: "gpt-5",
    temperature: 0.3,
    maxTokens: 1200,
    timeout: 30000,
}

const messages: ChatMessage[] = [
    { role: "system", content: "You are a translator." },
    { role: "user", content: "Translate: hello" },
]

function mockResponse() {
    return {
        choices: [{ message: { content: '{"translation":"test"}' } }],
    }
}

function makeClient(overrides: Partial<LLMConfig> = {}): OpenAICompatibleClient {
    return new OpenAICompatibleClient({ ...baseConfig, ...overrides })
}

// ── Tests ───────────────────────────────────────────────────────────

describe("OpenAICompatibleClient — useMaxCompletionTokens flag", () => {
    beforeEach(() => {
        mockCreate.mockReset()
        mockCreate.mockResolvedValue(mockResponse())
    })

    // ── Flag disabled (default): uses max_tokens ────────────────────

    it("default (flag absent) uses max_tokens", async () => {
        const client = makeClient()
        await client.generate(messages)

        expect(mockCreate).toHaveBeenCalledTimes(1)
        const callArg = mockCreate.mock.calls[0][0]
        expect(callArg).toHaveProperty("max_tokens", 1200)
        expect(callArg).not.toHaveProperty("max_completion_tokens")
    })

    it("explicit false uses max_tokens", async () => {
        const client = makeClient({ useMaxCompletionTokens: false })
        await client.generate(messages)

        const callArg = mockCreate.mock.calls[0][0]
        expect(callArg).toHaveProperty("max_tokens", 1200)
        expect(callArg).not.toHaveProperty("max_completion_tokens")
    })

    // ── Flag enabled: uses max_completion_tokens ────────────────────

    it("flag enabled uses max_completion_tokens", async () => {
        const client = makeClient({ useMaxCompletionTokens: true })
        await client.generate(messages)

        const callArg = mockCreate.mock.calls[0][0]
        expect(callArg).toHaveProperty("max_completion_tokens", 1200)
        expect(callArg).not.toHaveProperty("max_tokens")
    })

    it("flag enabled + different model name same behavior", async () => {
        const client = makeClient({ useMaxCompletionTokens: true, model: "gpt-5-mini" })
        await client.generate(messages)

        const callArg = mockCreate.mock.calls[0][0]
        expect(callArg).toHaveProperty("max_completion_tokens")
        expect(callArg).not.toHaveProperty("max_tokens")
    })

    // ── Non-OpenAI model without flag: uses max_tokens ──────────────

    it("third-party model without flag uses max_tokens", async () => {
        const client = makeClient({ model: "deepseek-chat" })
        await client.generate(messages)

        const callArg = mockCreate.mock.calls[0][0]
        expect(callArg).toHaveProperty("max_tokens", 1200)
        expect(callArg).not.toHaveProperty("max_completion_tokens")
    })

    it("third-party model with flag uses max_completion_tokens", async () => {
        // If a third-party provider also requires max_completion_tokens, the user can opt in
        const client = makeClient({ model: "custom-future-model", useMaxCompletionTokens: true })
        await client.generate(messages)

        const callArg = mockCreate.mock.calls[0][0]
        expect(callArg).toHaveProperty("max_completion_tokens", 1200)
        expect(callArg).not.toHaveProperty("max_tokens")
    })

    // ── generateText method: same flag behavior ─────────────────────

    it("generateText with flag uses max_completion_tokens", async () => {
        mockCreate.mockResolvedValue({ choices: [{ message: { content: "plain text" } }] })
        const client = makeClient({ useMaxCompletionTokens: true })
        await client.generateText(messages)

        const callArg = mockCreate.mock.calls[0][0]
        expect(callArg).toHaveProperty("max_completion_tokens", 1200)
        expect(callArg).not.toHaveProperty("max_tokens")
    })
})
