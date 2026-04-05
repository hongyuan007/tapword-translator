# Subagent Real-Time UI Streaming Spec

**Date**: 2026-04-05  
**Status**: Draft  
**Goal**: Stream subagent output (thinking, text, tool calls) into a nested collapsible card in real-time, matching the parent agent's block-based rendering.

---

## 1. Current Data Flow Analysis

### 1.1 Parent Agent Streaming Pipeline

```
AgentLoop.runAgent()
  └─ streamLlmResponse()
       ├─ stream.on("thinking") ──→ callbacks.onThinkingUpdate(delta, snapshot)
       ├─ stream.on("text")     ──→ callbacks.onTextUpdate(delta, snapshot)
       └─ stream.on("contentBlock") ──→ callbacks.onThinkingComplete()
  └─ processToolCalls()
       ├─ callbacks.onToolCallStart(id, name, label, input)
       └─ callbacks.onToolCallComplete(id, result, isError)

useAgentChat.sendMessage()
  └─ Creates AgentCallbacks that update `messages` state:
       ├─ onThinkingUpdate  → appendBlock({type:"thinking"}) or updateLastBlock({content})
       ├─ onThinkingComplete → updateLastBlock({isStreaming:false})
       ├─ onTextUpdate      → appendBlock({type:"text"}) or updateLastBlock({content})
       ├─ onToolCallStart   → appendBlock({type:"tool_call", status:"running"})
       └─ onToolCallComplete → updateToolBlock(id, {result, status})

MessageBubble
  └─ message.blocks.filter(isVisibleBlock).map(renderBlock)
       ├─ "thinking" → <ThinkingCard>
       ├─ "text"     → <MarkdownBlock>
       ├─ "tool_call"→ <ToolCallCard>
       ├─ "compaction"→ <CompactionCard>
       └─ "subagent" → null (NOT IMPLEMENTED)
```

### 1.2 Current SubagentRunner (Non-Streaming)

`SubagentRunner.runSubagent()` uses `client.messages.stream({...}).finalMessage()` which **awaits the entire response** before returning. There is no incremental streaming to the UI.

Current `SubagentCallbacks`:
- `onToolCallStart?(toolCallId, toolName, toolLabel)` — fires before tool execution
- `onToolCallComplete?(toolCallId, result, isError)` — fires after tool execution

**Missing**: No thinking/text streaming callbacks. No nested block emission.

### 1.3 Current subagentTool Integration

In `AgentLoop.processToolCalls()`, the `task` tool is executed via `executeTool()` which calls `toolReg.execute(input)`. The current `createSubagentTool()` factory:
- Does **not** pass any `SubagentCallbacks` to `runSubagent()`
- Returns a plain string result (the summary)
- The parent sees the subagent as a regular ToolCallBlock (`status: "running"` → `status: "completed"`)

### 1.4 Existing SubagentBlock Type

Already defined in `types.ts` with metadata fields but **no nested content blocks**:

```typescript
interface SubagentBlock {
    type: "subagent"
    toolCallId: string
    description: string
    status: "running" | "completed" | "error"
    rounds?: number
    toolCallCount?: number
    summary?: string
}
```

Already recognized in `isVisibleBlock()` but `renderBlock()` returns `null`.

---

## 2. Proposed Data Structures

### 2.1 Enhanced SubagentBlock

Replace the current flat `SubagentBlock` with one that holds **nested ContentBlocks** — essentially a mini-message:

```typescript
export interface SubagentBlock {
    type: "subagent"
    /** Unique tool call ID from the parent's tool_use block. */
    toolCallId: string
    /** Short description of the subtask. */
    description: string
    /** Current execution status. */
    status: "running" | "completed" | "error"
    /** Number of LLM rounds the subagent took. */
    rounds?: number
    /** Number of tool calls executed. */
    toolCallCount?: number
    /** The summary result (kept for serialization / restore). */
    summary?: string
    /**
     * Nested content blocks streamed from the subagent.
     * Uses the same block types as the parent (ThinkingBlock, TextBlock, ToolCallBlock).
     * Grows in real-time as the subagent streams.
     */
    nestedBlocks: ContentBlock[]
}
```

