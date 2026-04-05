# Context Compression for TapWord Agent Sidepanel

**Date**: 2026-07-17  
**Status**: Draft  
**Module**: `src/13_sidepanel`

---

## 1. Reference Implementation Analysis

The reference Python implementation (`s06_context_compact.py`) uses a **three-layer compression pipeline**:

| Layer | Name | Trigger | Behavior |
|-------|------|---------|----------|
| **Layer 1** | `micro_compact` | Every LLM turn (silent) | Replaces `tool_result` content older than the last 3 entries with a short placeholder `"[Previous: used {tool_name}]"`. This is lossless for recent context and cheap. |
| **Layer 2** | `auto_compact` | `estimate_tokens(messages) > 50000` | Saves full transcript to disk, asks the LLM to produce a structured summary, then replaces **all** messages with `[summary] + assistant ack`. |
| **Layer 3** | `compact` tool | Model calls `compact` tool explicitly | Same flow as Layer 2, but triggered by the model when it detects context bloat or wants to reset. |

**Key patterns to borrow:**
- **Layered approach** — micro-compression on every turn is nearly free and buys significant headroom before the expensive LLM-summarization path is needed.
- **Transcript persistence** — saving the raw conversation before compressing ensures recoverability and auditability.
- **Estimation heuristic** — `len(str(messages)) // 4` is a simple but effective estimator. We need to adjust this for Chinese content (see §3).
- **Summary structure** — the summarization prompt asks for: (1) what was accomplished, (2) current state, (3) key decisions. This is a good skeleton for continuity.
- **Two-message replacement** — the compressed state is always `[user: summary, assistant: "Understood"]`, which keeps the Anthropic API contract valid (alternating user/assistant roles).

**Patterns to adapt or improve:**
- The reference does not persist compression events to UI — we need a visible `CompactionCard`.
- The reference has no Chinese-aware token estimation.
- The reference uses a global threshold (50K); we should make this proportional to the **model's actual context window** minus a safety margin.
- The reference `micro_compact` walks messages in-place; our TypeScript AgentLoop pushes immutable `Anthropic.MessageParam[]` — we need a non-mutating approach.

---

## 2. Current State Analysis

### 2.1 AgentLoop History Management

**File**: `src/13_sidepanel/agent/AgentLoop.ts`

```
private history: Anthropic.MessageParam[] = []
```

- History is an array of `Anthropic.MessageParam` objects (role + content).
- `content` can be a `string` (user text) or an array of content blocks (`TextBlock`, `ToolUseBlock`, `ToolResultBlockParam`, etc.).
- Each `runAgent()` call appends user message → streams response → appends assistant message → processes tool calls → appends tool results → loops until `stop_reason !== "tool_use"`.
- `restoreHistory()` rebuilds from simplified `{role, content: string}[]` pairs (text only, no tool blocks).
- `clearHistory()` is all-or-nothing (wipes everything).
- **No token counting, no compression, no history pruning exists today.**

### 2.2 LLM Call Configuration

| Parameter | Value | Source |
|-----------|-------|--------|
| `model` | `"qwen3.5-plus"` (fallback) / `"accounts/fireworks/routers/kimi-k2p5-turbo"` (dev) | `VITE_AGENT_MODEL` env var |
| `max_tokens` | `10000` | `MAX_TOKENS` constant |
| `system` | System prompt (~500 chars base) + optional skill metadata + optional todo nag | `buildSystemPrompt()` |
| `tools` | 14 local tool definitions + MCP tools | `TOOL_REGISTRY` + `mcpCallbacks` |
| `baseURL` | DashScope or Fireworks | `VITE_AGENT_BASE_URL` |

**Context window sizes** (varies by model):
- `qwen3.5-plus`: 131,072 tokens
- `kimi-k2p5-turbo` (via Fireworks): 131,072 tokens
- These are not currently tracked or used anywhere in code.

### 2.3 UI Message State

**File**: `src/13_sidepanel/hooks/useAgentChat.ts`

- UI maintains `ChatMessage[]` state separate from `AgentLoop.history`.
- `ChatMessage` has: `role`, `content` (denormalized text), `blocks?: ContentBlock[]`, `isError?`.
- `ContentBlock = ThinkingBlock | TextBlock | ToolCallBlock`.
- Messages are persisted to `chrome.storage.session` via `StorageService` after each interaction.
- History restoration: on mount, saved messages are loaded → passed to `AgentLoop.restoreHistory()` as `{role, content}[]` pairs (blocks are not restored into LLM history).

### 2.4 Existing Card Component Patterns

**ThinkingCard** (`components/ThinkingCard.tsx`):
- Collapsible card with `💭` emoji, header text, and expandable content area.
- Takes `thinkingContent: string` and `isThinking: boolean`.
- Border styling: `border-l-2 border-l-blue-400` when active, plain when done.

