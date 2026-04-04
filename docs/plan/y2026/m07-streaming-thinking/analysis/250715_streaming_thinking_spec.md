# Streaming Output & Thinking Content Display — Technical Spec

**Date**: 2026-07-15  
**Module**: `src/13_sidepanel`  
**Status**: Draft  
**SDK**: `@anthropic-ai/sdk@0.82.0`

---

## 1. Current State Analysis

### 1.1 API Call Flow (Non-Streaming)

`AgentLoop.runAgent()` calls the Anthropic SDK synchronously via `this.client.messages.create()`:

```
User message → AgentLoop.runAgent()
  → this.client.messages.create({ model, system, messages, tools, max_tokens })
  → Blocks until full response arrives
  → Iterates response.content blocks (TextBlock / ToolUseBlock)
  → If stop_reason === "tool_use": execute tools, push tool_results, loop
  → If stop_reason !== "tool_use": return final text
```

Key details from `AgentLoop.ts`:
- Response is `Anthropic.Message` (non-streaming).
- Text extraction: `response.content.filter(block.type === "text").map(b => b.text)`.
- Tool execution: iterates `response.content` for `block.type === "tool_use"`, calls `executeTool()`, pushes `ToolResultBlockParam` array.
- `onTextUpdate(text)` callback fires once per agent loop iteration with the full text of that turn.
- `onToolUse(toolLabel)` callback fires once per tool call to show active tool indicator.

### 1.2 Message Data Model

```typescript
// src/13_sidepanel/types.ts
interface ChatMessage {
    role: "user" | "assistant"
    content: string          // Plain text only
    toolCalls?: string[]     // Tool labels for badge display
    isError?: boolean
}
```

Limitations:
- No field for thinking content.
- No field for streaming state.
- Content is a single string — no distinction between thinking and text blocks.

### 1.3 Hook → UI Data Flow

`useAgentChat.sendMessage()`:
1. Appends user `ChatMessage` to `messages` state.
2. Appends a placeholder assistant `ChatMessage` (empty content, empty toolCalls).
3. Calls `agentRef.current.runAgent(text, onTextUpdate, onToolUse)`.
4. `onTextUpdate`: replaces the assistant message `content` at `assistantIndex`.
5. `onToolUse`: appends to the assistant message `toolCalls` array, sets `activeTool`.
6. On completion or error: `setIsLoading(false)`.

### 1.4 UI Rendering

- `MessageBubble`: Renders `message.content` in a styled div. When content is empty, shows an italicized "thinking..." placeholder.
- `MessageList`: Renders all messages + an `activeTool` spinner indicator at the bottom.
- No markdown rendering — content is displayed as `whitespace-pre-wrap` plain text.

### 1.5 AnthropicClient

```typescript
// src/13_sidepanel/api/AnthropicClient.ts
new Anthropic({
    apiKey,
    baseURL: DASHSCOPE_ANTHROPIC_BASE_URL,  // "https://dashscope.aliyuncs.com/apps/anthropic"
    dangerouslyAllowBrowser: true,
})
```

Uses DashScope's Anthropic-compatible endpoint. The `stream: true` parameter sends an SSE stream in Anthropic message format.

---

## 2. Anthropic SDK Streaming API Analysis

### 2.1 Two Streaming Approaches

The SDK provides two ways to stream:

#### Approach A: Low-Level `create({ stream: true })`

```typescript
const stream = await client.messages.create({
    ...params,
    stream: true,
}) // Returns Stream<RawMessageStreamEvent>

for await (const event of stream) {
    // Process raw SSE events manually
}
```

Returns `Stream<RawMessageStreamEvent>` — an async iterable of raw events. Requires manual accumulation of message state.

#### Approach B: High-Level `messages.stream()`

```typescript
const stream = client.messages.stream({
    ...params,
}) // Returns MessageStream

stream.on('text', (textDelta, textSnapshot) => { ... })
stream.on('thinking', (thinkingDelta, thinkingSnapshot) => { ... })
stream.on('contentBlock', (block) => { ... })

const finalMessage = await stream.finalMessage()
```

