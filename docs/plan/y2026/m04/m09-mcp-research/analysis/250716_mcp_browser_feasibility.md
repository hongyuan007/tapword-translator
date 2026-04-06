# MCP Browser Feasibility Research: Chrome Extension Integration

**Date**: 2026-07-16  
**Status**: Complete  
**Scope**: Evaluate the feasibility of integrating MCP (Model Context Protocol) as a client within the TapWord Chrome extension's browser environment.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [MCP Protocol Overview](#2-mcp-protocol-overview)
3. [Transport Mechanisms](#3-transport-mechanisms)
4. [Browser Feasibility Analysis](#4-browser-feasibility-analysis)
5. [TypeScript SDK Client Integration Pattern](#5-typescript-sdk-client-integration-pattern)
6. [Integration Architecture for TapWord Agent](#6-integration-architecture-for-tapword-agent)
7. [Potential Challenges and Mitigations](#7-potential-challenges-and-mitigations)
8. [Conclusion and Recommended Approach](#8-conclusion-and-recommended-approach)

---

## 1. Executive Summary

This document evaluates whether the Model Context Protocol (MCP) can be integrated into TapWord Translator — a Chrome extension — running entirely within the browser. The conclusion is that **browser-based MCP integration is fully feasible**. The Streamable HTTP transport relies exclusively on standard web APIs (`fetch`, Server-Sent Events), and Chrome extensions enjoy the additional advantage of bypassing CORS restrictions via `host_permissions`. Multiple production applications already run MCP clients in browser environments, providing strong proof of concept.

---

## 2. MCP Protocol Overview

### 2.1 What is MCP?

MCP (Model Context Protocol) is an open protocol created by Anthropic for connecting Large Language Models (LLMs) to external tools and data sources. It provides a standardized way for AI applications to discover and invoke capabilities exposed by external servers, without hardcoding integrations for each tool or data source.

### 2.2 Architecture

The MCP architecture follows a layered client-server model:

```
┌─────────────────┐
│    MCP Host      │  (AI application — e.g., TapWord Agent)
│                  │
│  ┌────────────┐  │
│  │ MCP Client │──┼──────► MCP Server A  (tool provider)
│  └────────────┘  │
│  ┌────────────┐  │
│  │ MCP Client │──┼──────► MCP Server B  (data source)
│  └────────────┘  │
│  ┌────────────┐  │
│  │ MCP Client │──┼──────► MCP Server C  (prompt library)
│  └────────────┘  │
└─────────────────┘
```

- **MCP Host**: The AI application that embeds one or more MCP clients.
- **MCP Client**: A per-server connection handler. Each client maintains a 1:1 stateful session with one MCP server.
- **MCP Server**: A service that exposes tools, data resources, and/or prompt templates to clients.

### 2.3 Protocol Foundation

- **Wire format**: JSON-RPC 2.0
- **Stateful lifecycle**: `initialize` → capability negotiation → `ready` → use → `shutdown`
- The lifecycle ensures both sides agree on supported features before any tool invocation occurs.

### 2.4 Server Primitives (exposed by MCP Servers)

| Primitive     | Description                                                                 |
|---------------|-----------------------------------------------------------------------------|
| **Tools**     | Executable functions that the LLM can invoke (e.g., search, file read, API call) |
| **Resources** | Read-only data sources the LLM can query (e.g., file contents, database rows)   |
| **Prompts**   | Reusable prompt templates with parameters, served to the host application       |

### 2.5 Client Primitives (exposed by MCP Clients to Servers)

| Primitive       | Description                                                              |
|-----------------|--------------------------------------------------------------------------|
| **Sampling**    | Server requests the client to perform an LLM completion (model-in-the-loop) |
| **Elicitation** | Server requests user input through the client (human-in-the-loop)          |
| **Logging**     | Structured log messages from server to client                              |

---

## 3. Transport Mechanisms

MCP defines two standard transport mechanisms. Their browser-compatibility characteristics differ fundamentally.

### 3.1 stdio Transport

- The client launches the MCP server as a **child subprocess**.
- The server reads JSON-RPC messages from `stdin` and writes responses to `stdout`.
- Messages are newline-delimited JSON-RPC.

**Browser compatibility: ⛔ NOT COMPATIBLE**

Spawning subprocesses is impossible in any browser environment. This transport is designed exclusively for desktop/server scenarios (e.g., VS Code extensions, CLI tools).

### 3.2 Streamable HTTP Transport (Replaces legacy HTTP+SSE)

This is the newer transport mechanism that supersedes the original SSE-based approach.

**How it works:**

1. The server exposes a **single HTTP endpoint** (e.g., `https://example.com/mcp`).
2. The client sends JSON-RPC messages via **HTTP POST** to this endpoint.
3. The server responds with either:
   - `Content-Type: application/json` — a single JSON-RPC response, or
   - `Content-Type: text/event-stream` — an SSE stream for long-running operations or multiple responses.
4. The client can open an **SSE stream via HTTP GET** to receive server-initiated messages (notifications, progress updates).
5. **Session management**: The server issues an `Mcp-Session-Id` header; the client echoes it on subsequent requests.
6. **Resumability**: SSE events carry IDs; the client can send `Last-Event-ID` to resume a dropped stream.

**Browser compatibility: ✅ FULLY COMPATIBLE**

Every component maps directly to standard browser APIs:

| MCP Transport Feature    | Browser API                                      |
|--------------------------|--------------------------------------------------|
| HTTP POST requests       | `fetch()` API                                    |
| SSE streaming responses  | `EventSource` API or `fetch()` + `ReadableStream` |
| JSON-RPC parsing         | `JSON.parse()` / `JSON.stringify()`              |
| Session headers          | Standard HTTP headers via `fetch()`              |
| Resumability             | `Last-Event-ID` header via `fetch()`             |

No Node.js-specific dependencies are required.

---

## 4. Browser Feasibility Analysis

### 4.1 Why Streamable HTTP Works in Browsers

The Streamable HTTP transport is built on universally available web standards:

1. **`fetch()` API**: Available in all modern browsers and Chrome extension contexts (service workers, content scripts, popup pages, sidepanels).
2. **Server-Sent Events (SSE)**: The `EventSource` API is natively supported. Alternatively, `fetch()` with `ReadableStream` provides more control for parsing SSE frames.
3. **JSON-RPC 2.0**: Pure JSON — no binary protocol, no special encoding.
4. **No Node.js dependencies**: The transport layer itself requires zero server-side runtime APIs.

### 4.2 CORS Considerations

Standard web pages face Cross-Origin Resource Sharing (CORS) restrictions when connecting to MCP servers on different origins. However, Chrome extensions have a significant advantage:

- **`host_permissions` in `manifest.json`**: Extensions can declare permissions to bypass CORS entirely.
- **Background service worker**: Can make cross-origin requests without CORS headers.
- **Content scripts**: Also benefit from the extension's host permissions for `fetch()` calls.

```json
// manifest.json example
{
  "host_permissions": [
    "https://*.mcp-server-domain.com/*"
  ]
}
```

The MCP specification requires servers to validate the `Origin` header for security, but Chrome extensions can include appropriate `Origin` headers and work within this security model.

### 4.3 `@modelcontextprotocol/sdk` TypeScript SDK

The official TypeScript SDK provides:

- `Client` class — manages the MCP client lifecycle
- `StreamableHTTPClientTransport` class — implements the Streamable HTTP transport

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
```

**Browser bundling considerations:**

| Aspect | Status | Notes |
|--------|--------|-------|
| `StreamableHTTPClientTransport` | ✅ Uses `fetch()` internally | Browser-native |
| `Client` class | ⚠️ Needs verification | May import other modules with Node.js deps |
| Tree-shaking via Vite | ⚠️ Needs testing | Should eliminate unused Node.js code paths |
| Fallback option | ✅ | Implement custom transport using raw `fetch()` + SSE if SDK has issues |

The SDK is also available as `@modelcontextprotocol/client` convenience package, which may have a cleaner dependency tree for client-only usage.

### 4.4 Existing Browser-Based MCP Clients (Proof of Feasibility)

Multiple production applications already run MCP clients in browser environments:

| Application | Type | Transport | Notes |
|-------------|------|-----------|-------|
| **rtrvr.ai** | Chrome Extension | Streamable HTTP | Acts as both MCP client AND server in-browser |
| **modelcontextchat.com** | Web App | Streamable HTTP | Web-based MCP client for remote servers |
| **MCPBundles Studio** | Web App | Streamable HTTP | Browser-based testing and execution of MCP tools |
| **MooPoint** | Web App | SSE, Streamable HTTP | AI chat platform with MCP support |
| **Superjoin** | Google Sheets Extension | SSE, Streamable HTTP | Fully web-based, runs inside Google Sheets |
| **Tambo** | Web Library | Streamable HTTP | Supports OAuth 2.1 for MCP auth |
| **Joey** | Mobile (React) | Streamable HTTP | React-based mobile MCP client |

These implementations conclusively demonstrate that browser-based MCP clients are not only possible but actively deployed in production.

---

## 5. TypeScript SDK Client Integration Pattern

Below is the complete integration pattern using the official TypeScript SDK. This code is designed to run inside a Chrome extension's background service worker or sidepanel context.

### 5.1 Complete Client Lifecycle

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

// ──────────────────────────────────────────────
// 1. Create MCP Client
// ──────────────────────────────────────────────
const client = new Client(
  { name: "tapword-agent", version: "1.0.0" },
  { capabilities: {} }
)

// ──────────────────────────────────────────────
// 2. Create Streamable HTTP Transport
// ──────────────────────────────────────────────
const transport = new StreamableHTTPClientTransport(
  new URL("https://mcp-server.example.com/mcp"),
  {
    // Optional: authentication provider for OAuth/API key
    authProvider: optionalAuthProvider,
  }
)

// ──────────────────────────────────────────────
// 3. Connect (initialize + capability negotiation)
// ──────────────────────────────────────────────
await client.connect(transport)

// ──────────────────────────────────────────────
// 4. Discover Available Tools
// ──────────────────────────────────────────────
const toolsResult = await client.listTools()

// Convert MCP tools to Anthropic tool format for LLM consumption
const mcpToolsForLlm = toolsResult.tools.map(tool => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema,
}))

// ──────────────────────────────────────────────
// 5. Pass Tools to LLM (merged with local tools)
// ──────────────────────────────────────────────
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-20250514",
  messages: conversationMessages,
  tools: [...localTools, ...mcpToolsForLlm],
})

// ──────────────────────────────────────────────
// 6. Route Tool Calls (local vs. MCP)
// ──────────────────────────────────────────────
if (response.content.some(c => c.type === "tool_use")) {
  for (const block of response.content) {
    if (block.type !== "tool_use") continue

    if (isMcpTool(block.name)) {
      // Execute via MCP server
      const result = await client.callTool({
        name: block.name,
        arguments: block.input,
      })
      // Append tool_result to conversation and loop back to LLM
    } else {
      // Execute via local TOOL_REGISTRY
      const handler = TOOL_REGISTRY.get(block.name)
      const result = await handler.execute(block.input)
    }
  }
}

// ──────────────────────────────────────────────
// 7. Cleanup on Session End
// ──────────────────────────────────────────────
await transport.close()
```

### 5.2 Helper: Identifying MCP Tools

```typescript
// Maintain a Set of tool names sourced from MCP servers
const mcpToolNames = new Set<string>()

function registerMcpTools(tools: Array<{ name: string }>): void {
  for (const tool of tools) {
    mcpToolNames.add(tool.name)
  }
}

function isMcpTool(toolName: string): boolean {
  return mcpToolNames.has(toolName)
}
```

### 5.3 Discovering Resources and Prompts

```typescript
// List available resources (data sources)
const resourcesResult = await client.listResources()
for (const resource of resourcesResult.resources) {
  console.log(`Resource: ${resource.name} — ${resource.uri}`)
}

// Read a specific resource
const content = await client.readResource({ uri: "file:///path/to/data" })

// List available prompt templates
const promptsResult = await client.listPrompts()
for (const prompt of promptsResult.prompts) {
  console.log(`Prompt: ${prompt.name} — ${prompt.description}`)
}

// Get a specific prompt with arguments
const promptResult = await client.getPrompt({
  name: "translate-context",
  arguments: { text: "hello", targetLang: "zh" },
})
```

---

## 6. Integration Architecture for TapWord Agent

### 6.1 Current Architecture

The TapWord Agent currently operates with a local-only tool model:

```
AgentLoop
  └── TOOL_REGISTRY (Map<string, ToolHandler>)
        ├── todoTools       (task management)
        ├── knowledgeTools  (knowledge base)
        └── getCurrentPage  (page content extraction)
```

### 6.2 Proposed MCP-Integrated Architecture

```
AgentLoop
  ├── Local Tools (TOOL_REGISTRY — unchanged)
  │     ├── todoTools
  │     ├── knowledgeTools
  │     └── getCurrentPage
  │
  ├── McpClientManager (NEW)
  │     ├── MCP Client 1 → Remote Server A (Streamable HTTP)
  │     ├── MCP Client 2 → Remote Server B (Streamable HTTP)
  │     └── MCP Client N → Remote Server N (Streamable HTTP)
  │
  └── UnifiedToolRegistry (NEW — merges local + MCP tools)
        ├── Local tools from TOOL_REGISTRY
        └── MCP tools from all connected servers
```

### 6.3 Key Design Decisions

#### 6.3.1 McpClientManager

A centralized service that manages the lifecycle of multiple MCP server connections.

```typescript
interface McpServerConfig {
  id: string
  name: string
  url: string
  authType: 'none' | 'bearer' | 'oauth'
  authToken?: string
  enabled: boolean
}

class McpClientManager {
  private clients: Map<string, Client> = new Map()
  private transports: Map<string, StreamableHTTPClientTransport> = new Map()

  async connect(config: McpServerConfig): Promise<void> { /* ... */ }
  async disconnect(serverId: string): Promise<void> { /* ... */ }
  async disconnectAll(): Promise<void> { /* ... */ }
  async listAllTools(): Promise<McpToolEntry[]> { /* ... */ }
  async callTool(serverId: string, name: string, args: unknown): Promise<unknown> { /* ... */ }
}
```

Responsibilities:
- Connect to / disconnect from MCP servers
- Aggregate tools from all connected servers
- Route tool calls to the correct server
- Handle reconnection on failures

#### 6.3.2 UnifiedToolRegistry

Merges local TOOL_REGISTRY tools and MCP tools into a single list for the LLM. Each tool entry carries a source tag for routing.

```typescript
interface UnifiedToolEntry {
  name: string
  description: string
  inputSchema: object
  source: { type: 'local' } | { type: 'mcp', serverId: string }
}
```

When the LLM calls a tool:
1. Look up the tool in the unified registry.
2. If `source.type === 'local'` → execute via `TOOL_REGISTRY`.
3. If `source.type === 'mcp'` → execute via `McpClientManager.callTool(serverId, name, args)`.

#### 6.3.3 Server Configuration Storage

- Store MCP server URLs and auth info in `chrome.storage.sync` for cross-device sync.
- Provide a UI in the options/popup page for users to add, remove, and configure servers.
- Configuration schema:

```typescript
interface McpSettings {
  servers: McpServerConfig[]
}
```

#### 6.3.4 Lazy Connection Strategy

- Do NOT maintain persistent background connections to MCP servers.
- Connect when the sidepanel opens (user initiates an agent session).
- Disconnect when the sidepanel closes or after an idle timeout.
- Re-initialize sessions on each sidepanel open (do not rely on long-lived sessions).

#### 6.3.5 Error Handling

- MCP server disconnections must NOT crash the agent.
- Gracefully degrade to local tools only when an MCP server is unavailable.
- Show user-visible status indicators for server connection state.
- Implement per-tool-call timeouts to prevent indefinite hangs.

### 6.4 Data Flow Diagram

```
User Message
    │
    ▼
AgentLoop
    │
    ├─ 1. Build tool list ◄─── UnifiedToolRegistry
    │                              ├── TOOL_REGISTRY (local)
    │                              └── McpClientManager.listAllTools() (remote)
    │
    ├─ 2. Send to LLM with tools
    │
    ├─ 3. Receive LLM response
    │
    ├─ 4. If tool_use:
    │     ├─ Local tool? → TOOL_REGISTRY.execute()
    │     └─ MCP tool?   → McpClientManager.callTool()
    │
    ├─ 5. Append tool_result to conversation
    │
    └─ 6. Loop back to step 2 (agentic loop)
```

---

## 7. Potential Challenges and Mitigations

### 7.1 SDK Node.js Dependencies

| Aspect | Detail |
|--------|--------|
| **Risk** | The `@modelcontextprotocol/sdk` package may import Node.js-specific modules (e.g., `node:http`, `node:child_process`) in parts of its codebase. |
| **Impact** | Build failure or runtime error when bundled for browser via Vite. |
| **Mitigation A** | Test if Vite tree-shaking removes Node.js code paths when only `Client` + `StreamableHTTPClientTransport` are imported. |
| **Mitigation B** | If tree-shaking fails, implement a custom `StreamableHTTPClientTransport` using raw `fetch()` + `ReadableStream` for SSE parsing. The Streamable HTTP protocol is well-documented JSON-RPC over standard HTTP — a minimal implementation is ~200 lines. |

### 7.2 CORS Restrictions

| Aspect | Detail |
|--------|--------|
| **Risk** | Standard web pages face CORS restrictions when connecting to MCP servers on different origins. |
| **Impact** | `fetch()` calls blocked by the browser's same-origin policy. |
| **Mitigation** | Chrome extensions bypass CORS via `host_permissions` in `manifest.json`. This is a non-issue for extension contexts (background service worker, sidepanel, popup). |

### 7.3 MCP Server Authentication

| Aspect | Detail |
|--------|--------|
| **Risk** | MCP servers may require OAuth 2.1 flows, which involve redirects and popups. |
| **Impact** | Complex auth UX inside a Chrome extension context. |
| **Mitigation** | Phase 1: Support only API key / Bearer token authentication (simple header injection). Phase 2: Add OAuth 2.1 support using `chrome.identity` API for redirect handling. |

### 7.4 Tool Name Conflicts

| Aspect | Detail |
|--------|--------|
| **Risk** | Local tools and MCP tools (or tools from different MCP servers) may share the same name. |
| **Impact** | Ambiguous tool routing; wrong tool executed. |
| **Mitigation** | Option A: Namespace MCP tools with a server prefix (e.g., `serverA/search`). Option B: Reject duplicate names and warn the user during configuration. Option C: Prioritize local tools and shadow MCP tools with the same name. |

### 7.5 Context Window Bloat

| Aspect | Detail |
|--------|--------|
| **Risk** | Connecting to many MCP servers exposes dozens or hundreds of tools, consuming LLM context window tokens. |
| **Impact** | Reduced room for conversation history; higher API costs; potential confusion for the LLM. |
| **Mitigation** | Allow users to selectively enable/disable individual tools per server in the settings UI. Implement a tool budget (maximum number of MCP tools sent to the LLM). Consider dynamic tool selection based on conversation context. |

### 7.6 Network Latency

| Aspect | Detail |
|--------|--------|
| **Risk** | Remote MCP tool execution adds network round-trip time. |
| **Impact** | Slower agent responses; poor UX for latency-sensitive tools. |
| **Mitigation** | Show loading state in the UI (TapWord already has `ToolCallCard` with loading indicators). Set per-tool-call timeouts (e.g., 30 seconds). Allow users to configure timeout values. |

### 7.7 Session Management

| Aspect | Detail |
|--------|--------|
| **Risk** | Streamable HTTP sessions are stateful. Chrome extension sidepanels can be opened/closed frequently, and service workers have limited lifetimes. |
| **Impact** | Stale sessions; failed requests after reconnection. |
| **Mitigation** | Re-initialize MCP sessions on each sidepanel open. Do not cache session IDs across navigation. Implement automatic reconnection with exponential backoff. |

---

## 8. Conclusion and Recommended Approach

### 8.1 Verdict

**Browser-based MCP integration is FULLY FEASIBLE** for the TapWord Chrome extension.

Key supporting evidence:
- The Streamable HTTP transport uses only standard web APIs (`fetch`, SSE) — no Node.js runtime required.
- Chrome extensions bypass CORS restrictions via `host_permissions`, eliminating the primary barrier for browser-based HTTP clients.
- Multiple production applications (rtrvr.ai, Superjoin, MooPoint, etc.) already run MCP clients in browser environments.
- The official TypeScript SDK provides `StreamableHTTPClientTransport`, which uses `fetch()` internally and is likely browser-compatible.

### 8.2 Recommended Implementation Plan

#### Phase 1: SDK Validation (1-2 days)

1. Add `@modelcontextprotocol/sdk` as a dependency.
2. Create a minimal test: import `Client` + `StreamableHTTPClientTransport`, connect to a test MCP server, list tools, call a tool.
3. Build with Vite and verify the bundle:
   - Does it build without Node.js polyfill errors?
   - What is the bundle size impact?
4. **Decision point**: If SDK bundles cleanly → use it. If not → implement custom transport.

#### Phase 2: Core Integration (3-5 days)

1. Implement `McpClientManager` service.
2. Implement `UnifiedToolRegistry` that merges local + MCP tools.
3. Modify `AgentLoop` to use `UnifiedToolRegistry` for tool list construction and routing.
4. Support connecting to a single MCP server (hardcoded URL for testing).

#### Phase 3: Configuration UI (2-3 days)

1. Add MCP server configuration to the options/popup page.
2. Store server configs in `chrome.storage.sync`.
3. Support add / remove / enable / disable servers.
4. Show connection status indicators.

#### Phase 4: Multi-Server & Polish (2-3 days)

1. Support multiple simultaneous MCP server connections.
2. Handle tool name conflicts (namespacing or rejection).
3. Implement per-tool enable/disable toggles.
4. Add error recovery and reconnection logic.
5. Implement idle timeout and cleanup.

#### Phase 5: Authentication (2-3 days, if needed)

1. Support Bearer token authentication.
2. (Optional) Add OAuth 2.1 support via `chrome.identity` API.

### 8.3 Transport Strategy

- **Only support Streamable HTTP transport** — stdio is impossible in the browser.
- The legacy HTTP+SSE transport is deprecated; no need to support it.
- Streamable HTTP covers all use cases and is the recommended transport going forward.

### 8.4 Fallback Strategy

If the official SDK proves problematic for browser bundling, a custom minimal implementation is straightforward:

```typescript
// Minimal custom Streamable HTTP transport (~200 lines)
// Uses only: fetch(), ReadableStream, TextDecoder, JSON.parse

class MinimalStreamableHttpTransport {
  private sessionId: string | null = null

  constructor(private readonly endpoint: URL) {}

  async send(message: JsonRpcMessage): Promise<JsonRpcMessage | AsyncIterable<JsonRpcMessage>> {
    const response = await fetch(this.endpoint.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      },
      body: JSON.stringify(message),
    })

    // Capture session ID from server
    const newSessionId = response.headers.get('Mcp-Session-Id')
    if (newSessionId) this.sessionId = newSessionId

    const contentType = response.headers.get('Content-Type') ?? ''

    if (contentType.includes('text/event-stream')) {
      return this.parseSSEStream(response.body!)
    } else {
      return await response.json()
    }
  }

  private async *parseSSEStream(body: ReadableStream<Uint8Array>): AsyncIterable<JsonRpcMessage> {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += value
      // Parse SSE frames from buffer...
      // yield JSON.parse(data) for each complete event
    }
  }
}
```

This fallback ensures the project is never blocked by SDK compatibility issues.

---

## Appendix A: Key References

| Resource | URL |
|----------|-----|
| MCP Specification | https://spec.modelcontextprotocol.io |
| MCP TypeScript SDK | https://github.com/modelcontextprotocol/typescript-sdk |
| Streamable HTTP Transport Spec | https://spec.modelcontextprotocol.io/specification/basic/transports/#streamable-http |
| JSON-RPC 2.0 Specification | https://www.jsonrpc.org/specification |

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **MCP** | Model Context Protocol — open protocol for LLM-to-tool communication |
| **JSON-RPC 2.0** | A stateless, lightweight remote procedure call protocol using JSON |
| **SSE** | Server-Sent Events — a standard for server-to-client streaming over HTTP |
| **Streamable HTTP** | MCP's HTTP-based transport using POST + SSE on a single endpoint |
| **stdio** | Standard input/output transport — requires subprocess spawning (not browser-compatible) |
| **CORS** | Cross-Origin Resource Sharing — browser security policy for cross-origin requests |
| **host_permissions** | Chrome extension manifest field that grants cross-origin access |
