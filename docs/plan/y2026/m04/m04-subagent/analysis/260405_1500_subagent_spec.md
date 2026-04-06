# Subagent Capability — Technical Specification

**Date:** 2026-04-05  
**Status:** Draft  
**Author:** AI Agent (Phase 1 Research)

---

## 1. Current State Analysis

### 1.1 Agent Loop Architecture

The agent loop lives in `src/13_sidepanel/agent/AgentLoop.ts`. It is a class (`AgentLoop`) that:

1. Maintains a `history: Anthropic.MessageParam[]` array — the full Anthropic-format conversation.
2. Exposes `runAgent(userMessage, callbacks)` which enters a `while(true)` loop:
   - Performs **Layer 1 micro-compaction** (trims old tool results).
   - Checks **Layer 2 auto-compaction** (LLM summarization when context exceeds threshold).
   - Sends `history` + system prompt + tool definitions to the LLM via streaming.
   - If `stop_reason === "tool_use"` → executes tools, appends results, loops.
   - If `stop_reason !== "tool_use"` → returns final text to caller.
3. Delegates tool execution through `executeTool(name, input)` which checks:
   - **Local tools** first (from `TOOL_REGISTRY` Map).
   - **MCP tools** second (via `mcpCallbacks`).

### 1.2 Tool System

Tools are defined as `ToolRegistration` objects:

```typescript
interface ToolRegistration {
    definition: Anthropic.Tool    // JSON schema for the LLM
    label: string                  // Human-readable label for UI
    execute: (input: Record<string, unknown>) => Promise<string>
}
```

All tools are registered in `tools/index.ts` as a `Map<string, ToolRegistration>` called `TOOL_REGISTRY`. Current tools:

| Tool Name | File | Purpose |
|---|---|---|
| `get_current_page` | `getCurrentPage.ts` | Read active tab DOM content |
| `search_knowledge` | `knowledgeTools.ts` | Semantic search local KB |
| `store_knowledge` | `knowledgeTools.ts` | Save to local KB |
| `create_todos` | `todoTools.ts` | Create task plan |
| `update_todo_status` | `todoTools.ts` | Update a todo item |
| `complete_task` | `todoTools.ts` | Mark task complete |
| `load_skill` | `skillTools.ts` | Load skill document |
| `read_file` | `fileTools.ts` | Read from TapWordFS |
| `list_directory` | `fileTools.ts` | List TapWordFS directory |
| `write_file` | `fileTools.ts` | Write to TapWordFS |
| `delete_file` | `fileTools.ts` | Delete file from TapWordFS |
| `delete_directory` | `fileTools.ts` | Delete directory from TapWordFS |
| `fetch_url` | `fetchUrlTool.ts` | Fetch and parse web URL |
| `search_files` | `searchFilesTool.ts` | Grep across TapWordFS files |

Additionally, MCP tools are dynamically injected via `McpToolCallbacks` at runtime.

### 1.3 Callback System

`AgentCallbacks` (defined in `types.ts`) provides real-time streaming events to the UI:

- `onTextUpdate` / `onThinkingUpdate` / `onThinkingComplete` — streaming text
- `onToolCallStart` / `onToolCallComplete` — tool execution lifecycle
- `onCompactionStart` / `onCompactionComplete` — context compression events
- `onContextUsageUpdate` — context window usage progress bar

The React hook `useAgentChat` consumes these callbacks and manages `ChatMessage[]` state with rich `ContentBlock[]` (thinking, text, tool_call, compaction blocks).

### 1.4 Context Compression

`ContextCompressor` (in `ContextCompressor.ts`) provides two layers:
- **Micro-compact**: Trims old tool_result content each turn (keeps last 3 intact).
- **Auto-compact**: When context reaches 80% of available window, uses an LLM call to summarize history, replacing it with `[summary, ack]` pair.

### 1.5 Key Observations for Subagent Integration

- The `AgentLoop` class is stateful — it owns `history` and the `Anthropic` client.
- Tools are pure functions (`execute`) that receive `input` and return `string`. No access to `AgentLoop` internals.
- The `while(true)` loop in `runAgent` is the core iteration — any subagent call would occur **inside** a tool execution within this loop.
- The `McpToolCallbacks` pattern shows precedent for extending tool resolution without modifying the core loop.

