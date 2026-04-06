Last updated on: 2026-04-06

# TapWord Side Panel Module (`src/13_sidepanel`)

## Module Overview

This module implements the React-based Side Panel application for the TapWord extension. It serves as an interactive AI chat assistant that can converse with the user, understand the current webpage context, manage a local knowledge base, and orchestrate complex tasks via a subagent system. The panel also supports MCP (Model Context Protocol) integration for connecting to external tool servers.

## File Structure

```
13_sidepanel/
├── sidepanel.html
├── index.tsx
├── import-skill.html
├── import-skill-entry.tsx
├── App.tsx
├── types.ts
├── agent/
│   ├── AgentLoop.ts
│   ├── SubagentRunner.ts
│   ├── prompts.ts
│   ├── README.md
│   ├── prompts/
│   │   └── explainTextPrompt.ts
│   ├── tools/
│   │   ├── ToolRegistry.ts
│   │   ├── types.ts
│   │   ├── registerAll.ts
│   │   ├── getCurrentPageTool.ts
│   │   ├── getSelectedTextTool.ts
│   │   ├── fetchUrlTool.ts
│   │   ├── fileTools.ts
│   │   ├── searchFilesTool.ts
│   │   ├── knowledgeTools.ts
│   │   ├── skillTools.ts
│   │   ├── todoTools.ts
│   │   └── subagentToolFactory.ts
│   └── utils/
│       ├── ContextCompressor.ts
│       ├── RateLimiter.ts
│       ├── retryWithBackoff.ts
│       └── isProxyArtifact.ts
├── api/
│   ├── AnthropicClient.ts
│   └── EmbeddingClient.ts
├── components/
│   ├── ApiKeySetup.tsx
│   ├── AuthBanner.tsx
│   ├── ChatHeader.tsx
│   ├── ChatInputBar.tsx
│   ├── CompactionCard.tsx
│   ├── ContextUsageBar.tsx
│   ├── FileBrowserPanel.tsx
│   ├── KnowledgePanel.tsx
│   ├── MarkdownBlock.tsx
│   ├── McpPanel.tsx
│   ├── MessageBubble.tsx
│   ├── MessageList.tsx
│   ├── SkillsPanel.tsx
│   ├── SubagentCard.tsx
│   ├── ThinkingCard.tsx
│   ├── TodoPanel.tsx
│   ├── ToolCallCard.tsx
│   └── ToolsPanel.tsx
├── hooks/
│   ├── useAgentChat.ts
│   ├── useApiKey.ts
│   └── useMcpServers.ts
├── mcp/
│   ├── McpClientManager.ts
│   ├── McpServerStorage.ts
│   ├── index.ts
│   └── types.ts
├── services/
│   ├── KnowledgeStore.ts
│   ├── SkillStorageService.ts
│   ├── StorageService.ts
│   ├── TapWordFS.ts
│   └── TodoManager.ts
└── styles/
    └── sidepanel.css
```

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                            App.tsx                                 │
│         (Root Component — Tab Routing, Setup Logic)                │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌── Agent System (agent/) ──────────────────────────────────┐     │
│  │                                                            │     │
│  │  AgentLoop                                                 │     │
│  │  • While-loop orchestrator with streaming LLM calls        │     │
│  │  • Tool execution via ToolRegistry (enabled tools only)    │     │
│  │  • AbortSignal support for cancellation                    │     │
│  │  • MCP tool callbacks integration                          │     │
│  │                                                            │     │
│  │  SubagentRunner                                            │     │
│  │  • Standalone LLM loop for delegated subtasks              │     │
│  │  • Max 40 rounds, 20000 max_tokens per call                │     │
│  │  • Rate limiting + retry with backoff                      │     │
│  │                                                            │     │
│  │  ToolRegistry                                              │     │
│  │  • Centralized tool management with enable/disable         │     │
│  │  • 3 categories: builtin | capability | skill              │     │
│  │  • Auto-discovery via import.meta.glob in registerAll.ts   │     │
│  │  • Persistence of enabled state via localStorage           │     │
│  │                                                            │     │
│  │  Utils: ContextCompressor, RateLimiter,                    │     │
│  │         retryWithBackoff, isProxyArtifact                  │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                    │
│  ┌── MCP Integration (mcp/) ─────────────────────────────────┐     │
│  │  McpClientManager: Server connections & tool discovery      │     │
│  │  McpServerStorage: Persistent server configurations         │     │
│  │  Integrated via McpToolCallbacks interface in AgentLoop     │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                    │
│  ┌── Data & Persistence (services/) ─────────────────────────┐     │
│  │  KnowledgeStore: Embedding-based local knowledge retrieval  │     │
│  │  SkillStorageService: Skill file storage via TapWordFS      │     │
│  │  TapWordFS: Virtual file system on chrome.storage           │     │
│  │  TodoManager: Todo item persistence & lifecycle             │     │
│  │  StorageService: chrome.storage utility                     │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                    │
│  ┌── UI Components (components/) ────────────────────────────┐     │
│  │  Chat UI: ChatHeader, ChatInputBar, MessageList,            │     │
│  │           MessageBubble, ContextUsageBar                    │     │
│  │  Streaming: ThinkingCard, ToolCallCard, SubagentCard,       │     │
│  │            MarkdownBlock, CompactionCard                    │     │
│  │  Panels: ToolsPanel, KnowledgePanel, SkillsPanel,          │     │
│  │          FileBrowserPanel, McpPanel, TodoPanel              │     │
│  │  Config: ApiKeySetup, AuthBanner                            │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                    │
│  ┌── State Hooks (hooks/) ───────────────────────────────────┐     │
│  │  useAgentChat: UI ↔ AgentLoop bridge, streaming state,      │     │
│  │                abort, pending queue, subagent callbacks      │     │
│  │  useApiKey: API key persistence via chrome.storage          │     │
│  │  useMcpServers: MCP server management                       │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Agent System (`agent/`)

