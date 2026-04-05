import Anthropic from "@anthropic-ai/sdk"
import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("ContextCompressor")

// ─── Constants ─────────────────────────────────────────────────

/** Default context window size (tokens) for supported models. */
const MODEL_CONTEXT_WINDOW = 131072
/** Safety buffer for estimation inaccuracy. */
const SAFETY_MARGIN = 4096
/** Trigger compression at this fraction of available context. */
const COMPRESSION_RATIO = 0.80
/** Reserved output tokens per LLM call. */
const MAX_TOKENS = 10000
/** Number of recent tool result entries to keep intact during micro-compact. */
const KEEP_RECENT_TOOL_RESULTS = 3
/** Max characters of conversation JSON fed to the summarization prompt. */
const SUMMARIZATION_INPUT_CAP = 80000
/** Max tokens for the summarization LLM call. */
const SUMMARIZATION_MAX_TOKENS = 2000
/** Minimum messages to keep when mechanical truncation is used as fallback. */
const MECHANICAL_TRUNCATION_KEEP = 6

// ─── CJK Detection ────────────────────────────────────────────

const CJK_RANGES = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/

function isCJK(char: string): boolean {
    return CJK_RANGES.test(char)
}

// ─── Summarization Prompt ──────────────────────────────────────

const SUMMARIZATION_PROMPT = `You are summarizing a conversation between a user and an AI assistant (TapWord Agent).
Create a concise summary that preserves all information needed to continue the work.

Include:
1. **Tasks completed**: What was accomplished, including specific file paths, function names, and code changes.
2. **Current state**: The user's last request and what was in progress when this summary was created.
3. **Key decisions**: Important choices made during the conversation and their rationale.
4. **Errors / blockers**: Any unresolved issues, error states, or things that were tried and failed.
5. **Active todos**: Current task list items and their status.

Rules:
- Be concise but complete. Aim for 300-500 words.
- Use structured bullet points.
- Preserve exact file paths, variable names, and technical terms.
- Do not include pleasantries or conversational filler.`

// ─── Interface ─────────────────────────────────────────────────

export interface IContextCompressor {
    /** CJK-aware heuristic token estimation. */
    estimateTokens(text: string): number

    /** Layer 1: Immutable tool result trimming, keep last N tool results. */
    microCompact(history: Anthropic.MessageParam[]): Anthropic.MessageParam[]

    /** Layer 2: LLM summarization — replaces history with [summary, ack]. */
    autoCompact(
        client: Anthropic,
        model: string,
        history: Anthropic.MessageParam[],
    ): Promise<{
        history: Anthropic.MessageParam[]
        summary: string
        compressedCount: number
        tokensBefore: number
        tokensAfter: number
    }>

    /** Check whether history token count exceeds the compression threshold. */
    shouldCompress(history: Anthropic.MessageParam[], systemTokens: number, toolTokens: number): boolean

    /** Compute the compression token threshold for given system/tool overhead. */
    getThreshold(systemTokens: number, toolTokens: number): number
}

// ─── Implementation ────────────────────────────────────────────

class ContextCompressor implements IContextCompressor {
    estimateTokens(text: string): number {
        let cjkChars = 0
        let otherChars = 0
        for (const char of text) {
            if (isCJK(char)) cjkChars++
            else otherChars++
        }
        return Math.ceil(cjkChars / 1.5 + otherChars / 4)
    }

    microCompact(history: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
        // Build a map of tool_use id → tool name from assistant messages
        const toolNameMap = new Map<string, string>()
        for (const msg of history) {
            if (msg.role !== "assistant" || typeof msg.content === "string") continue
            for (const block of msg.content) {
                if (block.type === "tool_use") {
                    toolNameMap.set(block.id, block.name)
                }
            }
        }

        // Collect indices of user messages that contain tool_result blocks
        const toolResultIndices: number[] = []
        for (let i = 0; i < history.length; i++) {
            const msg = history[i]!
            if (msg.role !== "user" || typeof msg.content === "string") continue
            const hasToolResult = (msg.content as Anthropic.ToolResultBlockParam[]).some(
                (block) => block.type === "tool_result",
            )
            if (hasToolResult) toolResultIndices.push(i)
        }

        // Indices to keep intact (last N)
        const keepSet = new Set(toolResultIndices.slice(-KEEP_RECENT_TOOL_RESULTS))

        // Build new history, trimming old tool results
        return history.map((msg, idx) => {
            if (msg.role !== "user" || typeof msg.content === "string") return msg
            if (keepSet.has(idx)) return msg

            const blocks = msg.content as Anthropic.ToolResultBlockParam[]
            const hasToolResult = blocks.some((b) => b.type === "tool_result")
            if (!hasToolResult) return msg

            const trimmedBlocks = blocks.map((block) => {
                if (block.type !== "tool_result") return block
                const contentStr = typeof block.content === "string" ? block.content : JSON.stringify(block.content)
                if (contentStr.length <= 100) return block

                const toolName = toolNameMap.get(block.tool_use_id) ?? "unknown"
                return {
                    ...block,
                    content: `[Previous: used ${toolName}]`,
                }
            })

            return { ...msg, content: trimmedBlocks }
        })
    }