---

## 2. Reference Subagent Example Summary

**Source:** `/Users/hongyuan/project/learn-claude-code/agents/s04_subagent.py`

### 2.1 Core Concept

The reference implements a parent–child agent architecture:

```
Parent agent                     Subagent
+------------------+             +------------------+
| messages=[...]   |             | messages=[]      |  ← fresh
|                  |  dispatch   |                  |
| tool: task       | ────────>  | while tool_use:  |
|   prompt="..."   |            |   call tools     |
|                  |  summary   |                  |
|   result = "..." | <────────  | return last text |
+------------------+             +------------------+
```

**Key insight**: *"Process isolation gives context isolation for free."*

### 2.2 Design Principles

1. **Fresh context**: The subagent starts with `messages = []` — only a task prompt. No parent history leaks in.
2. **Shared filesystem**: Both parent and child operate on the same filesystem (TapWordFS in our case).
3. **Summary-only return**: The subagent's entire conversation is discarded; only the final text response flows back to the parent.
4. **Filtered tool set**: The child gets all base tools **except** the `task` tool itself (no recursive spawning).
5. **Safety limit**: The child has a max iteration cap (`for _ in range(30)`) to prevent runaway loops.
6. **Own system prompt**: The child gets a dedicated system prompt (`SUBAGENT_SYSTEM`) distinct from the parent.
7. **Separate LLM calls**: The child makes its own `client.messages.create()` calls, using the same `client` and `model`.

### 2.3 Concepts to Adapt

| Reference Concept | TapWord Adaptation |
|---|---|
| `run_subagent(prompt)` function | New `SubagentRunner` class or function in `agent/` |
| Fresh `messages=[]` | New history array, not shared with parent `AgentLoop.history` |
| `CHILD_TOOLS` (filtered) | Subset of `TOOL_REGISTRY` — exclude `task` tool, potentially exclude todo tools |
| `SUBAGENT_SYSTEM` | Dedicated system prompt in `prompts.ts` |
| `task` tool definition | New `ToolRegistration` in `tools/subagentTool.ts` |
| Max iteration cap | Configurable constant (e.g., `MAX_SUBAGENT_ROUNDS = 20`) |
| Return final text only | Extract text blocks from last response, discard child history |

---

## 3. Proposed Changes

### 3.1 Files to Create

| File | Purpose |
|---|---|
| `src/13_sidepanel/agent/SubagentRunner.ts` | Core subagent execution logic — a standalone function/class that runs a fresh agent loop with filtered tools |
| `src/13_sidepanel/agent/tools/subagentTool.ts` | `ToolRegistration` for the `task` tool that the parent LLM invokes to spawn a subagent |

### 3.2 Files to Modify

| File | Change |
|---|---|
| `src/13_sidepanel/agent/tools/index.ts` | Register the new `task` tool in `TOOL_REGISTRY` |
| `src/13_sidepanel/agent/prompts.ts` | Add `SUBAGENT_SYSTEM_PROMPT` export; optionally update parent system prompt to mention the `task` tool's purpose |
| `src/13_sidepanel/types.ts` | Add `SubagentBlock` content block type for UI rendering of subagent activity |
| `src/13_sidepanel/agent/AgentLoop.ts` | Pass `client` and `model` to tool context or make them accessible for subagent creation |
| `src/13_sidepanel/agent/tools/types.ts` | Extend `ToolRegistration` or `ToolContext` to support injecting the Anthropic client (needed by subagent tool) |

### 3.3 Logic Flow

```
User sends message
  → AgentLoop.runAgent()
    → LLM responds with tool_use: "task"
      → executeTool("task", { prompt, description })
        → SubagentRunner.run(client, model, prompt, filteredTools, subagentSystemPrompt)
          → Fresh messages = [{ role: "user", content: prompt }]
          → while (stop_reason === "tool_use" && round < MAX_ROUNDS):
              → LLM call with child messages + filtered tools
              → Execute tool calls (using same TOOL_REGISTRY minus "task")
              → Append results to child messages
          → Extract final text from last assistant response
          → Return summary string to parent
        ← Parent receives summary as tool_result
    → Parent LLM continues with summary in context
```

