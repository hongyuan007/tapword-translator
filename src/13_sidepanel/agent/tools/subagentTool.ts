import type Anthropic from "@anthropic-ai/sdk"
import * as loggerModule from "@/0_common/utils/logger"
import type { ToolRegistration } from "./types"
import { runSubagent } from "../SubagentRunner"
import type { SubagentCallbacks } from "../SubagentRunner"
import { buildSubagentSystemPrompt } from "../prompts"
import type { AgentCallbacks } from "../../types"
import type { McpToolCallbacks } from "../AgentLoop"

const logger = loggerModule.createLogger("subagentTool")

/** Tool name for the subagent dispatch tool. */
export const TASK_TOOL_NAME = "task"

/** Maximum characters for the subagent summary returned to the parent. */
const MAX_SUMMARY_LENGTH = 5000

/** Tool names excluded from the subagent's toolset. */
const EXCLUDED_TOOLS = new Set([
    TASK_TOOL_NAME,        // Prevent recursive subagent spawning
    "create_todos",        // Todo management is parent-only
    "update_todo_status",
    "complete_task",
])

/**
 * Extended ToolRegistration with a method to inject the parent execution context.
 * AgentLoop calls `setExecutionContext()` before `execute()` for the subagent tool.
 */
export interface SubagentToolRegistration extends ToolRegistration {
    /** Inject the parent's toolCallId and callbacks before execute(). */
    setExecutionContext: (toolCallId: string, callbacks: AgentCallbacks) => void
}

/**
 * Create a SubagentCallbacks bridge that translates subagent streaming events
 * into parent AgentCallbacks.onSubagentBlockUpdate calls.
 */
function createSubagentCallbackBridge(
    toolCallId: string,
    parentCallbacks: AgentCallbacks,
): SubagentCallbacks {
    let phase: "idle" | "thinking" | "text" = "idle"

    return {
        onThinkingUpdate: (_delta, snapshot) => {
            parentCallbacks.onSubagentBlockUpdate(toolCallId, (blocks) => {
                if (phase !== "thinking") {
                    phase = "thinking"
                    return [...blocks, { type: "thinking", content: snapshot, isStreaming: true }]
                }
                const updated = [...blocks]
                const last = updated[updated.length - 1]
                if (last?.type === "thinking") {
                    updated[updated.length - 1] = { ...last, content: snapshot }
                }
                return updated
            })
        },

        onThinkingComplete: () => {
            phase = "idle"
            parentCallbacks.onSubagentBlockUpdate(toolCallId, (blocks) => {
                const updated = [...blocks]
                const last = updated[updated.length - 1]
                if (last?.type === "thinking") {
                    updated[updated.length - 1] = { ...last, isStreaming: false }
                }
                return updated
            })
        },

        onTextUpdate: (_delta, snapshot) => {
            parentCallbacks.onSubagentBlockUpdate(toolCallId, (blocks) => {
                if (phase !== "text") {
                    phase = "text"
                    return [...blocks, { type: "text", content: snapshot, isStreaming: true }]
                }
                const updated = [...blocks]
                const last = updated[updated.length - 1]
                if (last?.type === "text") {
                    updated[updated.length - 1] = { ...last, content: snapshot }
                }
                return updated
            })
        },

        onToolCallStart: (tcId, toolName, toolLabel) => {
            phase = "idle"
            parentCallbacks.onSubagentBlockUpdate(toolCallId, (blocks) => [
                ...blocks,
                { type: "tool_call", toolCallId: tcId, toolName, toolLabel, status: "running" as const },
            ])
        },

        onToolCallComplete: (tcId, result, isError) => {
            parentCallbacks.onSubagentBlockUpdate(toolCallId, (blocks) =>
                blocks.map((b) =>
                    b.type === "tool_call" && b.toolCallId === tcId
                        ? { ...b, result, isError, status: isError ? "error" as const : "completed" as const }
                        : b,
                ),
            )
        },
    }
}

/**
 * Factory: create the `task` tool bound to a specific Anthropic client, model, and base toolset.
 * The child toolset is derived from baseToolRegistry with excluded tools removed.
 * Returns SubagentToolRegistration with setExecutionContext for callback injection.
 */
export function createSubagentTool(
    client: Anthropic,
    model: string,
    baseToolRegistry: Map<string, ToolRegistration>,
    mcpCallbacks?: McpToolCallbacks | null,
    signal?: AbortSignal,
): SubagentToolRegistration {
    // Build filtered tool map (exclude task tool + todo tools)
    const childTools = new Map<string, ToolRegistration>()
    for (const [name, reg] of baseToolRegistry) {
        if (!EXCLUDED_TOOLS.has(name)) {
            childTools.set(name, reg)
        }
    }

    logger.info(`Subagent child toolset: ${Array.from(childTools.keys()).join(", ")}`)

    // Mutable closure references for the parent execution context
    let activeToolCallId: string | null = null
    let activeCallbacks: AgentCallbacks | null = null

    return {
        definition: {
            name: TASK_TOOL_NAME,
            description:
                "Spawn a subagent with a fresh context to handle an independent subtask. " +
                "The subagent shares the filesystem but NOT conversation history. " +
                "Only its final summary is returned to you. " +
                "Use this for exploration, research, or self-contained work that doesn't need your full context.",
            input_schema: {
                type: "object" as const,
                properties: {
                    description: {
                        type: "string",
                        description: "Short label describing the subtask (shown to user).",
                    },
                    prompt: {
                        type: "string",
                        description:
                            "Detailed instructions for the subagent. Include all necessary context — " +
                            "the subagent has no access to the current conversation history.",
                    },
                },
                required: ["prompt"],
            },
        },
        label: "Spawning subagent...",

        setExecutionContext: (toolCallId: string, callbacks: AgentCallbacks) => {
            activeToolCallId = toolCallId
            activeCallbacks = callbacks
        },

        execute: async (input) => {
            const prompt = input.prompt as string
            const description = (input.description as string) || "subtask"

            logger.info(`Subagent dispatched: "${description}" (prompt: ${prompt.length} chars)`)

            // Build streaming callback bridge if parent context is available
            const subCallbacks = activeToolCallId && activeCallbacks
                ? createSubagentCallbackBridge(activeToolCallId, activeCallbacks)
                : undefined

            try {
                const systemPrompt = buildSubagentSystemPrompt()
                const result = await runSubagent(client, model, systemPrompt, prompt, childTools, subCallbacks, mcpCallbacks, signal)

                // Cap summary length to avoid bloating parent context
                const summary = result.summary.length > MAX_SUMMARY_LENGTH
                    ? result.summary.substring(0, MAX_SUMMARY_LENGTH) + `\n\n[...truncated at ${MAX_SUMMARY_LENGTH} chars]`
                    : result.summary

                logger.info(
                    `Subagent completed: ${result.rounds} rounds, ` +
                    `${result.toolCallCount} tool calls, summary: ${summary.length} chars`,
                )

                return (
                    `[Subagent "${description}" completed in ${result.rounds} rounds, ` +
                    `${result.toolCallCount} tool calls]\n\n${summary}`
                )
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error)
                logger.error(`Subagent "${description}" failed:`, errMsg)
                return `[Subagent "${description}" failed: ${errMsg}]`
            } finally {
                // Clear execution context after use
                activeToolCallId = null
                activeCallbacks = null
            }
        },
    }
}
