# Code Change Handoff Manifest — Full-Page Translation

## 1. Change Context

### Related Documents
- `docs/plan/y2026/m03-full-translate/progress.md` (Progress tracker)
- `docs/plan/y2026/m03-full-translate/analysis/260315_dom_walker_research.md` (DOM walker design research)
- `docs/plan/y2026/m03-full-translate/analysis/260315_batch_translation_and_queues_research.md` (Batch queue research)
- `docs/plan/y2026/m03-full-translate/analysis/260315_observers_and_orchestration_research.md` (Observers & orchestration research)
- `docs/plan/y2026/m03-full-translate/analysis/260316_p0_recursive_translation_spec.md` (P0 recursive translation spec)
- `docs/plan/y2026/m03-full-translate/analysis/260317_token_tracking_spec.md` (Token tracking spec)

### Task Objectives
This changeset attempted to implement two end-to-end features across the **tapword-translator** extension and the **translate-api** backend:

1. **Full-Page Translation (tapword-translator)**: A new `src/11_full_translate/` module that walks the DOM tree, classifies elements as block/inline, observes elements entering the viewport, batches translation requests, renders bilingual or translation-only output, and handles dynamic content mutations. The popup gains a "Translate Page" toggle button.

2. **Backend Batch Translation API (translate-api)**: A new `POST /api/v1/translate/batch` endpoint that accepts an array of texts and translates them concurrently via `Promise.allSettled`. Additionally, token consumption tracking was added via a `TokenTracker` singleton and a new `generateWithUsage()` method on the LLM service layer.

---

## 2. File Change Audit

### Repository: `tapword-translator`

