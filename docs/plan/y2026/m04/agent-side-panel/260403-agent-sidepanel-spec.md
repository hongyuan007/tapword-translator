# Agent Side Panel — Technical Specification (v3)

**Date**: 2026-04-03  
**Status**: Draft  
**Scope**: tapword-translator only (zero backend changes)

---

## 1. Feature Overview

Implement an AI agent side panel in the TapWord Chrome extension. The entire agent runs **in the browser extension** with no backend changes required.

**Core capabilities**:
- Webpage-context Q&A: Ask questions about the current page
- Knowledge storage: Save content to local IndexedDB knowledge base
- Knowledge retrieval: Semantic search using vector similarity
- Streaming responses: Real-time token streaming from Claude

**Design philosophy**:
- Zero backend dependencies — user provides their own Anthropic API key
- `@anthropic-ai/sdk` runs in sidepanel with `dangerouslyAllowBrowser: true`
- Agent loop pattern: `while stopReason === "tool_use"` (see reference code pattern)
- This is a beta / power-user feature; API key configuration required

---

## 2. Architecture

```
┌─────────────────────── Chrome Extension ──────────────────────────┐
│                                                                      │
│  ┌── 13_sidepanel (new module) ──────────────────────────────────┐ │
│  │  React UI                                                       │ │
│  │  ├── ChatView (streaming message list + input bar)             │ │
│  │  ├── AgentLoop (@anthropic-ai/sdk, ~100 lines TS)              │ │
│  │  │     dangerouslyAllowBrowser: true                           │ │
│  │  ├── KnowledgeStore (IndexedDB + cosine similarity)            │ │
│  │  └── ApiKeySettings (API key stored in chrome.storage.sync)    │ │
│  └───────────────────────────────────────────────────────────────┘ │
│         ↕ chrome.runtime.sendMessage                                 │
│  ┌── 2_background (extended) ────────────────────────────────────┐ │
│  │  - New: GET_PAGE_CONTENT handler                               │ │
│  │  - Routes to active tab content script                         │ │
│  └───────────────────────────────────────────────────────────────┘ │
│         ↕ chrome.tabs.sendMessage                                    │
│  ┌── 1_content (extended) ────────────────────────────────────── ┐ │
│  │  - New: responds to GET_PAGE_CONTENT                           │ │
│  │  - Returns document.body.innerText (trimmed)                   │ │
│  └───────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
                  ↕ HTTPS (direct, user's own DashScope API key)
       ┌────────────────────────────────────────────────┐
       │  dashscope.aliyuncs.com                        │
       │  /apps/anthropic  → Qwen3.5-plus (chat)        │
       │  /compatible-mode → text-embedding-v4 (embed)  │
       └────────────────────────────────────────────────┘
```

---

## 3. Tech Stack

| Component | Decision | Rationale |
|-----------|----------|-----------|
| **LLM SDK** | `@anthropic-ai/sdk` with `baseURL` pointed to DashScope Anthropic-compatible endpoint | Calls Qwen models via Anthropic API schema; `dangerouslyAllowBrowser: true` |
| **Model** | `qwen3.5-plus` (default), user-configurable | Qwen via Anthropic-compatible DashScope endpoint; cost-efficient |
| **Embedding** | Alibaba `text-embedding-v4` (OpenAI-compatible mode) | 1024 dims default; ¥0.0005/K tokens; OpenAI SDK compatible |
| **Agent Loop** | Custom TypeScript (~100 lines) | Standard `while stopReason === "tool_use"` pattern |
| **Vector Storage** | IndexedDB + Float32Array + JS cosine similarity | No server infra needed; fast for < 10k personal items |
| **UI Framework** | React 19 + Tailwind CSS v4 + shadcn/ui + lucide-react | Modern; scoped to 13_sidepanel only; shadcn provides chat UI primitives |
| **Extension API** | `chrome.sidePanel` (MV3) | Native Chrome sidepanel |

### Reference Documentation

