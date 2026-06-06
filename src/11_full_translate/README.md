Last updated on: 2026-03-15

# 11_full_translate: Full-Page Translation Module

## Module Overview

This module implements full-page translation for the TapWord Translator Chrome extension. It walks the entire DOM tree, classifies elements as block or inline, lazily translates paragraphs as they enter the viewport, and renders bilingual or translation-only results. The architecture follows a **Walk → Observe → Batch → Render** pipeline optimized for performance through viewport-based lazy loading, batched API requests, token-bucket rate limiting, IndexedDB caching, and `requestAnimationFrame`-batched DOM writes.

## File Structure

```
11_full_translate/
├── README.md                           # This document
├── index.ts                            # Public API barrel — re-exports all types, constants, DOM, and utils
├── PageTranslationManager.ts           # Top-level orchestrator (lifecycle, pipeline coordination)
├── types/
│   └── index.ts                        # Core TypeScript type definitions
├── constants/
│   └── index.ts                        # Data attributes, CSS classes, tag sets, default values
├── dom/
│   ├── index.ts                        # DOM sub-module barrel exports
│   ├── filter.ts                       # Element classification (block/inline/skip detection)
│   ├── walker.ts                       # Recursive DOM walker — labels elements with data attributes
│   ├── renderer.ts                     # Dual-language renderer — inserts/removes translated content
│   └── translationWalker.ts            # Extracts translation units from labeled paragraphs
└── utils/
    ├── index.ts                        # Utils sub-module barrel exports
    ├── ViewportObserver.ts             # IntersectionObserver wrapper for lazy translation
    ├── DynamicContentObserver.ts       # MutationObserver wrapper for dynamically added content
    ├── DomBatcher.ts                   # Singleton rAF-based DOM write batcher
    ├── BatchQueue.ts                   # Accumulates texts and sends batched translation requests
    ├── TokenBucketRateLimiter.ts       # Token-bucket rate limiter for API throttling
    └── TranslationCache.ts            # IndexedDB-based translation cache (SHA-256 keyed)
```

## Architecture Overview

The module operates as a four-stage pipeline:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        PageTranslationManager                            │
│   (Orchestrator — lifecycle, config, session management)                 │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌─── Stage 1: WALK ─────────────────────────────────────────────┐     │
│   │  walker.ts (walkAndLabelElement)                               │     │
│   │  ┌──────────────────┐    ┌──────────────────────────────┐     │     │
│   │  │ filter.ts        │    │ Data Attributes Applied:     │     │     │
│   │  │ • block/inline?  │───▶│ • data-tapword-walked        │     │     │
│   │  │ • skip/translate?│    │ • data-tapword-paragraph     │     │     │
│   │  │ • force-block?   │    │ • data-tapword-block-node    │     │     │
│   │  └──────────────────┘    │ • data-tapword-inline-node   │     │     │
│   │                          └──────────────────────────────────┘   │     │
│   └────────────────────────────────────────────────────────────────┘     │
│                                    │                                     │
│                                    ▼                                     │
│   ┌─── Stage 2: OBSERVE ──────────────────────────────────────────┐     │
│   │  ViewportObserver (IntersectionObserver)                       │     │
│   │  • Watches labeled paragraphs; fires when within 600px margin  │     │
│   │                                                                │     │
│   │  DynamicContentObserver (MutationObserver)                     │     │
│   │  • Detects new/revealed elements → re-walks and observes       │     │
│   └────────────────────────────────────────────────────────────────┘     │
│                                    │                                     │
│                                    ▼                                     │
│   ┌─── Stage 3: BATCH ────────────────────────────────────────────┐     │
│   │  translationWalker.ts (extractTranslationUnits)                │     │
│   │  ┌──────────────────────────────────────────────────────────┐ │     │
│   │  │ TranslationCache  → cache hit? return immediately        │ │     │
│   │  │ TokenBucketRateLimiter → throttle API requests           │ │     │
│   │  │ BatchQueue → accumulate texts, flush as batched message  │ │     │
│   │  └──────────────────────────────────────────────────────────┘ │     │
│   └────────────────────────────────────────────────────────────────┘     │
│                                    │                                     │
│                                    ▼                                     │
│   ┌─── Stage 4: RENDER ──────────────────────────────────────────┐     │
│   │  renderer.ts (insertTranslation)                               │     │
│   │  ┌──────────────────────────────────────────────────────────┐ │     │
│   │  │ DomBatcher (rAF batching)                                │ │     │
│   │  │ • bilingual: append translated span after original        │ │     │
│   │  │ • translationOnly: replace original with translated       │ │     │
│   │  └──────────────────────────────────────────────────────────┘ │     │
│   └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Entry Point (`index.ts`)

