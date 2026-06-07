# Read-Frog: Observers & Orchestration Research

> **Source Project**: `/Users/hongyuan/project/read-frog`  
> **Date**: 2026-03-15  
> **Purpose**: Analyze read-frog's viewport observation (IntersectionObserver), dynamic content observation (MutationObserver), DOM batching, and PageTranslationManager orchestration logic for adaptation into TapWord's full-page translation feature.

---

## Table of Contents

1. [PageTranslationManager — Complete Lifecycle](#1-pagetranslationmanager--complete-lifecycle)
2. [IntersectionObserver Details](#2-intersectionobserver-details)
3. [MutationObserver Details](#3-mutationobserver-details)
4. [Translation Walker (translateWalkedElement)](#4-translation-walker-translatewalkedelement)
5. [Translation Text Flow](#5-translation-text-flow)
6. [DOMBatcher](#6-dombatcher)
7. [Translation Insertion (Rendering)](#7-translation-insertion-rendering)
8. [Translation Cleanup](#8-translation-cleanup)
9. [SPA / URL Change Handling](#9-spa--url-change-handling)
10. [Key Adaptation Notes for TapWord](#10-key-adaptation-notes-for-tapword)

---

## 1. PageTranslationManager — Complete Lifecycle

**File**: `src/entrypoints/host.content/translation-control/page-translation.ts`

### 1.1 Constructor and Fields

```typescript
export class PageTranslationManager implements IPageTranslationManager {
  // Static configuration
  private static readonly MAX_DURATION = 500              // Touch trigger max duration
  private static readonly MOVE_THRESHOLD = 30 * 30        // Touch move threshold (squared)
  private static readonly DEFAULT_INTERSECTION_OPTIONS: SimpleIntersectionOptions = {
    root: null,
    rootMargin: "600px",     // Pre-load elements 600px outside viewport
    threshold: 0.1,          // Trigger when 10% of element is visible
  }

  // Instance state
  private isPageTranslating: boolean = false
  private intersectionObserver: IntersectionObserver | null = null
  private mutationObservers: MutationObserver[] = []       // Array — multiple observers for shadow roots
  private walkId: string | null = null                     // UUID session ID for stale prevention
  private intersectionOptions: IntersectionObserverInit
  private dontWalkIntoElementsCache = new WeakSet<HTMLElement>()  // Visibility-change tracking cache
  
  // Document title tracking
  private titleObserver: MutationObserver | null = null
  private lastSourceTitle: string | null = null
  private lastAppliedTranslatedTitle: string | null = null
  private titleRequestVersion = 0                          // Version counter for stale title requests
}
```

**Key design decisions**:
- `mutationObservers` is an **array**, not a single observer — each shadow root gets its own MutationObserver
- `walkId` is a **UUID** generated via `crypto.randomUUID()` — used to tag all walked elements in a session and prevent stale translations
- `dontWalkIntoElementsCache` is a `WeakSet` — tracks elements that were previously "don't walk into" for visibility-change detection
- `titleRequestVersion` is an incrementing counter — prevents out-of-order title translation responses from being applied

The constructor validates `threshold` range and merges with defaults:

```typescript
constructor(intersectionOptions: SimpleIntersectionOptions = {}) {
  if (intersectionOptions.threshold !== undefined) {
    if (intersectionOptions.threshold < 0 || intersectionOptions.threshold > 1) {
      throw new Error("IntersectionObserver threshold must be between 0 and 1")
    }
  }
  this.intersectionOptions = {
    ...PageTranslationManager.DEFAULT_INTERSECTION_OPTIONS,
    ...intersectionOptions,
  }
}
```

### 1.2 `start()` Method — Full Walkthrough

The `start()` method follows this sequence:

```
1. Guard: already active? → return
2. Load config → validate translation config
3. Send "enabled" state to background
4. Set isPageTranslating = true
5. Prime article context (Readability extraction for AI-aware titles)
6. Start document title tracking
7. Generate walkId (crypto.randomUUID())
8. Create IntersectionObserver with callback
9. Initialize walkability state (addDontWalkIntoElements)
10. Walk & observe existing elements (observerTopLevelParagraphs)
11. Start MutationObserver (observeMutations)
```

Full code:

```typescript
async start(): Promise<void> {
  if (this.isPageTranslating) {
    console.warn("PageTranslationManager is already active")
    return
  }

  const config = await getLocalConfig()
  if (!config) {
    console.warn("Config is not initialized")
    return
  }

  const detectedCode = await getDetectedCodeFromStorage()
  if (!validateTranslationConfigAndToast({
    providersConfig: config.providersConfig,
    translate: config.translate,
    language: config.language,
  }, detectedCode)) {
    return
  }

  await sendMessage("setAndNotifyPageTranslationStateChangedByManager", { enabled: true })
  this.isPageTranslating = true

  await this.primeDocumentTitleContext(config.translate.enableAIContentAware)
  this.startDocumentTitleTracking()

  // SESSION KEY: new UUID per start() call
  const walkId = crypto.randomUUID()
  this.walkId = walkId

  this.intersectionObserver = new IntersectionObserver(async (entries, observer) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        if (isHTMLElement(entry.target)) {
          if (!entry.target.closest(`.${CONTENT_WRAPPER_CLASS}`)) {
            const currentConfig = await getLocalConfig()
            if (!currentConfig) {
              logger.error("Global config is not initialized")
              return
            }
            void translateWalkedElement(entry.target, walkId, currentConfig)
          }
        }
        observer.unobserve(entry.target)  // CRITICAL: unobserve after triggering translation
      }
    }
  }, this.intersectionOptions)

  this.addDontWalkIntoElements(document.body)
  await this.observerTopLevelParagraphs(document.body)
  this.observeMutations(document.body)
}
```

**Critical flow observations**:
- The IntersectionObserver callback captures `walkId` via closure — this means even if `this.walkId` changes (new session), the captured `walkId` stays consistent for that observer instance
- `translateWalkedElement` is called with `void` (fire-and-forget) — translations run concurrently
- Config is fetched fresh inside the callback (`await getLocalConfig()`) — not stale from `start()` time

### 1.3 `stop()` Method — Cleanup

```typescript
stop(): void {
  if (!this.isPageTranslating) {
    console.warn("AutoTranslationManager is already inactive")
    return
  }

  void sendMessage("setAndNotifyPageTranslationStateChangedByManager", { enabled: false })

  this.isPageTranslating = false
  this.walkId = null                                    // Invalidates any in-flight walkId checks
  this.dontWalkIntoElementsCache = new WeakSet()        // Full reset
  this.stopDocumentTitleTracking()

  if (this.intersectionObserver) {
    this.intersectionObserver.disconnect()
    this.intersectionObserver = null
  }
  this.mutationObservers.forEach(observer => observer.disconnect())
  this.mutationObservers = []

  void removeAllTranslatedWrapperNodes()                // Remove all injected translation UI
}
```

**Key**: Setting `this.walkId = null` is a lightweight "cancellation" — any in-flight `translateWalkedElement` calls will early-return because `element.getAttribute(WALKED_ATTRIBUTE) !== walkId` would fail (walkId from walker vs null or new UUID).

### 1.4 walkId Session Management

The `walkId` is a UUID that serves as a **session identifier** for an entire page translation cycle:

1. **Generation**: `crypto.randomUUID()` in `start()`
2. **Labeling**: `walkAndLabelElement()` stamps every walked element with `data-read-frog-walked="${walkId}"`
3. **Validation**: `translateWalkedElement()` checks `element.getAttribute(WALKED_ATTRIBUTE) !== walkId` — returns immediately if stale
4. **Invalidation**: `stop()` sets `this.walkId = null`

This prevents:
- **Cross-session pollution**: If stop → start happens quickly, old translations from previous sessions won't interfere
- **Stale translations**: Elements labeled in a previous session won't be re-translated in a new session

### 1.5 Document Title Translation

The title tracking system is notably sophisticated:

- **`startDocumentTitleTracking()`**: Records `lastSourceTitle`, creates a MutationObserver on `document.head` watching `childList + subtree + characterData`
- **`handleDocumentTitleMutation()`**: When title changes, checks if it's the source title or our applied translation — only triggers sync if it's a genuinely new source title
- **`syncDocumentTitle()`**: Uses `titleRequestVersion` to prevent stale async responses from overwriting newer titles
- **`stopDocumentTitleTracking()`**: Restores the original `lastSourceTitle`, increments version to invalidate in-flight requests

---

## 2. IntersectionObserver Details

### 2.1 Configuration

```typescript
private static readonly DEFAULT_INTERSECTION_OPTIONS: SimpleIntersectionOptions = {
  root: null,            // Viewport as root
  rootMargin: "600px",   // Observe 600px BEYOND the viewport (pre-loading)
  threshold: 0.1,        // Trigger when 10% visible
}
```

The 600px `rootMargin` causes elements **below the fold** to start translating before the user scrolls to them — a critical UX optimization.

The caller (content script entry point) overrides these from config:

```typescript
const preloadConfig = initialConfig?.translate.page.preload ?? DEFAULT_CONFIG.translate.page.preload
const manager = new PageTranslationManager({
  root: null,
  rootMargin: `${preloadConfig.margin}px`,
  threshold: preloadConfig.threshold,
})
```

### 2.2 How Paragraph Elements Are Observed After Walk

The `observerTopLevelParagraphs()` method:

```typescript
private async observerTopLevelParagraphs(container: HTMLElement): Promise<void> {
  const observer = this.intersectionObserver
  if (!this.walkId || !observer) return

  const config = await getLocalConfig()
  if (!config) { logger.error("Global config is not initialized"); return }

  // Skip if container has an ancestor that should not be walked into
  if (hasNoWalkAncestor(container, config)) return

  // STEP 1: Walk and label the DOM tree
  walkAndLabelElement(container, this.walkId, config)

  // STEP 2: If the container itself is a paragraph, observe it directly
  if (container.hasAttribute("data-read-frog-paragraph") 
      && container.getAttribute("data-read-frog-walked") === this.walkId) {
    observer.observe(container)
    return
  }

  // STEP 3: Collect all paragraph elements (including those in shadow roots)
  const paragraphs = this.collectParagraphElementsDeep(container, this.walkId)

  // STEP 4: Filter to only TOP-LEVEL paragraphs (no nesting)
  const topLevelParagraphs = paragraphs.filter((el) => {
    const ancestor = el.parentElement?.closest("[data-read-frog-paragraph]")
    return !ancestor || !container.contains(ancestor)
  })

  // STEP 5: Observe each top-level paragraph
  topLevelParagraphs.forEach(el => observer.observe(el))
}
```

**Why only top-level paragraphs?**  
Nested paragraphs are handled by the `translateWalkedElement` recursive function — only the outermost paragraph needs viewport-based triggering. Inner block children are recursively walked during translation.

### 2.3 The Intersection Callback

When an element enters the viewport + 600px margin:

```typescript
this.intersectionObserver = new IntersectionObserver(async (entries, observer) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      if (isHTMLElement(entry.target)) {
        // Guard: skip if element is inside an already-translated wrapper
        if (!entry.target.closest(`.${CONTENT_WRAPPER_CLASS}`)) {
          const currentConfig = await getLocalConfig()
          if (!currentConfig) { logger.error("..."); return }
          // Fire-and-forget translation
          void translateWalkedElement(entry.target, walkId, currentConfig)
        }
      }
      // CRITICAL: unobserve immediately after triggering
      observer.unobserve(entry.target)
    }
  }
}, this.intersectionOptions)
```

**Key behaviors**:
- **Unobserve after intersection**: Each element is only translated once via IntersectionObserver. Once it enters the viewport area, the observer stops watching it.
- **Config re-fetched each time**: The callback reads fresh config from storage, not from the `start()` closure. This means runtime config changes (e.g., switching translation mode) take effect immediately.
- **Wrapper exclusion**: Elements already inside `CONTENT_WRAPPER_CLASS` are skipped to prevent double-translation.

### 2.4 Shadow Root Paragraph Collection

The `collectParagraphElementsDeep` method recursively traverses shadow roots:

```typescript
private collectParagraphElementsDeep(container: HTMLElement, walkId: string): HTMLElement[] {
  const result: HTMLElement[] = []

  const collectFromContainer = (root: HTMLElement | Document | ShadowRoot) => {
    const elements = root.querySelectorAll<HTMLElement>(
      `[data-read-frog-paragraph][data-read-frog-walked="${CSS.escape(walkId)}"]`
    )
    result.push(...Array.from(elements))
  }

  const traverseElement = (element: HTMLElement) => {
    if (element.shadowRoot) {
      collectFromContainer(element.shadowRoot)
      for (const child of element.shadowRoot.children) {
        if (child instanceof HTMLElement) traverseElement(child)
      }
    }
    for (const child of element.children) {
      if (child instanceof HTMLElement) traverseElement(child)
    }
  }

  collectFromContainer(container)
  traverseElement(container)
  return result
}
```

---

## 3. MutationObserver Details

### 3.1 Configuration and What Mutations Are Watched

```typescript
private observeMutations(container: HTMLElement): void {
  const mutationObserver = new MutationObserver((records) => {
    for (const rec of records) {
      if (rec.type === "childList") {
        rec.addedNodes.forEach((node) => {
          if (isHTMLElement(node)) {
            this.addDontWalkIntoElements(node)          // Cache walkability state
            void this.observerTopLevelParagraphs(node)  // Walk, label, observe new nodes
            this.observeIsolatedDescendantsMutations(node) // Shadow root observation
          }
        })
      }
      else if (
        rec.type === "attributes"
        && (rec.attributeName === "style" || rec.attributeName === "class")
      ) {
        const el = rec.target
        if (isHTMLElement(el) && this.didChangeToWalkable(el)) {
          void this.observerTopLevelParagraphs(el)
        }
      }
    }
  })

  mutationObserver.observe(container, {
    childList: true,      // New nodes added/removed
    subtree: true,        // Watch entire subtree
    attributes: true,     // Attribute changes
    attributeFilter: ["style", "class"],  // ONLY style and class changes
  })

  this.mutationObservers.push(mutationObserver)
  this.observeIsolatedDescendantsMutations(container)
}
```

### 3.2 childList Mutations — New Elements

When new nodes are added to the DOM (e.g., lazy-loaded content, SPA route changes, AJAX updates):

1. **`addDontWalkIntoElements(node)`**: Scans the new subtree for elements that should not be walked into (e.g., `display: none`, `.notranslate`) and caches them in `dontWalkIntoElementsCache`
2. **`observerTopLevelParagraphs(node)`**: Walks the new node, labels elements with `data-read-frog-*` attributes, and observes paragraph elements with IntersectionObserver
3. **`observeIsolatedDescendantsMutations(node)`**: Checks for shadow roots in the new subtree and attaches additional MutationObservers

### 3.3 Attribute Changes — Visibility Detection

The `didChangeToWalkable` method detects elements transitioning from hidden→visible:

```typescript
private didChangeToWalkable(element: HTMLElement): boolean {
  const wasDontWalkInto = this.dontWalkIntoElementsCache.has(element)
  const isDontWalkIntoNow = isDontWalkIntoButTranslateAsChildElement(element)

  // Update cache
  if (isDontWalkIntoNow) {
    this.dontWalkIntoElementsCache.add(element)
  } else {
    this.dontWalkIntoElementsCache.delete(element)
  }

  // Only trigger if: was hidden → now visible
  return wasDontWalkInto === true && isDontWalkIntoNow === false
}
```

**Key insight**: Only the **transition from "don't walk into" to "walkable"** triggers observation. This prevents repeated re-processing when elements change attributes without affecting visibility.

The `isDontWalkIntoButTranslateAsChildElement` check covers:
- Elements with `.notranslate` class
- Elements in `DONT_WALK_BUT_TRANSLATE_TAGS` set

Note: The `isDontWalkIntoAndDontTranslateAsChildElement` function (used during walking, but NOT in the mutation visibility check) covers more:
- `display: none`, `visibility: hidden`
- `hidden` attribute, `aria-hidden="true"`
- `.sr-only`, `.visually-hidden` classes
- Custom site-specific selectors

### 3.4 Shadow Root Recursive Observation

```typescript
private observeIsolatedDescendantsMutations(element: HTMLElement): void {
  if (element.shadowRoot) {
    for (const child of element.shadowRoot.children) {
      if (isHTMLElement(child)) {
        this.observeMutations(child)  // Creates a NEW MutationObserver for this shadow root
      }
    }
  }
  for (const child of element.children) {
    if (isHTMLElement(child)) {
      this.observeIsolatedDescendantsMutations(child)
    }
  }
}
```

Each shadow root gets its **own** MutationObserver because `subtree: true` cannot cross shadow boundaries. All observers are stored in `this.mutationObservers[]` and disconnected in `stop()`.

### 3.5 Walkability Cache Initialization

Before attaching observers, existing "don't walk into" elements are cached:

```typescript
private addDontWalkIntoElements(element: HTMLElement): void {
  const dontWalkIntoElements = deepQueryTopLevelSelector(element, isDontWalkIntoButTranslateAsChildElement)
  dontWalkIntoElements.forEach(el => this.dontWalkIntoElementsCache.add(el))
}
```

This creates the baseline state for `didChangeToWalkable` to detect transitions.

---

## 4. Translation Walker (`translateWalkedElement`)

**File**: `src/utils/host/translate/core/translation-walker.ts`

### 4.1 How It Processes Labeled DOM

```typescript
export async function translateWalkedElement(
  element: HTMLElement,
  walkId: string,
  config: Config,
  toggle: boolean = false,
): Promise<void> {
  // Guard: already translated (has wrapper inside)
  if (!toggle && element.querySelector(`.${CONTENT_WRAPPER_CLASS}`)) return

  // Guard: stale session (walkId mismatch)
  if (element.getAttribute(WALKED_ATTRIBUTE) !== walkId) return

  const promises: Promise<void>[] = []

  if (element.hasAttribute(PARAGRAPH_ATTRIBUTE)) {
    // This element HAS inline children → it's a translation unit boundary

    let hasBlockNodeChild = false
    for (const child of element.childNodes) {
      if (isHTMLElement(child) && child.hasAttribute(BLOCK_ATTRIBUTE)) {
        hasBlockNodeChild = true
        break
      }
    }

    const computedStyle = window.getComputedStyle(element)
    const isFlexParent = computedStyle.display.includes("flex")

    if (!hasBlockNodeChild) {
      // SIMPLE CASE: All children are inline → translate entire paragraph as one unit
      promises.push(translateNodes([element], walkId, toggle, config))
    } else {
      // COMPLEX CASE: Mix of inline and block children → group inline runs
      const children = Array.from(element.childNodes)
      let consecutiveInlineNodes: ChildNode[] = []
      
      for (const child of children) {
        if (isTransNode(child) && isBlockTransNode(child) && !isTextNode(child)) {
          // Flush accumulated inline nodes as one translation unit
          promises.push(translateNodes(consecutiveInlineNodes, walkId, toggle, config, !isFlexParent))
          consecutiveInlineNodes = []
          // Recurse into the block child
          promises.push(translateWalkedElement(child, walkId, config, toggle))
        } else {
          consecutiveInlineNodes.push(child)
        }
      }

      // Flush remaining inline nodes
      if (consecutiveInlineNodes.length) {
        promises.push(translateNodes(consecutiveInlineNodes, walkId, toggle, config, !isFlexParent))
      }
    }
  } else {
    // NOT a paragraph → recurse into children (including shadow roots)
    for (const child of element.childNodes) {
      if (isHTMLElement(child)) {
        promises.push(translateWalkedElement(child, walkId, config, toggle))
      }
    }
    if (element.shadowRoot) {
      for (const child of element.shadowRoot.children) {
        if (isHTMLElement(child)) {
          promises.push(translateWalkedElement(child, walkId, config, toggle))
        }
      }
    }
  }

  await Promise.all(promises)
}
```

### 4.2 Inline Node Grouping Logic

The key insight is the "consecutive inline nodes" pattern:

```
<div data-read-frog-paragraph>
  "Some text"                    ← inline
  <span>more text</span>         ← inline
  <div data-read-frog-block>     ← BLOCK: flushes previous inline group
    <p>block content</p>
  </div>
  "trailing text"                ← inline (new group)
</div>
```

This results in 3 translation calls:
1. `translateNodes(["Some text", <span>])` — first inline group
2. `translateWalkedElement(<div>, ...)` — recurse into block child
3. `translateNodes(["trailing text"])` — second inline group

### 4.3 Connection Between Walking and Translating

The flow is:
1. **Walk phase** (`walkAndLabelElement`): Labels every element with `WALKED_ATTRIBUTE` = walkId, and marks elements as `PARAGRAPH_ATTRIBUTE`, `BLOCK_ATTRIBUTE`, or `INLINE_ATTRIBUTE`
2. **Observe phase**: IntersectionObserver observes only top-level paragraph elements
3. **Translate phase** (`translateWalkedElement`): When viewport-triggered, reads the labels to determine translation units — paragraphs define boundaries, blocks split inline groups

---

## 5. Translation Text Flow

### 5.1 `translateTextCore` — How Text Goes to Background

**File**: `src/utils/host/translate/translate-text.ts`

```typescript
export async function translateTextCore(options: TranslateTextOptions): Promise<string> {
  const { text, langConfig, providerConfig, enableAIContentAware, extraHashTags, articleContext } = options

  const preparedText = prepareTranslationText(text)   // Strip invisible chars, trim
  if (preparedText === "") return ""

  // Build hash components for cache key
  const hashComponents = await buildHashComponents(
    preparedText, providerConfig,
    { sourceCode: langConfig.sourceCode, targetCode: langConfig.targetCode },
    enableAIContentAware,
    { title: articleTitle, textContent: articleTextContent },
  )
  hashComponents.push(...extraHashTags)

  // Send to background service worker via message passing
  return await sendMessage("enqueueTranslateRequest", {
    text: preparedText,
    langConfig,
    providerConfig,
    scheduleAt: Date.now(),
    hash: Sha256Hex(...hashComponents),  // SHA-256 hash for deduplication/caching
    articleTitle,
    articleTextContent,
  })
}
```

### 5.2 Message Passing Pattern

The content script to background communication flows:
1. **Content** calls `translateTextCore()` → `sendMessage("enqueueTranslateRequest", {...})`
2. **Background** receives the message, enqueues the request (with hash-based deduplication)
3. **Background** calls the actual translation API (Google, DeepLX, LLM, etc.)
4. **Background** returns the translated string back to content via the message response

The `hash` field enables:
- **Request deduplication**: Same text with same config → same hash → single API call
- **Cache hits**: Previously translated text can be returned from cache

### 5.3 `translateTextForPage` — High-Level Page Translation

```typescript
export async function translateTextForPage(text: string): Promise<string> {
  const config = await getConfigOrThrow()
  const articleData = await getOrFetchArticleData(config.translate.enableAIContentAware)
  return translateTextUsingPageConfig(config, text, {
    articleContext: articleData ?? undefined,
  })
}
```

The `translateTextUsingPageConfig` adds page-specific logic:
- **Target language detection**: Skips if text is already in target language (for texts > 50 chars)
- **Skip language filtering**: Skips if text is in a user-configured "skip language" list
- **Article context**: Passes article title/content for AI-aware translation

### 5.4 The Spinner → Translation → Display Flow

From `translation-modes.ts`, the bilingual mode flow:

```
1. Check for duplicate translation (translatingNodes WeakSet)
2. Extract text content from nodes
3. Filter small paragraphs / numeric content
4. Create wrapper <span> with CONTENT_WRAPPER_CLASS
5. Create spinner inside wrapper
6. Batch-insert wrapper into DOM
7. await translateTextForPage(textContent)    ← API call happens here
8. Remove spinner
9. Insert translated text into wrapper
10. Apply decoration styles
```

---

## 6. DOMBatcher

**File**: `src/utils/host/dom/batch-dom.ts`

### 6.1 `requestAnimationFrame` Singleton

```typescript
class DOMBatcher {
  private operations: DOMOperation[] = []
  private rafId: number | null = null
  private isProcessing = false

  queue(operation: DOMOperation): void {
    this.operations.push(operation)
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.rafId !== null || this.isProcessing) return

    this.rafId = requestAnimationFrame(() => {
      this.flush()
    })
  }

  private flush(): void {
    this.rafId = null
    if (this.operations.length === 0) return

    this.isProcessing = true
    const ops = this.operations.splice(0)  // Drain all queued ops

    for (const op of ops) {
      try { op() }
      catch (error) { console.error("Error executing batched DOM operation:", error) }
    }

    this.isProcessing = false

    // If new ops were queued during execution, schedule another flush
    if (this.operations.length > 0) {
      this.scheduleFlush()
    }
  }
}
```

### 6.2 Queue/Flush Pattern

- **Singleton**: One global `DOMBatcher` instance for the entire app
- **Coalescing**: Multiple `queue()` calls within the same frame are batched into one `rAF` callback
- **Re-entrant safe**: If an operation queues more operations, they're scheduled for the next frame (via `isProcessing` guard)
- **Error isolation**: Each operation is try/caught individually — one failure doesn't block others

### 6.3 Additional Utilities

```typescript
// Force synchronous flush (for testing)
export function flushBatchedOperations(): void {
  domBatcher.flushImmediate()
}

// DocumentFragment helper for batch appending
export function createFragment(ownerDocument: Document = document): DocumentFragment {
  return ownerDocument.createDocumentFragment()
}
```

The `flushImmediate()` method loops until all operations (including newly queued ones) are complete — useful for tests that need synchronous completion.

### 6.4 Usage Throughout Translation

DOMBatcher is used in three key locations:

1. **Wrapper insertion** (both bilingual and translationOnly modes):
   ```typescript
   batchDOMOperation(() => {
     targetNode.parentNode?.insertBefore(translatedWrapperNode, targetNode.nextSibling)
   })
   ```

2. **Wrapper removal** (when translation returns empty):
   ```typescript
   batchDOMOperation(() => translatedWrapperNode.remove())
   ```

3. **TranslationOnly final DOM mutations**:
   ```typescript
   batchDOMOperation(() => {
     lastChildNode.parentNode?.insertBefore(translatedWrapperNode, lastChildNode.nextSibling)
     allChildNodes.forEach(childNode => childNode.remove())
   })
   ```

4. **Cleanup operations** (`translation-cleanup.ts`):
   ```typescript
   batchDOMOperation(() => { nodeToRestore.innerHTML = originalContent })
   batchDOMOperation(() => wrapper.remove())
   batchDOMOperation(() => spinner.remove())
   ```

---

## 7. Translation Insertion (Rendering)

**File**: `src/utils/host/translate/dom/translation-insertion.ts`

### 7.1 `insertTranslatedNodeIntoWrapper` — Full Code

```typescript
export async function insertTranslatedNodeIntoWrapper(
  translatedWrapperNode: HTMLElement,
  targetNode: TransNode,
  translatedText: string,
  translationNodeStyle: TranslationNodeStyleConfig,
  forceBlockTranslation: boolean = false,
): Promise<void> {
  const ownerDoc = getOwnerDocument(translatedWrapperNode)
  const translatedNode = ownerDoc.createElement("span")
  const forceInlineTranslation = isForceInlineTranslation(targetNode)
  const customForceBlock = isHTMLElement(targetNode) && isCustomForceBlockTranslation(targetNode)

  // Priority: customForceBlock > forceInlineTranslation > forceBlockTranslation > isInlineTransNode > isBlockTransNode
  if (customForceBlock) {
    addBlockTranslation(ownerDoc, translatedWrapperNode, translatedNode)
  } else if (forceInlineTranslation) {
    addInlineTranslation(ownerDoc, translatedWrapperNode, translatedNode)
  } else if (forceBlockTranslation) {
    addBlockTranslation(ownerDoc, translatedWrapperNode, translatedNode)
  } else if (isInlineTransNode(targetNode)) {
    addInlineTranslation(ownerDoc, translatedWrapperNode, translatedNode)
  } else if (isBlockTransNode(targetNode)) {
    addBlockTranslation(ownerDoc, translatedWrapperNode, translatedNode)
  } else {
    return  // Unknown node type, skip
  }

  translatedNode.textContent = translatedText
  translatedWrapperNode.appendChild(translatedNode)
  await decorateTranslationNode(translatedNode, translationNodeStyle)
}
```

### 7.2 Inline vs Block Strategy

**Inline translation**: Adds a space separator, then the translated content inline:

```typescript
export function addInlineTranslation(ownerDoc: Document, translatedWrapperNode: HTMLElement, translatedNode: HTMLElement): void {
  const spaceNode = ownerDoc.createElement("span")
  spaceNode.textContent = "  "           // Double space separator
  translatedWrapperNode.appendChild(spaceNode)
  translatedNode.className = `${NOTRANSLATE_CLASS} ${INLINE_CONTENT_CLASS}`
}
```

**Block translation**: Adds a `<br>` before the translated content:

```typescript
export function addBlockTranslation(ownerDoc: Document, translatedWrapperNode: HTMLElement, translatedNode: HTMLElement): void {
  const brNode = ownerDoc.createElement("br")
  translatedWrapperNode.appendChild(brNode)
  translatedNode.className = `${NOTRANSLATE_CLASS} ${BLOCK_CONTENT_CLASS}`
}
```

### 7.3 Inline/Block Decision Priority

From highest to lowest:
1. **Custom force block** — site-specific CSS selector match (`CUSTOM_FORCE_BLOCK_TRANSLATION_SELECTOR_MAP`)
2. **Force inline** — elements in `FORCE_INLINE_TRANSLATION_TAGS` or with `display: flex`
3. **Force block parameter** — passed when inline children are inside a paragraph with block siblings (and parent is NOT flex)
4. **isInlineTransNode** — element has `data-read-frog-inline-node` attribute
5. **isBlockTransNode** — element has `data-read-frog-block-node` attribute

### 7.4 Wrapper Creation (in translation-modes.ts)

The wrapper `<span>` is created with these attributes:

```typescript
const translatedWrapperNode = ownerDoc.createElement("span")
translatedWrapperNode.className = `${NOTRANSLATE_CLASS} ${CONTENT_WRAPPER_CLASS}`
translatedWrapperNode.setAttribute(TRANSLATION_MODE_ATTRIBUTE, "bilingual")  // or "translationOnly"
translatedWrapperNode.setAttribute(WALKED_ATTRIBUTE, walkId)
setTranslationDirAndLang(translatedWrapperNode, config)  // dir="ltr"/"rtl", lang="xx"
```

Classes applied:
- `notranslate` — prevents re-walking
- `read-frog-translated-content-wrapper` — identifies translated content for cleanup
- Inner translation spans get `read-frog-translated-inline-content` or `read-frog-translated-block-content`

### 7.5 Styling/Decoration

```typescript
export async function decorateTranslationNode(
  translatedNode: HTMLElement,
  styleConfig: TranslationNodeStyleConfig,
): Promise<void> {
  if (styleConfig.isCustom && styleConfig.customCSS) {
    translatedNode.dataset[customTranslationNodeAttribute] = "custom"
    await ensureCustomCSS(root, styleConfig.customCSS)
    return
  }
  translatedNode.dataset[customTranslationNodeAttribute] = styleConfig.preset
  ensurePresetStyles(root)
}
```

Style injection uses **Constructable Stylesheets** (`adoptedStyleSheets`) where supported, falling back to `<style>` element injection. Each shadow root gets its own theme injection.

---

## 8. Translation Cleanup

**File**: `src/utils/host/translate/dom/translation-cleanup.ts`

### 8.1 `removeTranslatedWrapperWithRestore`

```typescript
export function removeTranslatedWrapperWithRestore(wrapper: HTMLElement): void {
  // First: clean up React shadow hosts and spinners inside the wrapper
  removeShadowHostInTranslatedWrapper(wrapper)

  const translationMode = wrapper.getAttribute(TRANSLATION_MODE_ATTRIBUTE)

  if (translationMode === "translationOnly") {
    // Walk up the DOM tree to find the nearest ancestor with saved innerHTML
    let currentNode = wrapper.parentNode
    while (currentNode && isHTMLElement(currentNode)) {
      const originalContent = originalContentMap.get(currentNode)
      if (originalContent) {
        const nodeToRestore = currentNode
        batchDOMOperation(() => {
          nodeToRestore.innerHTML = originalContent  // Full innerHTML restore
        })
        originalContentMap.delete(currentNode)
        return
      }
      currentNode = currentNode.parentNode
    }
  }

  // Bilingual mode: just remove the wrapper element
  batchDOMOperation(() => wrapper.remove())
}
```

### 8.2 `removeAllTranslatedWrapperNodes`

```typescript
export function removeAllTranslatedWrapperNodes(
  root: Document | ShadowRoot = document,
): void {
  const translatedNodes = deepQueryTopLevelSelector(root, isTranslatedWrapperNode)
  translatedNodes.forEach((contentWrapperNode) => {
    removeTranslatedWrapperWithRestore(contentWrapperNode)
  })
}
```

Uses `deepQueryTopLevelSelector` which recursively traverses shadow roots to find translated wrappers.

### 8.3 Two Cleanup Strategies

| Mode | Cleanup Strategy | State |
|------|-----------------|-------|
| **Bilingual** | Simply `.remove()` the wrapper `<span>` | No saved state needed — original DOM is untouched |
| **TranslationOnly** | Restore parent's `innerHTML` from `originalContentMap` | `originalContentMap: Map<Element, string>` saves pre-translation HTML |

**Important**: `translationOnly` mode uses `innerHTML` restoration, which **destroys and recreates DOM nodes**. Comments in the code note this explicitly — the translation function must re-query DOM nodes after restoration.

### 8.4 Walk Label Removal

Walk labels (`data-read-frog-walked`, `data-read-frog-paragraph`, etc.) are NOT explicitly removed on `stop()`. Instead:
- `walkId` is set to `null`, making all old labels stale
- New `start()` generates a fresh `walkId`
- `translateWalkedElement` checks `element.getAttribute(WALKED_ATTRIBUTE) !== walkId` and returns early if stale

This is a lazy cleanup approach — labels remain in the DOM but are effectively invalidated by the UUID change.

---

## 9. SPA / URL Change Handling

**File**: `src/entrypoints/host.content/listen.ts`

### 9.1 Four Detection Strategies

The URL change listener uses four simultaneous strategies:

#### Strategy 1: History API Monkey-Patching

```typescript
let prev = location.href
const originals: Record<string, typeof history.pushState> = {};
(["pushState", "replaceState"] as const).forEach((fn) => {
  const orig = history[fn]
  originals[fn] = orig
  history[fn] = function (...args) {
    orig.apply(this, args as any)
    const now = location.href
    fire(prev, now, fn)
    prev = now
  }
})
```

Monkey-patches `history.pushState` and `history.replaceState` to fire a custom event after each call. Originals are saved for cleanup restoration.

#### Strategy 2: `popstate` / `hashchange` Events

```typescript
window.addEventListener("popstate", onPopState, { signal })
window.addEventListener("hashchange", onHashChange, { signal })
```

Catches browser back/forward navigation and hash-only changes.

#### Strategy 3: Modern Navigation API (Chrome/Edge only)

```typescript
if ("navigation" in window) {
  const onNavigate = (e: any) => {
    const now = e.destination?.url ?? location.href
    fire(prev, now, "navigate")
    prev = now
  }
  ;(window as any).navigation.addEventListener("navigate", onNavigate, { signal })
}
```

Uses the [Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API) where available.

#### Strategy 4: Polling Fallback (Firefox/Safari only)

```typescript
if (!["chrome", "edge"].includes(import.meta.env.BROWSER)) {
  intervalId = setInterval(() => {
    const now = location.href
    if (now !== prev) {
      fire(prev, now, "interval")
      prev = now
    }
  }, 1000)
}
```

1-second polling as a last resort for browsers without the Navigation API.

### 9.2 Event Firing and Filtering

```typescript
const fire = (from: string, to: string, reason: string) => {
  if (from === to) return

  // SAME PAGE filter: skip if only hash/query changed but origin+pathname are identical
  if (isSamePage(from, to)) return

  const ev = new CustomEvent("extension:URLChange", { detail: { from, to, reason } })
  window.dispatchEvent(ev)
}
```

The `isSamePage` check prevents triggering on hash-only or query-only changes within the same path.

### 9.3 How URL Change Affects Translation

In `index.tsx`:

```typescript
const handleUrlChange = async (from: string, to: string) => {
  if (from !== to) {
    logger.info("URL changed from", from, "to", to)
    if (manager.isActive) {
      manager.stop()            // Stop current translation
    }
    // Re-detect language for the new page
    if (window === window.top) {
      const { detectedCodeOrUnd } = await getDocumentInfo()
      const detectedCode: LangCodeISO6393 = detectedCodeOrUnd === "und" ? "eng" : detectedCodeOrUnd
      await storage.setItem<LangCodeISO6393>(`local:${DETECTED_CODE_STORAGE_KEY}`, detectedCode)
      // Ask background to decide if auto-translation should be enabled
      void sendMessage("checkAndAskAutoPageTranslation", { url: to, detectedCodeOrUnd })
    }
  }
}
```

Key behavior: On URL change, the manager is **stopped** (removing all translations). The background script then decides whether to re-enable auto-translation for the new URL, which sends back `askManagerToTogglePageTranslation` message.

### 9.4 Cleanup

```typescript
return () => {
  // Restore original history methods
  for (const fn of ["pushState", "replaceState"] as const) {
    if (originals[fn]) history[fn] = originals[fn]
  }
  window.removeEventListener("popstate", onPopState)
  window.removeEventListener("hashchange", onHashChange)
  removeNavigateListener?.()
  if (intervalId !== null) { clearInterval(intervalId); intervalId = null }
}
```

---

## 10. Key Adaptation Notes for TapWord

### 10.1 What to Keep (High-Value Patterns)

| Pattern | Value | Notes |
|---------|-------|-------|
| **IntersectionObserver + rootMargin** | Essential for performance | Pre-loads translations 600px before viewport |
| **MutationObserver for dynamic content** | Essential for SPA support | Detects lazy-loaded content, AJAX updates |
| **walkId UUID session management** | Elegant stale prevention | Simple and effective — no explicit cancellation needed |
| **DOMBatcher (rAF queuing)** | Prevents layout thrashing | Simple singleton pattern, easy to port |
| **Walk → Label → Observe → Translate pipeline** | Core architecture | Separation of concerns is excellent |
| **Shadow root traversal** | Needed for Web Components | Many modern sites use shadow DOM |
| **Visibility change detection** | Handles tabbed/accordion UIs | `dontWalkIntoElementsCache` + `didChangeToWalkable` |
| **URL change detection (4 strategies)** | Robust SPA handling | History monkey-patching is the most reliable strategy |

### 10.2 What to Simplify for TapWord

| Read-Frog Feature | TapWord Adaptation |
|---|---|
| **React-based error UI** (shadow hosts, TranslationError component) | Use simple DOM-based error display — no React dependency |
| **`sonner` toast library** | Use our existing toast system |
| **Jotai state atoms** | Not needed — TapWord uses no state library in content scripts |
| **WXT `defineContentScript` / `#imports`** | Replace with our Vite-based content script entry |
| **`hotkeys-js` library** | Evaluate if needed; we can use native `keydown` listener |
| **Readability article extraction** | Only needed if we plan AI-content-aware translation |
| **Four-finger touch trigger** | Mobile-specific — TapWord is desktop-focused |

### 10.3 Architecture Differences (No React, No WXT, No Jotai)

| Concern | Read-Frog | TapWord Approach |
|---------|-----------|-----------------|
| **Content script framework** | WXT (`defineContentScript`, `ctx.onInvalidated`) | Vite build, manual lifecycle management |
| **State management** | Jotai atoms for global config, `getLocalConfig()` | Direct `chrome.storage` reads, message passing |
| **UI rendering** | React + Shadow DOM for error/toast | Plain DOM manipulation |
| **Message passing** | WXT's `sendMessage` (typed) | Our typed `chrome.runtime.sendMessage` wrapper |
| **Style injection** | Constructable Stylesheets + `<style>` fallback | Same approach can be reused |
| **Config hot-reload** | `getLocalConfig()` fetched fresh per callback | Same pattern works |

### 10.4 Key Implementation Recommendations

1. **PageTranslationManager should be a standalone class** — read-frog's design is already well-encapsulated; the class owns its observers and lifecycle
2. **Use WeakSet for `dontWalkIntoElementsCache`** — prevents memory leaks from removed DOM nodes
3. **Use WeakSet for `translatingNodes`** — prevents duplicate concurrent translations of the same node
4. **Store `originalContentMap` only for translationOnly mode** — bilingual mode doesn't modify original DOM
5. **The IntersectionObserver callback should re-fetch config** — long-lived observers may span config changes
6. **Consider simplifying shadow root handling** — many sites don't use shadow DOM; make it optional for initial implementation
7. **The `walkId` pattern is superior to explicit cancellation** — adopt this as our session management approach
8. **DOMBatcher is standalone and dependency-free** — can be copied almost verbatim
9. **URL change detection should use all 4 strategies** — the monkey-patching approach is the most reliable for SPAs

### 10.5 Data Flow Summary

```
User triggers "Translate Page"
    │
    ▼
PageTranslationManager.start()
    │
    ├── walkId = crypto.randomUUID()
    ├── Create IntersectionObserver (rootMargin: 600px)
    ├── walkAndLabelElement(document.body, walkId)  ← Labels DOM: paragraph, block, inline
    ├── observerTopLevelParagraphs(document.body)    ← IO.observe(paragraph elements)
    └── observeMutations(document.body)              ← MO watches childList + style/class
         │
         ▼
    [IntersectionObserver fires for visible paragraphs]
         │
         ▼
    translateWalkedElement(element, walkId, config)
         │
         ├── Check walkId matches (stale guard)
         ├── If paragraph: group inline nodes, split at block boundaries
         └── translateNodes(groupedNodes, walkId, config)
              │
              ├── Create wrapper <span> with spinner
              ├── batchDOMOperation(insert wrapper)
              ├── translateTextForPage(text)
              │      │
              │      └── sendMessage("enqueueTranslateRequest", {...})
              │              └── Background: API call → response
              ├── Remove spinner
              └── insertTranslatedNodeIntoWrapper(wrapper, translatedText)

    [MutationObserver fires for new DOM nodes]
         │
         ├── addDontWalkIntoElements(newNode)
         ├── observerTopLevelParagraphs(newNode)  ← walk, label, IO.observe
         └── observeIsolatedDescendantsMutations(newNode) ← shadow root MO


User triggers "Stop Translation"
    │
    ▼
PageTranslationManager.stop()
    │
    ├── walkId = null (invalidates all in-flight)
    ├── IntersectionObserver.disconnect()
    ├── All MutationObservers.disconnect()
    └── removeAllTranslatedWrapperNodes()
```
