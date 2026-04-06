# Multi-Block Content Cards — Technical Specification

**Date**: 2026-07-15  
**Module**: `src/13_sidepanel`  
**Status**: Draft

---

## 1. Current State Analysis

### 1.1 Problem Statement

One user query can trigger a **multi-turn agent loop** (think → text → tool call → think → text → …). However, the current UI collapses this entire sequence into **one thinking card** and **one message bubble**. Each new loop iteration **overwrites** the previous thinking/text content, so the user only sees the final iteration's output.

### 1.2 Current Data Model (`types.ts`)

```typescript
export interface ChatMessage {
    role: "user" | "assistant"
    content: string                // Single flat text field — overwritten per iteration
    thinkingContent?: string       // Single flat field — overwritten per iteration
    isThinking?: boolean
    toolCalls?: string[]           // Labels only, no structure (name, input, result)
    isError?: boolean
}
```

**Limitations:**
- `content` is a single string; every `onTextUpdate` overwrites it with the latest snapshot, losing previous iterations' text.
- `thinkingContent` is a single string; same overwrite problem.
- `toolCalls` stores display labels (`string[]`); no tool name, input, output, or status.

### 1.3 Current Agent Loop Flow (`AgentLoop.ts`)

```
while (true) {
    stream = client.messages.stream(...)
    
    stream.on("thinking", delta)     → callbacks.onThinkingUpdate(delta, snapshot)
    stream.on("text", delta)         → callbacks.onTextUpdate(delta, snapshot)
    stream.on("contentBlock", block) → callbacks.onThinkingComplete() | callbacks.onToolUse(label)

    response = await stream.finalMessage()
    
    if (stop_reason !== "tool_use") return accumulatedText
    
    for each tool_use block:
        callbacks.onToolUse(label)       // ← called AGAIN (duplicate)
        result = executeTool(...)
        // result is NOT reported to UI
    
    push tool results → continue loop
}
```

**Issues identified:**
1. `onToolUse` fires **twice** per tool: once from the stream `contentBlock` event, once from the execution loop.
2. Tool execution **results** are never reported to the UI.
3. The `snapshot` parameter in `onTextUpdate` is per-API-call; continuing the loop starts a fresh snapshot, overwriting the previous text.

### 1.4 Current Hook (`useAgentChat.ts`)

Creates **one** placeholder assistant message at a fixed `assistantIndex`. All callbacks mutate this single message object:

```typescript
const assistantIndex = messages.length + 1
setMessages(prev => [...prev, { role: "assistant", content: "", toolCalls: [] }])

// onTextUpdate → prev[assistantIndex].content = snapshot     (OVERWRITES)
// onThinkingUpdate → prev[assistantIndex].thinkingContent = snapshot  (OVERWRITES)
// onToolUse → prev[assistantIndex].toolCalls.push(label)     (APPENDS — but labels only)
```

### 1.5 Current UI Components

| Component | Role | Limitation |
|-----------|------|------------|
| `MessageBubble.tsx` | Renders tool badges → ThinkingCard → text content | One thinking card, one text block per message |
| `ThinkingCard.tsx` | Collapsible thinking panel | Already a standalone component; reusable |
| `MessageList.tsx` | Maps `messages[]` → `MessageBubble` | No block-level rendering |

---

## 2. Proposed Data Model

### 2.1 Design Decision: Option A — `blocks: ContentBlock[]` inside `ChatMessage`

**Considered options:**

| Option | Description | Verdict |
|--------|-------------|---------|
| **A — Blocks array** | Add `blocks: ContentBlock[]` to assistant `ChatMessage` | **Selected** — cleanest; preserves user/assistant alternation |
| B — Message per block | Each block is its own `ChatMessage` | Rejected — breaks user/assistant alternation; messy history |
| C — Separate `AssistantMessage` type | New type with blocks, alongside `UserMessage` | Rejected — unnecessary complexity; discriminated union adds friction |

**Rationale for Option A:**
- Preserves the existing `ChatMessage[]` array structure and user/assistant alternation.
- `blocks` is additive; `content` remains as a denormalized summary for backward compatibility and history restoration.
- Minimal impact on `StorageService`, `App.tsx`, `MessageList.tsx`.