---

## 4. Detailed Design

### 4.1 SubagentRunner

```typescript
// src/13_sidepanel/agent/SubagentRunner.ts

import type Anthropic from "@anthropic-ai/sdk"
import type { ToolRegistration } from "./tools/types"

const MAX_SUBAGENT_ROUNDS = 20
const SUBAGENT_MAX_TOKENS = 8000

export interface SubagentCallbacks {
    /** Called when the subagent starts a tool call (for UI progress). */
    onToolCallStart?: (toolCallId: string, toolName: string, toolLabel: string) => void
    /** Called when the subagent completes a tool call. */
    onToolCallComplete?: (toolCallId: string, result: string, isError: boolean) => void
}

export interface SubagentResult {
    /** The final text summary from the subagent. */
    summary: string
    /** Number of LLM rounds the subagent took. */
    rounds: number
    /** Number of tool calls executed. */
    toolCallCount: number
}

export async function runSubagent(
    client: Anthropic,
    model: string,
    systemPrompt: string,
    prompt: string,
    tools: Map<string, ToolRegistration>,
    callbacks?: SubagentCallbacks,
): Promise<SubagentResult> {
    const toolDefs = Array.from(tools.values()).map(t => t.definition)
    const messages: Anthropic.MessageParam[] = [
        { role: "user", content: prompt }
    ]

    let rounds = 0
    let toolCallCount = 0

    for (let i = 0; i < MAX_SUBAGENT_ROUNDS; i++) {
        rounds++

        const response = await client.messages.create({
            model,
            system: systemPrompt,
            messages,
            tools: toolDefs,
            max_tokens: SUBAGENT_MAX_TOKENS,
        })

        messages.push({ role: "assistant", content: response.content })

        if (response.stop_reason !== "tool_use") {
            break
        }

        // Execute tool calls
        const toolResults: Anthropic.ToolResultBlockParam[] = []
        for (const block of response.content) {
            if (block.type !== "tool_use") continue
            toolCallCount++

            callbacks?.onToolCallStart?.(block.id, block.name, `Subagent: ${block.name}`)

            const toolReg = tools.get(block.name)
            if (!toolReg) {
                const errMsg = `Unknown tool: ${block.name}`
                callbacks?.onToolCallComplete?.(block.id, errMsg, true)
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: errMsg,
                    is_error: true,
                })
                continue
            }

            try {
                const result = await toolReg.execute(block.input as Record<string, unknown>)
                callbacks?.onToolCallComplete?.(block.id, result, false)
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: result,
                })
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error)
                callbacks?.onToolCallComplete?.(block.id, errMsg, true)
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: `Error: ${errMsg}`,
                    is_error: true,
                })
            }
        }

        messages.push({ role: "user", content: toolResults })
    }

    // Extract final text — discard child history
    const lastAssistant = messages[messages.length - 1]
    let summary = "(no summary)"
    if (lastAssistant?.role === "assistant" && Array.isArray(lastAssistant.content)) {
        const texts = lastAssistant.content
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
        if (texts.length > 0) {
            summary = texts.join("\n")
        }
    }

    return { summary, rounds, toolCallCount }
}
```

### 4.2 Subagent Tool Registration

