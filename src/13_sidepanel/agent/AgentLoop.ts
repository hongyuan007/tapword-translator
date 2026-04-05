import Anthropic from "@anthropic-ai/sdk"
import * as loggerModule from "@/0_common/utils/logger"
import { createAnthropicClient } from "../api/AnthropicClient"
import { todoManager } from "@/13_sidepanel/services/TodoManager"
import type { AgentCallbacks } from "../types"
import type { ContextUsage } from "../types"
import { skillStorageService } from "@/13_sidepanel/services/SkillStorageService"
import { buildSystemPrompt } from "./prompts"
import { TOOL_REGISTRY, TODO_TOOL_NAMES } from "./tools"
import { createSubagentTool, TASK_TOOL_NAME } from "./tools/subagentTool"
import type { SubagentToolRegistration } from "./tools/subagentTool"
import { contextCompressor } from "./utils/ContextCompressor"
import { retryWithBackoff } from "./utils/retryWithBackoff"

const logger = loggerModule.createLogger("AgentLoop")

/** Fallback model when no model is configured in agentSettings. */
const FALLBACK_MODEL = import.meta.env.VITE_AGENT_MODEL || ""
const MAX_TOKENS = 10000
/** Max rounds without a todo update before injecting a nag reminder. */
const TODO_NAG_THRESHOLD = 3
/** Cap percentage at this value to avoid displaying > 100%. */
const MAX_PERCENTAGE = 100

/** MCP tool integration callbacks. */
export interface McpToolCallbacks {
    /** Get Anthropic-format tool definitions for enabled MCP tools. */
    getMcpToolDefinitions: () => Anthropic.Tool[]
    /** Route a tool call to the appropriate MCP server. */
    callMcpTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<string>
    /** Get a Map<toolName, serverId> for enabled MCP tools. */
    getMcpToolMap: () => Map<string, string>
}

// --- Error types ---

const AUTH_ERROR_MESSAGE = "Invalid API key. Please check your DashScope API key in settings."
const RATE_LIMIT_ERROR_MESSAGE = "Rate limit exceeded. Please wait a moment and try again."
const NETWORK_ERROR_MESSAGE = "Network error. Please check your connection."

export class AgentError extends Error {
    readonly isAuthError: boolean

    constructor(message: string, isAuthError = false) {
        super(message)
        this.name = "AgentError"
        this.isAuthError = isAuthError
    }
}

/** Thrown when the agent loop is aborted by the user. */
export class AgentAbortError extends Error {
    constructor() {
        super("Agent execution aborted by user.")
        this.name = "AgentAbortError"
    }
}

function classifyApiError(error: unknown): AgentError {
    if (error && typeof error === "object" && "status" in error) {
        const status = (error as { status: number }).status
        if (status === 401 || status === 403) {
            return new AgentError(AUTH_ERROR_MESSAGE, true)
        }
        if (status === 429) {
            return new AgentError(RATE_LIMIT_ERROR_MESSAGE)
        }
        const msg = error instanceof Error ? error.message : String(error)
        return new AgentError(`API error (${status}): ${msg}`)
    }
    if (error instanceof TypeError) {
        return new AgentError(NETWORK_ERROR_MESSAGE)
    }
    const msg = error instanceof Error ? error.message : String(error)
    return new AgentError(msg)
}

// --- Internal types ---

/** Context computed once per `runAgent()` invocation and reused across loop iterations. */
interface RunInvocationContext {
    baseSystemPrompt: string
    allToolDefs: Anthropic.Tool[]
    systemTokens: number
    toolTokens: number
}

// --- AgentLoop ---

export class AgentLoop {
    private client: Anthropic
    private model: string
    private history: Anthropic.MessageParam[] = []
    private roundsSinceTodoUpdate: number = 0
    private mcpCallbacks: McpToolCallbacks | null = null
    /** Runtime tool registry = static tools + dynamically created subagent tool. */
    private runtimeToolRegistry = new Map(TOOL_REGISTRY)
    /** Abort controller for the current `runAgent()` invocation. */
    private abortController: AbortController | null = null

    constructor(apiKey: string, mcpCallbacks?: McpToolCallbacks, model?: string) {
        this.client = createAnthropicClient(apiKey)
        this.model = model || FALLBACK_MODEL
        this.mcpCallbacks = mcpCallbacks ?? null
    }

    // Restore LLM conversation history from simplified message pairs
    restoreHistory(messages: Array<{ role: "user" | "assistant"; content: string }>): void {
        this.history = messages
            .filter((m) => m.content)
            .map((m) => {
                if (m.role === "user") {
                    return { role: "user" as const, content: m.content }
                }
                return {
                    role: "assistant" as const,
                    content: [{ type: "text" as const, text: m.content }],
                }
            })
        logger.info(`Restored ${this.history.length} history entries`)
    }

    /** Abort the current `runAgent()` invocation. Safe to call when no invocation is running. */
    abort(): void {
        if (this.abortController) {
            logger.info("Aborting agent loop")
            this.abortController.abort()
        }
    }