Returns `MessageStream` — a high-level wrapper with typed event emitters and snapshot accumulation. Automatically manages the message state.

#### Recommendation: Approach A (Low-Level)

**Rationale**: The `MessageStream` high-level API handles event accumulation internally, which is convenient but makes it harder to:
- Control exactly when React state updates happen.
- Correctly extract the accumulated message for `this.history` (it wraps messages in its own `messages` array).
- Handle the agent loop pattern (where we need `stop_reason` and `content` blocks to decide whether to continue the loop).

With Approach A, we iterate raw events, accumulate state ourselves in `AgentLoop`, and call callbacks at precisely the right times. This keeps `AgentLoop` as the single source of truth for conversation state.

### 2.2 Raw Stream Event Types

```typescript
type RawMessageStreamEvent =
  | RawMessageStartEvent       // { type: 'message_start', message: Message }
  | RawMessageDeltaEvent       // { type: 'message_delta', delta: { stop_reason, ... }, usage }
  | RawMessageStopEvent        // { type: 'message_stop' }
  | RawContentBlockStartEvent  // { type: 'content_block_start', index, content_block }
  | RawContentBlockDeltaEvent  // { type: 'content_block_delta', index, delta }
  | RawContentBlockStopEvent   // { type: 'content_block_stop', index }
```

### 2.3 Content Block Delta Types

```typescript
type RawContentBlockDelta =
  | TextDelta           // { type: 'text_delta', text: string }
  | InputJSONDelta      // { type: 'input_json_delta', partial_json: string }
  | ThinkingDelta       // { type: 'thinking_delta', thinking: string }
  | CitationsDelta      // { type: 'citations_delta', ... }
  | SignatureDelta      // { type: 'signature_delta', signature: string }
```

### 2.4 Content Block Start Types (relevant subset)

```typescript
// content_block_start.content_block can be:
| TextBlock             // { type: 'text', text: '', citations: null }
| ThinkingBlock         // { type: 'thinking', thinking: '', signature: '' }
| ToolUseBlock          // { type: 'tool_use', id, name, input: {} }
| RedactedThinkingBlock // { type: 'redacted_thinking', data: '...' }
```

### 2.5 Streaming Event Sequence

A typical response with thinking + text + tool_use:

```
message_start         → { message: { id, model, role, content: [], stop_reason: null } }
content_block_start   → { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }
content_block_delta   → { index: 0, delta: { type: 'thinking_delta', thinking: 'Let me...' } }
content_block_delta   → { index: 0, delta: { type: 'thinking_delta', thinking: ' analyze...' } }
content_block_delta   → { index: 0, delta: { type: 'signature_delta', signature: '...' } }
content_block_stop    → { index: 0 }
content_block_start   → { index: 1, content_block: { type: 'text', text: '' } }
content_block_delta   → { index: 1, delta: { type: 'text_delta', text: 'Here' } }
content_block_delta   → { index: 1, delta: { type: 'text_delta', text: ' is my analysis...' } }
content_block_stop    → { index: 1 }
content_block_start   → { index: 2, content_block: { type: 'tool_use', id: 'toolu_123', name: 'getCurrentPage', input: {} } }
content_block_delta   → { index: 2, delta: { type: 'input_json_delta', partial_json: '{"' } }
content_block_delta   → { index: 2, delta: { type: 'input_json_delta', partial_json: 'url":"...' } }
content_block_stop    → { index: 2 }
message_delta         → { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: ... } }
message_stop
```

### 2.6 ThinkingBlock & ThinkingConfigParam

To request thinking content, add `thinking` to the create params:

```typescript
{
    thinking: { type: 'enabled', budget_tokens: 4096 }
    // or: { type: 'adaptive' }       — model decides whether to think
    // or: { type: 'disabled' }        — no thinking
}
```

