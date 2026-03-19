# Full-Text Translation Progress Tracking

## Milestones

- [x] **Analysis Phase**
  - [x] Research architectural patterns (DOM walking, lazy translation, dynamic content handling).
  - [x] Write Product Requirements Document and Technical Specification.
  - [x] Analyze Read Frog architecture.
  - [x] Document current word/phrase architecture.

- [x] **Implementation Phase**
  - [x] **Step 1: Foundation Types and Constants** — Define core types, constants (skip tags, data attribute names, force-block tags), and module index.
  - [x] **Step 2: DOM Walker and Block Detector** — Recursive DOM traversal, block/inline detection via computed CSS, paragraph labeling with data attributes, shadow DOM support.
  - [x] **Step 3: Viewport Observer** — IntersectionObserver wrapper with configurable rootMargin for lazy translation triggering.
  - [x] **Step 4: Dynamic Content Observer** — MutationObserver for childList/attributes changes, feeding new nodes into DOM Walker.
  - [x] **Step 5: DOM Batcher Utility** — requestAnimationFrame-based DOM write batching to prevent layout thrashing.
  - [x] **Step 6: Dual-Language Renderer** — DOM insertion of translated text (inline and block strategies), cleanup/restore, translation styling.
  - [x] **Step 7: Message Types and Background Handler** — New MessageType for batch translation, request/response interfaces, MessageRouter case, new handler in background.
  - [x] **Step 8: Batch Translation Service** — translateBatch method in 6_translate, backend API endpoint definition.
  - [x] **Step 9: Translation Queue with Batch and Rate Limit** — BatchQueue with separator, TokenBucketRateLimiter for background service worker.
  - [x] **Step 10: IndexedDB Translation Cache** — SHA-256 hash-based cache keyed by text+lang+provider, cache-before-enqueue pattern.
  - [x] **Step 11: PageTranslationManager Orchestrator** — Top-level class coordinating Walker, Observers, Queue, and Renderer.
  - [x] **Step 12: Integration and Content Script Wiring** — Wire PageTranslationManager into content script, add popup/keyboard trigger, update manifest if needed.

- [x] **P0 Bug Fixes: Recursive Nested Paragraph Translation** (2026-03-16)
  - [x] P0-1: Recursive block-child translation — `translateElement` recurses into block children instead of skipping them.
  - [x] P0-2: Flex parent detection — `extractTranslationUnits` computes `isFlexParent` to preserve flex layouts.
  - [x] P0-3: `forceBlockTranslation` flag — inline groups sibling to block children use block-style insertion in non-flex parents.
  - [x] `types/index.ts`: Added `TranslationUnit` interface with `forceBlockTranslation` field.
  - [x] `dom/translationWalker.ts`: Block detection, flex check, `collectBlockChildren()`, updated `flushInlineGroup`.
  - [x] `dom/renderer.ts`: `InsertTranslationOptions` type, per-unit `insertAfterNode` insertion, `forceBlockTranslation` override.
  - [x] `dom/index.ts`: Exports `collectBlockChildren` and `InsertTranslationOptions`.
  - [x] `PageTranslationManager.ts`: Recursive `translateElement` / `translateSimpleParagraph` / `translateMixedParagraph` / `translateUnit` / `translateText`.

- [x] **P0 Bug Fix: Persistent Spinner on Nested Paragraphs** (2026-03-15)
  - [x] `removeSpinner` used `querySelector` which searched the entire subtree, causing it to find a child's spinner instead of its own direct-child spinner in nested paragraph scenarios. Changed to `:scope > .${SPINNER_CLASS}` to select only direct children.

- [x] **Logging Optimization** (2026-03-15)
  - [x] Removed ~84% of per-item debug/info logs (investigation artifacts, redundant breadcrumbs).
  - [x] Downgraded `onParagraphVisible` and `translateMixedParagraph start` to `debug`.
  - [x] Added aggregate `stats` counter with periodic `[progress]` summary every 20 paragraphs.
  - [x] Downgraded `BatchQueue` flush/success logs to `debug`; removed per-item enqueue/split/response logs.
  - [x] Downgraded `FullTranslateBatchHandler` request log to `debug`; removed per-segment index logs.
  - [x] All warn/error logs preserved for debugging capability.

- [ ] **Testing and Verification**
  - [x] Type-check passes across all modified modules.
  - [ ] Write unit tests for DOM analysis and batching.
  - [ ] Write E2E Playwright tests for lazy loading and SPA handling.
