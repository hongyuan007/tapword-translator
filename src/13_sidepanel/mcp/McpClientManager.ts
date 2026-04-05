import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import * as loggerModule from "@/0_common/utils/logger"
import * as mcpStorage from "./McpServerStorage"
import type { McpServerConfig, McpServerState, McpToolEntry } from "./types"

const logger = loggerModule.createLogger("McpClientManager")

/** Per-tool-call timeout in milliseconds. */
const TOOL_CALL_TIMEOUT_MS = 15_000

// ─── Public Interface ──────────────────────────────────────────

export interface IMcpClientManager {
    /** Connect to an MCP server with session resumption support. */
    connectServer(config: McpServerConfig): Promise<McpServerState>
    /** Disconnect a server, preserving session cache for reconnection. */
    disconnectServer(serverId: string): Promise<void>
    /** Disconnect a server and clear its session cache permanently. */
    disconnectAndClearCache(serverId: string): Promise<void>
    /** Disconnect all servers, preserving session caches. */
    disconnectAll(): Promise<void>
    /** Get runtime state for a specific server. */
    getServerState(serverId: string): McpServerState | undefined
    /** Get runtime states for all servers. */
    getAllServerStates(): McpServerState[]
    /** Aggregate enabled tools from connected, enabled servers. */
    getAllEnabledMcpTools(): McpToolEntry[]
    /** Execute a tool call on a specific MCP server. */
    callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<string>
}

/** Internal connection record for a single MCP server. */
interface ServerConnection {
    client: Client
    transport: StreamableHTTPClientTransport
    state: McpServerState
}

// ─── Implementation ────────────────────────────────────────────

/**
 * Core MCP client lifecycle manager.
 * Manages connections to multiple MCP servers and routes tool calls.
 */
export class McpClientManager implements IMcpClientManager {
    private connections = new Map<string, ServerConnection>()

    /**
     * Connect to an MCP server: create Client + Transport, initialize,
     * discover tools, and store the connection.
     *
     * Attempts session resumption first (using cached sessionId to skip init).
     * Falls back to full fresh connect if resumption fails.
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

        // Build optional auth headers
        const headers: Record<string, string> = {}
        if (config.authType === "bearer" && config.authToken) {
            headers["Authorization"] = `Bearer ${config.authToken}`
        }

        // Attempt session resumption first
        const cached = await mcpStorage.loadSessionCache(config.id)
        if (cached) {
            try {
                const result = await this.attemptSessionResumption(config, headers, cached.sessionId)
                state.status = "connected"
                state.tools = result.tools
                this.connections.set(config.id, { client: result.client, transport: result.transport, state })
                await this.persistSessionCache(config.id, result.transport, state.tools)
                logger.info(`Resumed session for "${config.name}" — ${state.tools.length} tools`)
                return state
            } catch {
                logger.info(`Session resumption failed for "${config.name}", falling back to fresh connect`)
                await mcpStorage.clearSessionCache(config.id)
            }
        }

        // Full fresh connect
        try {
            const transport = new StreamableHTTPClientTransport(
                new URL(config.url),
                { requestInit: { headers } }
            )

            const client = new Client(
                { name: "tapword-agent", version: "1.0.0" },
                { capabilities: {} }
            )

            await client.connect(transport)

            const toolsResult = await client.listTools()
            const tools = this.mapTools(toolsResult.tools, config)

            state.status = "connected"
            state.tools = tools

            this.connections.set(config.id, { client, transport, state })
            await this.persistSessionCache(config.id, transport, tools)
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
     * Attempt to resume an existing MCP session by passing a cached sessionId
     * to the transport. If the session is still valid, listTools will succeed
     * and we skip the full init handshake.
     */
    private async attemptSessionResumption(
        config: McpServerConfig,
        headers: Record<string, string>,
        sessionId: string
    ): Promise<{ client: Client; transport: StreamableHTTPClientTransport; tools: McpToolEntry[] }> {
        const transport = new StreamableHTTPClientTransport(
            new URL(config.url),
            { requestInit: { headers }, sessionId }
        )

        const client = new Client(
            { name: "tapword-agent", version: "1.0.0" },
            { capabilities: {} }
        )

        // connect() skips initialize when transport.sessionId is set
        await client.connect(transport)

        // Verify the session by listing tools — throws on 404/409/error
        const toolsResult = await client.listTools()
        const tools = this.mapTools(toolsResult.tools, config)

        return { client, transport, tools }
    }

    /** Map raw MCP SDK tool objects to our McpToolEntry type. */
    private mapTools(
        rawTools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
        config: McpServerConfig
    ): McpToolEntry[] {
        return rawTools.map((t) => ({
            name: t.name,
            description: t.description ?? "",
            inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
            serverId: config.id,
            serverName: config.name,
            enabled: true,
        }))
    }

    /** Persist session ID and tool list for fast reconnection. */
    private async persistSessionCache(
        serverId: string,
        transport: StreamableHTTPClientTransport,
        tools: McpToolEntry[]
    ): Promise<void> {
        const sessionId = transport.sessionId
        if (sessionId) {
            await mcpStorage.saveSessionCache(serverId, { sessionId, tools })
        }
    }

    /** Disconnect a single server. Preserves session cache for fast reconnection. */
    async disconnectServer(serverId: string): Promise<void> {
        const conn = this.connections.get(serverId)
        if (!conn) return

        try {
            await conn.transport.close()
        } catch (error) {
            logger.error(`Error closing transport for ${serverId}:`, error)
        }
        this.connections.delete(serverId)
        logger.info(`Disconnected from "${conn.state.config.name}" (cache preserved)`)
    }

    /**
     * Disconnect a server AND clear its session cache.
     * Use when permanently removing a server or on unrecoverable errors.
     */
    async disconnectAndClearCache(serverId: string): Promise<void> {
        await this.disconnectServer(serverId)
        await mcpStorage.clearSessionCache(serverId)
    }

    /** Disconnect all servers. Preserves session caches for next sidepanel open. */
    async disconnectAll(): Promise<void> {
        const serverIds = Array.from(this.connections.keys())
        await Promise.allSettled(serverIds.map((id) => this.disconnectServer(id)))
        logger.info(`Disconnected all (${serverIds.length}) MCP servers (caches preserved)`)
    }

    /** Get the runtime state for a specific server. */
    getServerState(serverId: string): McpServerState | undefined {
        return this.connections.get(serverId)?.state
    }

    /** Get runtime states for all connected/tracked servers. */
    getAllServerStates(): McpServerState[] {
        return Array.from(this.connections.values()).map((c) => c.state)
    }

    /**
     * Aggregate all tools from connected, enabled servers
     * where the individual tool is also enabled.
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
                setTimeout(
                    () => reject(new Error(`MCP tool "${toolName}" timed out after ${TOOL_CALL_TIMEOUT_MS}ms`)),
                    TOOL_CALL_TIMEOUT_MS
                )
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