| File Path | Change Type | Objective Description |
| :--- | :--- | :--- |
| `src/0_common/types/index.ts` | Mod | Added `FullTranslateToggleMessage`, `FullTranslateToggleResponseMessage`, `FullTranslateBatchRequestData`, `FullTranslateBatchRequestMessage`, `FullTranslateBatchResponseMessage` types, and added `"FULL_TRANSLATE_TOGGLE"` / `"FULL_TRANSLATE_BATCH_REQUEST"` to `MessageType` union |
| `src/0_common/locales/*.json` (×8) | Mod | Added i18n keys: `popup.translatePage.label`, `popup.translatePage.stop`, `popup.translatePage.loading` |
| `src/11_full_translate/types/index.ts` | New | Type definitions: `TransNode`, `FullTranslateMode`, `PageTranslateRange`, `FullTranslateConfig`, `PreloadConfig`, `WalkResult`, `ParagraphInfo`, `TranslationUnit`, `BatchTranslationItem`, `BatchTranslationResult`, etc. |
| `src/11_full_translate/constants/index.ts` | New | Constants: data attributes (`WALKED_ATTRIBUTE`, `PARAGRAPH_ATTRIBUTE`, `BLOCK_ATTRIBUTE`, `INLINE_ATTRIBUTE`), CSS classes, tag classification sets (`DONT_WALK_AND_TRANSLATE_TAGS`, `DONT_WALK_BUT_TRANSLATE_TAGS`, `FORCE_BLOCK_TAGS`, `FORCE_INLINE_TRANSLATION_TAGS`), site-specific selectors for YouTube/GitHub/Discord/ChatGPT, batch queue defaults, rate limiter defaults |
| `src/11_full_translate/dom/filter.ts` | New | DOM filter functions: `isHTMLElement`, `isTextNode`, `isShallowInlineHTMLElement`, `isShallowBlockHTMLElement`, `isDontWalkIntoButTranslateAsChildElement`, `isDontWalkIntoAndDontTranslateAsChildElement`, `isCustomDontWalkIntoElement`, `isCustomForceBlockTranslation`, `isTranslatedWrapperNode`, `isNumericContent`, `hasNoWalkAncestor`. Includes drop-cap detection and "main content" mode filtering |
| `src/11_full_translate/dom/walker.ts` | New | Recursive DOM walker `walkAndLabelElement()` — labels elements with `data-tapword-*` attributes based on block/inline classification. Also `extractTextContent()` with whitespace normalization. Handles shadow DOM children |
| `src/11_full_translate/dom/translationWalker.ts` | New | `extractTranslationUnits()` groups consecutive inline children into `TranslationUnit[]`. `extractParagraphText()` joins unit texts. `shouldTranslateParagraph()` filters by min chars/words. `collectBlockChildren()` collects direct block children for recursive processing. Includes P0 flex-parent detection for `forceBlockTranslation` flag |
| `src/11_full_translate/dom/renderer.ts` | New | `insertTranslation()` renders bilingual or translationOnly output via `DomBatcher`. `removeAllTranslations()` cleans up injected wrappers. `removeWalkLabels()` removes data attributes. `createSpinner()` / `removeSpinner()` manage loading indicators. `removeSpinner` uses `:scope >` selector to target only direct-child spinners, preventing subtree interference (bug fix) |
| `src/11_full_translate/dom/index.ts` | New | Barrel re-export for all DOM sub-modules (filter, walker, translationWalker, renderer) |
| `src/11_full_translate/utils/BatchQueue.ts` | New | Accumulates translation requests and sends as batches to background via `chrome.runtime.sendMessage`. Returns `Promise<string>` per enqueue. Splits into sub-batches by `maxItemsPerBatch` / `maxCharsPerBatch`. Retry logic with exponential backoff on `BatchCountMismatchError`. Falls back to individual `sendSingleTranslation` on exhausted retries |
| `src/11_full_translate/utils/DomBatcher.ts` | New | Singleton that coalesces DOM write operations into `requestAnimationFrame` batches to prevent layout thrashing |
| `src/11_full_translate/utils/ViewportObserver.ts` | New | Wraps `IntersectionObserver` with configurable `rootMargin` and `threshold`. Calls `onEnterViewport` callback then unobserves the element (one-shot per paragraph) |
| `src/11_full_translate/utils/DynamicContentObserver.ts` | New | Wraps `MutationObserver` (`childList + subtree + attributes`). Detects newly added or revealed elements. Skips already-walked elements and translated wrappers. Also observes shadow roots recursively |
| `src/11_full_translate/utils/TokenBucketRateLimiter.ts` | New | Token bucket rate limiter: `acquire()` returns a promise that resolves when a token is available. Defaults: 8 tokens/sec, 60 capacity |
| `src/11_full_translate/utils/TranslationCache.ts` | New | IndexedDB-based(`tapword-translation-cache`) cache. Key = SHA-256 hash of `text|sourceLang|targetLang`. Lazy singleton `IDBDatabase` |
| `src/11_full_translate/utils/index.ts` | New | Barrel re-export for utils |
| `src/11_full_translate/index.ts` | New | Module barrel file — exports all types, constants, DOM functions, utils, and `PageTranslationManager` |
| `src/11_full_translate/PageTranslationManager.ts` | New | Top-level orchestrator. `start()`: generates walkId, creates `BatchQueue`/`ViewportObserver`/`DynamicContentObserver`, walks DOM, collects top-level paragraphs, observes them. `stop()`: disconnects observers, clears queue, removes translations/labels. `translateElement()`: recursive — simple paragraphs get translated as one unit; mixed (block+inline) paragraphs extract `TranslationUnit[]` and recurse into block children. `translateText()`: cache → rate-limit → `BatchQueue.enqueue()`. `filterTopLevelParagraphs()`: prevents nested paragraph double-processing. Logs aggregate progress every 20 paragraphs |
| `src/11_full_translate/README.md` | New | Module documentation |
| `src/1_content/handlers/FullTranslateHandler.ts` | New | Manages `PageTranslationManager` lifecycle. `handleToggle(enabled, sendResponse)`: lazily creates manager, calls `start()`/`stop()`. Reads `targetLanguage` from user settings via `storageManager` |
| `src/1_content/index.ts` | Mod | Added `chrome.runtime.onMessage` listener for `FULL_TRANSLATE_TOGGLE` message, delegating to `fullTranslateHandler.handleToggle()` |
| `src/2_background/handlers/FullTranslateBatchHandler.ts` | New | Handles `FULL_TRANSLATE_BATCH_REQUEST` messages. Iterates over `data.texts`, calls `translateModule.translateFragment()` sequentially, pushes empty string on individual failure. Returns `{ success, translations }` |
| `src/2_background/messaging/MessageRouter.ts` | Mod | Added case `"FULL_TRANSLATE_BATCH_REQUEST"` routing to `FullTranslateBatchHandler`. Added case `"FULL_TRANSLATE_TOGGLE"` that forwards the message to the active tab's content script via `chrome.tabs.sendMessage()` |
| `src/3_popup/index.html` | Mod | Added `<div class="full-translate-action">` section with a `<button id="fullTranslateButton">` containing a globe SVG icon and i18n-keyed label |
| `src/3_popup/index.ts` | Mod | Added `setupFullTranslateButton()` — toggle behavior with `is-loading` / `is-active` CSS states. Sends `FULL_TRANSLATE_TOGGLE` message via `chrome.runtime.sendMessage()`. Added `updateButtonState()` helper |
| `src/3_popup/styles/popup.css` | Mod | Added `.full-translate-action`, `.full-translate-button` styles with gradient, hover/active states, `is-loading` spinner keyframe animation, `is-active` green state |