**ToolCallCard** (`components/ToolCallCard.tsx`):
- Collapsible card with `Wrench` icon, status indicators (`Loader2`/`Check`/`X`).
- Takes a `ToolCallBlock` with `status: "running" | "completed" | "error"`.
- Expandable result preview with truncation.

Both follow the same structural pattern: **header row (icon + label + chevron) → collapsible content area**.

---

## 3. Token Estimation Strategy

### 3.1 Why Character-Based Estimation

True token counting (e.g., `tiktoken`) would require shipping a tokenizer WASM/JS bundle into the extension, adding ~2–4 MB to the build for uncertain benefit. Since we only need to know *approximately* when to compress (not exact billing counts), a character-based heuristic is sufficient and zero-cost.

### 3.2 Chinese vs English Token Ratio

| Language | Approximate Ratio | Reason |
|----------|-------------------|--------|
| English | ~4 chars per token | Standard BPE tokenization |
| Chinese | ~1.5–2 chars per token | Each CJK character often maps to 1 token; some common words merge into 1 token |
| Mixed | ~3 chars per token | Weighted average assumption |

### 3.3 Estimation Algorithm

```
function estimateTokens(text: string): number {
    let cjkChars = 0
    let otherChars = 0
    for (const char of text) {
        if (isCJK(char)) cjkChars++
        else otherChars++
    }
    return Math.ceil(cjkChars / 1.5 + otherChars / 4)
}
```

Where `isCJK(char)` checks Unicode ranges `\u4E00-\u9FFF`, `\u3400-\u4DBF`, `\uF900-\uFAFF` (CJK Unified Ideographs + Extension A + Compatibility).

### 3.4 What to Count

The **total context** sent to the API on each turn includes:

| Component | How to estimate | Typical size |
|-----------|----------------|--------------|
| System prompt | `estimateTokens(effectiveSystem)` | ~200–500 tokens |
| Tool definitions | `estimateTokens(JSON.stringify(allToolDefs))` | ~2,000–4,000 tokens (14 tools + MCP) |
| Conversation history | `estimateTokens(JSON.stringify(this.history))` | Grows unbounded |
| Reserved for output | `MAX_TOKENS` (10,000) | Fixed |

**Effective available context** = `MODEL_CONTEXT_WINDOW - systemTokens - toolTokens - MAX_TOKENS - SAFETY_MARGIN`

Tool definitions and system prompt should be computed once at the start of each `runAgent()` call and cached for the duration.

---

## 4. Compression Trigger Logic

### 4.1 Threshold Calculation

```
MODEL_CONTEXT_WINDOW = 131072    // configurable per model
SAFETY_MARGIN        = 4096      // buffer for estimation inaccuracy
COMPRESSION_RATIO    = 0.80      // trigger at 80% of available context

availableForHistory = MODEL_CONTEXT_WINDOW - systemTokens - toolTokens - MAX_TOKENS - SAFETY_MARGIN
compressionThreshold = availableForHistory * COMPRESSION_RATIO
```

With typical values: `131072 - 500 - 3000 - 10000 - 4096 = 113,476` → threshold ≈ `90,780 tokens`.

### 4.2 When to Check

- **Before each LLM call** in the `while(true)` loop inside `runAgent()`.
- This is where the reference implementation checks too — right before calling `client.messages.create()`.

### 4.3 Decision Flow

```
                    ┌──────────────────┐
                    │ Before LLM call  │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ micro_compact()  │  ← always (Layer 1)
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────────────┐
                    │ historyTokens > threshold?│
                    └────────┬─────────┬────────┘
                             │yes      │no
                    ┌────────▼──────┐  │
                    │ auto_compact()│  │  ← Layer 2
                    └────────┬──────┘  │
                             │         │
                    ┌────────▼─────────▼──┐
                    │ Proceed with LLM call│
                    └─────────────────────┘
```

---

## 5. Compression Flow

### 5.1 Layer 1: Micro-Compact (Tool Result Trimming)

**Goal**: Reduce token bloat from old tool results without losing conversation flow.

**Algorithm**:
1. Walk `this.history` and collect all entries that are `tool_result` blocks (user role messages with `content: ToolResultBlockParam[]`).
2. Keep the last `KEEP_RECENT` (3) tool result entries untouched.
3. For older entries, if `content` string length > 100 chars, replace with `"[Previous: used {toolName}]"`.
4. Build a `toolNameMap` by scanning assistant messages for `tool_use` blocks and mapping `block.id → block.name`.
5. Return a **new** history array (do not mutate in place — immutability principle).

**Adaptation from reference**: The Python version mutates dicts in-place. We will produce a new array via `.map()` to keep the TypeScript code idiomatic.