> `ContentBlock` type is already a union that includes `ThinkingBlock | TextBlock | ToolCallBlock | CompactionBlock | SubagentBlock`. We will reuse `ThinkingBlock`, `TextBlock`, and `ToolCallBlock` for nested blocks. Recursive `SubagentBlock` nesting is **not supported** (the `task` tool is excluded from sub-toolsets).

### 2.2 Updated ContentBlock Union

No change to the union itself — `SubagentBlock` is already a member. Only the `SubagentBlock` interface gains the `nestedBlocks` field.

---

## 3. Proposed Callback Chain

### 3.1 Overview

```
SubagentRunner (streaming LLM loop)
  │
  ├─ SubagentCallbacks.onThinkingUpdate(delta, snapshot)
  ├─ SubagentCallbacks.onThinkingComplete()
  ├─ SubagentCallbacks.onTextUpdate(delta, snapshot)
  ├─ SubagentCallbacks.onToolCallStart(id, name, label)
  ├─ SubagentCallbacks.onToolCallComplete(id, result, isError)
  │
  └─ returned via subagentTool.execute() closure
       │
       ▼
AgentLoop.processToolCalls()
  │  (The subagent tool's execute() receives a SubagentCallbacks
  │   object that bridges to AgentCallbacks via new subagent events)
  │
  ├─ AgentCallbacks.onSubagentBlockUpdate(toolCallId, patch)
  │
  └─ (onToolCallComplete still fires when the entire subagent finishes)
       │
       ▼
useAgentChat
  │
  ├─ onSubagentBlockUpdate(toolCallId, patch)
  │     → findSubagentBlock(toolCallId) → apply patch to nestedBlocks
  │
  └─ onToolCallComplete → (handled as before for regular tool blocks;
                            but for subagent, this fires AFTER the full
                            SubagentBlock has been populated)
```

### 3.2 Extended SubagentCallbacks

```typescript
/** Callbacks for forwarding subagent progress events to the parent UI. */
export interface SubagentCallbacks {
    onThinkingUpdate?: (thinkingDelta: string, thinkingSnapshot: string) => void
    onThinkingComplete?: () => void
    onTextUpdate?: (textDelta: string, textSnapshot: string) => void
    onToolCallStart?: (toolCallId: string, toolName: string, toolLabel: string) => void
    onToolCallComplete?: (toolCallId: string, result: string, isError: boolean) => void
}
```

### 3.3 Extended AgentCallbacks

Add one new callback to `AgentCallbacks`:

```typescript
export interface AgentCallbacks {
    // ... existing callbacks ...

    /**
     * Fired when a running subagent emits a streaming update.
     * The hook uses this to mutate the SubagentBlock's nestedBlocks in-place.
     * @param toolCallId - Matches the subagent's parent ToolCallBlock ID
     * @param updater - Function that receives current nestedBlocks and returns updated nestedBlocks
     */
    onSubagentBlockUpdate: (
        toolCallId: string,
        updater: (currentBlocks: ContentBlock[]) => ContentBlock[],
    ) => void
}
```

**Why a functional updater?** Because streaming events arrive rapidly and we need the latest state. A patch-object approach would require the caller to know the current nested block index, duplicating state tracking logic. A functional updater keeps all block mutation logic inside `useAgentChat`.

### 3.4 Callback Bridge in subagentTool

Inside `createSubagentTool()`, the `execute()` function will:

1. Receive an injected `AgentCallbacks` reference (see §4.3 for how)
2. Before calling `runSubagent()`, emit `appendBlock({type:"subagent", ...nestedBlocks:[]})` via a pre-call hook
3. Create a `SubagentCallbacks` adapter that translates subagent events into `onSubagentBlockUpdate` calls
4. On completion, patch the `SubagentBlock` status and summary

---

## 4. Detailed File Changes

### 4.1 `src/13_sidepanel/types.ts`

**Change**: Add `nestedBlocks` to `SubagentBlock`, add `onSubagentBlockUpdate` to `AgentCallbacks`.