### Repository: `translate-api`

| File Path | Change Type | Objective Description |
| :--- | :--- | :--- |
| `src/7_generate/types/generate.d.ts` | Mod | Added `TokenUsage` interface (`promptTokens`, `completionTokens`, `totalTokens`) and `GenerationResult` interface (`content`, `usage: TokenUsage \| null`) |
| `src/7_generate/services/llm/TokenTracker.ts` | New | In-memory singleton that accumulates token consumption across all LLM calls since server start. `record(usage)` increments counters. `getStats()` returns aggregated totals + uptime. `reset()` for testing |
| `src/7_generate/services/llm/generationLLM.service.ts` | Mod | Added `generateWithUsage()` method that returns `GenerationResult` (content + token usage). Extracts `prompt_tokens`, `completion_tokens`, `total_tokens` from OpenAI response `usage` field. Records usage in `TokenTracker.getInstance()`. Refactored existing `generate()` to delegate to `generateWithUsage()` and return only content |
| `src/7_generate/services/FragmentTranslation.service.ts` | Mod | Changed to call `this.client.generateWithUsage(messages)` instead of `this.client.generate(messages)`. Passes `usage` through in `FragmentTranslationResult` |
| `src/1_translate/types/translation.d.ts` | Mod | Added `usage` optional field to `FragmentTranslationResponse`. Added `BatchTranslationRequest` (`texts[]`, `sourceLanguage`, `targetLanguage`) and `BatchTranslationResponse` (`translations[]`, `sourceLanguage`, `targetLanguage`, `totalUsage?`) interfaces |
| `src/1_translate/services/translation.service.ts` | Mod | Added `translateBatch()` function — maps texts to `translateFragment()` calls via `Promise.allSettled`, aggregates `totalUsage` token counts across fulfilled results, returns `BatchTranslationResponse`. Also added `usage` passthrough in existing `translateFragment()` response |
| `src/1_translate/controllers/translation.controller.ts` | Mod | Added `translateBatchHandler()` — validates `texts` array (non-empty, max 10, each non-empty string, total ≤ 5000 chars), validates `sourceLanguage`/`targetLanguage` required, calls `translationService.translateBatch()` |
| `src/1_translate/routes/index.ts` | Mod | Added `POST /batch` route with `jwtMiddleware`, `versionCheckMiddleware`, and `batchTranslateRateLimiter` (10 req / 30 sec). Route handler: `translationController.translateBatchHandler` |

---

## 3. AI Generation Disclaimer & Risk Warnings

> **Important Note for Reviewer**:
> The code in this submission was generated by an AI assistant based on documentation. **Do not assume the code logic is correct.**

You need to prioritize reviewing the following potential risk points:

### General
- [ ] **Logical Consistency**: Verify the code conforms to the requirements documents and research specs listed above, not just that it appears to.
- [ ] **Side Effects**: Verify modifications to existing files (`MessageRouter.ts`, `index.ts`, `generationLLM.service.ts`) do not break existing functionality.
- [ ] **Edge Cases**: AI-generated code may ignore null values, empty arrays, concurrent state mutations, etc.

### tapword-translator — DOM Walking & Translation
- [ ] **Recursive Translation Interactions**: `translateElement()` recurses into children for non-paragraph elements and into block children for mixed paragraphs. Verify no infinite loops or double-processing can occur (the `translatingNodes` WeakSet guards against re-entry on the same element, but nested paragraph scenarios may be complex).
- [ ] **`filterTopLevelParagraphs()` Correctness**: This walks the ancestor chain to exclude nested paragraphs. Confirm it handles deep nesting and edge cases where `PARAGRAPH_ATTRIBUTE` is set at multiple levels.
- [ ] **Spinner Removal with `:scope >`**: The `removeSpinner()` function uses `paragraphElement.querySelector(':scope > .tapword-translate-spinner')` to only remove direct-child spinners. Verify this correctly prevents removing spinners from nested paragraph children in mixed-content scenarios.
- [ ] **`forceBlockTranslation` Logic (P0 fix)**: In `extractTranslationUnits()`, `forceBlock = hasBlockChild && !isFlexParent`. Verify this correctly handles flex containers (where block children should be treated as inline) vs. normal flow containers.
- [ ] **Shadow DOM Handling**: Both `walkAndLabelElement()` and `DynamicContentObserver` attempt to handle shadow roots. Verify cross-shadow-DOM element references work correctly with `IntersectionObserver` and `MutationObserver`.
- [ ] **`DomBatcher` Singleton Reset**: `DomBatcher.reset()` sets `instance = null`. Verify no operations are in-flight or queued in `requestAnimationFrame` at the time of reset that could cause stale references.
- [ ] **`TranslationCache` SHA-256**: Uses `crypto.subtle.digest` which is async. In the content script context, verify this is available (requires secure context / HTTPS pages). HTTP pages may fail.
- [ ] **Site-Specific Selectors**: `CUSTOM_DONT_WALK_SELECTORS` and `CUSTOM_FORCE_BLOCK_SELECTORS` are hardcoded for specific hostnames. These may become stale as sites update their DOM structure.

