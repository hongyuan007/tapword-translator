# MCP Browser Integration Research — Progress Tracker

**Project**: TapWord Translator — MCP (Model Context Protocol) Integration  
**Goal**: Evaluate and implement MCP client capabilities within the Chrome extension's browser environment.

---

## Phases Overview

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| 1. Feasibility Research | Evaluate whether MCP can run in browser/extension context | ✅ Complete | See analysis document |
| 2. SDK Validation | Test `@modelcontextprotocol/sdk` bundling with Vite | ⬜ Not Started | — |
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

## Next Steps

1. **Phase 2**: Install `@modelcontextprotocol/sdk`, create a minimal integration test, and verify Vite bundling produces a clean browser-compatible build.
2. If SDK validation succeeds, proceed directly to Phase 3 (Core Integration).
3. If SDK has Node.js dependency issues, implement the custom minimal transport as described in the feasibility document.