- **@anthropic-ai/sdk (npm)**: https://www.npmjs.com/package/@anthropic-ai/sdk
- **Anthropic API — Tool Use**: https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview
- **Anthropic API — Messages**: https://docs.anthropic.com/en/api/messages
- **DashScope Anthropic-compatible endpoint**: `https://dashscope.aliyuncs.com/apps/anthropic` (supports qwen3.5-plus, qwen-plus, etc.)
- **Alibaba text-embedding-v4 API doc**: https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api
- **Alibaba DashScope OpenAI-compatible endpoint**: `https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings`
- **Chrome sidePanel API**: https://developer.chrome.com/docs/extensions/reference/api/sidePanel

---

## 4. Component Design

### 4.1 AgentLoop

Implements standard LLM tool-calling cycle:

```typescript
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: dashscopeApiKey,
  baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  dangerouslyAllowBrowser: true,
})

async function runAgent(userMessage: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ]

  while (true) {
    const response = await client.messages.create({
      model: 'qwen3.5-plus',
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOL_DEFINITIONS,
      max_tokens: 4096,
    })

    // Append assistant turn to history
    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason !== 'tool_use') {
      // Final text response
      return response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
    }

    // Process tool calls and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      const result = await executeTool(block.name, block.input)
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result })
    }
    messages.push({ role: 'user', content: toolResults })
    // loop continues
  }
}
```

**Tools**:

| Tool | Description | Implementation |
|------|-------------|----------------|
| `get_current_page` | Returns the current page content | Sends `GET_PAGE_CONTENT` via background → active tab content script |
| `search_knowledge` | Finds relevant saved knowledge | Embeds query via text-embedding-v4 → cosine search in KnowledgeStore |
| `store_knowledge` | Saves text to knowledge base | Embeds text via text-embedding-v4 → upserts to KnowledgeStore |

---

### 4.2 KnowledgeStore (IndexedDB + Vector Search)

```typescript
interface KnowledgeItem {
  id: string
  text: string
  embedding: Float32Array  // 1024 dims (text-embedding-v4)
  source: string           // page URL
  title: string
  createdAt: number
}

class KnowledgeStore {
  async store(item: KnowledgeItem): Promise<void>
  async search(queryEmbedding: Float32Array, topK: number): Promise<ScoredItem[]>
  async delete(id: string): Promise<void>
  async list(): Promise<KnowledgeItem[]>
}

// Cosine similarity — < 1ms for < 10k vectors
function cosineSimilarity(a: Float32Array, b: Float32Array): number
```

---

### 4.3 API Key Configuration

Users provide their own DashScope API key via the extension Options page. The key is stored in `chrome.storage.sync` and injected at runtime:

```typescript
// Chat via Anthropic-compatible DashScope endpoint
const { dashscopeApiKey } = await chrome.storage.sync.get('dashscopeApiKey')
const client = new Anthropic({
  apiKey: dashscopeApiKey,
  baseURL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  dangerouslyAllowBrowser: true,
})
```

The same `dashscopeApiKey` is used for text-embedding-v4 via the OpenAI-compatible endpoint:
```typescript
// OpenAI SDK can call DashScope embeddings directly
const openai = new OpenAI({ apiKey: dashscopeApiKey, baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })
const res = await openai.embeddings.create({ model: 'text-embedding-v4', input: text, dimensions: 1024 })
const embedding = new Float32Array(res.data[0].embedding)
```

---

## 5. No Backend Changes

This feature introduces **zero changes to translate-api**. All LLM and embedding calls go directly from the extension to external APIs using the user's own keys.

| External API | Purpose | Key Source |
|---|---|---|
| `dashscope.aliyuncs.com/apps/anthropic` | Chat (Qwen3.5-plus via Anthropic-compatible API) | User-provided `dashscopeApiKey` |
| `dashscope.aliyuncs.com/compatible-mode/v1` | Embeddings (`text-embedding-v4`, OpenAI-compatible) | Same `dashscopeApiKey` |

---

## 6. Frontend Module: 13_sidepanel

### File Structure