### tapword-translator — BatchQueue & Message Flow
- [ ] **`BatchQueue.executeBatch()` Retry Logic**: Retries only on `BatchCountMismatchError`. Verify the count mismatch scenario is realistic and that non-retryable errors properly fall through to `fallbackToIndividual`.
- [ ] **`sendSingleTranslation()` Uses Callback-Based `sendMessage`**: Unlike `executeBatch()` which awaits `sendMessage`, `sendSingleTranslation()` uses the callback form. Verify both patterns work correctly in Chrome extension messaging.
- [ ] **Sequential Processing in `FullTranslateBatchHandler`**: The background handler uses a `for` loop (sequential) to translate each text, not `Promise.allSettled`. This means a batch of 4 texts waits for each to complete before starting the next. Verify this is intentional and whether concurrency would be preferable.
- [ ] **Message Routing for `FULL_TRANSLATE_TOGGLE`**: The background `MessageRouter` forwards this message to the active tab via `chrome.tabs.sendMessage`. Verify this works when the popup sends the message (popup → background → content script). Confirm there are no race conditions if the user clicks rapidly.

### tapword-translator — Popup UI
- [ ] **Button State Management**: `setupFullTranslateButton()` uses a local `isRunning` variable. If the popup is closed and reopened, the button state resets to "not running" even if translation is still active on the page. Verify if this is acceptable or if state persistence is needed.
- [ ] **`is-loading` / `is-active` CSS Class Conflicts**: Verify the CSS transitions and class toggling do not produce visual glitches if the response is very fast or if the user double-clicks.

### translate-api — Batch Endpoint
- [ ] **Validation Boundary**: `BATCH_MAX_TEXTS = 10` and `BATCH_MAX_TOTAL_CHARS = 5000` are hardcoded constants at the controller level. The extension's `DEFAULT_MAX_ITEMS_PER_BATCH = 4` and `DEFAULT_MAX_CHARS_PER_BATCH = 1000` are separate. Verify these limits are aligned and that the extension never sends a batch exceeding backend limits.
- [ ] **`Promise.allSettled` Concurrency**: `translateBatch()` calls `translateFragment` concurrently for all texts. Under high load with large batches, this may create burst token consumption. Verify the rate limiter at the route level (10 req / 30 sec) is sufficient.
- [ ] **Token Usage Aggregation**: `totalUsage` is summed across fulfilled results. Verify that when some results are rejected and lack `.usage`, the aggregation logic correctly skips them (it checks `result.status === "fulfilled" && result.value.usage`).
- [ ] **Error Handling Granularity**: Failed individual translations in `translateBatch()` return empty string `""`. The caller (extension) receives `translations[]` with some entries as `""`. Verify the extension handles empty translations gracefully and does not render empty translation wrappers.

### translate-api — Token Tracking
- [ ] **`TokenTracker` Singleton Lifecycle**: The singleton persists in-memory for the server lifetime. Verify no memory leak implications and that `getStats()` / `reset()` work correctly under concurrent requests.
- [ ] **`rawUsage` Type Safety**: `const rawUsage = completion.usage as any` — the OpenAI SDK's `usage` object field names (`prompt_tokens`, `completion_tokens`, `total_tokens`) are accessed with `|| 0` fallback. Verify these field names match the actual SDK response structure for the configured model provider.
- [ ] **`generate()` → `generateWithUsage()` Refactor**: The existing `generate()` now delegates to `generateWithUsage()`. Verify all existing callers of `generate()` (beyond `FragmentTranslation.service.ts`) are unaffected by this change — the return type is still `Promise<string>`.
