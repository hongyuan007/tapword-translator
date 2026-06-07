# Code Change Handoff Manifest — Full-Page Translation (Comprehensive)

**Date**: 2026-03-17
**Scope**: 2 repositories, 47 source files, 4 features + bug fixes

---

## 1. Change Context

### Related Documents
- `docs/plan/y2026/m03-full-translate/requirements.md` — Feature requirements
- `docs/plan/y2026/m03-full-translate/progress.md` — Development progress tracker
- `docs/plan/y2026/m03-full-translate/analysis/260315_dom_walker_research.md` — DOM walking research
- `docs/plan/y2026/m03-full-translate/analysis/260315_batch_translation_and_queues_research.md` — Batch queue research
- `docs/plan/y2026/m03-full-translate/analysis/260315_observers_and_orchestration_research.md` — Observers/orchestration research
- `docs/plan/y2026/m03-full-translate/analysis/260317_batch_api_research.md` — Batch API research
- `docs/plan/y2026/m03-full-translate/analysis/260317_full_text_batch_spec.md` — Full-text batch spec
- `docs/plan/y2026/m03-full-translate/analysis/260317_token_tracking_spec.md` — Token tracking spec
- `docs/plan/y2026/m03-full-translate/analysis/260316_p0_recursive_translation_spec.md` — Recursive translation spec
- `docs/plan/y2026/m03-full-translate/analysis/260315_p0_p1_fixes_research.md` — P0/P1 fixes research

### Task Objectives
This changeset attempts to implement a **full-page translation** feature for the TapWord browser extension. The intended goals are:

1. Introduce a new `11_full_translate` module that walks the DOM, classifies elements, and orchestrates viewport-aware lazy translation of paragraph-level content.
2. Wire the module into the existing content script, background service worker, and popup UI via new message types.
3. Add a dedicated backend API endpoint (`/api/v1/translate/full-text-batch`) that batches multiple text segments into a single LLM call using separator-based joining for token efficiency.
4. Introduce in-memory token consumption tracking (`TokenTracker`) and propagate `usage` data from every LLM call through the response chain.

---

## 2. File Change Audit

### Feature 1: Full-Page Translation Module (`src/11_full_translate/`)

All files in this section are **New**.