The Qwen models on DashScope may or may not support the `thinking` parameter. **This needs verification** (see Section 6 - Risks). If not supported, we should only display thinking blocks if they are returned by the model naturally (some models like Qwen3.5 may return thinking content as a separate block format without explicit configuration).

### 2.7 Tool Use in Streaming

When a `tool_use` content block is streamed:
1. `content_block_start` arrives with `{ type: 'tool_use', id, name, input: {} }`.
2. `content_block_delta` events with `input_json_delta` arrive with partial JSON.
3. `content_block_stop` signals completion of the block.
4. After all blocks, `message_delta` with `stop_reason: 'tool_use'` arrives.

The accumulated `input` can be reconstructed from the JSON deltas. We need the complete input before executing the tool.

---

## 3. Proposed Changes

### 3.1 Overview

```
                         ┌──── onThinkingUpdate(delta, snapshot) ──────┐
                         │                                              │
AgentLoop.runAgent() ────┼──── onTextUpdate(delta, snapshot) ──────────┤──→ useAgentChat
  (streaming)            │                                              │     (React state)
                         ├──── onToolUse(toolLabel) ───────────────────┤
                         │                                              │
                         └──── onThinkingComplete() ───────────────────┘
                                                                        │
                                                         ┌──────────────┘
                                                         ▼
                                                    ChatMessage {
                                                      role, content,
                                                      thinkingContent?,
                                                      isThinking?,
                                                      toolCalls?, isError?
                                                    }
                                                         │
                                                         ▼
                                                ┌─── MessageBubble ───┐
                                                │  ThinkingCard        │
                                                │  Text content        │
                                                │  Tool badges         │
                                                └──────────────────────┘
```

### 3.2 Type Changes (`types.ts`)

```typescript
export interface ChatMessage {
    role: "user" | "assistant"
    content: string
    /** Thinking/chain-of-thought text from the model */
    thinkingContent?: string
    /** Whether the model is currently in the thinking phase */
    isThinking?: boolean
    toolCalls?: string[]
    isError?: boolean
}
```

### 3.3 AgentLoop Changes (`agent/AgentLoop.ts`)

#### 3.3.1 New Callback Signature

```typescript
interface AgentCallbacks {
    onTextUpdate: (textDelta: string, textSnapshot: string) => void
    onThinkingUpdate: (thinkingDelta: string, thinkingSnapshot: string) => void
    onThinkingComplete: () => void
    onToolUse: (toolLabel: string) => void
}
```

The method signature changes from:

```typescript
async runAgent(
    userMessage: string,
    onTextUpdate: (text: string) => void,
    onToolUse?: (toolLabel: string) => void
): Promise<string>
```

To:

```typescript
async runAgent(
    userMessage: string,
    callbacks: AgentCallbacks
): Promise<string>
```

#### 3.3.2 Streaming API Call

Replace the `this.client.messages.create()` call with a streaming version:

```typescript
const stream = await this.client.messages.create({
    model: DEFAULT_MODEL,
    system: effectiveSystem,
    messages: this.history,
    tools: TOOL_DEFINITIONS,
    max_tokens: MAX_TOKENS,
    stream: true,
})
```

This returns `Stream<RawMessageStreamEvent>`.

#### 3.3.3 Event Processing Loop

Replace the block-based response processing with an event-driven accumulator:

```typescript
// Accumulators for this turn
const contentBlocks: Anthropic.ContentBlock[] = []
let currentBlockIndex = -1
let accumulatedText = ""
let accumulatedThinking = ""
let stopReason: string | null = null
let toolInputBuffers = new Map<number, string>()  // index → accumulated JSON string

for await (const event of stream) {
    switch (event.type) {
        case 'content_block_start':
            currentBlockIndex = event.index
            contentBlocks[event.index] = { ...event.content_block }
            if (event.content_block.type === 'thinking') {
                accumulatedThinking = ""
                // Signal UI that thinking has started (isThinking = true)
            }
            break

        case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
                accumulatedText += event.delta.text
                callbacks.onTextUpdate(event.delta.text, accumulatedText)
            } else if (event.delta.type === 'thinking_delta') {
                accumulatedThinking += event.delta.thinking
                callbacks.onThinkingUpdate(event.delta.thinking, accumulatedThinking)
            } else if (event.delta.type === 'input_json_delta') {
                const buf = (toolInputBuffers.get(event.index) || '') + event.delta.partial_json
                toolInputBuffers.set(event.index, buf)
                // Parse accumulated JSON for the tool_use block
                contentBlocks[event.index] = {
                    ...contentBlocks[event.index],
                    input: JSON.parse(buf),  // or use partial parse
                }
            }
            break

        case 'content_block_stop':
            if (contentBlocks[event.index]?.type === 'thinking') {
                callbacks.onThinkingComplete()
            }
            break

        case 'message_delta':
            stopReason = event.delta.stop_reason
            break

        case 'message_start':
        case 'message_stop':
            break
    }
}
```

**After the stream completes**, the rest of the agent loop proceeds the same as today:
- Push the accumulated `contentBlocks` as the assistant turn in `this.history`.
- If `stopReason === 'tool_use'`, extract tool blocks, execute tools, push tool results, and continue the loop.
- If not tool_use, return the accumulated text.

#### 3.3.4 Tool Input JSON Parsing

For tool_use blocks, the input is streamed as partial JSON via `input_json_delta`. Two options:
1. **Wait for `content_block_stop`**: Accumulate the full JSON string, then `JSON.parse()` it.
2. **Use partial parsing**: The SDK includes a `partialParse` utility in `_vendor/partial-json-parser`.

**Recommendation**: Option 1 (wait for `content_block_stop`). We don't need to show tool input as it streams — we only need the complete input to execute the tool. This is simpler and avoids edge cases with incomplete JSON.

#### 3.3.5 History Format

The accumulated content blocks must be pushed to `this.history` in the same format as the non-streaming response:

```typescript
this.history.push({
    role: "assistant",
    content: contentBlocks  // Array of ThinkingBlock | TextBlock | ToolUseBlock
})
```

This ensures multi-turn conversation integrity. The thinking blocks, text blocks, and tool_use blocks are all preserved in order.

### 3.4 Hook Changes (`hooks/useAgentChat.ts`)

#### 3.4.1 Updated `sendMessage`

The hook creates a callbacks object and passes it to `runAgent`:

```typescript
await agentRef.current.runAgent(text, {
    onTextUpdate: (delta, snapshot) => {
        setMessages((prev) => {
            const updated = [...prev]
            updated[assistantIndex] = {
                ...updated[assistantIndex]!,
                content: snapshot,
            }
            return updated
        })
    },
    onThinkingUpdate: (delta, snapshot) => {
        setMessages((prev) => {
            const updated = [...prev]
            updated[assistantIndex] = {
                ...updated[assistantIndex]!,
                thinkingContent: snapshot,
                isThinking: true,
            }
            return updated
        })
    },
    onThinkingComplete: () => {
        setMessages((prev) => {
            const updated = [...prev]
            updated[assistantIndex] = {
                ...updated[assistantIndex]!,
                isThinking: false,
            }
            return updated
        })
    },
    onToolUse: (toolLabel) => {
        setActiveTool(toolLabel)
        setMessages((prev) => {
            const updated = [...prev]
            const msg = updated[assistantIndex]!
            const calls = msg.toolCalls || []
            if (!calls.includes(toolLabel)) {
                updated[assistantIndex] = {
                    ...msg,
                    toolCalls: [...calls, toolLabel],
                }
            }
            return updated
        })
    },
})
```

#### 3.4.2 State Update Throttling

Streaming deltas can arrive very rapidly (tens of events per second). React state updates for every single delta token could cause performance issues.