```typescript
// SubagentBlock — add field:
export interface SubagentBlock {
    type: "subagent"
    toolCallId: string
    description: string
    status: "running" | "completed" | "error"
    rounds?: number
    toolCallCount?: number
    summary?: string
    /** Nested content blocks streamed from the subagent in real-time. */
    nestedBlocks: ContentBlock[]
}

// AgentCallbacks — add callback:
export interface AgentCallbacks {
    // ... existing ...
    onSubagentBlockUpdate: (
        toolCallId: string,
        updater: (currentBlocks: ContentBlock[]) => ContentBlock[],
    ) => void
}
```

### 4.2 `src/13_sidepanel/agent/SubagentRunner.ts`

**Change**: Replace `.finalMessage()` with real streaming + callback forwarding.

Key changes:
1. Extend `SubagentCallbacks` with `onThinkingUpdate`, `onThinkingComplete`, `onTextUpdate`
2. In the LLM loop, set up stream event listeners (same pattern as `AgentLoop.streamLlmResponse()`) and fire the callbacks
3. Await `stream.finalMessage()` is replaced by proper event wiring + await

```typescript
// Inside the for-loop in runSubagent():

const stream = client.messages.stream({
    model,
    system: systemPrompt,
    messages,
    tools: toolDefs,
    max_tokens: SUBAGENT_MAX_TOKENS,
})

stream.on("thinking", (delta, snapshot) => {
    callbacks?.onThinkingUpdate?.(delta, snapshot)
})

stream.on("text", (delta, snapshot) => {
    callbacks?.onTextUpdate?.(delta, snapshot)
})

stream.on("contentBlock", (block) => {
    if (block.type === "thinking") {
        callbacks?.onThinkingComplete?.()
    }
})

const response = await stream.finalMessage()
```

The `stream.finalMessage()` call still happens, but now events stream while waiting. No structural change to the loop — we just add event wiring before the await.

### 4.3 `src/13_sidepanel/agent/tools/subagentTool.ts`

**Change**: Accept `AgentCallbacks` and wire subagent streaming events into `onSubagentBlockUpdate`.

#### Option A: Inject callbacks at creation time

The factory currently receives `(client, model, baseToolRegistry)`. Add a 4th parameter: `parentCallbacks: AgentCallbacks`.

```typescript
export function createSubagentTool(
    client: Anthropic,
    model: string,
    baseToolRegistry: Map<string, ToolRegistration>,
    parentCallbacks: AgentCallbacks,       // NEW
): ToolRegistration
```

Inside `execute()`:

```typescript
execute: async (input) => {
    const prompt = input.prompt as string
    const description = (input.description as string) || "subtask"

    // 1. Pre-flight: tell the UI to create a SubagentBlock
    //    (This is handled by AgentLoop — see §4.4)

    // 2. Build SubagentCallbacks → bridge to parent's onSubagentBlockUpdate
    const subCallbacks = createSubagentCallbackBridge(
        parentToolCallId, parentCallbacks
    )

    // 3. Run subagent with streaming
    const result = await runSubagent(
        client, model, systemPrompt, prompt, childTools, subCallbacks
    )

    // 4. Return summary to parent LLM
    return formatSummary(description, result)
}
```

**Problem**: At `execute()` time, we don't know the `parentToolCallId` (it comes from the Anthropic `tool_use` block in `processToolCalls()`).

#### Option B (Preferred): ToolRegistration with callback injection

Extend `ToolRegistration` (or use a separate mechanism) so that `AgentLoop.processToolCalls()` can pass the `toolCallId` and `callbacks` into the tool at execution time.

**Approach**: Change the `execute` signature for the subagent tool to accept an optional context parameter. To avoid breaking all tools, use a separate field:

```typescript
// In tools/types.ts:
export interface ToolRegistration {
    definition: Anthropic.Tool
    label: string
    execute: (input: Record<string, unknown>) => Promise<string>
    /**
     * Optional hook called before execute() with the parent agent's context.
     * Used by the subagent tool to receive streaming callbacks.
     */
    beforeExecute?: (context: ToolExecutionContext) => void
}

export interface ToolExecutionContext {
    toolCallId: string
    callbacks: AgentCallbacks
}
```