| File Path | Change Type | Objective Description |
|:---|:---|:---|
| `src/11_full_translate/index.ts` | New | Module barrel — explicit exports for types, constants, DOM functions, utilities, and `PageTranslationManager` |
| `src/11_full_translate/README.md` | New | Module documentation — architecture, data flow, integration points, design decisions |
| `src/11_full_translate/types/index.ts` | New | Type definitions: `TransNode`, `FullTranslateMode`, `PageTranslateRange`, `FullTranslateConfig`, `PreloadConfig`, `WalkResult`, `ParagraphInfo`, `TranslationUnit`, `BatchTranslationItem/Result` |
| `src/11_full_translate/constants/index.ts` | New | Constants: data attributes (`WALKED_ATTRIBUTE`, `PARAGRAPH_ATTRIBUTE`, etc.), CSS classes, tag classification sets (`DONT_WALK_AND_TRANSLATE_TAGS`, `FORCE_BLOCK_TAGS`, etc.), site-specific selectors, batch/rate/preload defaults |
| `src/11_full_translate/PageTranslationManager.ts` | New | Top-level orchestrator (431 lines). Manages lifecycle: `start()` walks DOM + sets up observers, `stop()` cleans up. Coordinates `ViewportObserver`, `DynamicContentObserver`, `BatchQueue`, `TranslationCache`, `TokenBucketRateLimiter`. Recursive `translateElement()` handles simple paragraphs (single unit) and mixed paragraphs (inline groups + block children). Session isolation via `walkId` UUID. Progress logging every 20 paragraphs. |
| `src/11_full_translate/dom/index.ts` | New | DOM sub-module barrel — re-exports from filter, walker, renderer, translationWalker |
| `src/11_full_translate/dom/filter.ts` | New | Element classification (207 lines): `isHTMLElement` (duck-typed), `isShallowInlineHTMLElement`, `isShallowBlockHTMLElement`, `isDontWalkIntoButTranslateAsChildElement`, `isDontWalkIntoAndDontTranslateAsChildElement`, site-specific selectors, drop-cap detection, numeric content check, `hasNoWalkAncestor` |
| `src/11_full_translate/dom/walker.ts` | New | Recursive DOM walker (196 lines): `walkAndLabelElement()` sets data attributes per session. Handles shadow DOM. `extractTextContent()` with whitespace normalization. Propagates `forceBlock` upward. |
| `src/11_full_translate/dom/translationWalker.ts` | New | Translation unit extraction (149 lines): `extractTranslationUnits()` groups consecutive inline children. `extractParagraphText()` joins unit texts. `shouldTranslateParagraph()` validates min chars/words. `collectBlockChildren()` for recursive processing. Flex parent detection for `forceBlockTranslation` flag. |
| `src/11_full_translate/dom/renderer.ts` | New | Translation rendering (248 lines): `insertTranslation()` with bilingual/translationOnly modes, inline vs block insertion, `DomBatcher`-queued DOM writes. `removeAllTranslations()` with `originalContentMap` restore. `createSpinner()`/`removeSpinner()` with Web Animations API. `removeWalkLabels()` strips data attributes. |
| `src/11_full_translate/utils/index.ts` | New | Utils barrel — re-exports all utility classes |
| `src/11_full_translate/utils/ViewportObserver.ts` | New | Wraps `IntersectionObserver` for lazy translation triggering. Configurable preload margin (600px default) and threshold. Unobserves after first intersection. |
| `src/11_full_translate/utils/DynamicContentObserver.ts` | New | `MutationObserver` wrapper (161 lines). Observes `childList`+`attributes` mutations. Skips already-walked elements and translated wrappers. Recursively observes shadow roots. Detects revealed hidden elements via `didBecomeVisible()`. |
| `src/11_full_translate/utils/BatchQueue.ts` | New | Translation request accumulator (238 lines). `enqueue()` returns `Promise<string>`. Batches by item count (4) and char count (1000). Timer-based flush (100ms). Retry on `BatchCountMismatchError` (3 retries, exponential backoff 1s→8s). Falls back to individual `sendSingleTranslation()` if all retries fail. |
| `src/11_full_translate/utils/DomBatcher.ts` | New | Singleton `requestAnimationFrame` batcher (78 lines). Coalesces DOM writes to prevent layout thrashing. Self-scheduling on new operations during flush. `reset()` nulls singleton. |
| `src/11_full_translate/utils/TokenBucketRateLimiter.ts` | New | Token bucket rate limiter (63 lines). Defaults: capacity=60, rate=8/s. `acquire()` waits via `setTimeout` if no tokens available. `refill()` based on elapsed time. |
| `src/11_full_translate/utils/TranslationCache.ts` | New | IndexedDB-based cache (147 lines). SHA-256 key from `text|sourceLang|targetLang`. Lazy singleton DB open. `get()`/`set()`/`clear()` with error swallowing (returns null on failure). |

### Feature 2: Content/Background/Popup Integration

| File Path | Change Type | Objective Description |
|:---|:---|:---|
| `src/0_common/types/index.ts` | Mod | Added 3 new message types to `MessageType` union: `FULL_TRANSLATE_BATCH_REQUEST`, `FULL_TRANSLATE_TOGGLE`, `FULL_TRANSLATE_STATUS_REQUEST`. Added 6 new interfaces: `FullTranslateToggleMessage`, `FullTranslateToggleResponseMessage`, `FullTranslateStatusRequestMessage`, `FullTranslateStatusResponseMessage`, `FullTranslateBatchRequestData`, `FullTranslateBatchRequestMessage`, `FullTranslateBatchResponseMessage`. |
| `src/1_content/handlers/FullTranslateHandler.ts` | New | Content script handler (100 lines). `handleToggle()` lazily creates `PageTranslationManager`, builds config from user settings via `storageManager`. `handleStatusRequest()` returns running state. Defaults: sourceLang=auto, targetLang=zh, mode=bilingual, range=main. |
| `src/1_content/index.ts` | Mod | Added `chrome.runtime.onMessage` listener for `FULL_TRANSLATE_TOGGLE` (async, returns true) and `FULL_TRANSLATE_STATUS_REQUEST` (sync). Imported `FullTranslateHandler`. |
| `src/2_background/handlers/FullTranslateBatchHandler.ts` | New | Background handler (61 lines). `handleFullTranslateBatchRequest()` calls the backend full-text-batch endpoint via `post()`. Logs batch size, success count, and elapsed time. |
| `src/2_background/messaging/MessageRouter.ts` | Mod | Added 3 new cases to message routing switch: `FULL_TRANSLATE_BATCH_REQUEST` delegates to `FullTranslateBatchHandler`. `FULL_TRANSLATE_TOGGLE` and `FULL_TRANSLATE_STATUS_REQUEST` forward to active tab's content script via `chrome.tabs.sendMessage` with `lastError` guards and fallback error responses. |
| `src/3_popup/index.html` | Mod | Added `.full-translate-action` div with `#fullTranslateButton` button containing globe SVG icon and `#fullTranslateLabel` span with `data-i18n-key`. |
| `src/3_popup/index.ts` | Mod | Added `setupFullTranslateButton()` (94 lines of new code). Queries status on load, toggles on click with loading state, handles `lastError` and undefined/error responses. Imported new message types from `@/0_common/types`. |
| `src/3_popup/styles/popup.css` | Mod | Added 62 lines: `.full-translate-button` with gradient background, `.is-loading` state (gray, pointer-events:none, spin animation), `.is-active` state (red gradient for stop). |
| `src/0_common/locales/en.json` | Mod | Added 3 keys: `popup.translatePage.label`, `popup.translatePage.loading`, `popup.translatePage.stop` |
| `src/0_common/locales/zh.json` | Mod | Added 3 equivalent Chinese locale keys |
| `src/0_common/locales/de.json` | Mod | Added 3 equivalent German locale keys |
| `src/0_common/locales/es.json` | Mod | Added 3 equivalent Spanish locale keys |
| `src/0_common/locales/fr.json` | Mod | Added 3 equivalent French locale keys |
| `src/0_common/locales/ja.json` | Mod | Added 3 equivalent Japanese locale keys |
| `src/0_common/locales/ko.json` | Mod | Added 3 equivalent Korean locale keys |
| `src/0_common/locales/ru.json` | Mod | Added 3 equivalent Russian locale keys |

