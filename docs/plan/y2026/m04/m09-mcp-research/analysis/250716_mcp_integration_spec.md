# MCP Integration Technical Spec: TapWord Agent Sidepanel

**Date**: 2026-07-16  
**Status**: Draft  
**Prerequisite**: [250716_mcp_browser_feasibility.md](./250716_mcp_browser_feasibility.md)  
**SDK Version**: `@modelcontextprotocol/sdk@1.27.1`

---

## Table of Contents

1. [Overview](#1-overview)
2. [New Files to Create](#2-new-files-to-create)
3. [Files to Modify](#3-files-to-modify)
4. [Tool Routing Strategy](#4-tool-routing-strategy)
5. [i18n Keys](#5-i18n-keys)
6. [Verification Plan](#6-verification-plan)

---

## 1. Overview

### 1.1 Goal

Integrate the Model Context Protocol (MCP) into the TapWord Agent sidepanel so the agent can **discover and call tools** exposed by remote MCP servers. Users will manage MCP server connections through a dedicated UI tab.

### 1.2 Scope

- **Transport**: Streamable HTTP only (no stdio — impossible in browser).
- **Connection lifecycle**: Connect on demand when the sidepanel opens; disconnect on sidepanel close.
- **Auth (Phase 1)**: Bearer token and no-auth only. OAuth 2.1 is out of scope.
- **SDK**: `@modelcontextprotocol/sdk@1.27.1` — `Client` + `StreamableHTTPClientTransport`.

### 1.3 User-Facing Features

| Feature | Description |
|---------|-------------|
| **MCP tab** | New tab in the sidepanel header (alongside Chat, Knowledge, Skills, Files) |
| **Add server** | Input server name, URL, optional auth token |
| **Manage servers** | View connection status, enable/disable, delete |
| **Browse tools** | Expandable card per server showing discovered tools |
| **Toggle tools** | Enable/disable individual tools per server |

### 1.4 High-Level Architecture

```
AgentLoop
  ├── Local Tools (TOOL_REGISTRY — unchanged)
  │     ├── todoTools
  │     ├── knowledgeTools
  │     ├── skillTools / fileTools
  │     └── getCurrentPage
  │
  └── MCP Tools (NEW — via McpClientManager)
        ├── MCP Client 1 → Remote Server A (Streamable HTTP)
        ├── MCP Client 2 → Remote Server B (Streamable HTTP)
        └── ...

Tool Routing:
  tool_use block from LLM
    ├── TOOL_REGISTRY.has(name)?  → local execute
    └── mcpToolMap.has(name)?     → McpClientManager.callTool()
```

---

## 2. New Files to Create

### 2.1 `src/13_sidepanel/mcp/types.ts`

**Purpose**: Shared types for the MCP integration layer.

**Key Exports**:

```typescript
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
```

**Dependencies**: None (pure types).

---

### 2.2 `src/13_sidepanel/mcp/McpServerStorage.ts`

**Purpose**: CRUD operations for MCP server configs in `chrome.storage.sync`.

**Key Exports**:

```typescript
export function loadServerConfigs(): Promise<McpServerConfig[]>
export function saveServerConfigs(configs: McpServerConfig[]): Promise<void>
export function addServerConfig(config: McpServerConfig): Promise<void>
export function removeServerConfig(serverId: string): Promise<void>
export function updateServerConfig(config: McpServerConfig): Promise<void>
```

**Storage Key**: `"mcpServers"` in `chrome.storage.sync`.

**Implementation Pattern** (follows `StorageService.ts`):

```typescript
import * as loggerModule from "@/0_common/utils/logger"
import type { McpServerConfig } from "./types"

const logger = loggerModule.createLogger("McpServerStorage")
const STORAGE_KEY = "mcpServers"

export async function loadServerConfigs(): Promise<McpServerConfig[]> {
    try {
        const result = await chrome.storage.sync.get(STORAGE_KEY)
        return (result[STORAGE_KEY] as McpServerConfig[] | undefined) ?? []
    } catch (error) {
        logger.error("Failed to load MCP server configs:", error)
        return []
    }
}

export async function saveServerConfigs(configs: McpServerConfig[]): Promise<void> {
    try {
        await chrome.storage.sync.set({ [STORAGE_KEY]: configs })
    } catch (error) {
        logger.error("Failed to save MCP server configs:", error)
    }
}

export async function addServerConfig(config: McpServerConfig): Promise<void> {
    const configs = await loadServerConfigs()
    configs.push(config)
    await saveServerConfigs(configs)
}

export async function removeServerConfig(serverId: string): Promise<void> {
    const configs = await loadServerConfigs()
    await saveServerConfigs(configs.filter((c) => c.id !== serverId))
}

export async function updateServerConfig(config: McpServerConfig): Promise<void> {
    const configs = await loadServerConfigs()
    const index = configs.findIndex((c) => c.id === config.id)
    if (index !== -1) {
        configs[index] = config
        await saveServerConfigs(configs)
    }
}
```

**Dependencies**:
- `@/0_common/utils/logger`
- `./types` (McpServerConfig)

**Notes**:
- `chrome.storage.sync` has a 100 KB total quota and 8 KB per-item quota. MCP server configs are small (name + URL + token), so this is not a concern for a reasonable number of servers (< 50).
- All functions use try/catch with silent fallback to match the existing `StorageService.ts` pattern.
- Tool enable/disable state is stored alongside each server config: `McpServerConfig.enabled` controls the server, while individual tool enable states are stored in a separate session key (see below).

**Tool Enable State Storage**:

Tool enable/disable per server needs a separate storage key since the tool list is discovered at runtime:

```typescript
const TOOL_ENABLED_KEY = "mcpToolEnabled"

/** Stored as { [serverId]: { [toolName]: boolean } } */
export async function loadToolEnabledStates(): Promise<Record<string, Record<string, boolean>>> {
    try {
        const result = await chrome.storage.sync.get(TOOL_ENABLED_KEY)
        return (result[TOOL_ENABLED_KEY] as Record<string, Record<string, boolean>>) ?? {}
    } catch {
        return {}
    }
}

export async function saveToolEnabledState(
    serverId: string,
    toolName: string,
    enabled: boolean
): Promise<void> {
    const states = await loadToolEnabledStates()
    if (!states[serverId]) states[serverId] = {}
    states[serverId][toolName] = enabled
    try {
        await chrome.storage.sync.set({ [TOOL_ENABLED_KEY]: states })
    } catch (error) {
        logger.error("Failed to save tool enabled state:", error)
    }
}
```

---

### 2.3 `src/13_sidepanel/mcp/McpClientManager.ts`

**Purpose**: Core MCP client lifecycle manager. Manages connections to multiple MCP servers and routes tool calls.

**Key Exports**:

```typescript
export class McpClientManager {
    connectServer(config: McpServerConfig): Promise<McpServerState>
    disconnectServer(serverId: string): Promise<void>
    disconnectAll(): Promise<void>
    getServerState(serverId: string): McpServerState | undefined
    getAllServerStates(): McpServerState[]
    getAllEnabledMcpTools(): McpToolEntry[]
    callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<string>
}
```

**Detailed Behavior**:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import * as loggerModule from "@/0_common/utils/logger"
import type { McpServerConfig, McpServerState, McpToolEntry, McpConnectionStatus } from "./types"

const logger = loggerModule.createLogger("McpClientManager")

/** Per-tool-call timeout in milliseconds. */
const TOOL_CALL_TIMEOUT_MS = 30_000

interface ServerConnection {
    client: Client
    transport: StreamableHTTPClientTransport
    state: McpServerState
}

export class McpClientManager {
    private connections = new Map<string, ServerConnection>()

    /**
     * Connect to an MCP server: create Client + Transport, initialize,
     * discover tools, and store the connection.
     *
     * On failure: sets status to "error" with errorMessage. Does NOT throw.
     */
    async connectServer(config: McpServerConfig): Promise<McpServerState> {
        // Disconnect existing connection if any
        if (this.connections.has(config.id)) {
            await this.disconnectServer(config.id)
        }

        const state: McpServerState = {
            config,
            status: "connecting",
            tools: [],
        }

        try {
            // 1. Create transport with optional auth header
            const headers: Record<string, string> = {}
            if (config.authType === "bearer" && config.authToken) {
                headers["Authorization"] = `Bearer ${config.authToken}`
            }

            const transport = new StreamableHTTPClientTransport(
                new URL(config.url),
                { requestInit: { headers } }
            )

            // 2. Create MCP client
            const client = new Client(
                { name: "tapword-agent", version: "1.0.0" },
                { capabilities: {} }
            )

            // 3. Connect (initialize + capability negotiation)
            await client.connect(transport)

            // 4. Discover tools
            const toolsResult = await client.listTools()
            const tools: McpToolEntry[] = toolsResult.tools.map((t) => ({
                name: t.name,
                description: t.description ?? "",
                inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
                serverId: config.id,
                serverName: config.name,
                enabled: true, // Default: all tools enabled on first discover
            }))

            state.status = "connected"
            state.tools = tools

            this.connections.set(config.id, { client, transport, state })
            logger.info(`Connected to "${config.name}" — ${tools.length} tools discovered`)
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            state.status = "error"
            state.errorMessage = errorMsg
            logger.error(`Failed to connect to "${config.name}":`, errorMsg)
        }

        return state
    }

    /**
     * Disconnect a single server. Closes the transport gracefully.
     */
    async disconnectServer(serverId: string): Promise<void> {
        const conn = this.connections.get(serverId)
        if (!conn) return

        try {
            await conn.transport.close()
        } catch (error) {
            logger.error(`Error closing transport for ${serverId}:`, error)
        }
        this.connections.delete(serverId)
        logger.info(`Disconnected from "${conn.state.config.name}"`)
    }

    /**
     * Disconnect all servers. Called when sidepanel unmounts.
     */
    async disconnectAll(): Promise<void> {
        const serverIds = Array.from(this.connections.keys())
        await Promise.allSettled(serverIds.map((id) => this.disconnectServer(id)))
        logger.info(`Disconnected all (${serverIds.length}) MCP servers`)
    }

    getServerState(serverId: string): McpServerState | undefined {
        return this.connections.get(serverId)?.state
    }

    getAllServerStates(): McpServerState[] {
        return Array.from(this.connections.values()).map((c) => c.state)
    }

    /**
     * Aggregate all tools from all connected servers where both
     * the server and the individual tool are enabled.
     */
    getAllEnabledMcpTools(): McpToolEntry[] {
        const tools: McpToolEntry[] = []
        for (const conn of this.connections.values()) {
            if (conn.state.status !== "connected") continue
            if (!conn.state.config.enabled) continue
            for (const tool of conn.state.tools) {
                if (tool.enabled) tools.push(tool)
            }
        }
        return tools
    }

    /**
     * Execute a tool call on a specific MCP server.
     * Returns the tool result as a string (serialized JSON for object results).
     * Throws on timeout or if the server is not connected.
     */
    async callTool(
        serverId: string,
        toolName: string,
        args: Record<string, unknown>
    ): Promise<string> {
        const conn = this.connections.get(serverId)
        if (!conn) throw new Error(`MCP server "${serverId}" is not connected`)
        if (conn.state.status !== "connected") {
            throw new Error(`MCP server "${conn.state.config.name}" status: ${conn.state.status}`)
        }

        logger.info(`Calling MCP tool "${toolName}" on "${conn.state.config.name}"`)

        // Wrap with timeout
        const result = await Promise.race([
            conn.client.callTool({ name: toolName, arguments: args }),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`MCP tool "${toolName}" timed out after ${TOOL_CALL_TIMEOUT_MS}ms`)), TOOL_CALL_TIMEOUT_MS)
            ),
        ])

        // Serialize the result content array into a single string
        if (result.content && Array.isArray(result.content)) {
            return result.content
                .map((block: { type: string; text?: string }) => {
                    if (block.type === "text" && block.text) return block.text
                    return JSON.stringify(block)
                })
                .join("\n")
        }

        return JSON.stringify(result)
    }
}
```

**Dependencies**:
- `@modelcontextprotocol/sdk/client/index.js` → `Client`
- `@modelcontextprotocol/sdk/client/streamableHttp.js` → `StreamableHTTPClientTransport`
- `@/0_common/utils/logger`
- `./types`

**Design Decisions**:
- **NOT a global singleton**: The instance is created once in the `useMcpServers` hook and passed down. This allows proper lifecycle management (create on mount, destroy on unmount).
- **Error handling**: `connectServer` never throws — it sets `status: "error"`. `callTool` throws because the caller (AgentLoop) needs to produce a `tool_result` with `is_error: true`.
- **Timeout**: 30-second per-tool-call timeout to prevent indefinite hangs from unresponsive servers.

---

### 2.4 `src/13_sidepanel/mcp/index.ts`

**Purpose**: Module index file with explicit exports (per project convention).

```typescript
// ─── Types ─────────────────────────────────────────────────────
export type {
    McpAuthType,
    McpServerConfig,
    McpConnectionStatus,
    McpToolEntry,
    McpServerState,
} from "./types"

// ─── Classes ───────────────────────────────────────────────────
export { McpClientManager } from "./McpClientManager"

// ─── Storage ───────────────────────────────────────────────────
export {
    loadServerConfigs,
    saveServerConfigs,
    addServerConfig,
    removeServerConfig,
    updateServerConfig,
    loadToolEnabledStates,
    saveToolEnabledState,
} from "./McpServerStorage"
```

---

### 2.5 `src/13_sidepanel/hooks/useMcpServers.ts`

**Purpose**: React hook that manages the MCP server lifecycle — loading configs, connecting, exposing state, and providing mutation functions to the UI.

**Key Exports**:

```typescript
export interface UseMcpServersResult {
    /** All server states (connected, disconnected, and error). */
    servers: McpServerState[]
    /** Add a new server config, persist, and connect. */
    addServer: (name: string, url: string, authType: McpAuthType, authToken?: string) => Promise<void>
    /** Remove a server: disconnect + delete config. */
    removeServer: (serverId: string) => Promise<void>
    /** Enable/disable a server: toggle config.enabled, connect/disconnect accordingly. */
    toggleServer: (serverId: string, enabled: boolean) => Promise<void>
    /** Enable/disable an individual tool on a server. */
    toggleTool: (serverId: string, toolName: string, enabled: boolean) => void
    /**
     * Get Anthropic-format tool definitions for all enabled MCP tools.
     * Suitable for passing directly to the LLM tools array.
     */
    getMcpToolDefinitions: () => Anthropic.Tool[]
    /**
     * Execute a tool call on the appropriate MCP server.
     * Used by AgentLoop for MCP tool routing.
     */
    callMcpTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<string>
    /**
     * Build a lookup map from tool name → serverId for MCP tools.
     * Used by AgentLoop to determine routing.
     */
    getMcpToolMap: () => Map<string, string>
}

export function useMcpServers(): UseMcpServersResult
```

**Detailed Behavior**:

```typescript
import { useState, useEffect, useRef, useCallback } from "react"
import type Anthropic from "@anthropic-ai/sdk"
import * as loggerModule from "@/0_common/utils/logger"
import { McpClientManager } from "../mcp/McpClientManager"
import * as mcpStorage from "../mcp/McpServerStorage"
import type { McpServerConfig, McpServerState, McpAuthType, McpToolEntry } from "../mcp/types"

const logger = loggerModule.createLogger("useMcpServers")

export function useMcpServers(): UseMcpServersResult {
    const [servers, setServers] = useState<McpServerState[]>([])
    const managerRef = useRef<McpClientManager>(new McpClientManager())

    // ─── Mount: load configs, connect enabled servers ──────────
    useEffect(() => {
        let cancelled = false

        async function init() {
            const configs = await mcpStorage.loadServerConfigs()
            const toolStates = await mcpStorage.loadToolEnabledStates()

            // Build initial state for ALL configs (enabled or not)
            const initialStates: McpServerState[] = configs.map((c) => ({
                config: c,
                status: "disconnected",
                tools: [],
            }))
            if (!cancelled) setServers(initialStates)

            // Connect enabled servers
            for (const config of configs.filter((c) => c.enabled)) {
                if (cancelled) break
                const state = await managerRef.current.connectServer(config)

                // Apply persisted tool enable/disable states
                const serverToolStates = toolStates[config.id] ?? {}
                state.tools = state.tools.map((t) => ({
                    ...t,
                    enabled: serverToolStates[t.name] ?? true,
                }))

                if (!cancelled) {
                    setServers((prev) =>
                        prev.map((s) => (s.config.id === config.id ? state : s))
                    )
                }
            }
        }

        init()

        // ─── Unmount: disconnect all ───────────────────────────
        return () => {
            cancelled = true
            managerRef.current.disconnectAll()
        }
    }, [])

    // ─── addServer ─────────────────────────────────────────────
    const addServer = useCallback(async (
        name: string,
        url: string,
        authType: McpAuthType,
        authToken?: string,
    ) => {
        const config: McpServerConfig = {
            id: crypto.randomUUID(),
            name,
            url,
            authType,
            authToken,
            enabled: true,
        }

        await mcpStorage.addServerConfig(config)

        // Connect immediately
        const state = await managerRef.current.connectServer(config)
        setServers((prev) => [...prev, state])
    }, [])

    // ─── removeServer ──────────────────────────────────────────
    const removeServer = useCallback(async (serverId: string) => {
        await managerRef.current.disconnectServer(serverId)
        await mcpStorage.removeServerConfig(serverId)
        setServers((prev) => prev.filter((s) => s.config.id !== serverId))
    }, [])

    // ─── toggleServer ──────────────────────────────────────────
    const toggleServer = useCallback(async (serverId: string, enabled: boolean) => {
        setServers((prev) =>
            prev.map((s) =>
                s.config.id === serverId
                    ? { ...s, config: { ...s.config, enabled } }
                    : s
            )
        )

        // Persist updated config
        const configs = await mcpStorage.loadServerConfigs()
        const config = configs.find((c) => c.id === serverId)
        if (config) {
            config.enabled = enabled
            await mcpStorage.updateServerConfig(config)
        }

        if (enabled && config) {
            // Connect
            const state = await managerRef.current.connectServer(config)
            setServers((prev) =>
                prev.map((s) => (s.config.id === serverId ? state : s))
            )
        } else {
            // Disconnect
            await managerRef.current.disconnectServer(serverId)
            setServers((prev) =>
                prev.map((s) =>
                    s.config.id === serverId
                        ? { ...s, status: "disconnected", tools: [] }
                        : s
                )
            )
        }
    }, [])

    // ─── toggleTool ────────────────────────────────────────────
    const toggleTool = useCallback((
        serverId: string,
        toolName: string,
        enabled: boolean,
    ) => {
        setServers((prev) =>
            prev.map((s) =>
                s.config.id === serverId
                    ? {
                          ...s,
                          tools: s.tools.map((t) =>
                              t.name === toolName ? { ...t, enabled } : t
                          ),
                      }
                    : s
            )
        )
        // Persist tool enabled state (fire-and-forget)
        mcpStorage.saveToolEnabledState(serverId, toolName, enabled)
    }, [])

    // ─── getMcpToolDefinitions ─────────────────────────────────
    const getMcpToolDefinitions = useCallback((): Anthropic.Tool[] => {
        const enabledTools = managerRef.current.getAllEnabledMcpTools()
        return enabledTools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        }))
    }, [])

    // ─── callMcpTool ───────────────────────────────────────────
    const callMcpTool = useCallback(async (
        serverId: string,
        toolName: string,
        args: Record<string, unknown>,
    ): Promise<string> => {
        return managerRef.current.callTool(serverId, toolName, args)
    }, [])

    // ─── getMcpToolMap ─────────────────────────────────────────
    const getMcpToolMap = useCallback((): Map<string, string> => {
        const tools = managerRef.current.getAllEnabledMcpTools()
        const map = new Map<string, string>()
        for (const t of tools) {
            // Skip if name conflicts with a local tool — local takes priority
            // (conflict check happens at call site, not here)
            map.set(t.name, t.serverId)
        }
        return map
    }, [])

    return {
        servers,
        addServer,
        removeServer,
        toggleServer,
        toggleTool,
        getMcpToolDefinitions,
        callMcpTool,
        getMcpToolMap,
    }
}
```

**Dependencies**:
- `react` (useState, useEffect, useRef, useCallback)
- `@anthropic-ai/sdk` (type import for `Anthropic.Tool`)
- `@/0_common/utils/logger`
- `../mcp/McpClientManager`
- `../mcp/McpServerStorage`
- `../mcp/types`

**Design Notes**:
- `McpClientManager` is instantiated via `useRef` — one per `useMcpServers` hook lifetime. This avoids global singletons and ensures clean teardown.
- `getMcpToolDefinitions()` and `getMcpToolMap()` return fresh snapshots for each AgentLoop round, reflecting the latest enable/disable state.
- Tool enable state is synced to both React state (for UI) AND `McpClientManager`'s internal state via `setServers`. The manager reads from it via `getAllEnabledMcpTools()`.

---

### 2.6 `src/13_sidepanel/components/McpPanel.tsx`

**Purpose**: UI component for the MCP tab. Follows the `SkillsPanel.tsx` pattern — card list, toggles, expand/collapse.

**Props**:

```typescript
interface McpPanelProps {
    servers: McpServerState[]
    onAddServer: (name: string, url: string, authType: McpAuthType, authToken?: string) => void
    onRemoveServer: (serverId: string) => void
    onToggleServer: (serverId: string, enabled: boolean) => void
    onToggleTool: (serverId: string, toolName: string, enabled: boolean) => void
}
```

**Layout**:

```
┌──────────────────────────────────────┐
│ [+ Add Server]                       │  ← Top bar (always visible)
├──────────────────────────────────────┤
│                                      │
│  ┌── Server Card ─────────────────┐  │
│  │ Name          [status●] [🗑][⏻] │  │  ← Row 1: name, status dot, delete, toggle
│  │ https://exam...                │  │  ← Row 2: URL (truncated)
│  │ ▼ 3 tools                      │  │  ← Row 3: expand toggle
│  │ ┌────────────────────────────┐ │  │
│  │ │ tool_name_1         [⏻]   │ │  │  ← Tool row with toggle
│  │ │ tool_name_2         [⏻]   │ │  │
│  │ │ tool_name_3         [⏻]   │ │  │
│  │ └────────────────────────────┘ │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌── Server Card ─────────────────┐  │
│  │ ...                            │  │
│  └────────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

