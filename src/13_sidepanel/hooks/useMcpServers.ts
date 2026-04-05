import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import Anthropic from "@anthropic-ai/sdk"
import { McpClientManager } from "../mcp/McpClientManager"
import * as mcpStorage from "../mcp/McpServerStorage"
import type { McpServerConfig, McpServerState } from "../mcp/types"
import type { McpToolCallbacks } from "../agent/AgentLoop"

// --- Public interface ---

export interface UseMcpServersResult {
    serverStates: McpServerState[]
    addServer: (config: McpServerConfig) => Promise<void>
    removeServer: (serverId: string) => Promise<void>
    toggleServer: (serverId: string, enabled: boolean) => Promise<void>
    toggleTool: (serverId: string, toolName: string, enabled: boolean) => void
    reconnectServer: (serverId: string) => Promise<void>
    mcpCallbacks: McpToolCallbacks | undefined
}

// --- Hook ---

export function useMcpServers(): UseMcpServersResult {
    const managerRef = useRef(new McpClientManager())
    const [serverStates, setServerStates] = useState<McpServerState[]>([])

    // Mount: load configs, auto-connect enabled servers, apply tool enabled states
    useEffect(() => {
        let cancelled = false

        async function init() {
            const configs = await mcpStorage.loadServerConfigs()
            const toolStates = await mcpStorage.loadToolEnabledStates()
            if (cancelled) return

            // Pre-populate states using cached tools for instant UI display
            const initialStates: McpServerState[] = await Promise.all(
                configs.map(async (config) => {
                    if (!config.enabled) {
                        return { config, status: "disconnected" as const, tools: [] }
                    }
                    const cached = await mcpStorage.loadSessionCache(config.id)
                    if (cached) {
                        // Show cached tools immediately with "connecting" status
                        const cachedTools = cached.tools.map((t) => ({ ...t }))
                        applyToolEnabledOverrides(
                            { config, status: "connecting", tools: cachedTools },
                            toolStates
                        )
                        return { config, status: "connecting" as const, tools: cachedTools }
                    }
                    return { config, status: "disconnected" as const, tools: [] }
                })
            )
            setServerStates(initialStates)

            // Auto-connect enabled servers (uses session cache internally for fast resume)
            for (const config of configs) {
                if (!config.enabled) continue
                const state = await managerRef.current.connectServer(config)
                if (cancelled) return
                applyToolEnabledOverrides(state, toolStates)
                setServerStates((prev) => prev.map((s) => (s.config.id === config.id ? state : s)))
            }
        }

        init()
        return () => {
            cancelled = true
            managerRef.current.disconnectAll()
        }
    }, [])

    const addServer = useCallback(async (config: McpServerConfig) => {
        await mcpStorage.addServerConfig(config)

        if (config.enabled) {
            const connectingState: McpServerState = { config, status: "connecting", tools: [] }
            setServerStates((prev) => [...prev, connectingState])

            const state = await managerRef.current.connectServer(config)
            setServerStates((prev) => prev.map((s) => (s.config.id === config.id ? state : s)))
        } else {
            setServerStates((prev) => [...prev, { config, status: "disconnected", tools: [] }])
        }
    }, [])

    const removeServer = useCallback(async (serverId: string) => {
        await managerRef.current.disconnectAndClearCache(serverId)
        await mcpStorage.removeServerConfig(serverId)
        setServerStates((prev) => prev.filter((s) => s.config.id !== serverId))
    }, [])

    const toggleServer = useCallback(async (serverId: string, enabled: boolean) => {
        // Update persisted config
        const current = serverStates.find((s) => s.config.id === serverId)
        if (!current) return

        const updatedConfig: McpServerConfig = { ...current.config, enabled }
        await mcpStorage.updateServerConfig(updatedConfig)

        if (enabled) {
            setServerStates((prev) =>
                prev.map((s) => (s.config.id === serverId ? { ...s, config: updatedConfig, status: "connecting" } : s))
            )
            const toolStates = await mcpStorage.loadToolEnabledStates()
            const state = await managerRef.current.connectServer(updatedConfig)
            applyToolEnabledOverrides(state, toolStates)
            setServerStates((prev) => prev.map((s) => (s.config.id === serverId ? state : s)))
        } else {
            await managerRef.current.disconnectAndClearCache(serverId)
            setServerStates((prev) =>
                prev.map((s) =>
                    s.config.id === serverId ? { config: updatedConfig, status: "disconnected", tools: [] } : s
                )
            )
        }
    }, [serverStates])

    const toggleTool = useCallback((serverId: string, toolName: string, enabled: boolean) => {
        mcpStorage.saveToolEnabledState(serverId, toolName, enabled)
        setServerStates((prev) =>
            prev.map((s) => {
                if (s.config.id !== serverId) return s
                return {
                    ...s,
                    tools: s.tools.map((t) => (t.name === toolName ? { ...t, enabled } : t)),
                }
            })
        )
    }, [])

    const reconnectServer = useCallback(async (serverId: string) => {
        const current = serverStates.find((s) => s.config.id === serverId)
        if (!current) return

        await managerRef.current.disconnectServer(serverId)
        setServerStates((prev) =>
            prev.map((s) => (s.config.id === serverId ? { ...s, status: "connecting", tools: [], errorMessage: undefined } : s))
        )

        const toolStates = await mcpStorage.loadToolEnabledStates()
        const state = await managerRef.current.connectServer(current.config)
        applyToolEnabledOverrides(state, toolStates)
        setServerStates((prev) => prev.map((s) => (s.config.id === serverId ? state : s)))
    }, [serverStates])

    // Build McpToolCallbacks for AgentLoop (tool names are namespaced to prevent collisions)
    const mcpCallbacks = useMemo<McpToolCallbacks | undefined>(() => {
        const hasConnected = serverStates.some((s) => s.status === "connected" && s.config.enabled)
        if (!hasConnected) return undefined

        return {
            getMcpToolDefinitions: (): Anthropic.Tool[] => {
                return getEnabledTools(serverStates).map((tool) => ({
                    name: toNamespacedToolName(tool.serverName, tool.name),
                    description: `[${tool.serverName}] ${tool.description}`,
                    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
                }))
            },
            callMcpTool: (_serverId: string, namespacedName: string, args: Record<string, unknown>) => {
                const originalName = extractOriginalToolName(namespacedName)
                return managerRef.current.callTool(_serverId, originalName, args)
            },
            getMcpToolMap: (): Map<string, string> => {
                const map = new Map<string, string>()
                for (const tool of getEnabledTools(serverStates)) {
                    map.set(toNamespacedToolName(tool.serverName, tool.name), tool.serverId)
                }
                return map
            },
        }
    }, [serverStates])

    return { serverStates, addServer, removeServer, toggleServer, toggleTool, reconnectServer, mcpCallbacks }
}

