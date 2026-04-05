/**
 * Bash MCP Server — Local command execution via Streamable HTTP transport.
 *
 * Usage:
 *   node mcp-servers/bash-server/index.mjs [--port 3456]
 *
 * Then configure in TapWord MCP settings:
 *   URL: http://localhost:3456/mcp
 *   Auth: none
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import express from "express"
import { exec } from "node:child_process"
import { randomUUID } from "node:crypto"
import { stat, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { z } from "zod"
import { isCommandBlocked } from "./safety.mjs"

// ─── Constants ─────────────────────────────────────────────────

const DEFAULT_PORT = 3456
const HOST = "127.0.0.1"
const MCP_ENDPOINT = "/mcp"
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const DEFAULT_MAX_FILE_SIZE = 1_048_576 // 1 MB
const DEFAULT_ENCODING = "utf-8"
const SERVER_NAME = "bash-server"
const SERVER_VERSION = "1.0.0"

// ─── Port Resolution ───────────────────────────────────────────

function resolvePort() {
    // CLI flag: --port 8080
    const portFlagIdx = process.argv.indexOf("--port")
    if (portFlagIdx !== -1 && process.argv[portFlagIdx + 1]) {
        const parsed = parseInt(process.argv[portFlagIdx + 1], 10)
        if (!isNaN(parsed) && parsed > 0 && parsed < 65536) return parsed
    }
    // Environment variable
    if (process.env.PORT) {
        const parsed = parseInt(process.env.PORT, 10)
        if (!isNaN(parsed) && parsed > 0 && parsed < 65536) return parsed
    }
    return DEFAULT_PORT
}

// ─── MCP Server Factory ────────────────────────────────────────

/**
 * Creates and configures a new McpServer instance with all tools registered.
 * Called once per session to ensure clean state.
 */
function createMcpServer() {
    const server = new McpServer({
        name: SERVER_NAME,
        version: SERVER_VERSION,
    })

    registerRunCommandTool(server)
    registerReadFileTool(server)

    return server
}

// ─── Tool: run_command ─────────────────────────────────────────

function registerRunCommandTool(server) {
    server.registerTool("run_command", {
    description: "Execute a bash command on the local machine. Returns stdout, stderr, and exit code.",
    inputSchema: {
        command: z.string().describe("The bash command to execute"),
        cwd: z.string().optional().describe("Working directory (default: user home directory)"),
        timeout: z.number().optional().describe("Max execution time in ms (default: 30000, max: 120000)"),
    },
}, async (args) => {
    const { command, cwd, timeout } = args

    // Safety check
    const check = isCommandBlocked(command)
    if (check.blocked) {
        console.warn(`[BLOCKED] Command rejected: ${check.reason} — "${command}"`)
        return {
            content: [{ type: "text", text: `Command blocked: ${check.reason}` }],
            isError: true,
        }
    }

    const effectiveCwd = cwd || homedir()
    const effectiveTimeout = Math.min(timeout || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)

    return new Promise((resolve) => {
        const child = exec(command, {
            cwd: effectiveCwd,
            shell: "/bin/bash",
            timeout: effectiveTimeout,
            maxBuffer: 10 * 1024 * 1024, // 10 MB output buffer
            env: { ...process.env },
        }, (error, stdout, stderr) => {
            const output = [stdout, stderr].filter(Boolean).join("\n")

            if (error && error.killed) {
                // Process was killed (likely timeout)
                resolve({
                    content: [{
                        type: "text",
                        text: `[TIMEOUT after ${effectiveTimeout}ms]\n${output}\n\nProcess was killed due to timeout.`,
                    }],
                    isError: true,
                })
                return
            }

            const exitCode = error ? error.code ?? 1 : 0
            const header = `[Exit code: ${exitCode}]`

            resolve({
                content: [{ type: "text", text: `${header}\n${output}` }],
                isError: exitCode !== 0,
            })
        })

        // Ensure cleanup on unexpected situations
        child.on("error", (err) => {
            resolve({
                content: [{ type: "text", text: `Failed to start command: ${err.message}` }],
                isError: true,
            })
        })
    })
    })
}
// ─── Tool: read_file ───────────────────────────────────────────