**Detailed Component Structure**:

```tsx
import { useState } from "react"
import { Plus, Trash2, ChevronDown, ChevronUp, Plug, Loader2, AlertCircle } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import type { McpServerState, McpAuthType, McpConnectionStatus } from "../mcp/types"

// --- Constants ---

/** Status dot color mapping. */
const STATUS_COLORS: Record<McpConnectionStatus, string> = {
    connected: "bg-green-500",
    connecting: "bg-yellow-400 animate-pulse",
    error: "bg-red-500",
    disconnected: "bg-stone-300",
}

// --- Sub-components ---

/** Inline form for adding a new MCP server. */
function AddServerForm({ onSubmit, onCancel }: {
    onSubmit: (name: string, url: string, authType: McpAuthType, authToken?: string) => void
    onCancel: () => void
}) {
    const [name, setName] = useState("")
    const [url, setUrl] = useState("")
    const [authType, setAuthType] = useState<McpAuthType>("none")
    const [authToken, setAuthToken] = useState("")

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!name.trim() || !url.trim()) return
        onSubmit(name.trim(), url.trim(), authType, authToken.trim() || undefined)
    }

    return (
        <form onSubmit={handleSubmit} className="p-3 space-y-2 border border-stone-200 rounded-lg bg-white">
            {/* Name input */}
            <input
                type="text"
                placeholder={i18nModule.translate("sidepanel.mcp.form.name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-stone-200 rounded-md"
                autoFocus
            />
            {/* URL input */}
            <input
                type="url"
                placeholder={i18nModule.translate("sidepanel.mcp.form.url")}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-stone-200 rounded-md"
            />
            {/* Auth type selector */}
            <select
                value={authType}
                onChange={(e) => setAuthType(e.target.value as McpAuthType)}
                className="w-full px-2 py-1.5 text-xs border border-stone-200 rounded-md"
            >
                <option value="none">{i18nModule.translate("sidepanel.mcp.auth.none")}</option>
                <option value="bearer">{i18nModule.translate("sidepanel.mcp.auth.bearer")}</option>
            </select>
            {/* Auth token (conditional) */}
            {authType === "bearer" && (
                <input
                    type="password"
                    placeholder={i18nModule.translate("sidepanel.mcp.form.token")}
                    value={authToken}
                    onChange={(e) => setAuthToken(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs border border-stone-200 rounded-md"
                />
            )}
            {/* Buttons */}
            <div className="flex items-center gap-2 pt-1">
                <button type="submit" className="px-3 py-1 text-xs font-medium text-white bg-blue-500 rounded-md hover:bg-blue-600">
                    {i18nModule.translate("sidepanel.mcp.form.connect")}
                </button>
                <button type="button" onClick={onCancel} className="px-3 py-1 text-xs text-stone-500 hover:text-stone-700">
                    {i18nModule.translate("sidepanel.mcp.form.cancel")}
                </button>
            </div>
        </form>
    )
}

// --- Main Component ---

export function McpPanel({ servers, onAddServer, onRemoveServer, onToggleServer, onToggleTool }: McpPanelProps) {
    const [showAddForm, setShowAddForm] = useState(false)
    const [expandedId, setExpandedId] = useState<string | null>(null)

    function handleAddSubmit(name: string, url: string, authType: McpAuthType, authToken?: string) {
        onAddServer(name, url, authType, authToken)
        setShowAddForm(false)
    }

    // ─── Empty state ───────────────────────────────────────────
    if (servers.length === 0 && !showAddForm) {
        return (
            <div className="flex-1 flex flex-col">
                <div className="p-3 border-b border-stone-200">
                    <button
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-medium transition-colors"
                        onClick={() => setShowAddForm(true)}
                    >
                        <Plus className="w-3.5 h-3.5" />
                        {i18nModule.translate("sidepanel.mcp.addServer")}
                    </button>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                    <Plug className="w-8 h-8 text-stone-300" />
                    <p className="text-xs text-stone-400 max-w-[200px]">
                        {i18nModule.translate("sidepanel.mcp.emptyState")}
                    </p>
                </div>
            </div>
        )
    }

    // ─── Server list ───────────────────────────────────────────
    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Add button */}
            <div className="p-3 border-b border-stone-200">
                <button
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-medium transition-colors"
                    onClick={() => setShowAddForm(true)}
                >
                    <Plus className="w-3.5 h-3.5" />
                    {i18nModule.translate("sidepanel.mcp.addServer")}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {/* Add form (inline) */}
                {showAddForm && (
                    <AddServerForm onSubmit={handleAddSubmit} onCancel={() => setShowAddForm(false)} />
                )}

                {/* Server cards */}
                {servers.map((server) => (
                    <div key={server.config.id} className="group bg-white rounded-lg border border-stone-200 hover:border-stone-300 transition-colors">
                        <div className="px-3 pt-3 pb-2 space-y-1.5">
                            {/* Row 1: Name + Status + Delete + Toggle */}
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    {/* Status dot */}
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[server.status]}`} />
                                    <span className={`text-xs font-medium truncate ${server.config.enabled ? "text-stone-800" : "text-stone-400"}`}>
                                        {server.config.name}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-stone-100 text-stone-400 hover:text-red-500 shrink-0 transition-opacity"
                                        onClick={() => onRemoveServer(server.config.id)}
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                    {/* Server toggle */}
                                    <button
                                        role="switch"
                                        aria-checked={server.config.enabled}
                                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                                            server.config.enabled ? "bg-blue-500" : "bg-stone-300"
                                        }`}
                                        onClick={() => onToggleServer(server.config.id, !server.config.enabled)}
                                    >
                                        <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition ${
                                            server.config.enabled ? "translate-x-4" : "translate-x-0"
                                        }`} />
                                    </button>
                                </div>
                            </div>

                            {/* Row 2: URL */}
                            <p className="text-[11px] text-stone-400 truncate">{server.config.url}</p>

                            {/* Row 3: Error message (if any) */}
                            {server.status === "error" && server.errorMessage && (
                                <div className="flex items-center gap-1 text-[11px] text-red-500">
                                    <AlertCircle className="w-3 h-3 shrink-0" />
                                    <span className="truncate">{server.errorMessage}</span>
                                </div>
                            )}

                            {/* Row 4: Expand toggle for tools */}
                            {server.status === "connected" && server.tools.length > 0 && (
                                <button
                                    className="flex items-center gap-0.5 text-[10px] text-stone-400 hover:text-stone-600 transition-colors"
                                    onClick={() => setExpandedId(expandedId === server.config.id ? null : server.config.id)}
                                >
                                    {expandedId === server.config.id ? (
                                        <ChevronUp className="w-3 h-3" />
                                    ) : (
                                        <ChevronDown className="w-3 h-3" />
                                    )}
                                    {server.tools.length} {server.tools.length === 1 ? "tool" : "tools"}
                                </button>
                            )}

                            {/* Connecting spinner */}
                            {server.status === "connecting" && (
                                <div className="flex items-center gap-1 text-[10px] text-stone-400">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    {i18nModule.translate("sidepanel.mcp.connecting")}
                                </div>
                            )}
                        </div>

                        {/* Expanded tool list */}
                        {expandedId === server.config.id && server.tools.length > 0 && (
                            <div className="border-t border-stone-100 px-3 py-2 space-y-1.5">
                                {server.tools.map((tool) => (
                                    <div key={tool.name} className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className={`text-[11px] font-mono truncate ${tool.enabled ? "text-stone-700" : "text-stone-400"}`}>
                                                {tool.name}
                                            </p>
                                            {tool.description && (
                                                <p className="text-[10px] text-stone-400 truncate">{tool.description}</p>
                                            )}
                                        </div>
                                        <button
                                            role="switch"
                                            aria-checked={tool.enabled}
                                            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                                                tool.enabled ? "bg-blue-500" : "bg-stone-300"
                                            }`}
                                            onClick={() => onToggleTool(server.config.id, tool.name, !tool.enabled)}
                                        >
                                            <span className={`pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transition ${
                                                tool.enabled ? "translate-x-3" : "translate-x-0"
                                            }`} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
```

**Dependencies**:
- `react` (useState)
- `lucide-react` (Plus, Trash2, ChevronDown, ChevronUp, Plug, Loader2, AlertCircle)
- `@/0_common/utils/i18n`
- `../mcp/types` (McpServerState, McpAuthType, McpConnectionStatus)

---

## 3. Files to Modify

### 3.1 `src/13_sidepanel/components/ChatHeader.tsx`

**Changes**:

1. **Extend `SidePanelTab` type** to include `"mcp"`:

```diff
- export type SidePanelTab = "chat" | "knowledge" | "skills" | "files"
+ export type SidePanelTab = "chat" | "knowledge" | "skills" | "files" | "mcp"
```

2. **Add MCP tab button** using the `Plug` icon from `lucide-react`:

```diff
  import { MessageSquare, BookOpen, Zap, FolderOpen, Trash2, Settings } from "lucide-react"
+ import { Plug } from "lucide-react"
```

Add a new tab button after the "Files" tab, following the same pattern:

```tsx
<button
    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
        activeTab === "mcp" ? "text-stone-900 border-b-2 border-stone-900" : "text-stone-400 hover:text-stone-600"
    }`}
    onClick={() => onTabChange("mcp")}
>
    <Plug className="w-3.5 h-3.5" />
    {i18nModule.translate("sidepanel.tab.mcp")}
</button>
```

---

### 3.2 `src/13_sidepanel/App.tsx`

**Changes**:

1. **Import new components and hook**:

```diff
+ import { McpPanel } from "./components/McpPanel"
+ import { useMcpServers } from "./hooks/useMcpServers"
```

2. **Add `useMcpServers()` call** inside the `App` component:

```typescript
const {
    servers: mcpServers,
    addServer: addMcpServer,
    removeServer: removeMcpServer,
    toggleServer: toggleMcpServer,
    toggleTool: toggleMcpTool,
    getMcpToolDefinitions,
    callMcpTool,
    getMcpToolMap,
} = useMcpServers()
```

3. **Pass MCP functions to `useAgentChat`**:

```diff
- const { messages, isLoading, ... } = useAgentChat(apiKey)
+ const { messages, isLoading, ... } = useAgentChat(apiKey, {
+     getMcpToolDefinitions,
+     callMcpTool,
+     getMcpToolMap,
+ })
```

4. **Add MCP tab rendering branch**:

```diff
  {activeTab === "knowledge" ? (
      <KnowledgePanel />
  ) : activeTab === "skills" ? (
      <SkillsPanel ... />
  ) : activeTab === "files" ? (
      <FileBrowserPanel />
+ ) : activeTab === "mcp" ? (
+     <McpPanel
+         servers={mcpServers}
+         onAddServer={addMcpServer}
+         onRemoveServer={removeMcpServer}
+         onToggleServer={toggleMcpServer}
+         onToggleTool={toggleMcpTool}
+     />
  ) : ( ... )}
```

---

### 3.3 `src/13_sidepanel/agent/AgentLoop.ts`

**Changes**:

1. **Add MCP callback type to constructor/`runAgent`**:

```typescript
/** MCP tool integration callbacks. */
export interface McpToolCallbacks {
    /** Get Anthropic-format tool definitions for enabled MCP tools. */
    getMcpToolDefinitions: () => Anthropic.Tool[]
    /** Route a tool call to the appropriate MCP server. */
    callMcpTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<string>
    /** Get a Map<toolName, serverId> for enabled MCP tools. */
    getMcpToolMap: () => Map<string, string>
}
```

2. **Accept `McpToolCallbacks` as an optional parameter in the constructor**:

```diff
  export class AgentLoop {
      private client: Anthropic
      private history: Anthropic.MessageParam[] = []
      private roundsSinceTodoUpdate: number = 0
+     private mcpCallbacks: McpToolCallbacks | null = null

-     constructor(apiKey: string) {
+     constructor(apiKey: string, mcpCallbacks?: McpToolCallbacks) {
          this.client = createAnthropicClient(apiKey)
+         this.mcpCallbacks = mcpCallbacks ?? null
      }
```

3. **Build dynamic tool list** in `runAgent()`:

```diff
- const TOOL_DEFINITIONS = Array.from(TOOL_REGISTRY.values()).map((t) => t.definition)
```

Move tool list computation inside `runAgent()`:

```typescript
// Inside runAgent(), before the while(true) loop:
const localToolDefs = Array.from(TOOL_REGISTRY.values()).map((t) => t.definition)
const mcpToolDefs = this.mcpCallbacks?.getMcpToolDefinitions() ?? []
const allToolDefs = [...localToolDefs, ...mcpToolDefs]
```

Pass `allToolDefs` to the streaming API call:

```diff
- tools: TOOL_DEFINITIONS,
+ tools: allToolDefs,
```

4. **Modify `executeTool` for MCP routing**:

```typescript
private async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    // Local tools take priority
    const localTool = TOOL_REGISTRY.get(name)
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
```

---

### 3.4 `src/13_sidepanel/hooks/useAgentChat.ts`

**Changes**:

1. **Accept MCP callbacks as a parameter**:

```diff
+ import type { McpToolCallbacks } from "../agent/AgentLoop"

- export function useAgentChat(apiKey: string | null): UseAgentChatResult {
+ export function useAgentChat(apiKey: string | null, mcpCallbacks?: McpToolCallbacks): UseAgentChatResult {
```

2. **Pass MCP callbacks when creating AgentLoop**:

```diff
  useEffect(() => {
      if (apiKey) {
          embeddingClient.setApiKey(apiKey)
-         const agent = new AgentLoop(apiKey)
+         const agent = new AgentLoop(apiKey, mcpCallbacks)
          agentRef.current = agent
          ...
      }
- }, [apiKey])
+ }, [apiKey, mcpCallbacks])
```

**Note**: `mcpCallbacks` should be memoized (via `useMemo`) in `App.tsx` or the functions should be stable references (they are `useCallback`-wrapped in `useMcpServers`). Since `getMcpToolDefinitions`, `callMcpTool`, and `getMcpToolMap` are all `useCallback`-wrapped with empty deps in `useMcpServers`, they are stable references and won't cause extra re-creations of `AgentLoop`.

---

### 3.5 `src/13_sidepanel/agent/prompts.ts`

**No changes required**. MCP tools are injected at the tool definition level (via the `tools` parameter to the Anthropic API), not at the system prompt level. The LLM sees them as standard tools and calls them like any other tool.

---

## 4. Tool Routing Strategy

### 4.1 Routing Logic

```
tool_use block { name, input }
    │
    ├── TOOL_REGISTRY.has(name)?
    │        YES → Local execution via TOOL_REGISTRY.get(name).execute(input)
    │
    └── NO → mcpToolMap.has(name)?
                  YES → MCP execution via mcpCallbacks.callMcpTool(serverId, name, input)
                  NO  → throw Error("Unknown tool: ${name}")
```

### 4.2 Priority Rules

| Scenario | Behavior |
|----------|----------|
| Tool exists in TOOL_REGISTRY only | Execute locally |
| Tool exists in MCP only | Execute via MCP |
| Tool exists in BOTH local and MCP | **Local takes priority** — local tools are always available; MCP may disconnect |
| Tool exists in multiple MCP servers | First server wins (based on Map insertion order from `getAllEnabledMcpTools`) |
| Unknown tool name | Throw error → produces `is_error: true` tool_result for the LLM |

### 4.3 Tool Map Construction

The `getMcpToolMap()` function in `useMcpServers` builds a `Map<toolName, serverId>` from all enabled MCP tools. This map is rebuilt on each call to reflect the latest enable/disable state.

The AgentLoop calls `getMcpToolMap()` inside `executeTool()` for each tool call, ensuring it always uses the current state.

### 4.4 Dynamic Tool List

The tool list sent to the LLM is rebuilt at the start of each `runAgent()` call:

```typescript
const allToolDefs = [...localToolDefs, ...mcpToolDefs]
```

This means:
- Newly connected MCP servers' tools appear in the next `runAgent()` call.
- Disconnected servers' tools disappear from the next `runAgent()` call.
- Within a single `runAgent()` agentic loop (multiple LLM rounds), the tool list is **fixed** to the list captured at the start. This avoids mid-conversation tool list changes that could confuse the LLM.

---

## 5. i18n Keys

### English (`src/0_common/locales/en.json`)

```json
"sidepanel.tab.mcp": "MCP",
"sidepanel.mcp.addServer": "Add Server",
"sidepanel.mcp.emptyState": "No MCP servers configured",
"sidepanel.mcp.connecting": "Connecting...",
"sidepanel.mcp.form.name": "Server name",
"sidepanel.mcp.form.url": "https://example.com/mcp",
"sidepanel.mcp.form.token": "Bearer token",
"sidepanel.mcp.form.connect": "Connect",
"sidepanel.mcp.form.cancel": "Cancel",
"sidepanel.mcp.auth.none": "No authentication",
"sidepanel.mcp.auth.bearer": "Bearer token",
"sidepanel.mcp.enabled": "Enabled",
"sidepanel.mcp.disabled": "Disabled"
```

### Chinese (`src/0_common/locales/zh.json`)

```json
"sidepanel.tab.mcp": "MCP",
"sidepanel.mcp.addServer": "添加服务器",
"sidepanel.mcp.emptyState": "暂无 MCP 服务器",
"sidepanel.mcp.connecting": "连接中...",
"sidepanel.mcp.form.name": "服务器名称",
"sidepanel.mcp.form.url": "https://example.com/mcp",
"sidepanel.mcp.form.token": "Bearer 令牌",
"sidepanel.mcp.form.connect": "连接",
"sidepanel.mcp.form.cancel": "取消",
"sidepanel.mcp.auth.none": "无需认证",
"sidepanel.mcp.auth.bearer": "Bearer 令牌",
"sidepanel.mcp.enabled": "已启用",
"sidepanel.mcp.disabled": "已禁用"
```

---

## 6. Verification Plan

### 6.1 Build Verification

| Check | Command | Expected Result |
|-------|---------|-----------------|
| Type-check | `npm run type-check` | No errors |
| Dev build | `npm run dev` | Builds successfully, no Vite bundling errors |
| Prod build | `npm run build` | Builds successfully |

### 6.2 SDK Bundling Verification

Before implementing the full integration, verify that `@modelcontextprotocol/sdk` bundles cleanly with Vite in the browser context:

1. `npm install @modelcontextprotocol/sdk@1.27.1`
2. Create a minimal test import in `src/13_sidepanel/mcp/`:
   ```typescript
   import { Client } from "@modelcontextprotocol/sdk/client/index.js"
   import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
   console.log(Client, StreamableHTTPClientTransport)
   ```
3. Run `npm run build` — check for Node.js polyfill errors.
4. Check the resulting bundle for any `node:` protocol imports.
5. **Fallback**: If SDK fails to bundle, implement a minimal custom `StreamableHTTPClientTransport` using raw `fetch()` + SSE (see feasibility doc, Appendix).

### 6.3 Manual Testing Checklist

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open sidepanel | MCP tab visible in header |
| 2 | Click MCP tab | Empty state: Plug icon + "No MCP servers configured" |
| 3 | Click "Add Server" | Inline form appears with name, URL, auth fields |
| 4 | Enter valid MCP server URL, click Connect | Server card appears, status dot turns yellow → green |
| 5 | Expand server card | Tool list visible with toggle switches |
| 6 | Disable a tool | Tool is excluded from agent's tool list |
| 7 | Switch to Chat tab, send a message | Agent can call MCP tools, tool call card shows in chat |
| 8 | Toggle server off | Status dot turns gray, tools removed from agent |
| 9 | Delete server | Card removed, connection closed |
| 10 | Close and reopen sidepanel | Server configs restored, auto-reconnects enabled servers |

### 6.4 Error Scenario Testing

| Scenario | Expected Behavior |
|----------|-------------------|
| Invalid URL | Status → "error", error message displayed |
| Server unreachable | Status → "error", error message displayed |
| Server disconnects mid-session | Tool call returns error, LLM gets `is_error: true` result |
| Auth token expired | Status → "error" on next call or connection attempt |
| Tool call timeout (> 30s) | Error propagated to LLM as `is_error: true` tool result |

---

## Appendix A: File Change Summary

### New Files

| File Path | Description |
|-----------|-------------|
| `src/13_sidepanel/mcp/types.ts` | MCP integration types |
| `src/13_sidepanel/mcp/McpServerStorage.ts` | Storage CRUD for server configs |
| `src/13_sidepanel/mcp/McpClientManager.ts` | MCP client lifecycle manager |
| `src/13_sidepanel/mcp/index.ts` | Module index with explicit exports |
| `src/13_sidepanel/hooks/useMcpServers.ts` | React hook for MCP state management |
| `src/13_sidepanel/components/McpPanel.tsx` | MCP tab UI component |

### Modified Files

| File Path | Change Summary |
|-----------|----------------|
| `src/13_sidepanel/components/ChatHeader.tsx` | Add `"mcp"` to `SidePanelTab`, add Plug icon tab button |
| `src/13_sidepanel/App.tsx` | Import McpPanel + useMcpServers, add tab routing, pass MCP callbacks to useAgentChat |
| `src/13_sidepanel/agent/AgentLoop.ts` | Accept `McpToolCallbacks`, build dynamic tool list, modify `executeTool` for MCP routing |
| `src/13_sidepanel/hooks/useAgentChat.ts` | Accept and pass through `McpToolCallbacks` to AgentLoop |
| `src/0_common/locales/en.json` | Add MCP i18n keys |
| `src/0_common/locales/zh.json` | Add MCP i18n keys (Chinese) |

### New Dependency

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | `1.27.1` | MCP Client + StreamableHTTPClientTransport |