    async runAgent(userMessage: string, callbacks: AgentCallbacks): Promise<string> {
        // Reset abort state for each invocation
        this.abortController = new AbortController()
        const signal = this.abortController.signal

        this.history.push({ role: "user", content: userMessage })

        const ctx = await this.prepareInvocationContext(signal)
        let compressionCooldown = false

        while (true) {
            try {
                // ── Abort check ──
                if (signal.aborted) throw new AgentAbortError()

                // ── Context management ──
                this.history = contextCompressor.microCompact(this.history)
                this.emitContextUsage(callbacks, ctx.systemTokens, ctx.toolTokens)
                compressionCooldown = await this.compressContextIfNeeded(
                    callbacks, ctx.systemTokens, ctx.toolTokens, compressionCooldown,
                )

                // ── Abort check before LLM call ──
                if (signal.aborted) throw new AgentAbortError()

                // ── LLM call ──
                const effectiveSystem = this.buildEffectiveSystemPrompt(ctx.baseSystemPrompt)
                const { response, accumulatedText } = await this.streamLlmResponse(
                    effectiveSystem, ctx.allToolDefs, callbacks, signal,
                )

                this.history.push({ role: "assistant", content: response.content })

                // ── Terminal condition: no tool calls ──
                if (response.stop_reason !== "tool_use") {
                    this.emitContextUsage(callbacks, ctx.systemTokens, ctx.toolTokens)
                    return accumulatedText
                }

                // ── Abort check before tool execution ──
                if (signal.aborted) throw new AgentAbortError()

                // ── Tool execution round ──
                const toolResults = await this.processToolCalls(response, callbacks)
                this.history.push({ role: "user", content: toolResults })
                this.updateTodoProgress(response)
            } catch (error) {
                if (error instanceof AgentAbortError) {
                    logger.info("Agent loop aborted by user")
                    throw error
                }
                logger.error("Unhandled error in agent loop:", error)
                throw error
            }
        }
    }

    // ── Extracted private helpers for runAgent ──────────────────────────

    /** Prepare tools, system prompt, and token budgets for a single `runAgent()` invocation. */
    private async prepareInvocationContext(signal: AbortSignal): Promise<RunInvocationContext> {
        const skillMetas = await skillStorageService.loadSkillMetas()
        const baseSystemPrompt = buildSystemPrompt(skillMetas)

        // Create subagent tool (bound to this loop's client/model), passing abort signal
        const subagentTool = createSubagentTool(this.client, this.model, TOOL_REGISTRY, this.mcpCallbacks, signal)
        this.runtimeToolRegistry = new Map(TOOL_REGISTRY)
        this.runtimeToolRegistry.set(subagentTool.definition.name, subagentTool)

        // Build dynamic tool list: local tools + MCP tools
        const localToolDefs = Array.from(this.runtimeToolRegistry.values()).map((t) => t.definition)
        const mcpToolDefs = this.mcpCallbacks?.getMcpToolDefinitions() ?? []
        const allToolDefs = [...localToolDefs, ...mcpToolDefs]

        const systemTokens = contextCompressor.estimateTokens(baseSystemPrompt)
        const toolTokens = contextCompressor.estimateTokens(JSON.stringify(allToolDefs))

        return { baseSystemPrompt, allToolDefs, systemTokens, toolTokens }
    }

    /** Build the system prompt, appending a todo-nag reminder when the agent hasn't updated todos recently. */
    private buildEffectiveSystemPrompt(baseSystemPrompt: string): string {
        if (this.roundsSinceTodoUpdate >= TODO_NAG_THRESHOLD && todoManager.getItems().length > 0) {
            return baseSystemPrompt + "\n\n<reminder>You have an active task list. Please update your todos to reflect current progress.</reminder>"
        }
        return baseSystemPrompt
    }

    /** Run Layer 2 auto-compact if the context exceeds the compression threshold. Returns updated cooldown flag. */
    private async compressContextIfNeeded(
        callbacks: AgentCallbacks,
        systemTokens: number,
        toolTokens: number,
        compressionCooldown: boolean,
    ): Promise<boolean> {
        if (compressionCooldown || !contextCompressor.shouldCompress(this.history, systemTokens, toolTokens)) {
            return compressionCooldown
        }
        callbacks.onCompactionStart(this.history.length)
        const result = await contextCompressor.autoCompact(
            this.client,
            this.model,
            this.history,
        )
        this.history = result.history
        callbacks.onCompactionComplete(result.summary, {
            compressedCount: result.compressedCount,
            tokensBefore: result.tokensBefore,
            tokensAfter: result.tokensAfter,
        })
        return true
    }

