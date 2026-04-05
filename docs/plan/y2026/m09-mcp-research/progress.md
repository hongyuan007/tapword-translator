# MCP Browser Integration Research — Progress Tracker

**Project**: TapWord Translator — MCP (Model Context Protocol) Integration  
**Goal**: Evaluate and implement MCP client capabilities within the Chrome extension's browser environment.

---

## Phases Overview

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| 1. Feasibility Research | Evaluate whether MCP can run in browser/extension context | ✅ Complete | See analysis document |
| 2. SDK Validation | Test `@modelcontextprotocol/sdk` bundling with Vite | ✅ Complete | SDK v1.27.1, clean build |
| 3. Core Integration | Implement McpClientManager + UnifiedToolRegistry | ⬜ Not Started | — |
| 4. Configuration UI | Add server config to options/popup page | ⬜ Not Started | — |
| 5. Multi-Server & Polish | Multiple servers, error recovery, tool management | ⬜ Not Started | — |
| 6. Authentication | Bearer token + optional OAuth 2.1 | ⬜ Not Started | — |

---

## Completed Work

### Phase 1: Feasibility Research — ✅ Complete (2026-07-16)

**Output**: [250716_mcp_browser_feasibility.md](analysis/250716_mcp_browser_feasibility.md)

**Key findings**:
- Browser-based MCP integration is **fully feasible** using the Streamable HTTP transport.
- Streamable HTTP relies only on standard web APIs (`fetch`, SSE) — no Node.js runtime required.
- Chrome extensions bypass CORS via `host_permissions`, eliminating the primary browser limitation.
- Multiple production apps (rtrvr.ai, Superjoin, MooPoint, etc.) already run MCP clients in-browser.
- The official TypeScript SDK's `StreamableHTTPClientTransport` uses `fetch()` internally and is likely browser-compatible.
- Fallback: A minimal custom transport implementation is ~200 lines of code using raw `fetch()` + `ReadableStream`.

**Decision**: Proceed to Phase 2 — SDK Validation.

---

### Phase 2: SDK Validation — ✅ Complete (2026-07-16)

**Actions performed**:
1. Installed `@modelcontextprotocol/sdk@1.27.1` as a project dependency.
2. Verified SDK exports: `Client`, `StreamableHTTPClientTransport`, `auth`, `sse`, `websocket`, `middleware` all available under `./client` subpath.
3. Checked for Node.js dependencies in the import chain:
   - `streamableHttp.js` → imports only from `shared/transport.js`, `types.js`, `auth.js`, and `eventsource-parser/stream` — **NO Node.js imports**.
   - `index.js` (Client class) → imports from `shared/protocol.js`, `types.js`, `validation/ajv-provider.js`, `server/zod-compat.js`, `experimental/tasks/` — **NO Node.js imports**.
   - `shared/` modules → **NO Node.js imports**.
   - Only `stdio.js` contains `node:process`, `node:stream` imports — this module is NOT imported by our code path.
4. TypeScript type-check (`npm run type-check`) — **PASSED** cleanly.
5. Vite build (`npm run build`) — **PASSED** with no Node.js polyfill errors or warnings.
6. Node.js runtime verification: `Client` and `StreamableHTTPClientTransport` both resolve as functions and instantiate successfully.

**Conclusion**: The official SDK (`@modelcontextprotocol/sdk@1.27.1`) is **fully browser-compatible** when only the `Client` + `StreamableHTTPClientTransport` modules are imported. No custom transport implementation is needed.

**Decision**: Proceed to Phase 3 — Core Integration.

---

## Next Steps

1. **Phase 2**: Install `@modelcontextprotocol/sdk`, create a minimal integration test, and verify Vite bundling produces a clean browser-compatible build.
2. If SDK validation succeeds, proceed directly to Phase 3 (Core Integration).
3. If SDK has Node.js dependency issues, implement the custom minimal transport as described in the feasibility document.