### 2.2 New Types

```typescript
// ─── Content Block Types ───────────────────────────────────────

export interface ThinkingBlock {
    type: "thinking"
    content: string
    /** Whether this block is currently being streamed */
    isStreaming: boolean
}

export interface TextBlock {
    type: "text"
    content: string
    /** Whether this block is currently being streamed */
    isStreaming: boolean
}

export interface ToolCallBlock {
    type: "tool_call"
    /** Unique ID from the Anthropic tool_use content block */
    toolCallId: string
    /** Tool function name (e.g., "getCurrentPage") */
    toolName: string
    /** Human-readable label (e.g., "Reading current page...") */
    toolLabel: string
    /** Tool input parameters (optional, for display) */
    input?: Record<string, unknown>
    /** Tool execution result text */
    result?: string
    /** Whether the tool execution resulted in an error */
    isError?: boolean
    /** Current execution status */
    status: "running" | "completed" | "error"
}

export type ContentBlock = ThinkingBlock | TextBlock | ToolCallBlock

// ─── Updated ChatMessage ───────────────────────────────────────

export interface ChatMessage {
    role: "user" | "assistant"
    /**
     * For user messages: the user's input text.
     * For assistant messages: denormalized summary of all text blocks
     * (concatenation of TextBlock.content), used for history restoration
     * and backward compatibility.
     */
    content: string
    /**
     * Ordered sequence of content blocks for assistant messages.
     * Undefined for user messages.
     */
    blocks?: ContentBlock[]
    /** @deprecated Use blocks[].type === "thinking" instead. Kept for storage migration. */
    thinkingContent?: string
    /** @deprecated Use blocks[].type === "tool_call" instead. Kept for storage migration. */
    toolCalls?: string[]
    isError?: boolean
}
```

### 2.3 Updated AgentCallbacks

```typescript
export interface AgentCallbacks {
    onThinkingUpdate: (delta: string, snapshot: string) => void
    onThinkingComplete: () => void
    onTextUpdate: (delta: string, snapshot: string) => void
    /**
     * Fired immediately before tool execution begins.
     * @param toolCallId - Unique ID from Anthropic's tool_use block
     * @param toolName - Tool function name
     * @param toolLabel - Human-readable display label
     * @param input - Tool input parameters
     */
    onToolCallStart: (toolCallId: string, toolName: string, toolLabel: string, input?: Record<string, unknown>) => void
    /**
     * Fired after tool execution completes (success or failure).
     * @param toolCallId - Matches the ID from onToolCallStart
     * @param result - Tool execution result or error message
     * @param isError - Whether execution failed
     */
    onToolCallComplete: (toolCallId: string, result: string, isError: boolean) => void
}
```

**Changes from current `AgentCallbacks`:**
- **Removed**: `onToolUse(toolLabel: string)` — replaced by the two callbacks below.
- **Added**: `onToolCallStart(toolCallId, toolName, toolLabel, input)` — creates a ToolCallBlock with `status: "running"`.
- **Added**: `onToolCallComplete(toolCallId, result, isError)` — updates the matching ToolCallBlock with result and final status.

---

## 3. AgentLoop Changes

### 3.1 Stream Event Handling

```typescript
// BEFORE (current)
stream.on("contentBlock", (block) => {
    if (block.type === "thinking") callbacks.onThinkingComplete()
    if (block.type === "tool_use") callbacks.onToolUse(toolLabel)  // ← REMOVE
})

// AFTER (proposed)
stream.on("contentBlock", (block) => {
    if (block.type === "thinking") callbacks.onThinkingComplete()
    // tool_use handling moved to execution loop — no action here
})
```

### 3.2 Tool Execution Loop