```
src/13_sidepanel/
├── index.html
├── index.ts                      # Entry point, mounts React app
├── App.tsx
├── components/
│   ├── ChatView.tsx              # Message list + input bar
│   ├── MessageBubble.tsx         # Single message (streaming)
│   └── ToolCallIndicator.tsx     # Shows tool in progress
├── agent/
│   ├── AgentLoop.ts              # Tool-calling loop
│   ├── tools/
│   │   ├── getCurrentPage.ts     # Fetch via background → content script
│   │   ├── searchKnowledge.ts    # Query KnowledgeStore
│   │   └── storeKnowledge.ts     # Write to KnowledgeStore
│   └── prompts.ts                # System prompt builder
├── store/
│   └── KnowledgeStore.ts         # IndexedDB + cosine similarity
├── api/
│   └── AnthropicClient.ts         # Wraps @anthropic-ai/sdk + Voyage AI embedding
└── styles/
    └── sidepanel.css
```

### manifest.json Changes

```json
{
  "permissions": ["storage", "offscreen", "sidePanel"],
  "side_panel": {
    "default_path": "sidepanel.html"
  }
}
```

---

## 7. Communication Flow: Page Q&A

```
User types message in Sidepanel
        │
        ▼
AgentLoop.runAgent(message)
        │
        ▼
client.messages.create({ model, system, messages, tools })  →  api.anthropic.com
        │
        ▼
Claude returns tool_use: get_current_page
        │
        ▼
AgentLoop.executeTool('get_current_page')
  → chrome.runtime.sendMessage(GET_PAGE_CONTENT)
  ← background → chrome.tabs.sendMessage → content script
  ← document.body.innerText returned
        │
        ▼
Messages updated with tool_result, loop calls client.messages.create again
        │
        ▼
Claude returns stop_reason !== 'tool_use'
        │
        ▼
ChatView renders final text
```

---

## 8. Implementation Phases

### Phase 1: Infrastructure
1. `manifest.json`: add `sidePanel` permission + entry
2. `2_background`: add `GET_PAGE_CONTENT` message handler
3. `1_content`: add `GET_PAGE_CONTENT` listener → returns `innerText`
4. Add `@anthropic-ai/sdk` dependency (`npm install @anthropic-ai/sdk`)
5. `AnthropicClient.ts`: wrap SDK with `dangerouslyAllowBrowser: true`; add Voyage AI embedding helper

### Phase 2: Knowledge Store + Sidepanel Shell
1. Implement `KnowledgeStore.ts` (IndexedDB + cosine search, 512-dim Float32Array)
2. Create sidepanel HTML + basic React shell (empty chat UI)
3. Add API key settings to Options page (single field for `dashscopeApiKey`)
4. Add "Open Agent" button to popup; verify sidepanel opens correctly in Chrome

### Phase 3: Agent Loop + Chat UI
1. Implement `AgentLoop.ts` with tool-calling cycle
2. Implement 3 tools (getCurrentPage, searchKnowledge, storeKnowledge)
3. Wire `ChatView` to stream output from AgentLoop
4. Stream text → render token by token in `MessageBubble`
5. Show `ToolCallIndicator` during tool execution

### Phase 4: Polish
1. Conversation history persistence (chrome.storage.session)
2. Error handling: invalid API key, quota exceeded, network failure
3. Knowledge management UI (list/delete saved items)
4. Graceful degradation when no API key is configured (prompt user to set key)

---

## 9. Open Questions & Risks

| # | Question | Impact | Resolution |
|---|----------|--------|------------|
| 1 | `dangerouslyAllowBrowser: true` security | High | API key exposed in extension memory; acceptable for personal-use extension; document in UI |
| 2 | Page content max length | Low | Trim to 50000 chars; use Readability.js for main content extraction in Phase 4 |
| 3 | DashScope Anthropic-compatible API completeness | Medium | Not all Anthropic features supported; tool-use works; test iteratively |
| 4 | User has no API key configured | Medium | Show clear instructions on first open; link to DashScope console; block chat until key is set |
| 5 | First-time user has no knowledge base | Low | Gracefully handle empty results; show onboarding prompt |
| 6 | `chrome.storage.sync` key sync across devices | Low | DashScope key syncs across user's Chrome profiles; document this behavior |

---

## 10. Out of Scope (Future Enhancements)

- Cross-device knowledge sync (knowledge stays local in IndexedDB)
- Voice input/output in sidepanel
- Multi-page knowledge import
- Knowledge tagging/organizing UI (post-MVP)
- Migration to server-side vector storage if sync becomes required