function registerReadFileTool(server) {
    server.registerTool("read_file", {
    description: "Read a file from the local filesystem. Returns file content as text.",
    inputSchema: {
        path: z.string().describe("Absolute path to the file"),
        encoding: z.string().optional().describe('Text encoding (default: "utf-8")'),
        maxSize: z.number().optional().describe("Max file size in bytes (default: 1048576 = 1MB). Rejects larger files."),
    },
}, async (args) => {
    const { path: filePath, encoding, maxSize } = args
    const effectiveEncoding = encoding || DEFAULT_ENCODING
    const effectiveMaxSize = maxSize || DEFAULT_MAX_FILE_SIZE

    try {
        const fileStat = await stat(filePath)

        if (!fileStat.isFile()) {
            return {
                content: [{ type: "text", text: `Error: "${filePath}" is not a regular file.` }],
                isError: true,
            }
        }

        if (fileStat.size > effectiveMaxSize) {
            return {
                content: [{
                    type: "text",
                    text: `Error: File size (${fileStat.size} bytes) exceeds max allowed size (${effectiveMaxSize} bytes).`,
                }],
                isError: true,
            }
        }

        const content = await readFile(filePath, { encoding: effectiveEncoding })
        return { content: [{ type: "text", text: content }] }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
            content: [{ type: "text", text: `Error reading file: ${message}` }],
            isError: true,
        }
    }
    })
}

// ─── Session Management ────────────────────────────────────────

/** @type {Map<string, StreamableHTTPServerTransport>} */
const sessions = new Map()

// ─── Express + HTTP Server ─────────────────────────────────────

const app = express()
app.use(express.json())

/**
 * POST /mcp — Main MCP endpoint.
 * Routes requests to existing session transports or creates new ones.
 */
app.post(MCP_ENDPOINT, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"]

    // Route to existing session
    if (sessionId && sessions.has(sessionId)) {
        const transport = sessions.get(sessionId)
        await transport.handleRequest(req, res, req.body)
        return
    }

    // Reject non-initialization requests without a valid session
    if (sessionId && !sessions.has(sessionId)) {
        res.status(404).json({ error: "Session not found. Please re-initialize." })
        return
    }

    // New session: create server + transport
    try {
        const server = createMcpServer()
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
                sessions.set(id, transport)
                console.log(`[Session] New session: ${id}`)
            },
        })

        transport.onclose = () => {
            const sid = transport.sessionId
            if (sid) {
                sessions.delete(sid)
                console.log(`[Session] Closed: ${sid}`)
            }
        }

        await server.connect(transport)
        await transport.handleRequest(req, res, req.body)
    } catch (err) {
        console.error("[MCP] Error handling request:", err)
        if (!res.headersSent) {
            res.status(500).json({ error: "Internal server error" })
        }
    }
})

/**
 * GET /mcp — SSE stream for server-initiated notifications.
 */
app.get(MCP_ENDPOINT, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"]
    if (sessionId && sessions.has(sessionId)) {
        const transport = sessions.get(sessionId)
        await transport.handleRequest(req, res)
        return
    }
    res.status(400).json({ error: "Missing or invalid session ID." })
})

/**
 * DELETE /mcp — Session termination.
 */
app.delete(MCP_ENDPOINT, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"]
    if (sessionId && sessions.has(sessionId)) {
        const transport = sessions.get(sessionId)
        await transport.close()
        sessions.delete(sessionId)
        console.log(`[Session] Terminated: ${sessionId}`)
        res.status(200).json({ ok: true })
        return
    }
    res.status(404).json({ error: "Session not found." })
})

// Health check
app.get("/health", (req, res) => {
    res.json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION, activeSessions: sessions.size })
})

// ─── Start ─────────────────────────────────────────────────────

const port = resolvePort()

app.listen(port, HOST, () => {
    console.log(`\n  ✓ Bash MCP Server v${SERVER_VERSION}`)
    console.log(`    Listening on http://${HOST}:${port}${MCP_ENDPOINT}`)
    console.log(`    Health check: http://${HOST}:${port}/health`)
    console.log(`\n    Add to TapWord MCP settings:`)
    console.log(`      URL: http://localhost:${port}${MCP_ENDPOINT}`)
    console.log(`      Auth: none\n`)
})