    shouldCompress(
        history: Anthropic.MessageParam[],
        systemTokens: number,
        toolTokens: number,
    ): boolean {
        const threshold = this.getThreshold(systemTokens, toolTokens)
        const historyTokens = this.estimateTokens(JSON.stringify(history))

        logger.info(
            `Token check: history=${historyTokens}, threshold=${Math.round(threshold)}, available=${MODEL_CONTEXT_WINDOW - systemTokens - toolTokens - MAX_TOKENS - SAFETY_MARGIN}`,
        )

        return historyTokens > threshold
    }

    getThreshold(systemTokens: number, toolTokens: number): number {
        const availableForHistory = MODEL_CONTEXT_WINDOW - systemTokens - toolTokens - MAX_TOKENS - SAFETY_MARGIN
        return availableForHistory * COMPRESSION_RATIO
    }

    async autoCompact(
        client: Anthropic,
        model: string,
        history: Anthropic.MessageParam[],
    ): Promise<{
        history: Anthropic.MessageParam[]
        summary: string
        compressedCount: number
        tokensBefore: number
        tokensAfter: number
    }> {
        const tokensBefore = this.estimateTokens(JSON.stringify(history))
        const compressedCount = history.length

        logger.info(`Auto-compact triggered: ${compressedCount} messages, ~${tokensBefore} tokens`)

        // Persist raw transcript for recoverability
        try {
            const transcriptKey = `transcript_${Date.now()}`
            await chrome.storage.local.set({ [transcriptKey]: history })
            logger.info(`Transcript saved: ${transcriptKey}`)
        } catch (err) {
            logger.error("Failed to persist transcript:", err)
        }

        // Build summarization input (capped)
        const conversationJson = JSON.stringify(history)
        const truncatedConversation =
            conversationJson.length > SUMMARIZATION_INPUT_CAP
                ? conversationJson.slice(0, SUMMARIZATION_INPUT_CAP) + "\n...[truncated]"
                : conversationJson

        let summary: string
        try {
            const response = await client.messages.create({
                model,
                max_tokens: SUMMARIZATION_MAX_TOKENS,
                messages: [
                    {
                        role: "user",
                        content: `${SUMMARIZATION_PROMPT}\n\n<conversation>\n${truncatedConversation}\n</conversation>`,
                    },
                ],
            })

            // Extract text from response
            summary = response.content
                .filter((b): b is Anthropic.TextBlock => b.type === "text")
                .map((b) => b.text)
                .join("\n")

            logger.info(`Summarization complete: ${summary.length} chars`)
        } catch (err) {
            logger.error("Summarization LLM call failed, falling back to mechanical truncation:", err)
            return this.mechanicalTruncation(history, tokensBefore, compressedCount)
        }

        // Replace history with [summary, ack]
        const newHistory: Anthropic.MessageParam[] = [
            {
                role: "user",
                content: `[Context compressed — summary of previous conversation]\n\n${summary}`,
            },
            {
                role: "assistant",
                content: [
                    {
                        type: "text",
                        text: "Understood. I have the context from the summary and will continue from here.",
                    },
                ],
            },
        ]

        const tokensAfter = this.estimateTokens(JSON.stringify(newHistory))
        logger.info(`Compression result: ${tokensBefore} → ${tokensAfter} tokens (saved ~${tokensBefore - tokensAfter})`)

        return { history: newHistory, summary, compressedCount, tokensBefore, tokensAfter }
    }

    /** Fallback: keep last N messages when summarization fails. */
    private mechanicalTruncation(
        history: Anthropic.MessageParam[],
        tokensBefore: number,
        originalCount: number,
    ): {
        history: Anthropic.MessageParam[]
        summary: string
        compressedCount: number
        tokensBefore: number
        tokensAfter: number
    } {
        const kept = history.slice(-MECHANICAL_TRUNCATION_KEEP)

        // Ensure history starts with a user message (Anthropic API contract)
        let startIdx = 0
        while (startIdx < kept.length && kept[startIdx]!.role !== "user") {
            startIdx++
        }
        const validHistory: Anthropic.MessageParam[] = [
            {
                role: "user",
                content: "[Earlier context dropped due to length — some history may be missing]",
            },
            {
                role: "assistant",
                content: [{ type: "text", text: "Understood. Some earlier context has been dropped." }],
            },
            ...kept.slice(startIdx),
        ]

        const tokensAfter = this.estimateTokens(JSON.stringify(validHistory))
        const summary = "Context was mechanically truncated (summarization failed). Recent messages preserved."
        const compressedCount = originalCount - kept.slice(startIdx).length

        logger.info(`Mechanical truncation: kept ${validHistory.length} messages, ${tokensAfter} tokens`)

        return { history: validHistory, summary, compressedCount, tokensBefore, tokensAfter }
    }
}

export const contextCompressor = new ContextCompressor()
