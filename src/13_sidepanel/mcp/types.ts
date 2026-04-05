// MCP integration types for the TapWord Agent sidepanel

// ─── Server Configuration (persisted to chrome.storage.sync) ───

/** Authentication method for an MCP server. */
export type McpAuthType = "none" | "bearer"

/** User-configured MCP server entry. */
export interface McpServerConfig {
    /** Unique identifier (UUID v4 string). */
    id: string
    /** Human-readable display name. */
    name: string
    /** Streamable HTTP endpoint URL (e.g., "https://example.com/mcp"). */
    url: string
    /** Authentication method. */
    authType: McpAuthType
    /** Bearer token (only used when authType === "bearer"). */
    authToken?: string
    /** Whether this server should auto-connect when the sidepanel opens. */
    enabled: boolean
}

// ─── Runtime State ─────────────────────────────────────────────

/** Connection status for a single MCP server. */
export type McpConnectionStatus = "disconnected" | "connecting" | "connected" | "error"

/** A single tool discovered from an MCP server. */
export interface McpToolEntry {
    /** Tool name as reported by the MCP server. */
    name: string
    /** Tool description. */
    description: string
    /** JSON Schema for the tool's input parameters. */
    inputSchema: Record<string, unknown>
    /** ID of the parent server (McpServerConfig.id). */
    serverId: string
    /** Human-readable name of the parent server. */
    serverName: string
    /** Whether this tool is enabled for LLM use. */
    enabled: boolean
}

/** Full runtime state for a single MCP server. */
export interface McpServerState {
    /** The persisted configuration. */
    config: McpServerConfig
    /** Current connection status. */
    status: McpConnectionStatus
    /** Tools discovered from this server (populated after successful connection). */
    tools: McpToolEntry[]
    /** Error message if status === "error". */
    errorMessage?: string
}

// ─── Session Cache ─────────────────────────────────────────────

/** Cached MCP session data for fast reconnection (stored in chrome.storage.session). */
export interface McpSessionCache {
    /** The session ID from the transport, used to skip re-initialization. */
    sessionId: string
    /** Cached tool list from the last successful connection. */
    tools: McpToolEntry[]
}