Then in `AgentLoop.processToolCalls()`:

```typescript
for (const block of response.content) {
    if (block.type !== "tool_use") continue

    const toolReg = this.runtimeToolRegistry.get(block.name)
    // ...
    callbacks.onToolCallStart(block.id, block.name, toolLabel, ...)

    // Inject context before execution
    toolReg?.beforeExecute?.({ toolCallId: block.id, callbacks })

    const result = await this.executeTool(block.name, block.input)
    // ...
}
```

In `subagentTool.ts`, implement `beforeExecute` to capture the `toolCallId` and `callbacks` into closure-scoped variables, which `execute()` then uses.

### 4.4 `src/13_sidepanel/agent/AgentLoop.ts`

**Changes**:
1. Pass `AgentCallbacks` into `createSubagentTool()` — but since callbacks are per-invocation (passed to `runAgent()`), the subagent tool must be re-created each invocation or use the `beforeExecute` pattern.
2. In `processToolCalls()`, call `beforeExecute()` before `executeTool()`.
3. For the `task` tool specifically, append a `SubagentBlock` to the UI **before** running the tool, and convert the regular `ToolCallBlock` (already appended by `onToolCallStart`) into a `SubagentBlock`.

**Proposed flow in processToolCalls()**:

```typescript
private async processToolCalls(
    response: Anthropic.Message,
    callbacks: AgentCallbacks,
): Promise<Anthropic.ToolResultBlockParam[]> {
    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const block of response.content) {
        if (block.type !== "tool_use") continue

        const toolReg = this.runtimeToolRegistry.get(block.name)
        const toolLabel = toolReg?.label || this.resolveMcpToolLabel(block.name)

        // For subagent: emit a SubagentBlock instead of a ToolCallBlock
        if (block.name === TASK_TOOL_NAME) {
            const description = (block.input as Record<string, unknown>).description as string || "subtask"
            callbacks.onSubagentBlockUpdate(block.id, () => [])
            // ^ This will be handled specially — see useAgentChat §4.5
            // Actually, we use a dedicated onSubagentStart callback (see below)
        }

        callbacks.onToolCallStart(block.id, block.name, toolLabel, block.input as Record<string, unknown>)

        // Inject execution context for tools that need it
        toolReg?.beforeExecute?.({ toolCallId: block.id, callbacks })

        // ... execute + collect result (same as current) ...
    }
    return toolResults
}
```

**Refined approach**: Rather than overloading `onToolCallStart` / `onSubagentBlockUpdate`, add a dedicated `onSubagentStart` callback that creates the `SubagentBlock` in the UI:

```typescript
// Additional callback in AgentCallbacks:
onSubagentStart: (toolCallId: string, description: string) => void
```

Then in `processToolCalls()`:

```typescript
if (block.name === TASK_TOOL_NAME) {
    const description = (block.input as Record<string, unknown>).description as string || "subtask"
    callbacks.onSubagentStart(block.id, description)
} else {
    callbacks.onToolCallStart(block.id, block.name, toolLabel, block.input as Record<string, unknown>)
}
```

This way, the subagent block is created **instead of** a ToolCallBlock. The `onSubagentBlockUpdate` callback then streams nested blocks into it.

### 4.5 `src/13_sidepanel/hooks/useAgentChat.ts`

**Changes**: Implement the three new callbacks.

