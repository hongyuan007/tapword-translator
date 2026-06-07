# Product Requirements Document & Technical Specification: Full-Text Translation

## 1. Overview & Feature Requirements

### 1.1 Objective
Introduce a "Full-Text Translation" feature to provide paragraph-level, full-page translation capabilities. This will act as a sibling feature to the existing word/phrase translation, allowing users to consume entire web pages in a dual-language (original + translated text) format. 

### 1.2 Core Capabilities & Functional Requirements
1. **Smart DOM Block & Paragraph Detection**: Accurately segment a webpage into translatable paragraphs. Must strictly ignore non-content elements (e.g., `<script>`, `<style>`, `<code>`, `<svg>`) and distinguish between block and inline text nodes.
2. **Viewport-Based Lazy Translation**: To minimize API usage and improve performance, translation must be deferred until the target text is approaching or within the user's viewport, utilizing `IntersectionObserver`.
3. **Dynamic Content & SPA Handling**: Dynamically loaded content, infinite scroll sections, and Single Page Application (SPA) navigations must be seamlessly supported via `MutationObserver` and History API monkey-patching.
4. **Text Node Injection Strategy**: Translations must be injected as dual-language text directly into the DOM (e.g., adding a translated `<span>` below or beside the original text) without destroying native event listeners, React/Vue hydration boundaries, or complex website layouts.
5. **Request Batching & Local Caching**: Text blocks must be grouped into batched API requests to reduce network overhead and avoid hitting backend rate limits. Translations must be locally cached in the browser via `IndexedDB` to ensure instantaneous rendering on revisit or re-translation.

### 1.3 Non-Functional Requirements
- **Performance**: DOM traversal and mutation must be highly optimized, utilizing techniques such as `requestAnimationFrame` batching to prevent main-thread blocking and layout thrashing.
- **Resilience**: The extension must handle heavily nested structures and shadow DOM boundaries securely without causing infinite loops.

---

## 2. Current State Analysis

### 2.1 Existing Architecture
Currently, the TapWord Translator operates primarily on user-selected or pinpointed text ranges:
- **`src/1_content/`**: Relies on specific interaction handlers (`InputListener`, `TranslationPipeline`) to capture `Range` objects or point coordinates. DOM modifications are focused on rendering floating tooltips and localized underlines using `translationDisplayV2.ts`.
- **`src/6_translate/`**: Contains core business logic (`TranslationService.ts`) for single words or smaller fragments (`translateWord`, `translateFragment`).
- **`src/2_background/`**: Forwards individual API requests from the content script to cloud translation services or local LLMs.

### 2.2 Gaps for Full-Text Translation
1. **DOM Traversal Model**: We currently lack a top-down document-level DOM crawler that can classify all text nodes on a page into translatable "blocks".
2. **Asynchronous Observation**: The existing `SpaNavigationHandler` detects SPA changes but lacks continuous `childList` or `attributes` mutation tracking for infinite scrolling. We also have no viewport monitoring (`IntersectionObserver`).
3. **Translation Render Model**: The current underline + tooltip UI is not suitable for full-page translations. We need an inline node-insertion mechanism (dual-language display).
4. **API Limitations**: We do not currently batch large volumes of text nodes into single requests with separators. Rate limiters and batch queues must be introduced.

---

## 3. Proposed Changes (Files & Logic Architecture)

To implement Full-Text Translation efficiently, we will adopt a "Walk-Observe-Batch-Render" architecture pattern.

### 3.1 New Full-Text Content Module (`src/11_full_translate/`)

To keep concerns strictly separated from the existing point/range translation logic (`src/1_content/`), we will create a dedicated top-level module injected as a content script for full-page translations.

1. **`DomWalker.ts` (DOM Traversal & Labeling)**:
    - Recursively walks the DOM tree (including Shadow Roots) starting from `document.body`.
    - Skips explicitly ignored tags (`SCRIPT`, `STYLE`, `CODE`, etc.) and visually hidden elements (`display: none`).
    - Classifies remaining elements as "blocks" or "inline" elements using computed CSS rules (`getComputedStyle`).
    - Groups consecutive text and inline nodes into single "paragraph" units.
    - Applies custom `data-tapword-walked` ID attributes to track processed elements per translation session.

2. **`ViewportObserver.ts` (Lazy Evaluation)**:
    - Wraps an `IntersectionObserver` with a configurable `rootMargin` (e.g., `600px`).
    - Elements labeled as paragraphs by the `DomWalker` are observed.
    - When intersecting, the paragraph is dispatched for translation.

3. **`DynamicContentObserver.ts` (Mutations)**:
    - Wraps a `MutationObserver` listening to `childList` and `attributes` on the `document.body`.
    - Detects new nodes (infinite scroll) or nodes becoming visible, feeding them back into the `DomWalker`.

4. **`DualLanguageRenderer.ts` (DOM Insertion)**:
    - Safely inserts translated text back into the DOM.
    - **Inline Strategy**: Injects `<span> Translated text</span>` next to the original inline elements.
    - **Block Strategy**: Injects `<br><span>Translated block</span>` within the original block container.
    - Batches all DOM writes via `requestAnimationFrame` using a centralized DOM Batching utility to prevent layout thrashing.

### 3.2 Background & Messaging (`src/2_background/`)

1. **`TranslationQueueManager.ts` (Rate Limiting & Batching)**:
    - Introduces a new background service to handle high-volume text translation requests.
    - Implements a `BatchQueue`: Accumulates strings from the content script (e.g., joining them with a special separator like `⟨⟩`), triggering the actual network request only when a character limit or small delay (e.g., 100ms) is reached.
    - Implements a `TokenBucketRateLimiter`: Enforces a maximum number of requests per second based on the active backend provider's limits.

### 3.3 Translation Module (`src/6_translate/`)

1. **IndexedDB Caching**:
    - Add a new local cache layer using `Dexie.js` or standard IndexedDB API.
    - Cache translations keyed by an SHA-256 hash of: `[Original Text + Source Lang + Target Lang + Provider]`.
    - Check the cache *before* placing texts into the `BatchQueue`.

2. **`TranslationService.ts` Updates**:
    - Extend `translateFragment` or add a new `translateBatch` method to handle array-based inputs or separator-delimited strings, returning segmented arrays to the caller.

---

## 4. Verification Plan

### 4.1 Unit Testing (Vitest)
- **`DomWalker` Tests**: Feed complex, mocked DOM trees (containing mixed blocks, scripts, and inline tags) and assert that the correct text nodes are extracted and non-content elements are skipped.
- **`BatchQueue` & `RateLimiter` Tests**: Simulate concurrent translation requests from a content script; assert that they are grouped correctly and dispatched according to the token bucket delays.
- **`TextInjection` Tests**: Verify that appending spans inside paragraphs does not remove original DOM structure or alter existing standard attributes.

### 4.2 End-to-End Testing (Playwright)
- **Viewport Lazy Loading test**: Load a long page, assert only the first few visible paragraphs are translated. Scroll down, assert new translation requests are fired.
- **SPA Dynamics test**: Navigate to a mocked React application. Click a button to load a new tab, assert the new dynamic text is instantly picked up and translated without user intervention.
- **Dual-Language Visual test**: Take screenshots or assert text content on a standard article page to ensure the original English text and translated target text are both visually correct and formatted consistently.
