// Shared types for the sidepanel module

export interface ChatMessage {
    role: "user" | "assistant"
    content: string
    toolCalls?: string[]
    isError?: boolean
}

/** Status of a single todo item. */
export type TodoStatus = "pending" | "in_progress" | "completed"

/** A single todo item managed by the agent. */
export interface TodoItem {
    /** Unique identifier (string, e.g. "1", "2"). */
    id: string
    /** Short text shown in UI (3-7 words). */
    title: string
    /** Longer text for LLM task guidance (not shown in UI). */
    description?: string
    /** Current status. */
    status: TodoStatus
}