// --- Internal helpers ---

/** Apply persisted tool enabled overrides to a freshly connected server state. */
function applyToolEnabledOverrides(
    state: McpServerState,
    toolStates: Record<string, Record<string, boolean>>
): void {
    const serverOverrides = toolStates[state.config.id]
    if (!serverOverrides) return
    for (const tool of state.tools) {
        if (serverOverrides[tool.name] !== undefined) {
            tool.enabled = serverOverrides[tool.name]!
        }
    }
}

/** Collect all enabled tools from connected, enabled servers. */
function getEnabledTools(serverStates: McpServerState[]) {
    return serverStates
        .filter((s) => s.status === "connected" && s.config.enabled)
        .flatMap((s) => s.tools.filter((t) => t.enabled))
}

// ─── Tool name namespacing ─────────────────────────────────────

const NAMESPACE_SEPARATOR = "__"

/** Sanitize server name to a safe identifier (lowercase, alphanumeric + underscores). */
function sanitizeServerName(serverName: string): string {
    return serverName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
}

/** Build a namespaced tool name: `{sanitizedServerName}__{toolName}`. */
function toNamespacedToolName(serverName: string, toolName: string): string {
    return `${sanitizeServerName(serverName)}${NAMESPACE_SEPARATOR}${toolName}`
}

/** Extract the original tool name from a namespaced name. */
function extractOriginalToolName(namespacedName: string): string {
    const idx = namespacedName.indexOf(NAMESPACE_SEPARATOR)
    return idx === -1 ? namespacedName : namespacedName.slice(idx + NAMESPACE_SEPARATOR.length)
}