### 5.2 Layer 2: Auto-Compact (LLM Summarization)

**Trigger**: `estimateTokens(JSON.stringify(history)) > compressionThreshold`.

**Steps**:
1. **Persist raw transcript** to `chrome.storage.local` under a timestamped key (e.g., `transcript_1721234567890`). This replaces the reference's file-system transcript saving.
2. **Build summarization prompt**:

```
Summarize this conversation for continuity. Preserve:
1. What tasks were accomplished (including specific file paths, code changes, key outputs)
2. Current state of the work (what was the user's last request, what was in progress)
3. Key decisions made and their rationale
4. Any error states or unresolved issues
5. Active todo items and their status

Be concise but preserve all critical details needed to continue the work seamlessly.
Format as structured bullet points.

<conversation>
{truncated JSON of messages, capped at 80,000 chars}
</conversation>
```

3. **Call LLM** with the summarization prompt (non-streaming, `max_tokens: 2000`).
4. **Replace history** with two messages:
   - `{ role: "user", content: "[Context compressed — summary of previous conversation]\n\n{summary}" }`
   - `{ role: "assistant", content: "Understood. I have the context from the summary and will continue from here." }`
5. **Notify UI** via a new callback `onCompactionComplete(summary)` so that `useAgentChat` can insert a `CompactionBlock` into the message list.

### 5.3 Layer 3: Manual Compact Tool (Future / Optional)

Register a `compact` tool in `TOOL_REGISTRY` that the model can invoke when it detects context bloat. This is lower priority and can be deferred to a follow-up iteration.

---

## 6. UI Integration

### 6.1 New ContentBlock Type

Add to `types.ts`:

```typescript
export interface CompactionBlock {
    type: "compaction"
    /** The summary text produced by the LLM */
    summary: string
    /** Timestamp when compression occurred */
    timestamp: number
    /** Number of messages that were compressed */
    compressedMessageCount: number
    /** Estimated tokens before compression */
    tokensBefore: number
    /** Estimated tokens after compression */
    tokensAfter: number
}

export type ContentBlock = ThinkingBlock | TextBlock | ToolCallBlock | CompactionBlock
```

### 6.2 CompactionCard Component

**File**: `src/13_sidepanel/components/CompactionCard.tsx`

Follows the same collapsed/expanded card pattern as `ThinkingCard` and `ToolCallCard`:

- **Collapsed state** (default): `📦 Context Compressed · 42 messages → summary · saved ~85K tokens`
- **Expanded state**: Shows the full summary text in a scrollable area.
- **Styling**: Uses `border-l-2 border-l-amber-400` to visually distinguish from thinking (blue) and tool calls (neutral).

### 6.3 MessageBubble Integration

In `renderBlock()` inside `MessageBubble.tsx`, add a new case:

```typescript
case "compaction":
    return <CompactionCard key={index} block={block} />
```

### 6.4 Callback Flow

Add a new callback to `AgentCallbacks`:

```typescript
onCompactionComplete: (summary: string, stats: { compressedCount: number; tokensBefore: number; tokensAfter: number }) => void
```

In `useAgentChat.ts`, the handler appends a `CompactionBlock` to the current assistant message's blocks array, or inserts a standalone system-level message before the next user turn.

**Design decision**: The compaction card should appear as a **standalone entry** between the last pre-compression assistant message and the next user message. This means it is NOT part of an assistant message's `blocks[]`, but rather a separate `ChatMessage` with `role: "assistant"` and a single `CompactionBlock`.

---

## 7. Files to Create / Modify

### New Files

| File | Purpose |
|------|---------|
| `src/13_sidepanel/agent/ContextCompressor.ts` | Core compression logic: `estimateTokens()`, `microCompact()`, `autoCompact()`, threshold calculation. Service class with `IContextCompressor` interface. |
| `src/13_sidepanel/components/CompactionCard.tsx` | UI card component for displaying compression events. |

### Modified Files

| File | Changes |
|------|---------|
| `src/13_sidepanel/types.ts` | Add `CompactionBlock` to `ContentBlock` union. Add `onCompactionComplete` to `AgentCallbacks`. |
| `src/13_sidepanel/agent/AgentLoop.ts` | Import and invoke `ContextCompressor` before each LLM call in the `while(true)` loop. Pass `callbacks.onCompactionComplete` when compression occurs. Add `MODEL_CONTEXT_WINDOW` constant. |
| `src/13_sidepanel/hooks/useAgentChat.ts` | Handle `onCompactionComplete` callback — insert a `CompactionBlock` message into the messages array. |
| `src/13_sidepanel/components/MessageBubble.tsx` | Add `case "compaction"` to `renderBlock()`. Import `CompactionCard`. |
| `src/13_sidepanel/services/StorageService.ts` | (Optional) Add `saveTranscript()` / `loadTranscripts()` for persisting raw conversation before compression. |