#### AgentLoop (`agent/AgentLoop.ts`)
The core orchestrator for AI interactions. Uses a while-loop pattern with streaming LLM calls. Has 6 private methods extracted into a `RunInvocationContext` for readability. Supports abort via `AbortSignal`. Filters available tools using `toolRegistry.getEnabled()` and conditionally creates the subagent tool when appropriate. Integrates MCP tools via `McpToolCallbacks`.

#### SubagentRunner (`agent/SubagentRunner.ts`)
A standalone LLM loop for executing delegated subtasks. Operates with a max of 40 rounds and 20,000 `max_tokens` per call. Includes rate limiting via `RateLimiter` and automatic retry with exponential backoff.

#### Prompts (`agent/prompts.ts`, `agent/prompts/`)
- `buildSystemPrompt()`: Constructs the main system prompt for the agent.
- `buildSubagentSystemPrompt()`: Constructs the system prompt for subagent execution.
- `explainTextPrompt.ts`: Prompt builder for the explain-text feature.

### 2. Tool System (`agent/tools/`)

#### ToolRegistry (`agent/tools/ToolRegistry.ts`)
Centralized tool management exposing the `IToolRegistry` interface. The `ToolRegistry` class supports registering, enabling/disabling, and querying tools. Enabled state is persisted via `localStorage`. A singleton `toolRegistry` instance is exported.

#### Tool Categories
Tools are organized into three categories via the `ToolCategory` type:
- **`"builtin"`**: Standard tools for web access, file operations, knowledge, and task management.
- **`"capability"`**: The subagent tool, created dynamically by `subagentToolFactory.ts`.
- **`"skill"`**: Skill loading tools defined in `skillTools.ts`.

#### Available Tools
| File | Category | Description |
|------|----------|-------------|
| `getCurrentPageTool.ts` | builtin | Fetches the current browser page context |
| `getSelectedTextTool.ts` | builtin | Retrieves user-selected text from the page |
| `fetchUrlTool.ts` | builtin | Fetches content from a given URL |
| `fileTools.ts` | builtin | File read/write/list operations via TapWordFS |
| `searchFilesTool.ts` | builtin | Search across virtual file system |
| `knowledgeTools.ts` | builtin | Knowledge search & store operations |
| `todoTools.ts` | builtin | Todo create, update, and complete operations |
| `skillTools.ts` | skill | Skill loading and management |
| `subagentToolFactory.ts` | capability | Factory for creating the subagent delegation tool |

### 3. Agent Utils (`agent/utils/`)

- **ContextCompressor**: Two-layer context compression for managing token budgets within long conversations.
- **RateLimiter**: Token-bucket rate limiter (2 tokens max, 2/sec refill). Exported singleton `llmRateLimiter`.
- **retryWithBackoff**: Exponential backoff utility (2s → 4s → 8s, max 3 retries) for transient API errors.
- **isProxyArtifact**: Detects litellm proxy synthetic text artifacts (used for logging/diagnostics only).