**Strategy**: Do NOT throttle at the hook level. React 18's automatic batching already coalesces synchronous state updates. Since the `for await` loop in `AgentLoop` processes events one-by-one and callbacks fire synchronously within the loop, React will batch adjacent updates. If performance becomes an issue, add throttling later as an optimization — premature optimization should be avoided.

### 3.5 UI Changes

#### 3.5.1 ThinkingCard Component

New component: `src/13_sidepanel/components/ThinkingCard.tsx`

```
┌─ 💭 Thinking ──────────────────── ▾ ─┐
│ Let me analyze the page content...    │
│ I should check the knowledge base...  │
│ The user is asking about...           │
└───────────────────────────────────────┘
```

Behavior:
- **While thinking (`isThinking === true`)**: Card is expanded, shows streaming thinking text with a subtle animation (e.g., pulsing border or typing indicator).
- **When thinking completes (`isThinking === false`)**: Card auto-collapses to a single line summary (e.g., "💭 Thinking (click to expand)").
- **On click**: Toggles expanded/collapsed state.

Props:
```typescript
interface ThinkingCardProps {
    thinkingContent: string
    isThinking: boolean
}
```

Implementation notes:
- Thin collapsible card with `max-height` transition for smooth collapse/expand animation.
- Thinking text displayed in a monospace or slightly dimmed font to visually distinguish from main content.
- `overflow-y: auto` with a reasonable `max-height` (e.g., 200px) when expanded, so long thinking doesn't dominate the screen.

#### 3.5.2 MessageBubble Changes

Update `MessageBubble` to render `ThinkingCard` above the text content bubble:

```tsx
function MessageBubble({ message }: MessageBubbleProps) {
    // ... existing layout ...
    return (
        <div className={...}>
            {/* Avatar */}
            <div className="max-w-[80%] space-y-1">
                {/* Tool call badges */}
                {message.toolCalls && ... }

                {/* Thinking card (new) */}
                {message.thinkingContent && (
                    <ThinkingCard
                        thinkingContent={message.thinkingContent}
                        isThinking={message.isThinking ?? false}
                    />
                )}

                {/* Message content (existing) */}
                <div className={...}>
                    {message.content || <span>thinking...</span>}
                </div>
            </div>
        </div>
    )
}
```

#### 3.5.3 "Thinking..." Placeholder Update