### Files NOT Modified

- `AnthropicClient.ts` — no changes needed; the summarization call uses the same client.
- `prompts.ts` — the summarization prompt lives in `ContextCompressor.ts`, not in the system prompt.
- Tool files — no changes unless Layer 3 (manual compact tool) is implemented.

---

## 8. Edge Cases and Risks

### 8.1 Token Estimation Inaccuracy

**Risk**: Character-based estimation may be off by 10–20%, especially with code blocks (high ASCII density) or heavy emoji usage.

**Mitigation**: The `SAFETY_MARGIN` (4096 tokens) and triggering at 80% of available context provide a ~20% buffer. If the LLM returns a context-length error despite our estimation, we can catch it, force-compress, and retry.

### 8.2 Compression Loses Critical Context

**Risk**: The LLM summary may omit details that the user considers important (e.g., specific file paths mentioned 20 turns ago).

**Mitigation**:
- The summarization prompt explicitly asks for file paths, code changes, and error states.
- Raw transcript is persisted to `chrome.storage.local` for recovery.
- micro_compact only trims tool *results*, not the tool call inputs or assistant reasoning — the conversation structure is preserved.

### 8.3 Summarization API Call Failure

**Risk**: The LLM call for summarization may fail (rate limit, network error).

**Mitigation**: If the summarization call fails, fall back to a **mechanical truncation** strategy: keep the system prompt + last N messages (where N is calculated to fit within the threshold) and prepend a note `"[Earlier context dropped due to length — some history may be missing]"`. This is lossy but keeps the agent functional.

### 8.4 Infinite Compression Loop

**Risk**: If the summary itself is very large, post-compression tokens may still exceed the threshold, causing repeated compression attempts.

**Mitigation**: After compression, if tokens still exceed threshold, log a warning and proceed anyway (the safety margin should absorb it). Add a `compressionCooldown` flag that prevents re-compression within the same `runAgent()` invocation.

### 8.5 Session Restore After Compression

**Risk**: `restoreHistory()` currently only handles `{role, content}` pairs. A compressed history (with the special summary format) must survive save/restore cycles.

**Mitigation**: Since compressed history is just `[user(summary), assistant(ack)]` — two plain text messages — it naturally survives the existing `restoreHistory()` flow without changes.

### 8.6 UI Message Count Mismatch

**Risk**: After compression, UI has N messages but LLM history has 2. If the user scrolls up and sees old messages, then sends a new message, the agent has no memory of those visible messages.

**Mitigation**: Two options:
- **Option A (Recommended)**: When compression occurs, insert a compaction card in the UI and keep old messages visible but grayed out / marked as "compressed". The LLM history is the source of truth.
- **Option B**: Remove old UI messages and replace with just the compaction card. Simpler but loses visual history.

### 8.7 Concurrent Compression and Streaming

**Risk**: Compression triggers mid-loop between tool calls. The UI must handle the transition gracefully.

**Mitigation**: Compression always happens *before* the LLM call at the top of the loop, never during streaming. The callback `onCompactionComplete` fires synchronously before the stream starts, so the UI updates atomically.

### 8.8 MCP Tool Definitions Variability

**Risk**: MCP tools can be dynamically enabled/disabled, changing the tool definition token budget between turns.

**Mitigation**: Recalculate `toolTokens` at the start of each `runAgent()` call (already planned in §4.1), not cached across calls.

---

## Appendix A: Estimated Token Budgets

| Component | Estimated Tokens |
|-----------|-----------------|
| System prompt (base) | ~150 |
| System prompt (with 3 skills) | ~300 |
| Tool definitions (14 local) | ~2,500 |
| Tool definitions (14 local + 5 MCP) | ~3,500 |
| `MAX_TOKENS` (output reserve) | 10,000 |
| Safety margin | 4,096 |
| **Available for history** | **~113,000** |
| **Compression threshold (80%)** | **~90,000** |

## Appendix B: Compression Summary Prompt Template

```
You are summarizing a conversation between a user and an AI assistant (TapWord Agent).
Create a concise summary that preserves all information needed to continue the work.

Include:
1. **Tasks completed**: What was accomplished, including specific file paths, function names, and code changes.
2. **Current state**: The user's last request and what was in progress when this summary was created.
3. **Key decisions**: Important choices made during the conversation and their rationale.
4. **Errors / blockers**: Any unresolved issues, error states, or things that were tried and failed.
5. **Active todos**: Current task list items and their status.

Rules:
- Be concise but complete. Aim for 300-500 words.
- Use structured bullet points.
- Preserve exact file paths, variable names, and technical terms.
- Do not include pleasantries or conversational filler.
```
