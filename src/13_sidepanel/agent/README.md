Last updated on: 2026-04-04

# TapWord Agent Sub-Module (`src/13_sidepanel/agent`)

## Module Overview

This sub-module encapsulates the core "Agent Loop" logic for the Side Panel chat application. It manages the conversational state with the LLM and the execution of registered tools (function calling) on behalf of the user.

## File Structure

```
agent/
├── README.md                               # This document
├── AgentLoop.ts                            # Core agent loop implementation
├── prompts.ts                              # System prompts and instructions
└── tools/                                  # Tool definitions and implementation
    ├── index.ts                            # Registry of tools
    ├── types.ts                            # ToolContext and Tool interface definitions
    ├── getCurrentPage.ts                   # Reads current browser page content
    ├── searchKnowledge.ts                  # Semantic search on KnowledgeStore
    └── storeKnowledge.ts                   # Stores new facts into KnowledgeStore
```

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        AgentLoop                             │
│       (Iterative Orchestrator — History & LLM)               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌── Prompting ────────────────────────────────────────┐     │
│  │  prompts.ts                                         │     │
│  │  • SYSTEM_PROMPT: Identity, environment, behavior   │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌── Tool Registry ────────────────────────────────────┐     │
│  │  tools/index.ts                                     │     │
│  │  • Registered Tools (Map: name → Tool)              │     │
│  │  • definition: Model-visible schema                 │     │
│  │  • execute: JavaScript implementation               │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌── Execution Cycle ──────────────────────────────────┐     │
│  │  1. Send System Prompt + History + Tool Schema      │     │
│  │  2. Model: Respond Text OR Request Tool             │     │
│  │  3. Agent: Execute Tool → Append Result to History  │     │
│  │  4. Re-query Model until Finish                     │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Agent Loop (`AgentLoop.ts`)
The primary logic driver. It maintains a list of `history` messages in the Anthropic format and runs a `while(true)` loop until the LLM stop reason is something other than `tool_use`. It also provides `restoreHistory()` to rebuild the LLM-compatible conversation state from simple persistent storage.

### 2. Tools (`tools/`)
The agent's "hands." Each tool is a file containing:
- **`definition`**: A JSON schema (Anthropic format) describing the function name, description, and parameters.
- **`execute()`**: An async function that performs the actual work (e.g., calling `chrome.tabs.sendMessage` or interacting with the vector-based `KnowledgeStore`).

### 3. Tool Context (`tools/types.ts`)
An interface providing shared resources to every tool during execution, such as:
- **`apiKey`**: Used for model-to-model calls (like embeddings).
- **`knowledgeStore`**: Direct access to the persistent knowledge database.

## State Management

### 1. History Management
The `AgentLoop` tracks conversation history as `Anthropic.MessageParam[]`. This includes:
- User prompt turns.
- Assistant turns (containing text blocks and `tool_use` blocks).
- User turns (containing `tool_result` blocks).

### 2. Error Handling
The `AgentLoop` includes a robust `classifyApiError` function to differentiate between:
- **Auth Errors (401/403)**: Triggers the API Key setup UI.
- **Rate Limit (429)**: Asks the user to wait.
- **Network Errors**: Alerts about connectivity issues.

## Usage Example

```typescript
const loop = new AgentLoop(apiKey, knowledgeStore);

// Handle text streaming and tool execution labels
const response = await loop.runAgent(
  "Summarize the current page.",
  (text) => updateUI(text),
  (label) => showToolStatus(label)
);
```

## Future Extensions
- **Multi-modal Support**: The `AgentLoop` can be extended to handle image inputs or file uploads.
- **New Tools**: Adding capabilities like "Write an Email" or "Search the Web" only requires a new file in the `tools/` directory and registration in `tools/index.ts`.