### 4. MCP Integration (`mcp/`)

- **McpClientManager**: Manages connections to MCP servers, discovers available tools, and exposes them to the agent loop.
- **McpServerStorage**: Persistence layer for MCP server configurations using chrome.storage.
- Integrated into `AgentLoop` via the `McpToolCallbacks` interface.

### 5. API Clients (`api/`)

- **AnthropicClient**: Provides a unified interface for streaming LLM calls using the Anthropic Messages API format.
- **EmbeddingClient**: Generates vector embeddings for semantic search in the KnowledgeStore.

### 6. Services (`services/`)

- **KnowledgeStore**: Local knowledge base with embedding-based retrieval. Stores user-provided facts that the agent can query for context-aware answers.
- **SkillStorageService**: Manages skill file storage using TapWordFS.
- **StorageService**: Utility wrapper for `chrome.storage` interactions.
- **TapWordFS**: Virtual file system backed by `chrome.storage`, providing file read/write/list/delete operations.
- **TodoManager**: Todo item persistence and lifecycle management.

### 7. UI Components (`components/`)

- **Chat UI**: `ChatHeader` (tabs: chat, tools, knowledge, skills, files, mcp), `ChatInputBar` (with stop button and pending message queue), `MessageList`, `MessageBubble`.
- **Streaming Blocks**: `ThinkingCard` (thinking/reasoning display), `ToolCallCard` (tool invocation display), `SubagentCard` (nested streaming display for subagent output), `MarkdownBlock` (rendered markdown content), `CompactionCard` (context compaction indicator).
- **Panels**: `ToolsPanel` (3 categories with enable/disable toggles), `KnowledgePanel`, `SkillsPanel`, `FileBrowserPanel`, `McpPanel`, `TodoPanel`.
- **Config**: `ApiKeySetup` (onboarding for API key entry), `AuthBanner` (floating banner for authentication errors).
- **ContextUsageBar**: Displays real-time context token usage.

### 8. Custom Hooks (`hooks/`)

- **`useAgentChat`**: Bridge between UI and AgentLoop. Manages streaming state, abort control, pending message queue, and subagent callbacks.
- **`useApiKey`**: Persists and retrieves the API key via `chrome.storage`.
- **`useMcpServers`**: Hook for managing MCP server connections and state.

## Integration Points

### Background Script (`2_background`)
The side panel sends `SIDE_PANEL_OPENED` and `SIDE_PANEL_CLOSED` messages to the background script to help coordinate extension-wide state.

### Content Scripts (`1_content`)
Via tools (like `getCurrentPageTool`), the agent can request the background script to fetch information from the active tab's DOM.

### Persistence
All conversation settings, knowledge items, skills, todo items, and MCP server configurations are persisted using `chrome.storage.local` through the respective service classes.

## Coding Conventions

### Tool File Organization

Tool files use a **self-registration pattern**: each tool file calls `toolRegistry.add()` at module scope to register its tools. No central manifest is needed.

**Auto-discovery** is handled by `registerAll.ts`, which uses:
```typescript
import.meta.glob(['./*Tool.ts', './*Tools.ts'], { eager: true })
```
This automatically imports and executes all files matching the `*Tool.ts` or `*Tools.ts` naming convention, triggering their self-registration side effects. The `subagentToolFactory.ts` is imported explicitly since it does not follow the naming convention.

**File naming conventions:**
- `*Tool.ts` — single-purpose tool files (e.g., `getCurrentPageTool.ts`, `fetchUrlTool.ts`)
- `*Tools.ts` — grouped related tools (e.g., `knowledgeTools.ts`, `todoTools.ts`, `fileTools.ts`)
- `subagentToolFactory.ts` — explicitly imported factory (not auto-discovered)

**Tool categories:**
| Category | Purpose | Example |
|----------|---------|---------|
| `"builtin"` | Standard tools for web, files, knowledge, tasks | `getCurrentPageTool.ts`, `knowledgeTools.ts` |
| `"capability"` | Subagent delegation | `subagentToolFactory.ts` |
| `"skill"` | Skill loading and management | `skillTools.ts` |

Same-category tools should be defined in a single file rather than split into separate files. Each tool file groups related `ToolRegistration` entries under one shared logger.

## Technology Stack

- **React / TypeScript**: UI framework and type safety.
- **Anthropic SDK format**: Model communication interface.
- **Lucide React**: Icon library.
- **Tailwind-like CSS**: Styling for a modern, dark-themed interface.
