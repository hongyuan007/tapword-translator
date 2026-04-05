import type Anthropic from "@anthropic-ai/sdk"
import * as loggerModule from "@/0_common/utils/logger"
import type { ToolRegistration } from "./tools/types"
import type { McpToolCallbacks } from "./AgentLoop"
import { isProxyArtifact } from "./utils/isProxyArtifact"
import { retryWithBackoff } from "./utils/retryWithBackoff"

const logger = loggerModule.createLogger("SubagentRunner")

/** Maximum number of LLM rounds a subagent can execute. */
const MAX_SUBAGENT_ROUNDS = 40
/** Max tokens for each subagent LLM call. */
const SUBAGENT_MAX_TOKENS = 20000

/** Callbacks for forwarding subagent progress events to the parent UI. */
export interface SubagentCallbacks {
    onThinkingUpdate?: (thinkingDelta: string, thinkingSnapshot: string) => void
    onThinkingComplete?: () => void
    onTextUpdate?: (textDelta: string, textSnapshot: string) => void
    onToolCallStart?: (toolCallId: string, toolName: string, toolLabel: string) => void
    onToolCallComplete?: (toolCallId: string, result: string, isError: boolean) => void
}

/** Result of a completed subagent execution. */
export interface SubagentResult {
    /** Final text summary from the subagent. */
    summary: string
    /** Number of LLM rounds the subagent took. */
    rounds: number
    /** Number of tool calls executed. */
    toolCallCount: number
}

/**
 * Run a subagent with a fresh context and filtered toolset.
 * The subagent executes a standalone LLM loop and returns only its final text summary.
 * All internal message history is discarded after execution.
 */
export async function runSubagent(
    client: Anthropic,
    model: string,
    systemPrompt: string,
    prompt: string,
    tools: Map<string, ToolRegistration>,
    callbacks?: SubagentCallbacks,
    mcpCallbacks?: McpToolCallbacks | null,
    signal?: AbortSignal,
): Promise<SubagentResult> {
    // Merge local tool definitions with MCP tool definitions
    const localToolDefs = Array.from(tools.values()).map((t) => t.definition)
    const mcpToolDefs = mcpCallbacks?.getMcpToolDefinitions() ?? []
    const toolDefs = [...localToolDefs, ...mcpToolDefs]
    const messages: Anthropic.MessageParam[] = [
        { role: "user", content: prompt },
    ]

    let rounds = 0
    let toolCallCount = 0

    for (let i = 0; i < MAX_SUBAGENT_ROUNDS; i++) {
        // Check abort signal before each LLM round
        if (signal?.aborted) {
            logger.info("Subagent aborted by signal")
            break
        }

        rounds++

        // Stream LLM response with real-time event forwarding (retry on transient errors)
        const response = await retryWithBackoff("SubagentRunner", async () => {
            const stream = client.messages.stream(
                {
                    model,
                    system: systemPrompt,
                    messages,
                    tools: toolDefs,
                    max_tokens: SUBAGENT_MAX_TOKENS,
                },
                signal ? { signal } : {},
            )

            stream.on("thinking", (delta, snapshot) => {
                callbacks?.onThinkingUpdate?.(delta, snapshot)
            })

            stream.on("text", (delta, snapshot) => {
                if (isProxyArtifact(snapshot)) {
                    logger.warn("Proxy artifact detected in text stream", snapshot.slice(0, 200))
                }
                callbacks?.onTextUpdate?.(delta, snapshot)
            })

            stream.on("contentBlock", (block) => {
                if (block.type === "thinking") {
                    callbacks?.onThinkingComplete?.()
                }
            })

            return await stream.finalMessage()
        })

        messages.push({ role: "assistant", content: response.content })

        if (response.stop_reason !== "tool_use") {
            break
        }

        // Execute all tool calls from this response
        const toolResults: Anthropic.ToolResultBlockParam[] = []
        for (const block of response.content) {
            if (block.type !== "tool_use") continue
            toolCallCount++

            const toolReg = tools.get(block.name)
            const toolLabel = toolReg?.label ?? resolveMcpToolLabel(block.name, mcpCallbacks)
            callbacks?.onToolCallStart?.(block.id, block.name, toolLabel)

            try {
                const result = await executeTool(block.name, block.input as Record<string, unknown>, tools, mcpCallbacks)
                callbacks?.onToolCallComplete?.(block.id, result, false)
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: result,
                })
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error)
                callbacks?.onToolCallComplete?.(block.id, errMsg, true)
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: `Error: ${errMsg}`,
                    is_error: true,
                })
            }
        }

        messages.push({ role: "user", content: toolResults })
    }

    // Extract final text from the last assistant message
    const summary = extractSummary(messages)

    logger.info(
        `Subagent completed: ${rounds} rounds, ${toolCallCount} tool calls, summary: ${summary.length} chars`,
    )
    return { summary, rounds, toolCallCount }
}

/** Execute a tool by name: local tools take priority, then MCP tools. */
async function executeTool(
    name: string,
    input: Record<string, unknown>,
    tools: Map<string, ToolRegistration>,
    mcpCallbacks?: McpToolCallbacks | null,
): Promise<string> {
    const localTool = tools.get(name)
    if (localTool) return localTool.execute(input)

    if (mcpCallbacks) {
        const serverId = mcpCallbacks.getMcpToolMap().get(name)
        if (serverId) {
            return mcpCallbacks.callMcpTool(serverId, name, input)
        }
    }

    throw new Error(`Unknown tool: ${name}`)
}

/** Resolve a human-readable label for an MCP tool call. */
function resolveMcpToolLabel(toolName: string, mcpCallbacks?: McpToolCallbacks | null): string {
    if (mcpCallbacks) {
        const serverId = mcpCallbacks.getMcpToolMap().get(toolName)
        if (serverId) {
            return `[${serverId}] ${toolName}`
        }
    }
    return `Running ${toolName}...`
}

/** Walk backwards through messages to find the last assistant text content. */
function extractSummary(messages: Anthropic.MessageParam[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]!
        if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue

        const texts = (msg.content as Array<{ type: string; text?: string }>)
            .filter((b) => b.type === "text" && b.text)
            .map((b) => b.text!)

        if (texts.length > 0) {
            return texts.join("\n")
        }
    }
    return "(no summary produced)"
}
