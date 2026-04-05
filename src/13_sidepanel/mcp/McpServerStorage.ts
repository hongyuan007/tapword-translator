import * as loggerModule from "@/0_common/utils/logger"
import type { McpServerConfig, McpSessionCache } from "@/13_sidepanel/mcp/types"

const logger = loggerModule.createLogger("McpServerStorage")

// ─── Constants ─────────────────────────────────────────────────

const STORAGE_KEY = "mcpServers"
const TOOL_ENABLED_KEY = "mcpToolEnabled"
const SESSION_CACHE_PREFIX = "mcpSession_"

// ─── Public Interface ──────────────────────────────────────────

/** Public API for McpServerStorage. */
export interface IMcpServerStorage {
    loadServerConfigs(): Promise<McpServerConfig[]>
    saveServerConfigs(configs: McpServerConfig[]): Promise<void>
    addServerConfig(config: McpServerConfig): Promise<void>
    removeServerConfig(serverId: string): Promise<void>
    updateServerConfig(config: McpServerConfig): Promise<void>
    loadToolEnabledStates(): Promise<Record<string, Record<string, boolean>>>
    saveToolEnabledState(serverId: string, toolName: string, enabled: boolean): Promise<void>
    saveSessionCache(serverId: string, cache: McpSessionCache): Promise<void>
    loadSessionCache(serverId: string): Promise<McpSessionCache | null>
    clearSessionCache(serverId: string): Promise<void>
    clearAllSessionCaches(): Promise<void>
}

// ─── McpServerStorage Class ────────────────────────────────────

export class McpServerStorage implements IMcpServerStorage {

    /** Load all MCP server configs from chrome.storage.sync. */
    async loadServerConfigs(): Promise<McpServerConfig[]> {
        try {
            const result = await chrome.storage.sync.get(STORAGE_KEY)
            return (result[STORAGE_KEY] as McpServerConfig[] | undefined) ?? []
        } catch (error) {
            logger.error("Failed to load MCP server configs:", error)
            return []
        }
    }

    /** Overwrite all MCP server configs in chrome.storage.sync. */
    async saveServerConfigs(configs: McpServerConfig[]): Promise<void> {
        try {
            await chrome.storage.sync.set({ [STORAGE_KEY]: configs })
        } catch (error) {
            logger.error("Failed to save MCP server configs:", error)
        }
    }

    /** Append a new server config and persist. */
    async addServerConfig(config: McpServerConfig): Promise<void> {
        const configs = await this.loadServerConfigs()
        configs.push(config)
        await this.saveServerConfigs(configs)
    }

    /** Remove a server config by ID and persist. */
    async removeServerConfig(serverId: string): Promise<void> {
        const configs = await this.loadServerConfigs()
        await this.saveServerConfigs(configs.filter((c) => c.id !== serverId))
    }

    /** Update an existing server config in place and persist. */
    async updateServerConfig(config: McpServerConfig): Promise<void> {
        const configs = await this.loadServerConfigs()
        const index = configs.findIndex((c) => c.id === config.id)
        if (index !== -1) {
            configs[index] = config
            await this.saveServerConfigs(configs)
        }
    }

    /** Load per-server, per-tool enable states. */
    async loadToolEnabledStates(): Promise<Record<string, Record<string, boolean>>> {
        try {
            const result = await chrome.storage.sync.get(TOOL_ENABLED_KEY)
            return (result[TOOL_ENABLED_KEY] as Record<string, Record<string, boolean>>) ?? {}
        } catch {
            return {}
        }
    }

    /** Persist enable/disable state for a single tool on a server. */
    async saveToolEnabledState(
        serverId: string,
        toolName: string,
        enabled: boolean
    ): Promise<void> {
        const states = await this.loadToolEnabledStates()
        if (!states[serverId]) states[serverId] = {}
        states[serverId][toolName] = enabled
        try {
            await chrome.storage.sync.set({ [TOOL_ENABLED_KEY]: states })
        } catch (error) {
            logger.error("Failed to save tool enabled state:", error)
        }
    }

    /** Save MCP session cache for fast reconnection. */
    async saveSessionCache(serverId: string, cache: McpSessionCache): Promise<void> {
        try {
            await chrome.storage.session.set({ [`${SESSION_CACHE_PREFIX}${serverId}`]: cache })
        } catch (error) {
            logger.error(`Failed to save session cache for ${serverId}:`, error)
        }
    }

    /** Load a previously cached MCP session. */
    async loadSessionCache(serverId: string): Promise<McpSessionCache | null> {
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
    async clearSessionCache(serverId: string): Promise<void> {
        try {
            await chrome.storage.session.remove(`${SESSION_CACHE_PREFIX}${serverId}`)
        } catch (error) {
            logger.error(`Failed to clear session cache for ${serverId}:`, error)
        }
    }

    /** Clear all MCP session caches. */
    async clearAllSessionCaches(): Promise<void> {
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
}

/** Module-level singleton instance. */
export const mcpServerStorage = new McpServerStorage()