```typescript
// Inside the agentCallbacks object in sendMessage():

onSubagentStart: (toolCallId, description) => {
    phaseRef.current = "idle"
    appendBlock({
        type: "subagent",
        toolCallId,
        description,
        status: "running",
        nestedBlocks: [],
    })
},

onSubagentBlockUpdate: (toolCallId, updater) => {
    setMessages((prev) => {
        const updated = [...prev]
        const msg = updated[assistantIndex]!
        const blocks = (msg.blocks || []).map((b) => {
            if (b.type === "subagent" && b.toolCallId === toolCallId) {
                return {
                    ...b,
                    nestedBlocks: updater(b.nestedBlocks),
                }
            }
            return b
        })
        updated[assistantIndex] = { ...msg, blocks }
        return updated
    })
},

// Modify onToolCallComplete to also handle subagent completion:
onToolCallComplete: (toolCallId, result, isError) => {
    // Check if this is a subagent block
    setMessages((prev) => {
        const updated = [...prev]
        const msg = updated[assistantIndex]!
        const blocks = (msg.blocks || []).map((b) => {
            if (b.type === "subagent" && b.toolCallId === toolCallId) {
                return {
                    ...b,
                    status: isError ? "error" as const : "completed" as const,
                    summary: result,
                    // Mark all nested blocks as not streaming
                    nestedBlocks: b.nestedBlocks.map((nb: ContentBlock) =>
                        "isStreaming" in nb ? { ...nb, isStreaming: false } : nb
                    ),
                }
            }
            if (b.type === "tool_call" && b.toolCallId === toolCallId) {
                return { ...b, result, isError, status: isError ? "error" as const : "completed" as const }
            }
            return b
        })
        updated[assistantIndex] = { ...msg, blocks }
        return updated
    })
},
```

### 4.6 Subagent Callback Bridge (helper function)

Create a helper in `subagentTool.ts` (or a dedicated file) that translates `SubagentCallbacks` events into `onSubagentBlockUpdate` calls:

```typescript
function createSubagentCallbackBridge(
    toolCallId: string,
    parentCallbacks: AgentCallbacks,
): SubagentCallbacks {
    /**
     * Track the current "phase" within this subagent's nested blocks.
     * Same pattern as the parent's phaseRef in useAgentChat.
     */
    let phase: "idle" | "thinking" | "text" = "idle"

    return {
        onThinkingUpdate: (_delta, snapshot) => {
            parentCallbacks.onSubagentBlockUpdate(toolCallId, (blocks) => {
                if (phase !== "thinking") {
                    phase = "thinking"
                    return [...blocks, { type: "thinking", content: snapshot, isStreaming: true }]
                }
                // Update last block's content
                const updated = [...blocks]
                const last = updated[updated.length - 1]
                if (last?.type === "thinking") {
                    updated[updated.length - 1] = { ...last, content: snapshot }
                }
                return updated
            })
        },

        onThinkingComplete: () => {
            phase = "idle"
            parentCallbacks.onSubagentBlockUpdate(toolCallId, (blocks) => {
                const updated = [...blocks]
                const last = updated[updated.length - 1]
                if (last?.type === "thinking") {
                    updated[updated.length - 1] = { ...last, isStreaming: false }
                }
                return updated
            })
        },

        onTextUpdate: (_delta, snapshot) => {
            parentCallbacks.onSubagentBlockUpdate(toolCallId, (blocks) => {
                if (phase !== "text") {
                    phase = "text"
                    return [...blocks, { type: "text", content: snapshot, isStreaming: true }]
                }
                const updated = [...blocks]
                const last = updated[updated.length - 1]
                if (last?.type === "text") {
                    updated[updated.length - 1] = { ...last, content: snapshot }
                }
                return updated
            })
        },

        onToolCallStart: (tcId, toolName, toolLabel) => {
            phase = "idle"
            parentCallbacks.onSubagentBlockUpdate(toolCallId, (blocks) => [
                ...blocks,
                { type: "tool_call", toolCallId: tcId, toolName, toolLabel, status: "running" },
            ])
        },

        onToolCallComplete: (tcId, result, isError) => {
            parentCallbacks.onSubagentBlockUpdate(toolCallId, (blocks) =>
                blocks.map((b) =>
                    b.type === "tool_call" && b.toolCallId === tcId
                        ? { ...b, result, isError, status: isError ? "error" : "completed" }
                        : b,
                ),
            )
        },
    }
}
```

### 4.7 `src/13_sidepanel/components/SubagentCard.tsx` (NEW FILE)

A collapsible card that renders nested `ContentBlock[]` using the same `renderBlock()` helper from `MessageBubble.tsx`.