    /** Open a streaming LLM call, wire up delta callbacks, and await the final message. */
    private async streamLlmResponse(
        effectiveSystem: string,
        allToolDefs: Anthropic.Tool[],
        callbacks: AgentCallbacks,
        signal: AbortSignal,
    ): Promise<{ response: Anthropic.Message; accumulatedText: string }> {
        let accumulatedText = ""

        try {
            const response = await retryWithBackoff("AgentLoop", async () => {
                const stream = this.client.messages.stream(
                    {
                        model: this.model,
                        system: effectiveSystem,
                        messages: this.history,
                        tools: allToolDefs,
                        max_tokens: MAX_TOKENS,
                    },
                    { signal },
                )

                stream.on("thinking", (delta, snapshot) => {
                    callbacks.onThinkingUpdate(delta, snapshot)
                })

                stream.on("text", (delta, snapshot) => {
                    accumulatedText = snapshot
                    callbacks.onTextUpdate(delta, snapshot)
                })

                stream.on("contentBlock", (block) => {
                    if (block.type === "thinking") {
                        callbacks.onThinkingComplete()
                    }
                })

                return await stream.finalMessage()
            })
            return { response, accumulatedText }
        } catch (error) {
            logger.error("Streaming API call failed:", error)
            throw classifyApiError(error)
        }
    }

    /** Execute all tool_use blocks from the LLM response, collecting results for the next turn. */
    private async processToolCalls(
        response: Anthropic.Message,
        callbacks: AgentCallbacks,
    ): Promise<Anthropic.ToolResultBlockParam[]> {
        const toolResults: Anthropic.ToolResultBlockParam[] = []

        for (const block of response.content) {
            if (block.type !== "tool_use") continue

            const toolReg = this.runtimeToolRegistry.get(block.name)
            const toolLabel = toolReg?.label || this.resolveMcpToolLabel(block.name)
            logger.info(`Tool call: ${block.name}`, JSON.stringify(block.input))

            // Subagent tool: emit SubagentBlock and inject execution context
            if (block.name === TASK_TOOL_NAME) {
                const description = (block.input as Record<string, unknown>).description as string || "subtask"
                callbacks.onSubagentStart(block.id, description)

                // Inject parent context so the subagent tool can bridge streaming events
                const subagentReg = toolReg as SubagentToolRegistration | undefined
                subagentReg?.setExecutionContext(block.id, callbacks)
            } else {
                callbacks.onToolCallStart(block.id, block.name, toolLabel, block.input as Record<string, unknown>)
            }

            try {
                const result = await this.executeTool(block.name, block.input as Record<string, unknown>)
                const preview =
                    result.length > 500
                        ? `${result.substring(0, 250)}...[${result.length} chars]...${result.substring(result.length - 250)}`
                        : result
                logger.info(`Tool result (${block.name}): ${preview}`)
                callbacks.onToolCallComplete(block.id, result, false)
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: result,
                })
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error)
                logger.error(`Tool ${block.name} failed:`, errorMsg)
                callbacks.onToolCallComplete(block.id, `Error: ${errorMsg}`, true)
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: `Error: ${errorMsg}`,
                    is_error: true,
                })
            }
        }

        return toolResults
    }

    /** Increment or reset the todo-nag counter based on whether a todo tool was called. */
    private updateTodoProgress(response: Anthropic.Message): void {
        const calledTodoTool = response.content.some(
            (block) => block.type === "tool_use" && TODO_TOOL_NAMES.has(block.name),
        )
        if (calledTodoTool) {
            this.roundsSinceTodoUpdate = 0
        } else {
            this.roundsSinceTodoUpdate++
        }
    }

    /** Resolve a human-readable label for an MCP tool call. */
    private resolveMcpToolLabel(toolName: string): string {
        if (this.mcpCallbacks) {
            const serverId = this.mcpCallbacks.getMcpToolMap().get(toolName)
            if (serverId) {
                return `[${serverId}] ${toolName}`
            }
        }
        return `Running ${toolName}...`
    }

    /** Execute a tool by name: local tools take priority, then MCP tools. */
    private async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
        // Local tools take priority (includes dynamically registered subagent tool)
        const localTool = this.runtimeToolRegistry.get(name)
        if (localTool) return localTool.execute(input)

        // Try MCP tools
        if (this.mcpCallbacks) {
            const mcpToolMap = this.mcpCallbacks.getMcpToolMap()
            const serverId = mcpToolMap.get(name)
            if (serverId) {
                return this.mcpCallbacks.callMcpTool(serverId, name, input)
            }
        }

        throw new Error(`Unknown tool: ${name}`)
    }

    clearHistory(): void {
        this.history = []
        this.roundsSinceTodoUpdate = 0
        logger.info("Conversation history cleared")
    }

    /** Compute and emit a context usage snapshot. */
    private emitContextUsage(
        callbacks: AgentCallbacks,
        systemTokens: number,
        toolTokens: number,
    ): void {
        const threshold = contextCompressor.getThreshold(systemTokens, toolTokens)
        const tokensUsed = contextCompressor.estimateTokens(JSON.stringify(this.history))
        const percentage = Math.min(
            Math.round((tokensUsed / threshold) * MAX_PERCENTAGE),
            MAX_PERCENTAGE,
        )
        const usage: ContextUsage = { tokensUsed, threshold: Math.round(threshold), percentage }
        callbacks.onContextUsageUpdate(usage)
    }
}