### Feature 3: Backend Batch Translation API (`translate-api` repo)

| File Path | Change Type | Objective Description |
|:---|:---|:---|
| `resources/generate/full_text_batch/system_prompt.txt` | New | LLM system prompt: instructs translator to split/join segments by `%%` delimiter, output JSON `{"translations": "..."}`, match segment count exactly |
| `resources/generate/full_text_batch/user_prompt_template.txt` | New | User prompt template with `${sourceLanguage}`, `${targetLanguage}`, `${count}`, `${text}` placeholders |
| `src/1_translate/types/translation.d.ts` | Mod | Added `usage` field to `FragmentTranslationResponse`. Added 4 new interfaces: `BatchTranslationRequest/Response`, `FullTextBatchTranslationRequest/Response` |
| `src/1_translate/controllers/translation.controller.ts` | Mod | Added `translateBatchHandler` (validates: texts non-empty array, max 10 items, max 5000 total chars, each text non-empty, required languages). Added `translateFullTextBatchHandler` with identical validation. Standard BusinessError catch pattern. |
| `src/1_translate/routes/index.ts` | Mod | Added `POST /batch` route with `batchTranslateRateLimiter` (10 req/30s). Added `POST /full-text-batch` route with `fullTextBatchRateLimiter` (10 req/30s). Both protected by JWT + version middleware. |
| `src/1_translate/services/translation.service.ts` | Mod | Added `translateBatch()`: translates each text via `Promise.allSettled(translateFragment())`, failed slots return `""`, aggregates token usage. Added `translateFullTextBatch()`: calls `FullTextBatchTranslationService.translateBatch()` with try/catch fallback to `translateFullTextBatchFallback()` (individual fragment translations). Added `getFullTextBatchTranslationConfig()` with region-based env var lookup (America→AtlasCloud, default→Qwen). Lazy singleton for `FullTextBatchTranslationService`. |
| `src/7_generate/services/FullTextBatchTranslation.service.ts` | New | Dedicated batch LLM service (159 lines). Joins texts with `%%` separator, sends single LLM call, parses JSON response, splits on `%%`. One retry on count mismatch. `parseResponse()` has JSON.parse fallback with regex extraction. Max 4000 tokens. Factory function `createFullTextBatchTranslationService()`. |

### Feature 4: Token Consumption Tracking (`translate-api` repo)

