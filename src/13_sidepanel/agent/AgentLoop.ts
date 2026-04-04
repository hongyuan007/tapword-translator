import Anthropic from "@anthropic-ai/sdk"
import * as loggerModule from "@/0_common/utils/logger"
import { createAnthropicClient } from "../api/AnthropicClient"
import { KnowledgeStore } from "../store/KnowledgeStore"
import { TodoManager } from "../store/TodoManager"
import { SYSTEM_PROMPT } from "./prompts"
import { TOOL_REGISTRY, TODO_TOOL_NAMES } from "./tools"
import type { ToolContext } from "./tools"

const logger = loggerModule.createLogger("AgentLoop")

const DEFAULT_MODEL = import.meta.env.VITE_AGENT_MODEL || "qwen3.5-plus"
const MAX_TOKENS = 4000
/** Max rounds without a todo update before injecting a nag reminder. */
const TODO_NAG_THRESHOLD = 3

const TOOL_DEFINITIONS = Array.from(TOOL_REGISTRY.values()).map((t) => t.definition)

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

// --- AgentLoop ---

export class AgentLoop {
    private client: Anthropic
    private history: Anthropic.MessageParam[] = []
    private knowledgeStore: KnowledgeStore
    private todoManager: TodoManager
    private apiKey: string
    private roundsSinceTodoUpdate: number = 0

    constructor(apiKey: string, knowledgeStore: KnowledgeStore, todoManager: TodoManager) {
        this.apiKey = apiKey
        this.client = createAnthropicClient(apiKey)
        this.knowledgeStore = knowledgeStore
        this.todoManager = todoManager
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

    async runAgent(userMessage: string, onTextUpdate: (text: string) => void, onToolUse?: (toolLabel: string) => void): Promise<string> {
        this.history.push({ role: "user", content: userMessage })

        while (true) {
            try {
                // Compute effective system prompt with optional nag reminder
                let effectiveSystem = SYSTEM_PROMPT
                if (this.roundsSinceTodoUpdate >= TODO_NAG_THRESHOLD && this.todoManager.getItems().length > 0) {
                    effectiveSystem += "\n\n<reminder>You have an active task list. Please update your todos to reflect current progress.</reminder>"
                }

                let response: Anthropic.Message
                try {
                    response = await this.client.messages.create({
                        model: DEFAULT_MODEL,
                        system: effectiveSystem,
                        messages: this.history,
                        tools: TOOL_DEFINITIONS,
                        max_tokens: MAX_TOKENS,
                    })
                } catch (error) {
                    logger.error("API call failed:", error)
                    throw classifyApiError(error)
                }

                // Append assistant turn
                this.history.push({ role: "assistant", content: response.content })

                // Extract text from this turn and notify UI
                const textParts = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map((block) => block.text)
                if (textParts.length > 0) {
                    onTextUpdate(textParts.join(""))
                }

                // If no tool use, we're done
                if (response.stop_reason !== "tool_use") {
                    return textParts.join("")
                }

                // Process tool calls
                const toolResults: Anthropic.ToolResultBlockParam[] = []
                for (const block of response.content) {
                    if (block.type !== "tool_use") continue

                    const toolReg = TOOL_REGISTRY.get(block.name)
                    const toolLabel = toolReg?.label || `Running ${block.name}...`
                    logger.info(`Tool call: ${block.name}`, JSON.stringify(block.input))
                    onToolUse?.(toolLabel)

                    try {
                        const result = await this.executeTool(block.name, block.input as Record<string, unknown>)
                        const preview =
                            result.length > 500
                                ? `${result.substring(0, 250)}...[${result.length} chars]...${result.substring(result.length - 250)}`
                                : result
                        logger.info(`Tool result (${block.name}): ${preview}`)
                        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result })
                    } catch (error) {
                        const errorMsg = error instanceof Error ? error.message : String(error)
                        logger.error(`Tool ${block.name} failed:`, errorMsg)
                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: block.id,
                            content: `Error: ${errorMsg}`,
                            is_error: true,
                        })
                    }
                }

                // Append tool results and continue loop
                this.history.push({ role: "user", content: toolResults })

                // Track todo update counter
                const calledTodoTool = response.content.some((block) => block.type === "tool_use" && TODO_TOOL_NAMES.has(block.name))
                if (calledTodoTool) {
                    this.roundsSinceTodoUpdate = 0
                } else {
                    this.roundsSinceTodoUpdate++
                }
            } catch (error) {
                logger.error("Unhandled error in agent loop:", error)
                throw error
            }
        }
    }

    private async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
        const tool = TOOL_REGISTRY.get(name)
        if (!tool) throw new Error(`Unknown tool: ${name}`)
        const context: ToolContext = { apiKey: this.apiKey, knowledgeStore: this.knowledgeStore, todoManager: this.todoManager }
        return tool.execute(input, context)
    }

    clearHistory(): void {
        this.history = []
        this.roundsSinceTodoUpdate = 0
        logger.info("Conversation history cleared")
    }
}
