import type Anthropic from "@anthropic-ai/sdk"
import type { KnowledgeStore } from "../../store/KnowledgeStore"
import type { TodoManager } from "../../store/TodoManager"

/**
 * Context passed to every tool executor.
 */
export interface ToolContext {
    apiKey: string
    knowledgeStore: KnowledgeStore
    todoManager: TodoManager
}

/**
 * A single registered tool: definition + label + executor.
 */
export interface ToolRegistration {
    definition: Anthropic.Tool
    label: string
    execute: (input: Record<string, unknown>, context: ToolContext) => Promise<string>
}