| File Path | Change Type | Objective Description |
|:---|:---|:---|
| `src/7_generate/types/generate.d.ts` | Mod | Added `TokenUsage` interface (`promptTokens`, `completionTokens`, `totalTokens`). Added `GenerationResult` interface (`content` + `usage`). |
| `src/7_generate/services/llm/generationLLM.service.ts` | Mod | Added `generateWithUsage()` method (returns `GenerationResult`). Refactored `generate()` to delegate to `generateWithUsage()`. Extracts `prompt_tokens`, `completion_tokens`, `total_tokens` from OpenAI response. Records via `TokenTracker.getInstance().record()`. Variable renamed `usage` → `rawUsage` to avoid shadowing. |
| `src/7_generate/services/llm/TokenTracker.ts` | New | In-memory singleton (70 lines). Accumulates `totalPromptTokens`, `totalCompletionTokens`, `totalRequests` since server start. Logs accumulated stats every 10 requests. `getStats()` returns snapshot with `uptimeSeconds`. `reset()` for testing. |
| `src/7_generate/services/FragmentTranslation.service.ts` | Mod | Changed `this.client.generate(messages)` → `this.client.generateWithUsage(messages)`. Destructures `{ content, usage }`. Spreads `usage` into `FragmentTranslationResult`. Added `TokenUsage` import. |

### Feature 5: Translation API Types & Constants (Cross-Cutting)

| File Path | Change Type | Objective Description |
|:---|:---|:---|
| `src/6_translate/constants/TranslationConstants.ts` | Mod | Added `TRANSLATE_FULL_TEXT_BATCH: "/api/v1/translate/full-text-batch"` to endpoint enum |
| `src/6_translate/index.ts` | Mod | Added `export type { FullTextBatchApiRequest, FullTextBatchApiResponse }` |
| `src/6_translate/types/TranslationApiTypes.ts` | Mod | Added `FullTextBatchApiRequest` (texts, sourceLanguage, targetLanguage) and `FullTextBatchApiResponse` (translations, sourceLanguage, targetLanguage, optional usage breakdown) interfaces |

---

## 3. AI Generation Disclaimer & Risk Warnings

> **Important Note for Reviewer**:
> The code in this submission was generated by an AI assistant based on documentation and requirements. **Do not assume the code logic is correct.** All logic, edge cases, and side effects require independent verification.

### General Risks

- [ ] **Logical Consistency**: Verify that the code truly conforms to the rules in the requirements document, not just appears to.
- [ ] **Side Effects**: Check if modifications to existing files (`MessageRouter.ts`, `index.ts`, `generationLLM.service.ts`, `FragmentTranslation.service.ts`) break other existing features.
- [ ] **Edge Cases**: AI-generated code may ignore null values, invalid inputs, race conditions. Test these specifically.

### Feature-Specific Risk Items

#### Feature 1: Full-Page Translation Module

- [ ] **Race Condition — `translateText()` guards**: After `rateLimiter.acquire()` and `batchQueue.enqueue()`, the code checks `this.isRunning` and `this.walkId`. Verify these guards are sufficient if `stop()` is called mid-flight.
- [ ] **Memory Leak — `translatingNodes` WeakSet**: The `translatingNodes` WeakSet is only reset in `stop()`. Verify that elements referenced in the WeakSet are properly garbage-collected when removed from DOM by dynamic content changes.
- [ ] **DOM Walker — shadow DOM recursion**: `walkAndLabelElement` iterates `element.shadowRoot.children` but shadow DOM may have restricted access in some contexts. Verify error handling.
- [ ] **Spinner `:scope >` selector**: `removeSpinner()` uses `:scope > .${SPINNER_CLASS}` to only match direct-child spinners. Verify this works correctly in all browsers and doesn't orphan spinners if DOM structure changes during async translation.
- [ ] **`DomBatcher` singleton lifecycle**: `reset()` nulls the static instance, but in-flight `rAF` callbacks may still reference the old instance. Verify no stale references after `stop()`.
- [ ] **`TranslationCache` — IndexedDB in extension context**: Content scripts may have restricted IndexedDB access on certain pages (e.g., `chrome://` URLs). Verify the fallback behavior (returns null) is sufficient.
- [ ] **`DynamicContentObserver` — infinite loop risk**: If a mutation observer callback triggers DOM changes that generate new mutations, verify the `shouldSkip()` check prevents infinite loops (especially the `CONTENT_WRAPPER_CLASS` check).
- [ ] **`extractTranslationUnits` — flex parent detection**: The code checks `display.includes('flex')` which would match both `flex` and `inline-flex`. Verify this is intentional.
- [ ] **`TokenBucketRateLimiter` — negative tokens**: After `refill()`, if `this.tokens` is still < 1, the deficit calculation and wait time could be incorrect if multiple concurrent `acquire()` calls race. Verify thread-safety (single-threaded JS, but async interleaving possible).
- [ ] **`BatchQueue` — `executeBatch` retry on count mismatch only**: Non-retryable errors (network failures, etc.) immediately fall back to individual. Verify this policy is intentional and not too aggressive for transient network issues.
- [ ] **`walkAndLabelElement` — empty text check**: Step 8 returns early for empty `textContent` unless `forceBlock`. This might skip elements that only contain child elements with text (verify `textContent` includes descendant text).
- [ ] **Top-level paragraph filtering**: `filterTopLevelParagraphs()` walks ancestors to detect nested paragraphs. In deeply nested DOMs, this could be O(n*depth). Verify performance on complex pages.

