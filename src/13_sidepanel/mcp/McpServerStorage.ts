import * as loggerModule from "@/0_common/utils/logger"
import type { McpServerConfig, McpSessionCache } from "./types"

const logger = loggerModule.createLogger("McpServerStorage")

// ─── Storage Keys ──────────────────────────────────────────────

const STORAGE_KEY = "mcpServers"
const TOOL_ENABLED_KEY = "mcpToolEnabled"
const SESSION_CACHE_PREFIX = "mcpSession_"

// ─── Server Config CRUD ────────────────────────────────────────

/** Load all MCP server configs from chrome.storage.sync. */
export async function loadServerConfigs(): Promise<McpServerConfig[]> {
    try {
        const result = await chrome.storage.sync.get(STORAGE_KEY)
        return (result[STORAGE_KEY] as McpServerConfig[] | undefined) ?? []
    } catch (error) {
        logger.error("Failed to load MCP server configs:", error)
        return []
    }
}

/** Overwrite all MCP server configs in chrome.storage.sync. */
export async function saveServerConfigs(configs: McpServerConfig[]): Promise<void> {
    try {
        await chrome.storage.sync.set({ [STORAGE_KEY]: configs })
    } catch (error) {
        logger.error("Failed to save MCP server configs:", error)
    }
}

/** Append a new server config and persist. */
export async function addServerConfig(config: McpServerConfig): Promise<void> {
    const configs = await loadServerConfigs()
    configs.push(config)
    await saveServerConfigs(configs)
}

/** Remove a server config by ID and persist. */
export async function removeServerConfig(serverId: string): Promise<void> {
    const configs = await loadServerConfigs()
    await saveServerConfigs(configs.filter((c) => c.id !== serverId))
}

/** Update an existing server config in place and persist. */
export async function updateServerConfig(config: McpServerConfig): Promise<void> {
    const configs = await loadServerConfigs()
    const index = configs.findIndex((c) => c.id === config.id)
    if (index !== -1) {
        configs[index] = config
        await saveServerConfigs(configs)
    }
}

// ─── Tool Enable State ────────────────────────────────────────

/** Load per-server, per-tool enable states. Stored as { [serverId]: { [toolName]: boolean } }. */
export async function loadToolEnabledStates(): Promise<Record<string, Record<string, boolean>>> {
    try {
        const result = await chrome.storage.sync.get(TOOL_ENABLED_KEY)
        return (result[TOOL_ENABLED_KEY] as Record<string, Record<string, boolean>>) ?? {}
    } catch {
        return {}
    }
}

/** Persist enable/disable state for a single tool on a server. */
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

// ─── Session Cache (chrome.storage.session) ───────────────────

/** Save MCP session cache for fast reconnection. */
export async function saveSessionCache(serverId: string, cache: McpSessionCache): Promise<void> {
    try {
        await chrome.storage.session.set({ [`${SESSION_CACHE_PREFIX}${serverId}`]: cache })
    } catch (error) {
        logger.error(`Failed to save session cache for ${serverId}:`, error)
    }
}

/** Load a previously cached MCP session. */
export async function loadSessionCache(serverId: string): Promise<McpSessionCache | null> {
    try {
        const key = `${SESSION_CACHE_PREFIX}${serverId}`
        const result = await chrome.storage.session.get(key)
        return (result[key] as McpSessionCache | undefined) ?? null
    } catch (error) {
        logger.error(`Failed to load session cache for ${serverId}:`, error)
        return null
    }
}

/** Clear cached session for a single server. */
export async function clearSessionCache(serverId: string): Promise<void> {
    try {
        await chrome.storage.session.remove(`${SESSION_CACHE_PREFIX}${serverId}`)
    } catch (error) {
        logger.error(`Failed to clear session cache for ${serverId}:`, error)
    }
}

/** Clear all MCP session caches. */
export async function clearAllSessionCaches(): Promise<void> {
    try {
        const all = await chrome.storage.session.get(null)
        const sessionKeys = Object.keys(all).filter((k) => k.startsWith(SESSION_CACHE_PREFIX))
        if (sessionKeys.length > 0) {
            await chrome.storage.session.remove(sessionKeys)
        }
    } catch (error) {
        logger.error("Failed to clear all session caches:", error)
    }
}
