# Token Consumption Tracking — Technical Specification

**Date**: 2026-03-17  
**Status**: Draft  
**Scope**: translate-api backend — full-text translation (fragment + batch)

---

## 1. Goal

Track token consumption (prompt + completion tokens) for all full-text translation requests (fragment and batch), with three deliverables:

1. **Per-request token usage** — returned in each fragment translation API response.
2. **Per-batch aggregate token totals** — logged at info level for every batch translation request.
3. **In-memory global counter** — a singleton that accumulates all fragment translation token consumption since server start, queryable at any time.

---

## 2. Current State

- `GenerationLLMService.generate()` in `src/7_generate/services/llm/generationLLM.service.ts` calls `OpenAI.chat.completions.create()`, which returns `completion.usage` containing `{ prompt_tokens, completion_tokens, total_tokens }`.
- Usage data is currently **discarded** — only cache-hit detail is partially logged.
- `generate()` returns `Promise<string>` (content only).
- **6+ callers** depend on the `string` return type; changing it would be a breaking change.

---

## 3. Design

### 3.1 New Types

**File**: `src/7_generate/types/generate.d.ts`

```typescript
/** Token consumption breakdown for a single LLM call. */
interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

/** Extended generation result that includes token usage alongside content. */
interface GenerationResult {
    content: string;
    usage: TokenUsage | null;
}
```

### 3.2 Backward-Compatible API

**File**: `src/7_generate/services/llm/generationLLM.service.ts`

- **Keep** existing `generate()` returning `Promise<string>` — no signature change.
- **Add** new method `generateWithUsage(): Promise<GenerationResult>` that returns both content and token usage.
- **Refactor internals**: `generate()` calls `generateWithUsage()` and returns `.content`.

```
┌─────────────────────────────────────────────┐
│  generate(messages)                         │
│    → generateWithUsage(messages)            │
│    → return result.content                  │
│                                             │
│  generateWithUsage(messages)                │
│    → OpenAI.chat.completions.create(...)    │
│    → extract content + usage                │
│    → TokenTracker.record(usage)             │
│    → return { content, usage }              │
└─────────────────────────────────────────────┘
```

This ensures all 6+ existing callers remain untouched.

### 3.3 Token Tracker Singleton

**New file**: `src/7_generate/services/llm/TokenTracker.ts`

```typescript
class TokenTracker {
    private static instance: TokenTracker;

    // Accumulated totals since server start
    private totalPromptTokens = 0;
    private totalCompletionTokens = 0;
    private totalRequests = 0;
    private startTime = Date.now();

    static getInstance(): TokenTracker;

    /** Record a single LLM call's token usage. */
    record(usage: TokenUsage): void;

    /** Return accumulated stats since server start. */
    getStats(): {
        totalPromptTokens: number;
        totalCompletionTokens: number;
        totalTokens: number;
        totalRequests: number;
        uptimeSeconds: number;
    };

    /** Reset all counters (useful for testing). */
    reset(): void;
}
```

- Called inside `generateWithUsage()` automatically on every LLM call.
- Records every LLM call's token usage into the in-memory accumulator.
- Thread-safe by Node.js single-thread model; no locking needed.

### 3.4 Fragment Translation Changes

**File**: `src/7_generate/services/FragmentTranslation.service.ts` (or equivalent)

- Switch from `this.client.generate(messages)` to `this.client.generateWithUsage(messages)`.
- Add `usage: TokenUsage | null` to `FragmentTranslationResult` type.

### 3.5 Translation Service Changes

**File**: `src/1_translate/services/translation.service.ts`

- **`translateFragment()`**: propagate `usage` from `FragmentTranslationResult` into the response.
- **`translateBatch()`**: aggregate token usage across all `Promise.allSettled` results by summing `promptTokens`, `completionTokens`, and `totalTokens`. Log the per-batch total at info level.

```
Batch token usage: { promptTokens: 1234, completionTokens: 567, totalTokens: 1801, fragments: 5 }
```

### 3.6 API Response Changes

**File**: `src/1_translate/types/translation.d.ts`

```typescript
// Fragment-level response
interface FragmentTranslationResponse {
    // ... existing fields
    usage?: TokenUsage;
}

// Batch-level response
interface BatchTranslationResponse {
    // ... existing fields
    totalUsage?: TokenUsage;
}
```

Both fields are optional so that existing clients are unaffected if usage is unavailable (e.g., cache hits).

### 3.7 Controller / Logging

**File**: `src/1_translate/controllers/translation.controller.ts`

- Batch handler: log aggregate token usage per batch at **info** level.
- Include `usage` / `totalUsage` in API JSON responses so the frontend can optionally display consumption.

---

## 4. Files to Modify

| File | Change |
|---|---|
| `src/7_generate/types/generate.d.ts` | Add `TokenUsage` and `GenerationResult` types |
| `src/7_generate/services/llm/generationLLM.service.ts` | Add `generateWithUsage()`, refactor `generate()` to delegate |
| `src/7_generate/services/llm/TokenTracker.ts` | **New file** — in-memory counter singleton |
| `src/7_generate/services/FragmentTranslation.service.ts` | Use `generateWithUsage()`, return usage in result |
| `src/1_translate/types/translation.d.ts` | Add `usage` to fragment response, `totalUsage` to batch response |
| `src/1_translate/services/translation.service.ts` | Propagate usage in fragment, aggregate + log in batch |
| `src/1_translate/controllers/translation.controller.ts` | Include usage fields in API responses |

---

## 5. Non-Goals

- **No database persistence** — token usage is tracked in-memory only; it resets on server restart.
- **No changes to existing callers of `generate()`** — only fragment translation switches to `generateWithUsage()`.
- **No UI / frontend changes** — the extension may consume the data later, but that is out of scope.
- **No billing logic** — this spec covers measurement only, not cost calculation or quota enforcement.

---

## 6. Verification

| Check | Expected Result |
|---|---|
| `npm run build` | Passes with no type errors |
| Batch endpoint response | Contains `totalUsage` with aggregated `promptTokens`, `completionTokens`, `totalTokens` |
| Fragment endpoint response | Contains `usage` with per-request `promptTokens`, `completionTokens`, `totalTokens` |
| Console log (batch) | Info-level log showing per-batch token summary |
| `TokenTracker.getStats()` | Returns accumulated totals across all requests since startup |
