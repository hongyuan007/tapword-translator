Last updated on: 2026-04-04

# TapWord Side Panel Module (`src/13_sidepanel`)

## Module Overview

This module implements the React-based Side Panel application for the TapWord extension. It serves as an interactive AI chat assistant that can converse with the user, understand the current webpage context, and manage a local knowledge base.

## File Structure

```
13_sidepanel/
├── sidepanel.html                          # HTML entry point for the side panel
├── index.tsx                               # React entry point, panel lifecycle signaling
├── App.tsx                                 # Root React component, routing & state orchestration
├── types.ts                                # Shared ChatMessage and state interfaces
├── agent/
│   ├── AgentLoop.ts                        # Core orchestrator for AI interactions
│   ├── prompts.ts                          # System prompts
│   └── tools/
│       ├── index.ts                        # Tool registry & exports
│       ├── types.ts                        # ToolRegistration & ToolContext types
│       ├── getCurrentPage.ts               # Browser page context tool
│       ├── knowledgeTools.ts               # Knowledge search & store tools
│       └── todoTools.ts                    # Todo create, update & complete tools
├── api/
│   ├── AnthropicClient.ts                  # Client for LLM (compatible with Anthropic SDK)
│   └── EmbeddingClient.ts                  # Client for generating vector embeddings
├── components/
│   ├── ChatHeader.tsx                      # Header with tab switching and settings toggle
│   ├── ChatInputBar.tsx                    # Message input area with loading state
│   ├── MessageList.tsx                     # Container for chat history
│   ├── MessageBubble.tsx                   # Individual message display component
│   ├── KnowledgePanel.tsx                  # Local knowledge base management UI
│   ├── ApiKeySetup.tsx                     # Onboarding screen for API key entry
│   ├── AuthBanner.tsx                      # Floating banner for authentication errors
│   └── SettingsDrawer.tsx                  # Sidebar for API key configuration
├── hooks/
│   ├── useAgentChat.ts                     # Hook for managing agent conversation state
│   └── useApiKey.ts                        # Hook for persistent API key management
├── services/
│   └── StorageService.ts                   # Utility for chrome.storage interaction
├── store/
│   └── KnowledgeStore.ts                   # Local knowledge base persistence & retrieval
└── styles/
    └── sidepanel.css                       # Global styles for the side panel
```

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                        App.tsx                           │
│     (Root Component — Tab Routing, Setup Logic)          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌── Agent Logic ──────────────────────────────────┐     │
│  │  AgentLoop (agent/)                              │     │
│  │  • Conversation loop & state management          │     │
│  │  • Tool calling execution (Browser/Knowledge)    │     │
│  │  • LLM Prompting (Anthropic SDK format)          │     │
│  └──────────────────────────────────────────────────┘     │
│                                                          │
│  ┌── Data & Persistence ───────────────────────────┐     │
│  │  KnowledgeStore (store/)                         │     │
│  │  • Persistent local facts/data                   │     │
│  │  • Embedding-based retrieval logic               │     │
│  │                                                  │     │
│  │  StorageService (services/)                      │     │
│  │  • chrome.storage.local abstraction              │     │
│  └──────────────────────────────────────────────────┘     │
│                                                          │
│  ┌── UI Components (components/) ──────────────────┐     │
│  │  Chat UI: Header, List, Bubbles, InputBar        │     │
│  │  Knowledge UI: KnowledgePanel                    │     │
│  │  Config UI: SettingsDrawer, ApiKeySetup          │     │
│  └──────────────────────────────────────────────────┘     │
│                                                          │
│  ┌── State Hooks (hooks/) ─────────────────────────┐     │
│  │  useAgentChat: UI ↔ AgentLoop bridge             │     │
│  │  useApiKey: API Key lifecycle management         │     │
│  └──────────────────────────────────────────────────┘     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Agent Loop (`agent/AgentLoop.ts`)
The core orchestrator for AI interactions. It handles the iterative process of sending messages to the LLM, processing tool calls (like reading the current page or searching knowledge), and updating the UI with text responses.

### 2. Knowledge Store (`store/KnowledgeStore.ts`)
Manages the user's local "brain." It stores data that the agent can retrieve later to provide context-aware answers that persist across different webpages.

### 3. API Clients (`api/`)
- **AnthropicClient**: Provides a unified interface to talk to LLM providers (defaulting to models like `qwen3.5-plus`) using the Anthropic Messages API format.
- **EmbeddingClient**: Used by the KnowledgeStore to convert text into vector embeddings for semantic search capabilities.

### 4. Custom Hooks (`hooks/`)
- **`useAgentChat`**: Encapsulates the logic for sending messages, handling loading states, managing "tool active" indicators, and error handling for the chat interface.
- **`useApiKey`**: Safely retrieves and updates the DashScope API key from extension storage.

## Integration Points

### Background Script (`2_background`)
The side panel sends `SIDE_PANEL_OPENED` and `SIDE_PANEL_CLOSED` messages to the background script to help coordinate extension-wide state.

### Content Scripts (`1_content`)
Via tools (like `getCurrentPage`), the agent can request the background script to fetch information from the active tab's DOM.

### Persistence
All conversation settings and knowledge items are persisted using `chrome.storage.local` through the `StorageService` and `KnowledgeStore`.

## Coding Conventions

### Tool File Organization
Same-category tools should be defined in a single file rather than split into separate files. Each tool file groups related `ToolRegistration` exports under one shared logger.

| File | Contents |
|------|----------|
| `todoTools.ts` | All todo-related tools (`createTodosTool`, `updateTodoStatusTool`, `completeTodosTool`) |
| `knowledgeTools.ts` | All knowledge-related tools (`searchKnowledgeTool`, `storeKnowledgeTool`) |
| `getCurrentPage.ts` | Standalone page-context tool |

## Technology Stack

- **React / TypeScript**: UI framework and type safety.
- **Anthropic SDK**: Model communication interface.
- **Lucide React**: Icon library.
- **Tailwind-like CSS**: Styling for a modern, dark-themed interface.
