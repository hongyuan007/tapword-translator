# Agent Sidepanel — Progress Tracker

**Task ID**: m04-agent-sidepanel  
**Started**: 2026-04-03  
**Status**: Phase 6 Complete

---

## Completed Work

### Phase 1: Infrastructure ✅

**Files Modified:**
- `src/manifest.json`: Added `"sidePanel"` permission, `"side_panel": { "default_path": "src/13_sidepanel/sidepanel.html" }`, host_permissions for `dashscope.aliyuncs.com`
- `src/0_common/types/index.ts`: Added `"GET_PAGE_CONTENT"` to `MessageType` union
- `src/2_background/messaging/MessageRouter.ts`: Added `GET_PAGE_CONTENT` case — queries active tab, forwards to content script, returns `{ success, content }`
- `src/1_content/index.ts`: Added `GET_PAGE_CONTENT` handler in `onMessage` listener — responds with `document.body.innerText` trimmed to 50,000 chars

**Packages Installed:**
- `@anthropic-ai/sdk` (for LLM calls via Anthropic-compatible API)
- `voyageai` (installed but superseded by DashScope; can be removed if desired)
- `react`, `react-dom` (v19.2.4)
- `@vitejs/plugin-react` (v4.7.0, compatible with Vite 5)
- `tailwindcss` (v4.2.1), `@tailwindcss/vite` (v4.2.1)
- `lucide-react` (v1.7.0)
- `@types/react`, `@types/react-dom`

### Phase 2: Sidepanel React Shell ✅

**Files Created:**
- `src/13_sidepanel/sidepanel.html` — HTML entry point
- `src/13_sidepanel/index.tsx` — React root mount (`createRoot`)
- `src/13_sidepanel/App.tsx` — Minimal shell UI (header + message area + input bar)
- `src/13_sidepanel/styles/sidepanel.css` — Tailwind v4 entry (`@import "tailwindcss"`)

**Files Modified:**
- `vite.config.ts`:
  - Added `react()` and `tailwindcss()` plugins (before `webExtension`)
  - Added `'src/13_sidepanel/sidepanel.html'` to `additionalInputs`
  - Added `side_panel` rewrite block in manifest function to resolve source path
- `tsconfig.json`: Added `"jsx": "react-jsx"` to `compilerOptions`

**Build Status**: ✅ `npm run build` passes, `dist/src/13_sidepanel/sidepanel.html` generated with React bundle + Tailwind CSS.

### Phase 3: AgentLoop + KnowledgeStore + Chat UI ✅

**Files Created:**
- `src/13_sidepanel/api/AnthropicClient.ts` — Factory for Anthropic SDK client (DashScope base URL)
- `src/13_sidepanel/api/EmbeddingClient.ts` — OpenAI SDK → DashScope text-embedding-v4 (1024 dims)
- `src/13_sidepanel/agent/prompts.ts` — System prompt for the agent
- `src/13_sidepanel/agent/AgentLoop.ts` — Core agent class with tool-calling loop
- `src/13_sidepanel/agent/tools/getCurrentPage.ts` — Get current page content via chrome.runtime
- `src/13_sidepanel/agent/tools/searchKnowledge.ts` — Semantic search in KnowledgeStore
- `src/13_sidepanel/agent/tools/storeKnowledge.ts` — Save knowledge with embedding
- `src/13_sidepanel/store/KnowledgeStore.ts` — IndexedDB-backed vector store with cosine similarity

**Files Modified:**
- `src/13_sidepanel/App.tsx` — Replaced shell with full chat UI (messages, API key settings, tool indicators)

---

## Remaining Work

None — all planned phases are complete.

---

### Phase 5: Sidepanel Floating Button + Dev Env Config ✅

**Files Created:**
- `src/12_floating_button/sidepanel/constants.ts` — CSS prefix, dimensions, position, color constants for sidepanel button
- `src/12_floating_button/sidepanel/styles.ts` — CSS string constant for sidepanel button (injected in Shadow DOM)
- `src/12_floating_button/sidepanel/SidepanelButtonManager.ts` — Manager class: creates Shadow DOM floating button, sends `OPEN_SIDE_PANEL` message on click

**Files Modified:**
- `src/0_common/types/index.ts`: Added `"OPEN_SIDE_PANEL"` to `MessageType` union
- `src/12_floating_button/index.ts`: Added `SidepanelButtonManager` export
- `src/2_background/messaging/MessageRouter.ts`: Added `OPEN_SIDE_PANEL` case — calls `chrome.sidePanel.open({ windowId })` using sender's window context
- `src/1_content/index.ts`: Imports and initializes `SidepanelButtonManager`; adds cleanup on context invalidation
- `src/13_sidepanel/api/AnthropicClient.ts`: Base URL now reads from `import.meta.env.VITE_AGENT_BASE_URL` with fallback
- `src/13_sidepanel/api/EmbeddingClient.ts`: Base URL now reads from `import.meta.env.VITE_AGENT_EMBEDDING_BASE_URL` with fallback
- `src/13_sidepanel/agent/AgentLoop.ts`: Model now reads from `import.meta.env.VITE_AGENT_MODEL` with fallback
- `src/13_sidepanel/App.tsx`: `loadApiKey()` checks `import.meta.env.VITE_AGENT_API_KEY` first, skipping setup screen in dev
- `.env.development`: Added template variables for `VITE_AGENT_API_KEY`, `VITE_AGENT_BASE_URL`, `VITE_AGENT_EMBEDDING_BASE_URL`, `VITE_AGENT_MODEL`