```typescript
// src/13_sidepanel/agent/tools/subagentTool.ts

import * as loggerModule from "@/0_common/utils/logger"
import type { ToolRegistration } from "./types"
import type Anthropic from "@anthropic-ai/sdk"
import { runSubagent } from "../SubagentRunner"
import { TOOL_REGISTRY } from "./index"
import { buildSubagentSystemPrompt } from "../prompts"

const logger = loggerModule.createLogger("subagentTool")

const TASK_TOOL_NAME = "task"

/** Names of tools excluded from the subagent's toolset. */
const EXCLUDED_TOOLS = new Set([
    TASK_TOOL_NAME,        // Prevent recursive subagent spawning
    "create_todos",        // Todo management is parent-only
    "update_todo_status",
    "complete_task",
])

/** Factory: create the task tool bound to a specific Anthropic client and model. */
export function createSubagentTool(
    client: Anthropic,
    model: string,
    onSubagentProgress?: (event: { type: string; detail: string }) => void,
): ToolRegistration {
    // Build filtered tool map (exclude task tool + todo tools)
    const childTools = new Map<string, ToolRegistration>()
    for (const [name, reg] of TOOL_REGISTRY) {
        if (!EXCLUDED_TOOLS.has(name)) {
            childTools.set(name, reg)
        }
    }

    return {
        definition: {
            name: TASK_TOOL_NAME,
            description:
                "Spawn a subagent with a fresh context to handle an independent subtask. " +
                "The subagent shares the filesystem but NOT conversation history. " +
                "Only its final summary is returned to you. " +
                "Use this for exploration, research, or self-contained work that doesn't need your full context.",
            input_schema: {
                type: "object" as const,
                properties: {
                    description: {
                        type: "string",
                        description: "Short label describing the subtask (shown to user).",
                    },
                    prompt: {
                        type: "string",
                        description:
                            "Detailed instructions for the subagent. Include all necessary context — " +
                            "the subagent has no access to the current conversation history.",
                    },
                },
                required: ["prompt"],
            },
        },
        label: "Spawning subagent...",
        execute: async (input) => {
            const prompt = input.prompt as string
            const description = (input.description as string) || "subtask"

            logger.info(`Subagent dispatched: "${description}" (prompt: ${prompt.length} chars)`)

            const systemPrompt = buildSubagentSystemPrompt()
            const result = await runSubagent(client, model, systemPrompt, prompt, childTools)

            logger.info(
                `Subagent completed: ${result.rounds} rounds, ` +
                `${result.toolCallCount} tool calls, ` +
                `summary: ${result.summary.length} chars`
            )

            return `[Subagent "${description}" completed in ${result.rounds} rounds, ${result.toolCallCount} tool calls]\n\n${result.summary}`
        },
    }
}
```

### 4.3 System Prompt Addition

```typescript
// Addition to src/13_sidepanel/agent/prompts.ts

const SUBAGENT_SYSTEM_PROMPT = `# Role
You are a TapWord subagent — a focused worker that completes a specific task and reports back.

# Instructions
- Complete the task described in the user message.
- Use tools as needed to gather information or perform actions.
- When finished, provide a clear, structured summary of what you found or did.
- Be thorough but concise.
- You do NOT have access to the parent conversation, so work only with what the prompt provides.`

export function buildSubagentSystemPrompt(): string {
    return SUBAGENT_SYSTEM_PROMPT
}
```

### 4.4 Integration into AgentLoop

The main challenge: the `task` tool needs access to the `Anthropic` client and model name, but `ToolRegistration.execute` only receives `input`. Two approaches:

**Option A — Factory-based tool (Recommended)**:
The `task` tool is created via a factory function (`createSubagentTool`) that closes over `client` and `model`. It is registered dynamically in `AgentLoop.runAgent()` rather than statically in the `TOOL_REGISTRY`.

```typescript
// In AgentLoop.runAgent():
const subagentTool = createSubagentTool(this.client, DEFAULT_MODEL)
const dynamicToolRegistry = new Map(TOOL_REGISTRY)
dynamicToolRegistry.set(subagentTool.definition.name, subagentTool)
```

This approach:
- Keeps `ToolRegistration` interface unchanged.
- Doesn't pollute the static registry with runtime state.
- Aligns with how `McpToolCallbacks` already extends tool resolution dynamically.

**Option B — Extended ToolContext** (Alternative):
Add `ToolContext` to `execute` signature: `execute(input, context)`. This is more invasive — every tool's signature changes.

**Decision: Option A** is preferred because it requires zero changes to existing tool interfaces.

### 4.5 AgentLoop Modifications

The changes to `AgentLoop.ts` are minimal:

```typescript
// In runAgent(), after computing localToolDefs:

// Create subagent tool (bound to this loop's client/model)
const subagentTool = createSubagentTool(this.client, DEFAULT_MODEL, (event) => {
    // Optional: forward subagent progress to parent callbacks
})

// Build combined tool registry for execution
const runtimeToolRegistry = new Map(TOOL_REGISTRY)
runtimeToolRegistry.set(subagentTool.definition.name, subagentTool)

// Use runtimeToolRegistry instead of TOOL_REGISTRY in executeTool
```

The `executeTool` method must also be updated to look up from the runtime registry instead of the static one. Since `executeTool` is called within the `while(true)` loop, the simplest approach is to pass the runtime registry as a parameter or set it as an instance field at the start of `runAgent`.

### 4.6 UI Representation (Optional — Phase 2)

Add a new `SubagentBlock` to `ContentBlock` union in `types.ts`:

```typescript
export interface SubagentBlock {
    type: "subagent"
    /** Unique tool call ID from the parent's tool_use block */
    toolCallId: string
    /** Short description of the subtask */
    description: string
    /** Current execution status */
    status: "running" | "completed" | "error"
    /** Number of rounds the subagent took */
    rounds?: number
    /** Number of tool calls */
    toolCallCount?: number
    /** The summary result */
    summary?: string
}
```

This is a visual enhancement and can be deferred to Phase 2. In Phase 2 (implementation), the subagent's tool calls can appear as nested blocks in the UI. For the initial implementation, the `task` tool will render as a standard `ToolCallBlock`.

### 4.7 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      AgentLoop.runAgent()                       │
│                                                                 │
│  history: [user, assistant, user, ...]                          │
│                                                                 │
│  ┌─ LLM Call ─────────────────────────────────────────────┐     │
│  │  model: qwen3.5-plus                                   │     │
│  │  system: buildSystemPrompt(skills)                      │     │
│  │  tools: [...localTools, subagentTool, ...mcpTools]      │     │
│  │  messages: history                                      │     │
│  └─────────────────────────────────────────────────────────┘     │
│           │                                                     │
│           ▼                                                     │
│  stop_reason === "tool_use" && tool.name === "task"             │
│           │                                                     │
│           ▼                                                     │
│  ┌─ SubagentRunner.run() ─────────────────────────────────┐     │
│  │                                                        │     │
│  │  childHistory: [{ role: "user", content: prompt }]     │     │
│  │  childTools: TOOL_REGISTRY minus {task, todo tools}    │     │
│  │  childSystem: SUBAGENT_SYSTEM_PROMPT                   │     │
│  │                                                        │     │
│  │  ┌─ Child LLM Loop (max 20 rounds) ──────────────┐    │     │
│  │  │  LLM call → tool_use? → execute → append       │    │     │
│  │  │  LLM call → tool_use? → execute → append       │    │     │
│  │  │  LLM call → stop_reason ≠ tool_use → done      │    │     │
│  │  └────────────────────────────────────────────────┘    │     │
│  │                                                        │     │
│  │  return: { summary, rounds, toolCallCount }            │     │
│  │  (childHistory is DISCARDED)                           │     │
│  └────────────────────────────────────────────────────────┘     │
│           │                                                     │
│           ▼                                                     │
│  toolResult = "[Subagent completed...]\n\n{summary}"            │
│  history.push({ role: "user", content: [toolResult] })          │
│  → continue parent while loop                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Risks / Edge Cases

### 5.1 Runaway Subagent

**Risk**: The subagent enters an infinite tool loop or makes excessive LLM calls.  
**Mitigation**: Hard cap of `MAX_SUBAGENT_ROUNDS = 20`. After this, the subagent returns whatever text it has. Consider also adding a timeout (e.g., 120 seconds wall-clock time).

### 5.2 Context Window Consumption

**Risk**: The subagent's summary could be very long, bloating the parent's context.  
**Mitigation**: Cap the summary string returned to the parent (e.g., 5000 chars). The parent's existing micro-compact and auto-compact will also naturally handle this over time.

### 5.3 Recursive Subagent Spawning

**Risk**: If the `task` tool is accidentally included in the child's toolset, the child could spawn its own subagents infinitely.  
**Mitigation**: The `EXCLUDED_TOOLS` set explicitly removes `task` from the child's toolset. This is enforced at the factory level.

### 5.4 Concurrent Mutations via Shared Filesystem