```typescript
// BEFORE (current)
for (const block of response.content) {
    if (block.type !== "tool_use") continue
    callbacks.onToolUse(toolLabel)             // label only, no structure
    const result = await this.executeTool(block.name, block.input)
    toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result })
}

// AFTER (proposed)
for (const block of response.content) {
    if (block.type !== "tool_use") continue
    const toolReg = TOOL_REGISTRY.get(block.name)
    const toolLabel = toolReg?.label || `Running ${block.name}...`

    callbacks.onToolCallStart(block.id, block.name, toolLabel, block.input as Record<string, unknown>)

    try {
        const result = await this.executeTool(block.name, block.input as Record<string, unknown>)
        callbacks.onToolCallComplete(block.id, result, false)
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result })
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        callbacks.onToolCallComplete(block.id, `Error: ${errorMsg}`, true)
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: `Error: ${errorMsg}`, is_error: true })
    }
}
```

### 3.3 Return Value

The `runAgent` method currently returns `accumulatedText` (last iteration's text only). This return value is **not used** by `useAgentChat` (the hook already receives everything through callbacks). Consider changing the return type to `void` for clarity, or keeping it as-is for potential external use.

**Recommendation**: Change return type to `Promise<void>`. If any consumer needs the final text, they can reconstruct it from callback data.

---

## 4. useAgentChat Hook Changes

### 4.1 Phase Tracking

Introduce a `phaseRef` to track which type of block is currently being streamed. This determines whether incoming deltas should update the existing block or create a new one.

```typescript
type StreamPhase = "idle" | "thinking" | "text"
const phaseRef = useRef<StreamPhase>("idle")
```

**State machine:**
```
idle ──[thinking delta]──→ thinking ──[thinking complete]──→ idle
idle ──[text delta]──────→ text     ──[tool call start]───→ idle
idle ──[tool call start]─→ idle (tool blocks don't stream)
text ──[tool call start]─→ idle (text block streaming ended implicitly)
```

### 4.2 Block Manipulation Helpers

```typescript
function appendBlock(block: ContentBlock): void {
    setMessages(prev => {
        const updated = [...prev]
        const msg = updated[assistantIndex]!
        const blocks = [...(msg.blocks || []), block]
        updated[assistantIndex] = { ...msg, blocks }
        return updated
    })
}

function updateLastBlock(patch: Partial<ContentBlock>): void {
    setMessages(prev => {
        const updated = [...prev]
        const msg = updated[assistantIndex]!
        const blocks = [...(msg.blocks || [])]
        const lastIdx = blocks.length - 1
        if (lastIdx >= 0) {
            blocks[lastIdx] = { ...blocks[lastIdx], ...patch } as ContentBlock
        }
        updated[assistantIndex] = { ...msg, blocks }
        return updated
    })
}

function updateToolBlock(toolCallId: string, patch: Partial<ToolCallBlock>): void {
    setMessages(prev => {
        const updated = [...prev]
        const msg = updated[assistantIndex]!
        const blocks = (msg.blocks || []).map(b =>
            b.type === "tool_call" && b.toolCallId === toolCallId
                ? { ...b, ...patch }
                : b
        )
        updated[assistantIndex] = { ...msg, blocks }
        return updated
    })
}
```

### 4.3 Callback Implementations

```typescript
const agentCallbacks: AgentCallbacks = {
    onThinkingUpdate: (_delta, snapshot) => {
        if (phaseRef.current !== "thinking") {
            phaseRef.current = "thinking"
            appendBlock({ type: "thinking", content: snapshot, isStreaming: true })
        } else {
            updateLastBlock({ content: snapshot })
        }
    },
    onThinkingComplete: () => {
        updateLastBlock({ isStreaming: false })
        phaseRef.current = "idle"
    },
    onTextUpdate: (_delta, snapshot) => {
        if (phaseRef.current !== "text") {
            phaseRef.current = "text"
            appendBlock({ type: "text", content: snapshot, isStreaming: true })
        } else {
            updateLastBlock({ content: snapshot })
        }
    },
    onToolCallStart: (toolCallId, toolName, toolLabel, input) => {
        phaseRef.current = "idle"
        appendBlock({
            type: "tool_call", toolCallId, toolName, toolLabel, input,
            status: "running",
        })
    },
    onToolCallComplete: (toolCallId, result, isError) => {
        updateToolBlock(toolCallId, {
            result,
            isError,
            status: isError ? "error" : "completed",
        })
    },
}
```

### 4.4 Post-Loop Content Denormalization

After `runAgent` completes (in the `finally` or after `await`), compute the denormalized `content` field from all text blocks:

```typescript
setMessages(prev => {
    const updated = [...prev]
    const msg = updated[assistantIndex]!
    const blocks = msg.blocks || []

    // Denormalize: join all text block contents
    const content = blocks
        .filter((b): b is TextBlock => b.type === "text")
        .map(b => b.content)
        .join("\n\n")

    // Mark all blocks as not streaming
    const finalBlocks = blocks.map(b =>
        "isStreaming" in b ? { ...b, isStreaming: false } : b
    )

    updated[assistantIndex] = { ...msg, content, blocks: finalBlocks }
    return updated
})
```

### 4.5 Phase Reset

Reset `phaseRef` to `"idle"` at the beginning of each `sendMessage` call, before creating the placeholder assistant message.

---

## 5. UI Component Changes

### 5.1 MessageBubble.tsx — Refactor to Render Blocks

**Current**: Renders tool badges → ThinkingCard → text bubble (all flat fields).

**Proposed**: If `message.blocks` exists, iterate and render each block as a card. Fall back to legacy rendering for old messages without `blocks`.

```
MessageBubble
├── Avatar (left for assistant, right for user)
└── Content area
    ├── IF user message → single text bubble (unchanged)
    ├── IF assistant message WITH blocks →
    │   blocks.map(block => {
    │       switch (block.type):
    │           "thinking" → <ThinkingCard />
    │           "text"     → <TextBlockCard />
    │           "tool_call"→ <ToolCallCard />
    │   })
    └── IF assistant message WITHOUT blocks (legacy) →
        legacy rendering (tool badges + ThinkingCard + text)
```

### 5.2 ThinkingCard.tsx — Minor Update

**Current interface:**
```typescript
interface ThinkingCardProps {
    thinkingContent: string
    isThinking: boolean
}
```

**Proposed interface (additive):**
```typescript
interface ThinkingCardProps {
    thinkingContent: string
    isThinking: boolean   // maps to ThinkingBlock.isStreaming
}
```

No breaking changes. The `isThinking` prop maps directly to `ThinkingBlock.isStreaming`. The component itself requires **no code changes**.

### 5.3 TextBlockCard — New Component (or Inline)

A simple styled wrapper for text content, identical to the current message bubble's text rendering. Can be implemented as:

**Option 1 — Inline in MessageBubble**: Extract the current text `<div>` into a small helper rendered per TextBlock. Minimal file changes.

**Option 2 — Separate component `TextBlockCard.tsx`**: Standalone component for consistency with ThinkingCard/ToolCallCard.

**Recommendation**: Option 1 (inline) for now. The text rendering is a simple styled `<div>`; a separate file adds overhead with no reuse benefit.

```tsx
// Inline within MessageBubble's block rendering
function renderTextBlock(block: TextBlock, isError: boolean) {
    return (
        <div className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words
            ${isError ? "bg-red-50 text-red-800 ..." : "bg-white text-stone-800 ..."}`}>
            {block.content || (block.isStreaming && <span className="text-stone-400 italic text-xs">…</span>)}
        </div>
    )
}
```

### 5.4 ToolCallCard.tsx — New Component

Displays a tool call with its name, status, and optional result preview.

```tsx
interface ToolCallCardProps {
    block: ToolCallBlock
}
```

**Visual design:**
```
┌─────────────────────────────────┐
│ 🔧 getCurrentPage     ● Running │   ← status: "running" (spinner)
│                                 │
│ 🔧 getCurrentPage   ✓ Complete  │   ← status: "completed" (checkmark)
│   ▸ Show result                 │   ← collapsible result preview
│                                 │
│ 🔧 getCurrentPage   ✗ Error     │   ← status: "error" (red)
│   ▸ Show error                  │   ← collapsible error message
└─────────────────────────────────┘
```

**Behavior:**
- `status: "running"` → spinner icon, pulsing border (similar to ThinkingCard).
- `status: "completed"` → green checkmark, collapsible result preview (first ~200 chars).
- `status: "error"` → red X, collapsible error message.
- Click to toggle result/error visibility.

### 5.5 MessageList.tsx — No Changes Expected

`MessageList` maps `messages[]` → `MessageBubble`. Since block rendering is handled inside `MessageBubble`, no changes needed here. The `activeTool` indicator at the bottom can be **removed** since tool status is now shown inline via `ToolCallCard`.

### 5.6 Component Hierarchy (After)

```
MessageList
└── MessageBubble (per message)
    ├── [User message] → single text bubble
    └── [Assistant message] → blocks.map(block =>
        ├── ThinkingCard       (block.type === "thinking")
        ├── TextBlockCard      (block.type === "text", inline render)
        └── ToolCallCard       (block.type === "tool_call")
    )
