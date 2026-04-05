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

export interface CompactionBlock {
    type: "compaction"
    /** Current compression status */
    status: "compressing" | "completed"
    /** The summary text produced by the LLM */
    summary: string
    /** Timestamp when compression occurred */
    timestamp: number
    /** Number of messages that were compressed */
    compressedMessageCount: number
    /** Estimated tokens before compression */
    tokensBefore: number
    /** Estimated tokens after compression */
    tokensAfter: number
}

export type ContentBlock = ThinkingBlock | TextBlock | ToolCallBlock | CompactionBlock

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

/** Snapshot of context window usage for the progress indicator. */
export interface ContextUsage {
    /** Estimated history tokens currently consumed. */
    tokensUsed: number
    /** Token threshold that triggers auto-compression. */
    threshold: number
    /** Usage percentage (0-100, capped). */
    percentage: number
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
    /**
     * Fired immediately before context compression begins.
     * @param compressedCount - Number of messages about to be compressed
     */
    onCompactionStart: (compressedCount: number) => void
    /**
     * Fired after context compression completes.
     * @param summary - LLM-generated summary of compressed context
     * @param stats - Compression statistics
     */
    onCompactionComplete: (
        summary: string,
        stats: { compressedCount: number; tokensBefore: number; tokensAfter: number },
    ) => void
    /**
     * Fired with updated context usage stats so the UI can show a progress bar.
     * @param usage - Current context window usage snapshot
     */
    onContextUsageUpdate: (usage: ContextUsage) => void
}

// ─── Skill Types ───────────────────────────────────────────────

/** A single imported skill (folder-based). */
export interface Skill {
    /** Unique identifier = sanitized folder name (e.g., "e2e-testing"). */
    id: string
    /** Human-readable name from SKILL.md frontmatter or folder name. */
    name: string
    /** Short description for Layer 1 injection (~10-20 words). */
    description: string
    /**
     * Full markdown body of SKILL.md (Layer 2 content, excluding frontmatter).
     * Populated on demand for preview; may be empty in list context.
     */
    body: string
    /** Folder name as imported (e.g., "e2e-testing"). */
    folderName: string
    /** Import timestamp (epoch ms). */
    importedAt: number
    /** Whether this skill is enabled for agent use. */
    enabled: boolean
}

/** Metadata-only projection used for Layer 1 injection, UI listing, and LLM discovery. */
export interface SkillMeta {
    /** Unique identifier = sanitized folder name. */
    id: string
    /** Human-readable name from SKILL.md frontmatter or folder name. */
    name: string
    /** Short description for Layer 1 injection (~10-20 words). */
    description: string
    /** Folder name as imported. */
    folderName: string
    /** Absolute virtual FS path to the skill folder (e.g., "/tapword/skills/e2e-testing"). */
    folderPath: string
    /**
     * List of all file paths relative to the skill folder.
     * e.g., ["SKILL.md", "examples/login.spec.ts", "fixtures/auth.json"]
     */
    files: string[]
    /** Import timestamp (epoch ms). */
    importedAt: number
    /** Whether this skill is enabled for agent use. */
    enabled: boolean
}

// ─── Todo Types ────────────────────────────────────────────────

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