**Risk**: Parent and child both write to TapWordFS simultaneously (unlikely in practice since tool execution is sequential).  
**Mitigation**: The subagent runs synchronously within the parent's tool execution — not in parallel. The parent's `while(true)` loop is paused while the subagent executes. No concurrent mutation risk.

### 5.5 Error Propagation

**Risk**: An LLM API error inside the subagent could crash the parent loop.  
**Mitigation**: Wrap the entire `runSubagent` call in try/catch. On failure, return a descriptive error string as the tool result (not throw). The parent LLM can then decide how to proceed.

### 5.6 Token Cost

**Risk**: Each subagent call involves multiple LLM round-trips with their own context windows, increasing API costs.  
**Mitigation**: Document this trade-off. The parent LLM should be instructed via system prompt to use `task` judiciously — only for genuinely independent subtasks, not simple one-tool queries.

### 5.7 Streaming UX

**Risk**: While the subagent is running (potentially many seconds), the parent UI shows a static "Running task..." message with no progress.  
**Mitigation (Phase 2)**: Forward subagent tool-call events to the parent's `AgentCallbacks` so the UI can show nested progress. For Phase 2 implementation, the `SubagentCallbacks` interface is already designed for this.

### 5.8 MCP Tools in Subagent

**Risk**: Should MCP tools be available to the subagent?  
**Decision**: Initially **no** — only local `TOOL_REGISTRY` tools (minus excluded ones). MCP tool access can be added later if needed. This keeps the initial implementation simpler and avoids potential auth/session issues.

---

## 6. Verification Plan

### 6.1 Unit Tests

| Test Case | Description |
|---|---|
| `SubagentRunner: completes single-round task` | Mock LLM returns text on first call → verify summary matches |
| `SubagentRunner: executes tools and returns summary` | Mock LLM returns tool_use then text → verify tool is called and summary is correct |
| `SubagentRunner: respects MAX_SUBAGENT_ROUNDS` | Mock LLM always returns tool_use → verify loop stops at limit |
| `SubagentRunner: handles tool execution error` | Mock tool throws → verify error appears in tool_result, loop continues |
| `SubagentRunner: handles LLM API error` | Mock client throws → verify error is caught, meaningful error returned |
| `createSubagentTool: excludes task and todo tools` | Verify child toolset doesn't contain excluded tools |
| `createSubagentTool: returns formatted result string` | Execute tool → verify result string contains rounds and summary |

### 6.2 Integration Tests

| Test Case | Description |
|---|---|
| `Full loop: parent uses task tool` | Set up AgentLoop with mock LLM that calls `task` → verify subagent runs and parent receives summary |
| `Tool isolation: child cannot call task` | Mock child LLM tries to call `task` → verify "Unknown tool" error |

### 6.3 Manual Verification

1. Open sidepanel, send a message like: *"Research what files are in the /tapword/skills/ directory and summarize what you find. Use the task tool to delegate the exploration."*
2. Verify the agent spawns a subagent (shown as tool call in UI).
3. Verify the subagent's summary appears as the tool result.
4. Verify the parent continues the conversation with that summary in context.
5. Verify the UI doesn't freeze during subagent execution (streaming feedback).
6. Check context usage indicator — verify subagent's internal history doesn't leak into parent.

### 6.4 Type Safety

Run `npm run type-check` after implementation to ensure all new code compiles without errors.

---

## 7. Implementation Summary

### Phase 2 Task Breakdown

1. **Create `SubagentRunner.ts`** — core execution logic (~80 lines)
2. **Create `subagentTool.ts`** — tool registration factory (~60 lines)
3. **Update `prompts.ts`** — add `buildSubagentSystemPrompt()` (~15 lines)
4. **Update `AgentLoop.ts`** — wire subagent tool into runtime registry (~15 lines changed)
5. **Update `tools/index.ts`** — export `TASK_TOOL_NAME` constant (optional, for reference)
6. **Write unit tests** — `SubagentRunner.test.ts`, `subagentTool.test.ts`
7. **Manual E2E verification**

Estimated total new code: ~200 lines of production code + ~150 lines of tests.