```tsx
import { useState, useEffect } from "react"
import { Loader2, Check, X, Bot } from "lucide-react"
import type { SubagentBlock, ContentBlock } from "../types"
import { ThinkingCard } from "./ThinkingCard"
import { ToolCallCard } from "./ToolCallCard"
import { MarkdownBlock } from "./MarkdownBlock"

interface SubagentCardProps {
    block: SubagentBlock
}

export function SubagentCard({ block }: SubagentCardProps) {
    const [isExpanded, setIsExpanded] = useState(true) // open by default while running

    // Auto-collapse when subagent completes
    useEffect(() => {
        if (block.status !== "running") {
            // Optionally auto-collapse after a short delay
        }
    }, [block.status])

    const isRunning = block.status === "running"
    const isError = block.status === "error"

    return (
        <div className={`rounded-lg border text-xs transition-all duration-300 ${
            isRunning
                ? "border-l-2 border-l-purple-400 border-stone-200"
                : isError
                  ? "border-l-2 border-l-red-400 border-stone-200"
                  : "border-l-2 border-l-green-400 border-stone-200"
        }`}>
            {/* Header */}
            <div
                className="flex items-center gap-1.5 px-2.5 py-1.5 select-none cursor-pointer"
                onClick={() => setIsExpanded(prev => !prev)}
            >
                <Bot className="w-3 h-3 text-purple-500" />
                <span className="text-stone-600 font-medium truncate">
                    {block.description}
                </span>
                <span className="ml-auto flex items-center gap-1">
                    {isRunning && <Loader2 className="w-3 h-3 text-purple-500 animate-spin" />}
                    {block.status === "completed" && <Check className="w-3 h-3 text-green-600" />}
                    {isError && <X className="w-3 h-3 text-red-500" />}
                    {block.rounds != null && (
                        <span className="text-stone-400 text-[10px]">
                            {block.rounds}r · {block.toolCallCount ?? 0}t
                        </span>
                    )}
                    <span className="text-stone-400 text-[10px]">{isExpanded ? "▾" : "▸"}</span>
                </span>
            </div>

            {/* Nested content blocks */}
            {isExpanded && block.nestedBlocks.length > 0 && (
                <div className="px-2.5 pb-2 space-y-1 border-t border-stone-100">
                    {block.nestedBlocks
                        .filter(isVisibleNestedBlock)
                        .map((nb, i) => renderNestedBlock(nb, i))}
                </div>
            )}
        </div>
    )
}

function isVisibleNestedBlock(block: ContentBlock): boolean {
    if (block.type === "tool_call") return true
    if ("content" in block) return block.content !== "" || ("isStreaming" in block && block.isStreaming)
    return true
}

function renderNestedBlock(block: ContentBlock, index: number) {
    switch (block.type) {
        case "thinking":
            return <ThinkingCard key={index} thinkingContent={block.content} isThinking={block.isStreaming} />
        case "text":
            return (
                <div key={index} className="rounded-lg px-2.5 py-1.5 text-xs bg-stone-50 text-stone-700 break-words">
                    {block.content ? (
                        <MarkdownBlock content={block.content} isStreaming={block.isStreaming} />
                    ) : (
                        block.isStreaming && <span className="text-stone-400 italic text-[10px]">…</span>
                    )}
                </div>
            )
        case "tool_call":
            return <ToolCallCard key={index} block={block} />
        default:
            return null
    }
}
```

### 4.8 `src/13_sidepanel/components/MessageBubble.tsx`

**Change**: Import `SubagentCard` and add the `"subagent"` case to `renderBlock()`:

```typescript
import { SubagentCard } from "./SubagentCard"

// In renderBlock():
case "subagent":
    return <SubagentCard key={index} block={block} />
```

---

## 5. Complete File Change List

