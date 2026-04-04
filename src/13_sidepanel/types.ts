// Shared types for the sidepanel module

// ─── Content Block Types ───────────────────────────────────────

export interface ThinkingBlock {
    type: "thinking"
    content: string
    /** Whether this block is currently being streamed */
    isStreaming: boolean
}

export interface TextBlock {
    type: "text"
    content: string
    /** Whether this block is currently being streamed */
    isStreaming: boolean
}

export interface ToolCallBlock {
    type: "tool_call"
    /** Unique ID from the Anthropic tool_use content block */
    toolCallId: string
    /** Tool function name (e.g., "getCurrentPage") */
    toolName: string
    /** Human-readable label (e.g., "Reading current page...") */
    toolLabel: string
    /** Tool input parameters (optional, for display) */
    input?: Record<string, unknown>
    /** Tool execution result text */
    result?: string
    /** Whether the tool execution resulted in an error */
    isError?: boolean
    /** Current execution status */
    status: "running" | "completed" | "error"
}

export type ContentBlock = ThinkingBlock | TextBlock | ToolCallBlock

// ─── ChatMessage ───────────────────────────────────────────────

export interface ChatMessage {
    role: "user" | "assistant"
    /**
     * For user messages: the user's input text.
     * For assistant messages: denormalized summary of all text blocks
     * (concatenation of TextBlock.content), used for history restoration
     * and backward compatibility.
     */
    content: string
    /**
     * Ordered sequence of content blocks for assistant messages.
     * Undefined for user messages.
     */
    blocks?: ContentBlock[]
    isError?: boolean
}

/** Callbacks for streaming events from the agent loop. */
export interface AgentCallbacks {
    onTextUpdate: (textDelta: string, textSnapshot: string) => void
    onThinkingUpdate: (thinkingDelta: string, thinkingSnapshot: string) => void
    onThinkingComplete: () => void
    /**
     * Fired immediately before tool execution begins.
     * @param toolCallId - Unique ID from the tool_use block
     * @param toolName - Tool function name
     * @param toolLabel - Human-readable display label
     * @param input - Tool input parameters
     */
    onToolCallStart: (toolCallId: string, toolName: string, toolLabel: string, input?: Record<string, unknown>) => void
    /**
     * Fired after tool execution completes (success or failure).
     * @param toolCallId - Matches the ID from onToolCallStart
     * @param result - Tool execution result or error message
     * @param isError - Whether execution failed
     */
    onToolCallComplete: (toolCallId: string, result: string, isError: boolean) => void
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