```

---

## 6. Storage & Persistence

### 6.1 Session Storage

`StorageService.saveSessionMessages` serializes `ChatMessage[]` to `chrome.storage.session`. The new `blocks` field is plain JSON-serializable data — **no changes needed** to the storage functions themselves.

### 6.2 History Restoration

`AgentLoop.restoreHistory` reads `message.content` to reconstruct LLM conversation history. Since `content` is denormalized (contains all text blocks joined), this continues to work **without changes**.

```typescript
// Existing code — still works
restoreHistory(messages.map(m => ({ role: m.role, content: m.content })))
```

### 6.3 Backward Compatibility (Migration)

Old stored messages lack `blocks`. The UI must handle this gracefully:

```typescript
// In MessageBubble — legacy fallback
if (!message.blocks || message.blocks.length === 0) {
    // Render using legacy flat fields: thinkingContent, content, toolCalls
    return <LegacyMessageContent message={message} />
}
// Otherwise render blocks
return message.blocks.map(renderBlock)
```

**No explicit migration needed** — legacy messages render with the old logic; new messages use blocks. Over time, as users clear chat or start new sessions, all messages will use the new format.

### 6.4 Storage Size Consideration

Adding `blocks` increases storage size per message (tool inputs/results can be large). Mitigation:
- Truncate `ToolCallBlock.result` before persistence (e.g., first 500 chars).
- Omit `ToolCallBlock.input` from persisted data if it exceeds a threshold.
- Apply truncation in `saveSessionMessages` or in the hook before setting final state.

---

## 7. File-by-File Change Plan

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `types.ts` | **Modify** | Add `ContentBlock` union type (`ThinkingBlock`, `TextBlock`, `ToolCallBlock`). Add `blocks?: ContentBlock[]` to `ChatMessage`. Replace `onToolUse` with `onToolCallStart` + `onToolCallComplete` in `AgentCallbacks`. |
| 2 | `agent/AgentLoop.ts` | **Modify** | Remove duplicate `onToolUse` from stream `contentBlock` handler. Replace `onToolUse` calls in execution loop with `onToolCallStart` (before) and `onToolCallComplete` (after each tool). Pass `block.id`, `block.name`, `toolLabel`, `block.input` to start callback. Pass result/error to complete callback. |
| 3 | `hooks/useAgentChat.ts` | **Modify** | Add `phaseRef` for stream phase tracking. Replace flat-field callback implementations with block-aware versions (`appendBlock`, `updateLastBlock`, `updateToolBlock`). Add post-loop content denormalization. Remove `activeTool` state (replaced by inline ToolCallCard status). |
| 4 | `components/MessageBubble.tsx` | **Modify** | Add block-based rendering path: iterate `message.blocks`, render ThinkingCard / text div / ToolCallCard per block type. Keep legacy fallback for messages without `blocks`. |
| 5 | `components/ToolCallCard.tsx` | **Create** | New component. Displays tool name, status (running/completed/error), collapsible result preview. Spinner for running state. |
| 6 | `components/ThinkingCard.tsx` | **No change** | Already compatible. `isThinking` prop maps to `ThinkingBlock.isStreaming`. |
| 7 | `components/MessageList.tsx` | **Minor modify** | Remove the `activeTool` bottom indicator (tool status now inline). Remove `activeTool` prop. |
| 8 | `components/ChatInputBar.tsx` | **No change** | Input component; unaffected. |
| 9 | `App.tsx` | **Minor modify** | Remove `activeTool` from `MessageList` props. Remove `activeTool` from destructured `useAgentChat` result (or keep for non-UI uses). |
| 10 | `services/StorageService.ts` | **No change** | Serializes `ChatMessage[]` as-is; `blocks` is JSON-serializable. |

### Dependency Order

```
1. types.ts                          (foundation — all others depend on this)
2. agent/AgentLoop.ts                (callback signature change)
3. components/ToolCallCard.tsx       (new component, no deps on hook)
4. hooks/useAgentChat.ts             (consumes new callbacks, produces blocks)
5. components/MessageBubble.tsx      (renders blocks)
6. components/MessageList.tsx        (remove activeTool)
7. App.tsx                           (remove activeTool prop)
```

---

## 8. Risks & Edge Cases

### 8.1 High-Frequency State Updates

Each streaming delta triggers a `setMessages` call that clones the entire messages array. For long conversations with many blocks, this could cause performance issues.

**Mitigation**: Consider using `useRef` for the in-progress blocks array during streaming, and only sync to React state at a throttled interval (e.g., every 50–100ms via `requestAnimationFrame`). Apply the final state on stream completion.

### 8.2 Empty Blocks

The model may start a thinking phase but produce no content, or emit a text content block with empty text.

**Mitigation**: Filter out empty blocks (`block.content === ""`) in the render path rather than prevention (the model's behavior is not controllable).

### 8.3 Multiple Tool Calls in One Response

A single API response can contain multiple `tool_use` content blocks (e.g., the model calls two tools in parallel).

**Handling**: The current execution loop processes them sequentially. Each gets its own `onToolCallStart` → `onToolCallComplete` pair. The UI shows them as separate ToolCallCards appearing one by one. This is correct behavior.

**Future enhancement**: Show all tool calls at once with "pending" status before execution begins, then update to "running"/"completed" sequentially. This requires a two-pass approach (first pass: create all cards; second pass: execute). Not required for v1.

### 8.4 Error During Streaming (Partial Blocks)

If the API call fails mid-stream, some blocks may be partially filled.

**Handling**: The `catch` block in `useAgentChat` already handles errors. With blocks, it should:
1. Mark all in-progress blocks as `isStreaming: false`.
2. Append an error TextBlock (or set `isError` on the message).
3. Ensure partial content is still visible to the user.

### 8.5 Backward Compatibility — Old Stored Messages

Existing sessions have messages with `thinkingContent`, `content`, `toolCalls` but no `blocks`.

**Handling**: `MessageBubble` checks `message.blocks` and falls back to legacy rendering. No data migration needed.

### 8.6 `activeTool` Removal Impact

Removing the global `activeTool` state and the bottom-of-list spinner changes the loading UX. Users currently see a spinner below the message list.

**Mitigation**: The `ToolCallCard` with `status: "running"` + spinner provides equivalent feedback, positioned contextually within the message. Additionally, the `isLoading` state still disables the input bar, so the user knows the agent is working.

### 8.7 Content Denormalization Timing

The `content` field must be populated after the agent loop completes, but before `saveSessionMessages` fires (which is triggered by `useEffect` on `[messages, isLoading]`).

**Handling**: Denormalize in the `finally` block of `sendMessage`, before `setIsLoading(false)`. This ensures the effect sees the final `content` value.

---

## 9. Verification Plan

### 9.1 Unit Tests

| Test | Description |
|------|-------------|
| `ContentBlock type guards` | Verify TypeScript discriminated union works correctly for each block type |
| `AgentLoop callbacks` | Mock callbacks and verify `onToolCallStart`/`onToolCallComplete` are called with correct parameters for single and multiple tool calls |
| `Phase tracking` | Verify phase transitions: idle → thinking → idle → text → idle → tool → thinking → … |
| `Block append/update` | Verify `appendBlock`, `updateLastBlock`, `updateToolBlock` produce correct state |
| `Content denormalization` | Verify `content` field equals joined text of all TextBlocks after loop completion |
| `Legacy fallback` | Verify messages without `blocks` render correctly using old fields |

### 9.2 Manual Testing Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| Simple Q&A (no tools) | Single thinking card + single text block |
| Single tool call | Thinking → text → ToolCallCard (running → completed) → thinking → text |
| Multi-tool loop (3+ iterations) | Stacked cards: thinking, text, tool, thinking, text, tool, thinking, text |
| Tool execution error | ToolCallCard shows error status with red styling and error message |
| Network error mid-stream | Partial blocks visible; error message appended; input re-enabled |
| Clear chat | All messages and blocks cleared; fresh state |
| Session restore | Reload side panel; blocks render correctly from storage; conversation continues |
| Legacy message rendering | Old stored messages (no `blocks`) render with existing tool badges + ThinkingCard + text |

### 9.3 Performance Testing

| Check | Criteria |
|-------|----------|
| Streaming smoothness | No visible jank during text/thinking streaming with 10+ blocks |
| Memory | No significant memory growth after 50+ messages with blocks |
| Storage size | Verify `chrome.storage.session` quota is not exceeded with tool results |

---

## Appendix A: Visual Flow Example

For the query "阅读网页内容，总结关键知识并存储":

```
┌──────────────────────────────────────────────────────┐
│ [User]  阅读网页内容，总结关键知识并存储                  │
├──────────────────────────────────────────────────────┤
│ [Bot]                                                │
│                                                      │
│  ┌─ 💭 Thinking ─────────────────── ▾ ─┐            │
│  │ 用户想让我读取当前网页，提取知识...     │            │
│  └─────────────────────────────────────┘            │
│                                                      │
│  ┌─ 📝 Text ──────────────────────────┐            │
│  │ 好的，让我先读取当前网页的内容。      │            │
│  └─────────────────────────────────────┘            │
│                                                      │
│  ┌─ 🔧 getCurrentPage ─── ✓ Complete ─┐            │
│  │ ▸ Show result                       │            │
│  └─────────────────────────────────────┘            │
│                                                      │
│  ┌─ 💭 Thinking ─────────────────── ▾ ─┐            │
│  │ 网页内容已获取，我来提取关键知识...     │            │
│  └─────────────────────────────────────┘            │
│                                                      │
│  ┌─ 📝 Text ──────────────────────────┐            │
│  │ 我已读取网页内容，正在提取知识...      │            │
│  └─────────────────────────────────────┘            │
│                                                      │
│  ┌─ 🔧 storeKnowledge ─── ✓ Complete ─┐            │
│  │ ▸ Show result                       │            │
│  └─────────────────────────────────────┘            │
│                                                      │
│  ┌─ 💭 Thinking ─────────────────── ▾ ─┐            │
│  │ 知识已存储成功，我来回复用户...        │            │
│  └─────────────────────────────────────┘            │
│                                                      │
│  ┌─ 📝 Text ──────────────────────────┐            │
│  │ 完成！我已将以下关键知识存储：        │            │
│  │ 1. ...                              │            │
│  │ 2. ...                              │            │
│  └─────────────────────────────────────┘            │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## Appendix B: Streaming Timeline

```
Time ──────────────────────────────────────────────────────────────►

API Call #1:
  [thinking deltas...]  [thinking complete]  [text deltas...]  [tool_use block]
  │                     │                    │                  │
  └─ append ThinkingBlock   └─ mark done    └─ append TextBlock  └─ stream ends
                                              (isStreaming)

Tool Execution:
  [onToolCallStart]                    [onToolCallComplete]
  │                                    │
  └─ append ToolCallBlock (running)    └─ update to (completed)

API Call #2:
  [thinking deltas...]  [thinking complete]  [text deltas...]  [end_turn]
  │                     │                    │                  │
  └─ append NEW ThinkingBlock  └─ mark done └─ append NEW TextBlock  └─ done
```