| File | Action | Summary |
|------|--------|---------|
| `src/13_sidepanel/types.ts` | **Modify** | Add `nestedBlocks: ContentBlock[]` to `SubagentBlock`; add `onSubagentStart` and `onSubagentBlockUpdate` to `AgentCallbacks` |
| `src/13_sidepanel/agent/SubagentRunner.ts` | **Modify** | Extend `SubagentCallbacks` with thinking/text streaming; wire stream events before `finalMessage()` |
| `src/13_sidepanel/agent/tools/types.ts` | **Modify** | Add optional `beforeExecute?(ctx: ToolExecutionContext): void` to `ToolRegistration`; add `ToolExecutionContext` interface |
| `src/13_sidepanel/agent/tools/subagentTool.ts` | **Modify** | Implement `beforeExecute` to capture `toolCallId` + `callbacks`; create callback bridge that translates subagent events → `onSubagentBlockUpdate`; pass `SubagentCallbacks` to `runSubagent()` |
| `src/13_sidepanel/agent/AgentLoop.ts` | **Modify** | In `processToolCalls()`: emit `onSubagentStart` for `task` tool instead of `onToolCallStart`; call `toolReg.beforeExecute()` before execution |
| `src/13_sidepanel/hooks/useAgentChat.ts` | **Modify** | Implement `onSubagentStart`, `onSubagentBlockUpdate` callbacks; update `onToolCallComplete` to handle SubagentBlock finalization |
| `src/13_sidepanel/components/SubagentCard.tsx` | **Create** | New collapsible card component for rendering `SubagentBlock` with nested blocks |
| `src/13_sidepanel/components/MessageBubble.tsx` | **Modify** | Import `SubagentCard`; add `"subagent"` case to `renderBlock()` |

---

## 6. Sequence Diagram

```
User sends message
       │
       ▼
  useAgentChat.sendMessage()
       │
       ▼
  AgentLoop.runAgent()
       │
       ├─ LLM responds with tool_use: "task"
       │
       ▼
  processToolCalls()
       │
       ├─ Detects block.name === "task"
       ├─ calls callbacks.onSubagentStart(toolCallId, description)
       │     └─► useAgentChat: appendBlock({type:"subagent", nestedBlocks:[]})
       │             └─► React re-renders <SubagentCard> (empty, "running")
       │
       ├─ calls toolReg.beforeExecute({toolCallId, callbacks})
       │     └─► subagentTool captures toolCallId + callbacks in closure
       │
       ├─ calls executeTool("task", input)
       │     └─► subagentTool.execute()
       │           │
       │           ├─ Creates SubagentCallbacks bridge
       │           ├─ Calls runSubagent(client, model, ..., subCallbacks)
       │           │     │
       │           │     ├─ LLM stream: thinking delta
       │           │     │    └─► subCallbacks.onThinkingUpdate()
       │           │     │         └─► parentCallbacks.onSubagentBlockUpdate(toolCallId, updater)
       │           │     │              └─► useAgentChat: mutate SubagentBlock.nestedBlocks
       │           │     │                   └─► React re-renders <SubagentCard> with <ThinkingCard>
       │           │     │
       │           │     ├─ LLM stream: text delta
       │           │     │    └─► subCallbacks.onTextUpdate()
       │           │     │         └─► parentCallbacks.onSubagentBlockUpdate(...)
       │           │     │              └─► React re-renders <SubagentCard> with <MarkdownBlock>
       │           │     │
       │           │     ├─ LLM stream: tool_use
       │           │     │    └─► subCallbacks.onToolCallStart/Complete()
       │           │     │         └─► parentCallbacks.onSubagentBlockUpdate(...)
       │           │     │              └─► React re-renders <SubagentCard> with <ToolCallCard>
       │           │     │
       │           │     └─ Loop complete → returns SubagentResult
       │           │
       │           └─ Returns summary string
       │
       ├─ callbacks.onToolCallComplete(toolCallId, summary, false)
       │     └─► useAgentChat: patch SubagentBlock status→"completed", finalize nestedBlocks
       │           └─► React re-renders <SubagentCard> (completed state)
       │
       └─ Continue parent agent loop...
```

---

## 7. Risks & Edge Cases

### 7.1 React State Update Frequency

**Risk**: Subagent streaming fires thinking/text deltas at high frequency (every few tokens). Each delta triggers `setMessages()` which creates new state objects and causes React re-renders.

**Mitigation**:
- The `onSubagentBlockUpdate` updater pattern is already batch-friendly — React 18 auto-batches state updates within the same event tick.
- If performance degrades, introduce a **throttled flush**: accumulate deltas in a ref and flush to state every ~50ms via `requestAnimationFrame`. This matches the pattern used by many streaming chat UIs.
- The `SubagentCard` component can be wrapped in `React.memo` to avoid unnecessary re-renders of sibling blocks.