The barrel file that provides the module's public API. All types, constants, DOM utilities, and util classes are explicitly re-exported from this file. External consumers (e.g., `FullTranslateHandler` in `1_content`) import from `@/11_full_translate` and never reach into sub-files directly.

### 2. PageTranslationManager (`PageTranslationManager.ts`)

The top-level orchestrator. Manages the full lifecycle of a page translation session:

- **`start()`**: Generates a unique `walkId` (UUID), walks the entire `document.body`, collects top-level paragraph elements, observes them with `ViewportObserver`, and starts `DynamicContentObserver` for mutation detection.
- **`stop()`**: Tears down all observers, clears the batch queue, removes all translated content and walk labels, and resets state.
- **`updateConfig()`**: Merges new config values and restarts the session if already running.

**Paragraph translation strategy** — when a paragraph enters the viewport, `PageTranslationManager` delegates to one of two branches:

| Condition | Branch | Behavior |
|---|---|---|
| No block children, OR `translationOnly` mode | `translateSimpleParagraph` | Extract full text → translate as one unit → insert result |
| Has block children AND `bilingual` mode | `translateMixedParagraph` | Extract inline groups as `TranslationUnit[]` → translate each unit separately → recurse into block children |

A `WeakSet<Element>` (`translatingNodes`) prevents duplicate processing of the same element.

### 3. DOM Processing (`dom/`)

#### 3.1 filter.ts — Element Classification

Pure functions that classify DOM nodes for the walker. Key decisions:

| Function | Purpose |
|---|---|
| `isShallowInlineHTMLElement` | Inline if: non-empty text, not a force-block tag, CSS display is inline-family. Also handles floating drop-cap letters. |
| `isShallowBlockHTMLElement` | Block if: force-block tag OR computed display is not inline-family. |
| `isDontWalkIntoButTranslateAsChildElement` | Skip walking children but include their text (e.g., `<code>`, `<time>`, `.notranslate`). |
| `isDontWalkIntoAndDontTranslateAsChildElement` | Exclude entirely: hidden elements, `aria-hidden`, screen-reader-only classes, `<script>`, `<style>`, SVG, MathML, and main-range ignored structural tags. |
| `isNumericContent` | Detects purely numeric strings (digits, commas, dots) that do not need translation. |
| `hasNoWalkAncestor` | Walks up the ancestor chain to detect if an element is inside a skip-zone. Used by `DynamicContentObserver`. |

#### 3.2 walker.ts — Recursive DOM Walker

`walkAndLabelElement(element, walkId, range)` performs a single recursive pass over the DOM:

1. Checks filter predicates to decide whether to enter the subtree.
2. Sets `data-tapword-walked=<walkId>` on every processed element for session tracking.
3. Handles Shadow DOM by recursing into `element.shadowRoot.children`.
4. Classifies each child: text nodes with content set `hasInlineNodeChild = true`; HTML children are recursed.
5. If any inline child was found, marks the element with `data-tapword-paragraph`.
6. Applies `data-tapword-block-node` or `data-tapword-inline-node` based on computed style and tag-based overrides.

`extractTextContent(node, range)` recursively extracts normalized text from a node subtree. Whitespace is normalized (leading/trailing spaces preserved as single spaces for word boundaries) and `<br>` is converted to `\n`.

#### 3.3 translationWalker.ts — Translation Unit Extraction

Once a paragraph is labeled, `extractTranslationUnits(element, range)` processes its children to produce `TranslationUnit[]`:

- Groups consecutive inline children (text nodes + inline elements) into units.
- Block children act as group boundaries — they flush the current inline group and are **not** included in units (processed recursively by the manager).
- **Flex parent detection**: If a paragraph has block children but its display is `flex`, `forceBlockTranslation` is set to `false` to avoid breaking flex layouts.
- `shouldTranslateParagraph(text, minChars, minWords)` validates text length and filters out purely numeric content.
- `collectBlockChildren(element)` returns direct block children for recursive processing.

#### 3.4 renderer.ts — DOM Insertion & Cleanup

Handles creating, inserting, and removing translated content:

- **`insertTranslation(element, text, mode, options?)`**: Creates a wrapper `<span>` with CSS class `tapword-translated-content-wrapper` containing the translated text. Determines inline vs. block insertion style based on tag, attributes, and computed CSS. Uses `DomBatcher` for rAF-batched writes.
  - **Bilingual mode**: Appends the wrapper after original content (or after a specific node for unit-level insertion).
  - **TranslationOnly mode**: Saves original `innerHTML` into a `Map`, then replaces content with the translation wrapper.
- **`removeAllTranslations()`**: Finds all wrappers, restores original content for translationOnly elements, and removes remaining wrappers.
- **`removeWalkLabels(root?)`**: Strips all `data-tapword-*` attributes from walked elements.
- **`createSpinner()` / `removeSpinner()`**: Loading indicators rendered inline via the Web Animations API.

### 4. Observers (`utils/`)

#### 4.1 ViewportObserver

Wraps `IntersectionObserver` with a configurable `rootMargin` (default 600px) and `threshold` (default 0.1). When a paragraph enters the expanded viewport:

1. The element is automatically unobserved (fire-once).
2. The `onEnterViewport` callback is invoked, triggering translation.

#### 4.2 DynamicContentObserver

Wraps `MutationObserver` to detect content added after the initial walk:

- **`childList` mutations**: Collects newly added HTML elements that haven't been walked yet and are not part of injected translation wrappers.
- **`attributes` mutations** (on `style`, `class`, `hidden`): Detects elements that transition from hidden to visible.
- **Shadow DOM**: Recursively discovers shadow roots on existing and new elements, setting up separate `MutationObserver` instances on each.

New elements are fed back to `PageTranslationManager.onNewContentDetected()`, which re-walks them and observes resulting paragraphs.

### 5. Translation Pipeline (`utils/`)

#### 5.1 BatchQueue

Accumulates translation text entries and sends them to the background service worker as batched messages:

- **Batching logic**: Flushes when the queue reaches `maxItemsPerBatch` (default 4) or `maxCharsPerBatch` (default 1000), or after a `batchDelayMs` timer (default 100ms).
- **Promise-per-entry**: Each `enqueue(text)` returns a `Promise<string>` that resolves individually when the batch response arrives.
- **Retry with backoff**: On `BatchCountMismatchError` (response count ≠ request count), retries up to 3 times with exponential backoff (1s, 2s, 4s, capped at 8s).
- **Individual fallback**: If all retries fail, falls back to sending each text as a separate single-item batch.

#### 5.2 TokenBucketRateLimiter

Classic token-bucket algorithm for throttling API calls:

- **Capacity**: 60 tokens (default). **Rate**: 8 tokens/second (default).
- `acquire()` consumes one token. If the bucket is empty, the caller awaits until a token is refilled based on elapsed time.
- Prevents overwhelming the backend when many paragraphs enter the viewport simultaneously.

#### 5.3 TranslationCache

IndexedDB-backed persistent cache:

- **Key**: SHA-256 hash of `text|sourceLang|targetLang`.
- **Lazy DB initialization**: Opens the database on first access.
- Checked before every translation request in `PageTranslationManager.translateText()`. Successful translations are stored immediately after receiving the response.

#### 5.4 DomBatcher

Singleton that batches DOM write operations via `requestAnimationFrame` to prevent layout thrashing:

- `queue(operation)` buffers a callback. A single `rAF` frame executes all queued operations.
- If new operations are queued during execution, another frame is scheduled.
- `reset()` destroys the singleton instance (used during `stop()`).

### 6. Types & Constants