**Build Status**: ✅ `npm run type-check` and `npm run build` pass.

---

### Phase 4: Polish ✅

**Files Created:**
- `src/13_sidepanel/components/KnowledgePanel.tsx` — Knowledge management UI with list/delete, relative time formatting, empty state

**Files Modified:**
- `src/13_sidepanel/agent/AgentLoop.ts`:
  - Constructor now accepts `KnowledgeStore` via dependency injection (shared instance with KnowledgePanel)
  - Added `restoreHistory()` method for reconstructing LLM history from persisted messages
  - Added `AgentError` class and `classifyApiError()` for user-friendly error messages (401/403 → auth, 429 → rate limit, TypeError → network)
  - API call wrapped in try/catch with classified error re-throwing
- `src/13_sidepanel/App.tsx`:
  - **Conversation persistence**: Load/save messages via `chrome.storage.session`; restore LLM history on mount; clear on chat reset
  - **Error handling**: Error messages shown in red-tinted bubbles with AlertTriangle icon; `isError` field on ChatMessage
  - **Knowledge tab**: Tab-based navigation (Chat | Knowledge) in header; KnowledgePanel rendered when active
  - **Auth error banner**: Red banner with "Settings" button shown on auth failures
  - **Graceful degradation**: Input disabled when no API key; placeholder changes to "Configure API key to start..."
  - `KnowledgeStore` created at App level and shared between AgentLoop and KnowledgePanel

**Build Status**: ✅ `npm run type-check` and `npm run build` pass.

---

### Phase 6: UI Code Refactoring ✅

App.tsx refactored from ~487 lines to ~66 lines. Business logic extracted into hooks 
and service layer. UI split into 7 focused components.

**Files Created:**
- `src/13_sidepanel/types.ts` — Shared `ChatMessage` interface
- `src/13_sidepanel/services/StorageService.ts` — Encapsulates all chrome.storage calls (sync + session), with try/catch graceful degradation
- `src/13_sidepanel/hooks/useApiKey.ts` — API key lifecycle hook (env-first, then chrome.storage)
- `src/13_sidepanel/hooks/useAgentChat.ts` — Chat state management, AgentLoop interaction, session persistence, error handling
- `src/13_sidepanel/components/ChatHeader.tsx` — Tab navigation (Chat | Knowledge) + clear/settings buttons
- `src/13_sidepanel/components/MessageBubble.tsx` — Single message rendering with role-based styling
- `src/13_sidepanel/components/MessageList.tsx` — Scrollable message list with auto-scroll and tool indicator
- `src/13_sidepanel/components/ChatInputBar.tsx` — Input field + send button with Enter key support
- `src/13_sidepanel/components/SettingsDrawer.tsx` — Collapsible API key settings panel
- `src/13_sidepanel/components/AuthBanner.tsx` — Red warning banner for auth errors
- `src/13_sidepanel/components/ApiKeySetup.tsx` — Full-screen initial setup when no API key

**Files Modified:**
- `src/13_sidepanel/App.tsx` — Rewritten as thin shell (~66 lines): assembles hooks (`useApiKey`, `useAgentChat`) and renders component tree

**Build Status**: ✅ `npm run type-check` and `npm run build` pass.

---

## Architecture Summary

| Component | Technology | Notes |
|---|---|---|
| UI | React 19 + Tailwind CSS v4 + lucide-react | `src/13_sidepanel/` only |
| Chat (LLM) | `@anthropic-ai/sdk` → DashScope Anthropic-compatible | `baseURL: https://dashscope.aliyuncs.com/apps/anthropic`, model: `qwen3.5-plus` |
| Embedding | `openai` npm → DashScope OpenAI-compatible | `baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1`, model: `text-embedding-v4` (1024 dims) |
| Vector storage | IndexedDB + Float32Array | Pure browser, no server |
| Page content | `GET_PAGE_CONTENT` message → background → content script | Returns `document.body.innerText` (50k char limit) |
| API key | `dashscopeApiKey` in `chrome.storage.sync` | Single key for both chat + embedding |
| Tools | `get_current_page`, `search_knowledge`, `store_knowledge` | Anthropic tool-use format |

## Key Files (spec + reference)

- **Spec**: `docs/plan/y2026/m04/agent-side-panel/260403-agent-sidepanel-spec.md`
- **Reference agent loop (Python pattern)**: `/Users/hongyuan/project/learn-claude-code/agents/s01_agent_loop.py`
- **DashScope Anthropic-compatible env config**: `/Users/hongyuan/project/learn-claude-code/.env` (shows `ANTHROPIC_BASE_URL=https://dashscope.aliyuncs.com/apps/anthropic`, `MODEL_ID=qwen3.5-plus`)
- **DashScope embedding API doc**: https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api