### 7.2 Concurrent Subagent Calls

**Risk**: The LLM may emit multiple `tool_use` blocks in one response, including multiple `task` calls (though unlikely). The `processToolCalls()` loop executes tools **sequentially**, so concurrent subagent streaming is not an issue today.

**If parallel execution is added later**: Each subagent has its own `toolCallId`, so the `onSubagentBlockUpdate` calls are already scoped and won't conflict.

### 7.3 Session Persistence / Restore

**Risk**: Persisted `ChatMessage` objects now contain deeply nested `SubagentBlock.nestedBlocks`. On session restore, these blocks must be rendered as static (non-streaming) content.

**Mitigation**: The existing post-loop denormalization in `useAgentChat` already marks all blocks as `isStreaming: false`. For SubagentBlocks, ensure `nestedBlocks` items are also finalized.

### 7.4 Context Window Size

**Risk**: `nestedBlocks` are UI-only and should **not** be serialized into the LLM conversation history. The subagent result going back to the parent LLM is still just the summary string.

**Mitigation**: No change needed — `SubagentBlock.nestedBlocks` only lives in `ChatMessage.blocks[]`, which is a UI state structure. The LLM history in `AgentLoop.history` is separate and only receives the string tool_result.

### 7.5 Error Handling During Streaming

**Risk**: If the subagent's LLM call fails mid-stream, nested blocks may be left in an incomplete state (e.g., a `ThinkingBlock` with `isStreaming: true`).

**Mitigation**: When `onToolCallComplete` fires with `isError: true`, the `useAgentChat` handler already marks all `nestedBlocks` as `isStreaming: false` (see §4.5). The `SubagentCard` will show error status in the header.

### 7.6 `beforeExecute` API Surface

**Risk**: Adding `beforeExecute` to `ToolRegistration` is a new API surface that only the subagent tool uses. Other tools ignore it.

**Mitigation**: The field is optional and the `?.` call in `processToolCalls()` has zero cost for non-subagent tools. Alternative: use a type guard or a separate registry for "streaming-aware" tools. The `beforeExecute` approach is simpler and avoids over-engineering.

### 7.7 Subagent Tool Not Emitting `onToolCallStart`

**Risk**: The `task` tool will emit `onSubagentStart` instead of `onToolCallStart`. If any upstream code assumes every tool emits `onToolCallStart`, it may break.

**Mitigation**: Review all `onToolCallStart` consumers. Currently only `useAgentChat` consumes it. The change is localized.

---

## 8. Implementation Order

1. **Phase 1 — Data layer**: Modify `types.ts` (SubagentBlock + AgentCallbacks), modify `tools/types.ts` (ToolExecutionContext)
2. **Phase 2 — Backend plumbing**: Modify `SubagentRunner.ts` (streaming), modify `subagentTool.ts` (callback bridge + beforeExecute)
3. **Phase 3 — Orchestrator**: Modify `AgentLoop.ts` (processToolCalls differentiation + beforeExecute call)
4. **Phase 4 — State management**: Modify `useAgentChat.ts` (new callback handlers)
5. **Phase 5 — UI**: Create `SubagentCard.tsx`, modify `MessageBubble.tsx`
6. **Phase 6 — Polish**: Throttling, memo, edge case testing

---

## 9. Open Questions

1. **Auto-collapse behavior**: Should the SubagentCard auto-collapse when the subagent completes? Or stay expanded until the user clicks? (Spec assumes stay open; user can manually collapse.)
2. **Nested subagent depth**: The `task` tool is excluded from child toolsets, preventing recursion. If this changes, the `SubagentCard` could theoretically render nested `SubagentCard`s — the recursive data structure supports it, but UI depth limits should be considered.
3. **Progress indicator**: Should the SubagentCard show a round counter that updates in real-time? Currently `rounds` and `toolCallCount` are only set at completion. Adding live updates would require an additional callback or an increment mechanism.