#### Feature 2: Content/Background/Popup Integration

- [ ] **Popup TypeError safety**: `setupFullTranslateButton()` guards against undefined `response` from `sendMessage`. Verify the guard `if (!response || response.error)` handles all Chrome extension messaging edge cases (e.g., extension context invalidated).
- [ ] **Message forwarding — tab query race**: `MessageRouter` uses `chrome.tabs.query({ active: true, currentWindow: true })` which may return stale results. Verify behavior when user switches tabs rapidly.
- [ ] **`FULL_TRANSLATE_STATUS_REQUEST` returns sync `false`**: In `content/index.ts`, the listener returns `false` (synchronous) — but `handleStatusRequest` itself is synchronous, so this should be fine. Verify no async work is needed.
- [ ] **Ghost translation guards**: After `stop()`, in-flight async handlers might still call `sendResponse`. Verify the `canApplyTranslation()` check prevents rendering stale translations.
- [ ] **Content script lazy initialization**: `FullTranslateHandler` uses a module-level `let manager` variable. Verify this is safe across SPA navigations (no stale manager holding references to removed DOM).

#### Feature 3: Backend Batch Translation API

- [ ] **LLM separator `%%`**: The system prompt instructs the LLM to use `%%` as segment separator. If a user's text naturally contains `%%`, the parse logic would incorrectly split it. Verify handling or document as a known limitation.
- [ ] **`parseResponse()` regex fallback**: On JSON parse failure, the regex `/"translations"\s*:\s*"([\s\S]*?)"(?=\s*})` may fail on escaped quotes inside the translations string. Verify robustness.
- [ ] **One retry on count mismatch**: `FullTextBatchTranslationService.translateBatch()` retries only once on segment count mismatch (vs. 3 retries on the client side). Verify whether this asymmetry is intentional.
- [ ] **`translateBatch()` vs `translateFullTextBatch()` duality**: Two endpoints exist — `/batch` (N individual LLM calls) and `/full-text-batch` (1 LLM call). The extension only uses `/full-text-batch`. Verify whether `/batch` is needed or if it's dead code.
- [ ] **Rate limiter config**: Both batch endpoints use 10 req/30s. For full-page translation of large pages, this may be hit quickly. Verify whether the rate limit is sufficient.
- [ ] **Fallback in `translateFullTextBatch()`**: On any error (including validation errors), the try/catch falls back to individual `translateFragment()` calls. Verify this doesn't mask configuration errors that should be raised.
- [ ] **Environment variable fallback chain**: `getFullTextBatchTranslationConfig()` uses `ATLAS_CLOUD_MODEL_FAST || ATLAS_CLOUD_MODEL`. Verify these env vars exist in deployment configs.

#### Feature 4: Token Consumption Tracking

- [ ] **`TokenTracker` singleton — no persistence**: Token stats are in-memory only and lost on server restart. Verify this is acceptable for the current use case (monitoring, not billing).
- [ ] **`rawUsage` type assertion**: `completion.usage as any` bypasses TypeScript checking. Verify the OpenAI SDK's actual `usage` type to see if a safer cast is possible.
- [ ] **Usage propagation completeness**: `translateBatch()` aggregates usage from individual `translateFragment()` calls. Verify the aggregation is correct (sum of N individual calls) and that the response `totalUsage` field matches the frontend's expected `usage` field.
- [ ] **`generateWithUsage()` backward compatibility**: `generate()` now delegates to `generateWithUsage()`. Verify all existing callers of `generate()` are unaffected by the internal refactor.

---

## 4. Summary Statistics

| Metric | Count |
|:---|:---|
| Total files changed | 47 |
| New files | 26 |
| Modified files | 21 |
| Features | 5 (including cross-cutting types) |
| Bug fix items referenced | 4 (spinner `:scope >`, ghost translation guards, popup TypeError, dynamic root paragraph) |
| Risk checklist items | 30 |
| Repositories | 2 (`tapword-translator`, `translate-api`) |
| Lines added (approx.) | ~3,500 (src only, both repos) |