#### Types (`types/index.ts`)

| Type | Purpose |
|---|---|
| `TransNode` | `HTMLElement \| Text` — any node participating in translation |
| `FullTranslateMode` | `"bilingual" \| "translationOnly"` — display mode |
| `PageTranslateRange` | `"main" \| "all"` — `"main"` skips header/footer/nav |
| `FullTranslateConfig` | Full configuration object (mode, range, preload, language, thresholds) |
| `PreloadConfig` | IntersectionObserver margin and threshold values |
| `WalkResult` | Return value of `walkAndLabelElement` — `{ forceBlock, isInlineNode }` |
| `ParagraphInfo` | A paragraph ready for translation (element + text + walkId) |
| `TranslationUnit` | A group of consecutive inline nodes with extracted text |
| `BatchTranslationItem` / `BatchTranslationResult` | Request/response types for batch API |

#### Constants (`constants/index.ts`)

- **Data attributes**: `WALKED_ATTRIBUTE`, `PARAGRAPH_ATTRIBUTE`, `BLOCK_ATTRIBUTE`, `INLINE_ATTRIBUTE`, plus `MARK_ATTRIBUTES` set for cleanup.
- **CSS classes**: `CONTENT_WRAPPER_CLASS`, `INLINE_CONTENT_CLASS`, `BLOCK_CONTENT_CLASS`, `NOTRANSLATE_CLASS`.
- **Tag classification sets**: `DONT_WALK_AND_TRANSLATE_TAGS` (script, style, SVG, MathML, etc.), `DONT_WALK_BUT_TRANSLATE_TAGS` (code, time), `FORCE_BLOCK_TAGS` (h1-h6, li, article, section, etc.), `FORCE_INLINE_TRANSLATION_TAGS` (a, button, span).
- **Default values**: Batch size/delay, rate limiter capacity/rate, preload margin/threshold, text filter thresholds.

## Data Flow

End-to-end journey of a single paragraph from initial DOM walk to rendered translation:

```
1. PageTranslationManager.start()
   └─▶ walkAndLabelElement(document.body)
       └─▶ Recursive pass: filter.ts classifies each element
           └─▶ Sets data-tapword-walked, data-tapword-paragraph,
               data-tapword-block-node, data-tapword-inline-node

2. collectParagraphs() → filterTopLevelParagraphs()
   └─▶ Only top-level [data-tapword-paragraph] elements

3. viewportObserver.observe(paragraph) for each paragraph

4. User scrolls → paragraph enters viewport (600px margin)
   └─▶ ViewportObserver fires onParagraphVisible(element)

5. translateElement(element)
   ├─▶ [Simple] translateSimpleParagraph(element)
   │   ├─▶ extractParagraphText() → "Hello world, this is a test."
   │   ├─▶ shouldTranslateParagraph() → true
   │   ├─▶ createSpinner() → append loading indicator
   │   └─▶ translateText(text)
   │       ├─▶ cache.get() → null (cache miss)
   │       ├─▶ rateLimiter.acquire() → wait if throttled
   │       ├─▶ batchQueue.enqueue(text) → Promise<string>
   │       │   └─▶ BatchQueue accumulates, then flushes:
   │       │       └─▶ chrome.runtime.sendMessage(FULL_TRANSLATE_BATCH_REQUEST)
   │       │           └─▶ Background: FullTranslateBatchHandler
   │       │               └─▶ translateFragment() for each text
   │       │               └─▶ Response: { success: true, translations: [...] }
   │       ├─▶ cache.set() → store in IndexedDB
   │       └─▶ return "你好世界，这是一个测试。"
   │
   ├─▶ removeSpinner()
   └─▶ insertTranslation(element, translation, mode)
       └─▶ DomBatcher.queue(() => append <span> wrapper to DOM)
           └─▶ Next rAF frame: DOM write executed

6. [Meanwhile] DynamicContentObserver detects new elements
   └─▶ onNewContentDetected() → walkAndObserve() → back to step 3
```

## Integration Points

This module does **not** communicate with external APIs directly. It relies on two integration handlers:

### Content Script: `FullTranslateHandler` (`1_content/handlers/`)