Currently, when `content` is empty, a "thinking..." italicized placeholder is shown. With the new thinking card:
- If `isThinking === true` and `content` is empty: Don't show the old "thinking..." placeholder (the ThinkingCard already indicates thinking state).
- If `isThinking === false` and `content` is empty: Show "..." or a brief waiting indicator (this state should be very brief — it's the gap between thinking completing and text starting to stream).

---

## 4. File-by-File Change Plan

### File 1: `src/13_sidepanel/types.ts`
- Add `thinkingContent?: string` field to `ChatMessage`.
- Add `isThinking?: boolean` field to `ChatMessage`.
- Add `AgentCallbacks` interface (or keep it in AgentLoop.ts).

### File 2: `src/13_sidepanel/agent/AgentLoop.ts`
- Define `AgentCallbacks` interface at module level.
- Change `runAgent()` signature: replace `onTextUpdate` + `onToolUse` with a single `callbacks: AgentCallbacks` parameter.
- Replace `this.client.messages.create(...)` with `this.client.messages.create({ ..., stream: true })`.
- Replace response block iteration with a `for await (const event of stream)` loop that:
  - Accumulates content blocks.
  - Calls `callbacks.onThinkingUpdate()` on thinking deltas.
  - Calls `callbacks.onThinkingComplete()` on thinking block stop.
  - Calls `callbacks.onTextUpdate()` on text deltas.
  - Calls `callbacks.onToolUse()` when a tool_use block starts.
  - Tracks `stopReason` from `message_delta`.
- After the stream ends, push accumulated content blocks to `this.history`.
- If `stopReason === 'tool_use'`, execute tools and continue loop (unchanged logic).
- Return accumulated text.

### File 3: `src/13_sidepanel/hooks/useAgentChat.ts`
- Update `sendMessage()` to build an `AgentCallbacks` object.
- `onTextUpdate`: set `content` to the snapshot string.
- `onThinkingUpdate`: set `thinkingContent` to snapshot, `isThinking = true`.
- `onThinkingComplete`: set `isThinking = false`.
- `onToolUse`: unchanged logic (just wrapped in the callbacks object).

### File 4: `src/13_sidepanel/components/ThinkingCard.tsx` (NEW)
- Collapsible card component.
- Props: `thinkingContent: string`, `isThinking: boolean`.
- Internal state: `isExpanded` (synced to `isThinking` — auto-expands when thinking, auto-collapses when done; user can manually toggle).

### File 5: `src/13_sidepanel/components/MessageBubble.tsx`
- Import `ThinkingCard`.
- Render `ThinkingCard` conditionally when `message.thinkingContent` exists.
- Update the empty-content fallback to account for thinking state.

### File 6: `src/13_sidepanel/styles/sidepanel.css` (optional)
- Add transition styles for the collapsible card if CSS-based animation is used.
- Alternatively, handle via Tailwind utility classes inline.

---

## 5. Detailed Implementation Sequence

1. **types.ts** — Extend `ChatMessage` (no breaking changes, fields are optional).
2. **AgentLoop.ts** — Implement streaming + callbacks.
3. **useAgentChat.ts** — Connect callbacks to React state.
4. **ThinkingCard.tsx** — Build the collapsible thinking display component.
5. **MessageBubble.tsx** — Integrate ThinkingCard.
6. **Manual testing** — Verify streaming text, thinking display, tool calling, error handling.

---

## 6. Risks & Edge Cases

### 6.1 Compatible Endpoint (DashScope) Streaming Support

**Risk**: The DashScope Anthropic-compatible endpoint may not support all Anthropic streaming features identically.

**Mitigation**:
- DashScope's Anthropic-compatible endpoint uses the same SSE format. Streaming with `stream: true` should work — this is a standard part of the Anthropic Messages API that compatible endpoints generally support.
- **Action**: Test streaming with a simple call first before implementing the full feature. If streaming is not supported, we would need to use DashScope's native streaming API instead.

### 6.2 Thinking Content from Qwen Models

**Risk**: The `thinking` parameter and `ThinkingBlock` content type are Anthropic-specific. Qwen models on DashScope may not support them.

**Mitigation**:
- The thinking display UI should be purely reactive: if `thinkingContent` is empty/undefined, the ThinkingCard simply doesn't render.
- Some Qwen models (e.g., qwen3.5-plus) natively support streaming thinking output in Anthropic-compatible format. If the model returns `thinking` type blocks, they will be displayed; if not, nothing breaks.
- **Action**: Do NOT add `thinking: { type: 'enabled', budget_tokens: ... }` to the API request initially. Only display thinking if the model spontaneously produces it. Add thinking configuration as a follow-up if confirmed supported.

### 6.3 Tool Calling Integrity

**Risk**: Streaming may break tool call processing if JSON input is not fully accumulated before execution.

**Mitigation**:
- Tool execution happens AFTER the stream completes (i.e., after the `for await` loop exits).
- Tool input JSON is accumulated from `input_json_delta` events and only parsed after `content_block_stop`.
- The `stopReason` is extracted from `message_delta` event — only checked after stream completion.
- **This ensures identical behavior to the current non-streaming implementation**: tools fire after the full response is received.

### 6.4 Error Handling During Streaming

**Risk**: Network errors or API errors mid-stream could leave the UI in an inconsistent state.

**Mitigation**:
- Wrap the `for await` loop in try/catch. On error:
  - Use `classifyApiError()` (existing) to categorize the error.
  - The hook's existing error handling path will set `isError: true` on the assistant message.
  - Any partially streamed text/thinking content will be preserved in the message (this is actually better UX than today, since the user can see what was received before the error).
- If the stream is interrupted after thinking but before text, the ThinkingCard will show the partial thinking, and the message content will show the error.

### 6.5 Agent Loop Multi-Turn with Streaming

**Risk**: In multi-turn tool-calling scenarios, each iteration of the loop makes a new streaming API call. History must be correctly maintained.

**Mitigation**:
- After each stream completes, push the full accumulated content blocks to `this.history` as an assistant turn (same as the current non-streaming `response.content`).
- Push tool results as a user turn (unchanged).
- The loop structure (`while (true)`) remains the same — only the inner API call mechanism changes.

### 6.6 Callback / React State Update Performance

**Risk**: Very rapid streaming deltas could cause UI jank.

**Mitigation**:
- React 18 automatic batching helps, but SSE events processed in `for await` are microtask-based, which React may not always batch.
- **Fallback plan**: If performance is an issue, add a simple debounce/throttle (e.g., 50ms) to `onTextUpdate` and `onThinkingUpdate` callbacks inside `useAgentChat`. This should NOT be done preemptively — measure first.

### 6.7 Session Persistence

**Risk**: New fields (`thinkingContent`, `isThinking`) need to be persisted/restored correctly.

**Mitigation**:
- `StorageService.saveSessionMessages()` serializes `ChatMessage[]`. Since `thinkingContent` is an optional string, it will be naturally included in JSON serialization.
- `isThinking` should always be `false` after a session restore (no active streaming on restore). The `restoreHistory()` method in `AgentLoop` doesn't need changes — it only needs the `content` string for LLM history, not thinking content.

### 6.8 AbortController / Cancellation

**Risk**: If the user clears the chat or navigates away while streaming, the stream must be properly terminated.

**Mitigation**:
- Store the `Stream` object or its `AbortController` on the `AgentLoop` instance.
- On `clearHistory()`, abort any active stream.
- The `for await` loop will throw, caught by the agent loop's existing error handling.
- **Implementation**: Add an `abortController` field to `AgentLoop`, pass it as a signal to `create()`, and call `abortController.abort()` in `clearHistory()`.

---

## 7. Verification Plan

### 7.1 Manual Testing Checklist

| Scenario | Expected Behavior |
|---|---|
| Simple question (no tools) | Text streams token-by-token in the message bubble. |
| Question with thinking | ThinkingCard appears expanded with streaming text, then collapses. Text content follows. |
| Tool-calling question | Tool badge appears, tool executes, then text streams. Tool calling is not broken. |
| Multi-tool response | Multiple tool badges; each tool executes correctly; final text streams. |
| Error mid-stream | Partial text preserved; error shown in message bubble. |
| Clear chat during streaming | Stream is aborted cleanly; no errors in console. |
| Session restore | Messages restored with thinkingContent; isThinking is false; ThinkingCard is collapsed. |
| Long response (MAX_TOKENS=10000) | Full response streams without timeout. |
| ThinkingCard toggle | Click to expand/collapse after thinking completes. |

### 7.2 Unit Test Targets

- `AgentLoop`: Mock the Anthropic client to return a mock async iterable of events. Verify:
  - Callbacks fire with correct delta/snapshot values.
  - Tool calls are executed after stream completion.
  - History is correctly maintained across multi-turn loops.
- `ThinkingCard`: Render with `isThinking=true`, verify expanded; set `isThinking=false`, verify collapses; click to toggle.

### 7.3 Compatibility Testing

- Test with DashScope endpoint to confirm streaming works.
- Test with a model that produces thinking blocks.
- Test with a model that does NOT produce thinking blocks (verify no crash, ThinkingCard simply absent).

---

## 8. Out of Scope

- Markdown rendering for streamed text (separate feature).
- User-configurable thinking budget.
- Streaming in the `restoreHistory` path.
- Response caching or offline support.
