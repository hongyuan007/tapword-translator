/**
 * OpenAICompatibleClient Unit Test
 *
 * Verifies that the client uses `max_completion_tokens` for new OpenAI models
 * (gpt-5*, o1, o3, o4) and `max_tokens` for legacy/third-party models.
 *
 * These tests are written BEFORE the implementation change (TDD red phase).
 * They are expected to FAIL until the source code is updated.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ChatMessage } from "@/8_generate/types/GenerateTypes"

// ── Mock openai module ──────────────────────────────────────────────
// Capture the mock create function so we can inspect call arguments.
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

// Import AFTER mock is set up so the mocked module is used.
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
        choices: [{ message: { content: '{"translation":"测试"}' } }],
    }
}

function makeClient(model: string): OpenAICompatibleClient {
    return new OpenAICompatibleClient({ ...baseConfig, model })
}

// ── Tests ───────────────────────────────────────────────────────────

describe("OpenAICompatibleClient - max_tokens parameter handling", () => {
    beforeEach(() => {
        mockCreate.mockReset()
        mockCreate.mockResolvedValue(mockResponse())
    })

    // ── New models: should use max_completion_tokens ────────────────

    it("gpt-5 uses max_completion_tokens, not max_tokens", async () => {
        const client = makeClient("gpt-5")
        await client.generate(messages)

        expect(mockCreate).toHaveBeenCalledTimes(1)
        const callArg = mockCreate.mock.calls[0][0]

        expect(callArg).toHaveProperty("max_completion_tokens")
        expect(callArg).not.toHaveProperty("max_tokens")
    })

    it("gpt-5.4-nano uses max_completion_tokens, not max_tokens", async () => {
        const client = makeClient("gpt-5.4-nano")
        await client.generate(messages)

        expect(mockCreate).toHaveBeenCalledTimes(1)
        const callArg = mockCreate.mock.calls[0][0]

        expect(callArg).toHaveProperty("max_completion_tokens")
        expect(callArg).not.toHaveProperty("max_tokens")
    })

    it("o1 uses max_completion_tokens, not max_tokens", async () => {
        const client = makeClient("o1")
        await client.generate(messages)

        expect(mockCreate).toHaveBeenCalledTimes(1)
        const callArg = mockCreate.mock.calls[0][0]

        expect(callArg).toHaveProperty("max_completion_tokens")
        expect(callArg).not.toHaveProperty("max_tokens")
    })

    it("o3-mini uses max_completion_tokens, not max_tokens", async () => {
        const client = makeClient("o3-mini")
        await client.generate(messages)

        expect(mockCreate).toHaveBeenCalledTimes(1)
        const callArg = mockCreate.mock.calls[0][0]

        expect(callArg).toHaveProperty("max_completion_tokens")
        expect(callArg).not.toHaveProperty("max_tokens")
    })

    // ── Legacy / third-party models: should use max_tokens ──────────

    it("gpt-4o uses max_tokens, not max_completion_tokens", async () => {
        const client = makeClient("gpt-4o")
        await client.generate(messages)

        expect(mockCreate).toHaveBeenCalledTimes(1)
        const callArg = mockCreate.mock.calls[0][0]

        expect(callArg).toHaveProperty("max_tokens")
        expect(callArg).not.toHaveProperty("max_completion_tokens")
    })

    it("gpt-4o-mini uses max_tokens, not max_completion_tokens", async () => {
        const client = makeClient("gpt-4o-mini")
        await client.generate(messages)

        expect(mockCreate).toHaveBeenCalledTimes(1)
        const callArg = mockCreate.mock.calls[0][0]

        expect(callArg).toHaveProperty("max_tokens")
        expect(callArg).not.toHaveProperty("max_completion_tokens")
    })

    it("qwen-max uses max_tokens, not max_completion_tokens", async () => {
        const client = makeClient("qwen-max")
        await client.generate(messages)

        expect(mockCreate).toHaveBeenCalledTimes(1)
        const callArg = mockCreate.mock.calls[0][0]

        expect(callArg).toHaveProperty("max_tokens")
        expect(callArg).not.toHaveProperty("max_completion_tokens")
    })

    it("deepseek-chat uses max_tokens, not max_completion_tokens", async () => {
        const client = makeClient("deepseek-chat")
        await client.generate(messages)

        expect(mockCreate).toHaveBeenCalledTimes(1)
        const callArg = mockCreate.mock.calls[0][0]

        expect(callArg).toHaveProperty("max_tokens")
        expect(callArg).not.toHaveProperty("max_completion_tokens")
    })

    // ── Edge cases ─────────────────────────────────────────────────

    it("unknown model name defaults to max_tokens", async () => {
        const client = makeClient("some-unknown-model")
        await client.generate(messages)

        expect(mockCreate).toHaveBeenCalledTimes(1)
        const callArg = mockCreate.mock.calls[0][0]

        expect(callArg).toHaveProperty("max_tokens")
        expect(callArg).not.toHaveProperty("max_completion_tokens")
    })

    it("uppercase GPT-5 is recognized as new model", async () => {
        const client = makeClient("GPT-5")
        await client.generate(messages)

        expect(mockCreate).toHaveBeenCalledTimes(1)
        const callArg = mockCreate.mock.calls[0][0]

        expect(callArg).toHaveProperty("max_completion_tokens")
        expect(callArg).not.toHaveProperty("max_tokens")
    })

    it("uppercase O1 is recognized as new model", async () => {
        const client = makeClient("O1")
        await client.generate(messages)

        expect(mockCreate).toHaveBeenCalledTimes(1)
        const callArg = mockCreate.mock.calls[0][0]

        expect(callArg).toHaveProperty("max_completion_tokens")
        expect(callArg).not.toHaveProperty("max_tokens")
    })

    it("empty model name throws configuration error", async () => {
        expect(() => makeClient("")).toThrow("Missing required LLM configuration")
    })
})