- Lives in the content script context.
- Receives toggle messages from the popup/background and calls `PageTranslationManager.start()` or `stop()`.
- Builds `FullTranslateConfig` from user settings (via `storageManager`) with sensible defaults.
- Lazily instantiates `PageTranslationManager` — only created on first toggle.

### Background Service Worker: `FullTranslateBatchHandler` (`2_background/handlers/`)

- Listens for `FULL_TRANSLATE_BATCH_REQUEST` messages sent by `BatchQueue` via `chrome.runtime.sendMessage`.
- Translates each text segment using the existing `translateFragment()` function from `6_translate`.
- Returns `{ success, translations[] }` to the content script. On individual segment failure, pushes an empty string and continues.

```
┌─────────────┐   toggle msg    ┌──────────────────────┐
│  3_popup /   │ ──────────────▶ │  FullTranslateHandler │
│  2_background│                 │  (1_content)          │
└─────────────┘                 └──────┬───────────────┘
                                       │ start() / stop()
                                       ▼
                                ┌──────────────────────┐
                                │ PageTranslationManager│
                                │ (11_full_translate)   │
                                └──────┬───────────────┘
                                       │ chrome.runtime.sendMessage
                                       ▼
                                ┌───────────────────────────┐
                                │ FullTranslateBatchHandler  │
                                │ (2_background)             │
                                │ └─▶ translateFragment()    │
                                │     (6_translate)          │
                                └───────────────────────────┘
```

## Key Design Decisions

### 1. Recursive Translation for Mixed Paragraphs

When a paragraph contains both inline text **and** block children (e.g., a `<div>` with a `<p>` inside), the manager uses `translateMixedParagraph`:
- Inline groups between block boundaries are translated as separate `TranslationUnit` entries and inserted at the correct DOM positions.
- Block children are recursively processed via `translateElement()`, each as an independent paragraph.
- All operations run concurrently via `Promise.all`.

This preserves document structure while ensuring every piece of visible text receives a translation.

### 2. TranslationOnly Fallback

When `mode === "translationOnly"` and a paragraph has mixed block + inline children, the manager falls back to the **simple paragraph** branch (translating the full text as one unit). This avoids the complexity of replacing individual inline groups within a mixed layout, where the original/translated boundary would be ambiguous.

### 3. Flex Parent Detection

`extractTranslationUnits` checks if a paragraph with block children has `display: flex`. In a flex container, block children are laid out horizontally alongside inline items. Setting `forceBlockTranslation = false` in this case prevents inserting `<br>` separators that would break the flex layout.

### 4. Batch Count Retry with Individual Fallback

The LLM backend may occasionally return a different number of translations than requested. `BatchQueue.executeBatch` handles this via:

1. **Detection**: `BatchCountMismatchError` thrown when `response.translations.length !== request.texts.length`.
2. **Retry**: Up to 3 retries with exponential backoff (1s → 2s → 4s, max 8s).
3. **Fallback**: After all retries fail, each text is sent as a separate single-item request via `fallbackToIndividual()`.

This guarantees every paragraph eventually gets a translation response, even with unreliable batch responses.

### 5. Top-Level Paragraph Filtering

After walking, `filterTopLevelParagraphs()` removes any paragraph that has an ancestor paragraph within the same walk session. Only top-level paragraphs are observed by `ViewportObserver`. Nested paragraphs are handled via recursive `translateElement()` calls, preventing duplicate translations.

### 6. Session-Based Walk ID

Each `start()` generates a unique UUID stored as `walkId`. Every walked element is stamped with this ID in `data-tapword-walked`. This enables:
- **Session isolation**: Stale elements from a previous session are ignored.
- **Guard clauses**: `translateElement` exits early if the element's walk ID doesn't match the current session.
- **Clean teardown**: `removeWalkLabels()` strips all attributes from elements of the current session.

### 7. rAF-Based DOM Write Batching

All DOM mutations (inserting translations, removing wrappers, stripping labels) are funneled through the `DomBatcher` singleton, which coalesces writes into a single `requestAnimationFrame` callback. This prevents layout thrashing when many paragraphs are translated in quick succession.
