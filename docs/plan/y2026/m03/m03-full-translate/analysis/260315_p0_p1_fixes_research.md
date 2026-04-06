# Read-Frog Full-Page Translation — Deep Dive Research

**Date**: 2026-03-15  
**Project Analyzed**: `/Users/hongyuan/project/read-frog`  
**Purpose**: Detailed analysis of read-frog's inline node grouping, paragraph filtering, numeric content filter, batch retry logic, and shadow DOM mutation observation.

---

## Table of Contents

1. [translateWalkedElement — Complete Inline Node Grouping Algorithm](#1-translatewalkedelement--complete-inline-node-grouping-algorithm)
2. [Top-Level Paragraph Filtering](#2-top-level-paragraph-filtering)
3. [isNumericContent Filter](#3-isnumericcontent-filter)
4. [Batch Queue Retry Logic](#4-batch-queue-retry-logic)
5. [Shadow DOM Mutation Observation](#5-shadow-dom-mutation-observation)
6. [shouldFilterSmallParagraph](#6-shouldfilterparagraph)

---

## 1. translateWalkedElement — Complete Inline Node Grouping Algorithm

### Source File

`src/utils/host/translate/core/translation-walker.ts`

### Full Source Code

```typescript
import type { Config } from "@/types/config/config"
import {
  BLOCK_ATTRIBUTE,
  CONTENT_WRAPPER_CLASS,
  PARAGRAPH_ATTRIBUTE,
  WALKED_ATTRIBUTE,
} from "../../../constants/dom-labels"
import { isBlockTransNode, isHTMLElement, isTextNode, isTransNode } from "../../dom/filter"
import { translateNodes } from "./translation-modes"

export async function translateWalkedElement(
  element: HTMLElement,
  walkId: string,
  config: Config,
  toggle: boolean = false,
): Promise<void> {
  if (!toggle && element.querySelector(`.${CONTENT_WRAPPER_CLASS}`))
    return

  // if the walkId is not the same, return
  if (element.getAttribute(WALKED_ATTRIBUTE) !== walkId)
    return

  const promises: Promise<void>[] = []

  if (element.hasAttribute(PARAGRAPH_ATTRIBUTE)) {
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
      // SIMPLE CASE: All children are inline — translate the whole element as one unit
      promises.push(translateNodes([element], walkId, toggle, config))
    }
    else {
      // COMPLEX CASE: Has mixed block + inline children — group inline nodes
      const children = Array.from(element.childNodes)  // snapshot to prevent mutation during iteration
      let consecutiveInlineNodes: ChildNode[] = []
      for (const child of children) {
        if (isTransNode(child) && isBlockTransNode(child) && !isTextNode(child)) {
          // Block child encountered — flush the accumulated inline group
          promises.push(translateNodes(consecutiveInlineNodes, walkId, toggle, config, !isFlexParent))
          consecutiveInlineNodes = []
          // Recurse into the block child
          promises.push(translateWalkedElement(child, walkId, config, toggle))
        }
        else {
          // Inline child or text node — accumulate into current group
          consecutiveInlineNodes.push(child)
        }
      }

      // Flush any trailing inline nodes
      if (consecutiveInlineNodes.length) {
        promises.push(translateNodes(consecutiveInlineNodes, walkId, toggle, config, !isFlexParent))
        consecutiveInlineNodes = []
      }
    }
  }
  else {
    // NOT a paragraph element — just recurse into HTML children
    for (const child of element.childNodes) {
      if (isHTMLElement(child)) {
        promises.push(translateWalkedElement(child, walkId, config, toggle))
      }
    }
    // Also recurse into shadow root children
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

### Step-by-Step Algorithm Analysis

#### Phase 1: Guard Checks

1. **Duplicate translation guard**: If not toggling, and the element already contains a `.read-frog-translated-content-wrapper`, bail out immediately. Prevents re-translating already-translated content.
2. **Walk ID check**: If the element's `data-read-frog-walked` attribute doesn't match the current `walkId`, skip. This ensures stale elements from previous translation sessions aren't processed.

#### Phase 2: Paragraph Branch (element has `data-read-frog-paragraph`)

An element is a "paragraph" if `walkAndLabelElement` previously determined it contains at least one inline child with text content. This is the main translation path.

**Step 2a — Detect block children presence**:
```typescript
let hasBlockNodeChild = false
for (const child of element.childNodes) {
  if (isHTMLElement(child) && child.hasAttribute(BLOCK_ATTRIBUTE)) {
    hasBlockNodeChild = true
    break
  }
}
```
Scans direct children for any with `data-read-frog-block-node` attribute.

**Step 2b — Flex parent detection**:
```typescript
const computedStyle = window.getComputedStyle(element)
const isFlexParent = computedStyle.display.includes("flex")
```
Checks if the parent uses `display: flex` or `inline-flex`. This is critical because flex parents lay out children horizontally, so block-style translation insertion (which adds a `<div>`-like element) would break the flex layout.

**Step 2c — Simple case (no block children)**:
```typescript
if (!hasBlockNodeChild) {
  promises.push(translateNodes([element], walkId, toggle, config))
}
```
If all children are inline (text nodes, `<span>`, `<a>`, `<em>`, etc.), the entire element is treated as a single translation unit. `translateNodes` receives `[element]` — the paragraph element itself.

**Step 2d — Complex case (mixed block + inline children)**:

This is the **core inline node grouping algorithm**:

```
Children:  [text, <span>, <div data-block>, text, <em>, <p data-block>, text]
Groups:     ├─ group 1 ─┤  ├─ block 1 ─┤  ├─ group 2 ─┤  ├─ block 2 ─┤ ├─ g3 ─┤
```

The algorithm iterates through children:
- **Inline node encountered** → push to `consecutiveInlineNodes` accumulator
- **Block node encountered** → 
  1. **Flush**: Send the accumulated `consecutiveInlineNodes` to `translateNodes()` as one translation unit, with `forceBlockTranslation = !isFlexParent`
  2. **Reset**: Clear the accumulator
  3. **Recurse**: Call `translateWalkedElement()` on the block child (it might be a paragraph itself with its own inline groups)
- **End of iteration** → Flush any remaining inline nodes

**Key detail**: The `forceBlockTranslation` parameter is `!isFlexParent`. This means:
- **Normal parents**: `forceBlockTranslation = true` → translated content is inserted as a block element (new line)
- **Flex parents**: `forceBlockTranslation = false` → translated content is inserted inline to preserve flex layout

#### Phase 3: Non-Paragraph Branch

If the element is NOT a paragraph (it's just a structural container), simply recurse into:
1. All HTMLElement child nodes
2. All HTMLElement children of `element.shadowRoot` (if shadow root exists)

#### Concurrency Model

All `promises` are collected and awaited with `Promise.all()`. This means:
- Multiple inline groups within the same paragraph translate **concurrently**
- Block children translate concurrently with sibling inline groups
- The parent `await Promise.all(promises)` ensures all sub-translations complete before the function resolves

### Supporting: walkAndLabelElement (Labeling Phase)

`src/utils/host/dom/traversal.ts` — This runs **before** `translateWalkedElement` and labels the DOM:

```typescript
export function walkAndLabelElement(
  element: HTMLElement,
  walkId: string,
  config: Config,
): { forceBlock: boolean, isInlineNode: boolean } {
  if (isDontWalkIntoButTranslateAsChildElement(element) || isDontWalkIntoAndDontTranslateAsChildElement(element, config)) {
    return { forceBlock: false, isInlineNode: false }
  }

  element.setAttribute(WALKED_ATTRIBUTE, walkId)

  if (element.shadowRoot) {
    for (const child of element.shadowRoot.children) {
      if (isHTMLElement(child)) {
        walkAndLabelElement(child, walkId, config)
      }
    }
  }

  let hasInlineNodeChild = false
  let forceBlock = false

  const validChildNodes = Array.from(element.childNodes).filter((child) => {
    if (child.nodeType === Node.TEXT_NODE) return true
    if (isHTMLElement(child)) {
      return !(isDontWalkIntoButTranslateAsChildElement(child) || isDontWalkIntoAndDontTranslateAsChildElement(child, config))
    }
    return false
  })

  for (const child of validChildNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent?.trim()) {
        hasInlineNodeChild = true
      }
      continue
    }

    if (isHTMLElement(child)) {
      const result = walkAndLabelElement(child, walkId, config)
      forceBlock = forceBlock || result.forceBlock
      if (result.isInlineNode) {
        hasInlineNodeChild = true
      }
    }
  }

  if (hasInlineNodeChild) {
    element.setAttribute(PARAGRAPH_ATTRIBUTE, "")  // Mark as paragraph
  }

  forceBlock = forceBlock || FORCE_BLOCK_TAGS.has(element.tagName)

  if (element.textContent?.trim() === "" && !forceBlock) {
    return { forceBlock: false, isInlineNode: false }
  }

  const isInlineNode = isShallowInlineHTMLElement(element)

  if (isShallowBlockHTMLElement(element) || forceBlock || isCustomForceBlockTranslation(element)) {
    element.setAttribute(BLOCK_ATTRIBUTE, "")      // Mark as block
  } else if (isInlineNode) {
    element.setAttribute(INLINE_ATTRIBUTE, "")     // Mark as inline
  }

  return { forceBlock, isInlineNode }
}
```

**Key labeling rules**:
- An element gets `data-read-frog-paragraph` if it has any inline child with text content (text nodes count)
- An element gets `data-read-frog-block-node` if its computed display is block-like, or its tag is in `FORCE_BLOCK_TAGS`, or it has a `forceBlock` descendant
- An element gets `data-read-frog-inline-node` if its computed display is inline-like
- `FORCE_BLOCK_TAGS` includes: `BODY, H1-H6, BR, FORM, SELECT, BUTTON, LABEL, UL, OL, LI, BLOCKQUOTE, PRE, ARTICLE, SECTION, FIGURE, FIGCAPTION, HEADER, FOOTER, MAIN, NAV`

### Supporting: isForceInlineTranslation (Flex Parent in Translation Insertion)

`src/utils/host/translate/ui/translation-utils.ts`:

```typescript
export function isForceInlineTranslation(targetNode: TransNode): boolean {
  if (isHTMLElement(targetNode)) {
    const computedStyle = window.getComputedStyle(targetNode)
    return FORCE_INLINE_TRANSLATION_TAGS.has(targetNode.tagName) || computedStyle.display.includes("flex")
  }
  return false
}
```

This is used during translation **insertion** (not in the walker). If the target node itself is a flex container or a forced-inline tag, the translation is rendered inline rather than as a block element. This is a **second** flex check — the walker's `isFlexParent` check is on the **parent** of the inline group, while this one is on the **target element** itself.

---

## 2. Top-Level Paragraph Filtering

### Source File

`src/entrypoints/host.content/translation-control/page-translation.ts`

### observerTopLevelParagraphs Implementation

```typescript
private async observerTopLevelParagraphs(container: HTMLElement): Promise<void> {
  const observer = this.intersectionObserver
  if (!this.walkId || !observer) return

  const config = await getLocalConfig()
  if (!config) {
    logger.error("Global config is not initialized")
    return
  }

  // Skip if container has an ancestor that should not be walked into
  if (hasNoWalkAncestor(container, config)) return

  walkAndLabelElement(container, this.walkId, config)

  // If container itself is a paragraph with the correct walkId, observe it directly
  if (container.hasAttribute("data-read-frog-paragraph") && container.getAttribute("data-read-frog-walked") === this.walkId) {
    observer.observe(container)
    return
  }

  const paragraphs = this.collectParagraphElementsDeep(container, this.walkId)
  const topLevelParagraphs = paragraphs.filter((el) => {
    const ancestor = el.parentElement?.closest("[data-read-frog-paragraph]")
    // keep it if either:
    //  • no paragraph ancestor at all, or
    //  • the ancestor is *not* inside container
    return !ancestor || !container.contains(ancestor)
  })
  topLevelParagraphs.forEach(el => observer.observe(el))
}
```

### Step-by-Step Filtering Logic

1. **Walk and label**: `walkAndLabelElement()` recursively labels the container's subtree with `data-read-frog-paragraph`, `data-read-frog-block-node`, `data-read-frog-inline-node`, and `data-read-frog-walked` attributes.

2. **Self-check**: If the container element itself is a paragraph (has inline text children), observe it directly and return early.

3. **Collect all paragraphs**: `collectParagraphElementsDeep()` gathers ALL elements with `[data-read-frog-paragraph][data-read-frog-walked="{walkId}"]` from the container and all shadow roots.

4. **Top-level filtering**: For each collected paragraph, check if it has a **paragraph ancestor** inside the container:
   ```typescript
   const ancestor = el.parentElement?.closest("[data-read-frog-paragraph]")
   return !ancestor || !container.contains(ancestor)
   ```
   - If NO paragraph ancestor exists → keep (it's top-level)
   - If a paragraph ancestor EXISTS but is OUTSIDE the container → keep (orphaned from this context)
   - If a paragraph ancestor EXISTS and is INSIDE the container → **filter out** (it's nested, the ancestor will handle it)

   **Why**: Nested paragraphs are handled recursively by `translateWalkedElement`. Only the outermost paragraphs need to be observed by IntersectionObserver. The inner ones get translated when the outer one is translated (via the block-child recursion in `translateWalkedElement`).

5. **Observe**: Each top-level paragraph is registered with the IntersectionObserver.

### collectParagraphElementsDeep Implementation

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
        if (child instanceof HTMLElement) {
          traverseElement(child)
        }
      }
    }

    for (const child of element.children) {
      if (child instanceof HTMLElement) {
        traverseElement(child)
      }
    }
  }

  collectFromContainer(container)
  traverseElement(container)

  return result
}
```

**Key**: This traverses **both** the light DOM and shadow DOMs recursively, collecting paragraphs from shadow roots that `querySelectorAll` on the main document wouldn't find.

---

## 3. isNumericContent Filter

### Source File

`src/utils/host/translate/ui/translation-utils.ts`

### Full Implementation

```typescript
// Helper function to check if content is purely numeric
export function isNumericContent(text: string): boolean {
  // Remove whitespace and check if remaining content is numeric
  // Allow numbers, decimals, commas, and common numeric separators
  const cleanedText = text.trim()
  if (!cleanedText)
    return false

  // Pattern matches numbers with optional thousand separators and decimal points
  // Examples: "123", "1,234", "1,234.56", "1 234", "1.234,56" (European format)
  const numericPattern = /^[\d\s,.-]+$/
  if (!numericPattern.test(cleanedText))
    return false

  // Additional check: ensure there's at least one digit
  return /\d/.test(cleanedText)
}
```

### Analysis

**Regex**: `/^[\d\s,.-]+$/`
- `\d` — digits 0-9
- `\s` — whitespace (thousand separator in some locales: `1 234`)
- `,` — comma (thousand separator in US: `1,234` or decimal separator in EU: `1,234`)
- `.` — period (decimal separator in US: `1.23` or thousand separator in EU: `1.234`)
- `-` — minus/negative sign or range separator

**Two-phase check**:
1. First: all characters must be in `[\d\s,.-]`
2. Second: at least one actual digit must exist (prevents matching pure punctuation like `...` or `---`)

**Usage points** (in `translation-modes.ts`):
- Bilingual mode (line 89): `if (!textContent || isNumericContent(textContent)) return`
- TranslationOnly mode (line 231): `if (!innerTextContent.trim() || isNumericContent(innerTextContent)) return`

**Purpose**: Skip translation for purely numeric content like table cells with numbers, page numbers, dates, prices, etc. These don't need translation and would waste API calls.

---

## 4. Batch Queue Retry Logic

### Source File

`src/utils/request/batch-queue.ts`

### Full Source Code

```typescript
import { batchQueueConfigSchema } from "@/types/config/translate"

export class BatchCountMismatchError extends Error {
  constructor(expected: number, got: number, results: unknown[]) {
    super(`Batch result count mismatch: expected ${expected}, got ${got}.\nResults: ["${results.join("\",\n\"")}"]`)
    this.name = "BatchCountMismatchError"
  }
}

const BASE_BACKOFF_DELAY_MS = 1000
const MAX_BACKOFF_DELAY_MS = 8000

interface BatchTask<T, R> {
  data: T
  resolve: (value: R) => void
  reject: (error: Error) => void
}

interface PendingBatch<T, R> {
  id: string
  tasks: BatchTask<T, R>[]
  totalCharacters: number
  createdAt: number
}

export interface BatchOptions<T, R> {
  maxCharactersPerBatch: number
  maxItemsPerBatch: number
  batchDelay: number
  maxRetries?: number
  enableFallbackToIndividual?: boolean
  getBatchKey: (data: T) => string
  getCharacters: (data: T) => number
  executeBatch: (dataList: T[]) => Promise<R[]>
  executeIndividual?: (data: T) => Promise<R>
  onError?: (error: Error, context: { batchKey: string, retryCount: number, isFallback: boolean }) => void
}

export class BatchQueue<T, R> {
  private pendingBatchMap = new Map<string, PendingBatch<T, R>>()
  private nextScheduleTimer: NodeJS.Timeout | null = null
  private maxCharactersPerBatch: number
  private maxItemsPerBatch: number
  private batchDelay: number
  private maxRetries: number
  private enableFallbackToIndividual: boolean
  private getBatchKey: (data: T) => string
  private getCharacters: (data: T) => number
  private executeBatch: (dataList: T[]) => Promise<R[]>
  private executeIndividual?: (data: T) => Promise<R>
  private onError?: (error: Error, context: { batchKey: string, retryCount: number, isFallback: boolean }) => void

  constructor(config: BatchOptions<T, R>) {
    this.maxCharactersPerBatch = config.maxCharactersPerBatch
    this.maxItemsPerBatch = config.maxItemsPerBatch
    this.batchDelay = config.batchDelay
    this.maxRetries = config.maxRetries ?? 3
    this.enableFallbackToIndividual = config.enableFallbackToIndividual ?? true
    this.getBatchKey = config.getBatchKey
    this.getCharacters = config.getCharacters
    this.executeBatch = config.executeBatch
    this.executeIndividual = config.executeIndividual
    this.onError = config.onError
  }

  enqueue(data: T): Promise<R> {
    let resolve!: (value: R) => void
    let reject!: (error: Error) => void
    const promise = new Promise<R>((res, rej) => {
      resolve = res
      reject = rej
    })

    const batchKey = this.getBatchKey(data)
    const task: BatchTask<T, R> = { data, resolve, reject }

    this.addTaskToBatch(task, batchKey)
    this.schedule()

    return promise
  }

  // ... (scheduling and batching logic)

  private async executeBatchWithRetry(tasks: BatchTask<T, R>[], batchKey: string, retryCount: number): Promise<void> {
    try {
      const results = await this.executeBatch(tasks.map(task => task.data))

      if (!results) {
        throw new Error("Batch execution results are undefined")
      }

      if (results.length !== tasks.length) {
        throw new BatchCountMismatchError(tasks.length, results.length, results)
      }

      tasks.forEach((task, index) => task.resolve(results[index]))
    }
    catch (error) {
      const err = error as Error

      this.onError?.(err, { batchKey, retryCount, isFallback: false })

      // Only retry on count mismatch errors (LLM returned wrong number of results)
      if (retryCount < this.maxRetries && err instanceof BatchCountMismatchError) {
        const delay = this.calculateBackoffDelay(retryCount)
        await this.sleep(delay)
        return this.executeBatchWithRetry(tasks, batchKey, retryCount + 1)
      }

      if (this.enableFallbackToIndividual && this.executeIndividual) {
        return this.executeFallbackIndividual(tasks, batchKey)
      }

      tasks.forEach(task => task.reject(err))
    }
  }

  private async executeFallbackIndividual(tasks: BatchTask<T, R>[], batchKey: string) {
    await Promise.allSettled(
      tasks.map(async (task) => {
        try {
          if (!this.executeIndividual) {
            throw new Error("executeIndividual is not defined")
          }
          const result = await this.executeIndividual(task.data)
          task.resolve(result)
        }
        catch (error) {
          const err = error as Error
          this.onError?.(err, { batchKey, retryCount: this.maxRetries, isFallback: true })
          task.reject(err)
        }
      }),
    )
  }

  private calculateBackoffDelay(retryCount: number): number {
    return Math.min(BASE_BACKOFF_DELAY_MS * (2 ** retryCount), MAX_BACKOFF_DELAY_MS)
  }
}
```

### Retry Flow Analysis

```
executeBatch(tasks) 
  ├─ SUCCESS: results.length === tasks.length → resolve all tasks
  │
  ├─ BatchCountMismatchError (LLM returned wrong count):
  │   ├─ retryCount < maxRetries (default: 3) → exponential backoff → retry same batch
  │   │   backoff: 1s → 2s → 4s → 8s (capped)
  │   │
  │   └─ retryCount >= maxRetries →
  │       ├─ enableFallbackToIndividual && executeIndividual defined → fallback
  │       └─ otherwise → reject all tasks
  │
  └─ OTHER ERROR (network, API, etc.):
      ├─ enableFallbackToIndividual && executeIndividual defined → fallback immediately (no retry)
      └─ otherwise → reject all tasks
```

**Key design decisions**:

1. **Only `BatchCountMismatchError` triggers retry**: This is specifically for LLM batch translation where the model might return fewer/more translations than paragraphs sent. Other errors (network, auth, rate limit) do NOT retry — they fall through directly.

2. **Exponential backoff**: `min(1000 * 2^retryCount, 8000)` → delays of 1s, 2s, 4s, 8s max.

3. **Fallback to individual execution**: After retries are exhausted (or for non-mismatch errors), each task is executed individually via `executeIndividual`. Uses `Promise.allSettled` so one failure doesn't block others.

4. **Error context callback**: `onError` is called at every error point with `{ batchKey, retryCount, isFallback }` for logging/monitoring.

### Batching Logic

- **Batch key**: Tasks are grouped by `getBatchKey(data)` — typically source language + target language combination
- **Flush triggers**: A batch is flushed when:
  - `tasks.length >= maxItemsPerBatch`
  - `totalCharacters >= maxCharactersPerBatch`
  - Timer expires: `Date.now() >= batch.createdAt + batchDelay`
- **Character overflow**: If adding a task would exceed `maxCharactersPerBatch`, the current batch is flushed first, then a new batch is created

---

## 5. Shadow DOM Mutation Observation

### Source File

`src/entrypoints/host.content/translation-control/page-translation.ts`

### observeMutations Implementation

```typescript
private observeMutations(container: HTMLElement): void {
  const mutationObserver = new MutationObserver((records) => {
    for (const rec of records) {
      if (rec.type === "childList") {
        rec.addedNodes.forEach((node) => {
          if (isHTMLElement(node)) {
            this.addDontWalkIntoElements(node)
            void this.observerTopLevelParagraphs(node)
            this.observeIsolatedDescendantsMutations(node)
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
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class"],
  })

  this.mutationObservers.push(mutationObserver)
  this.observeIsolatedDescendantsMutations(container)
}
```

### observeIsolatedDescendantsMutations Implementation

```typescript
/**
 * Recursively find and observe shadow roots and iframes in an element and its descendants.
 * These can't be found as top level paragraph elements because isolated shadow roots and
 * iframes are not considered as part of the document.
 */
private observeIsolatedDescendantsMutations(element: HTMLElement): void {
  // Check if this element has a shadow root
  if (element.shadowRoot) {
    for (const child of element.shadowRoot.children) {
      if (isHTMLElement(child)) {
        this.observeMutations(child)    // <-- RECURSIVE: sets up a NEW MutationObserver on the shadow child
      }
    }
  }

  // Recursively check children for more shadow roots
  for (const child of element.children) {
    if (isHTMLElement(child)) {
      this.observeIsolatedDescendantsMutations(child)
    }
  }
}
```

### How Shadow Roots Are Discovered and Observed

```
document.body
  ├── observeMutations(body)                     → MutationObserver #1 on body
  │   └── observeIsolatedDescendantsMutations(body)
  │       ├── <custom-element>.shadowRoot found!
  │       │   └── for each child of shadowRoot:
  │       │       └── observeMutations(shadowChild) → MutationObserver #2 on shadow child
  │       │           └── observeIsolatedDescendantsMutations(shadowChild)
  │       │               └── (recurse deeper if more shadow roots)
  │       ├── <normal-div>
  │       │   └── observeIsolatedDescendantsMutations(normal-div)
  │       │       └── (check for shadow roots in children)
  │       └── ...
  │
  │   [Later: MutationObserver #1 fires for new node added to body]
  │   └── rec.addedNodes: <new-element>
  │       ├── addDontWalkIntoElements(new-element)
  │       ├── observerTopLevelParagraphs(new-element)    → walk, label, observe
  │       └── observeIsolatedDescendantsMutations(new-element)  → discover new shadow roots
```

### Key Design Points

1. **MutationObserver can't see into shadow DOMs**: A MutationObserver on `document.body` with `subtree: true` does NOT observe changes inside shadow roots. Each shadow root needs its own observer.

2. **Recursive discovery**: `observeIsolatedDescendantsMutations` walks the entire subtree looking for `element.shadowRoot`. When found, it creates a **new** MutationObserver for each top-level child of the shadow root.

3. **Newly added nodes**: When a MutationObserver fires for `childList` additions, the callback immediately calls `observeIsolatedDescendantsMutations` on the new node. This ensures dynamically-added web components with shadow DOMs get their own observers.

4. **Style/class attribute changes**: The observer filters for `style` and `class` attribute changes. Elements that transition from "don't walk into" (e.g., `display: none`) to "walkable" (e.g., `display: block`) are re-processed via `observerTopLevelParagraphs`. This handles lazy-loaded content and dynamic UI toggling.

5. **Walkability cache**: `dontWalkIntoElementsCache` (a `WeakSet`) tracks which elements were previously non-walkable. The `didChangeToWalkable()` method detects **transitions** from non-walkable to walkable, avoiding unnecessary re-processing of already-walked elements.

6. **Observer cleanup**: All MutationObservers are stored in `this.mutationObservers[]` and disconnected in `stop()`.

### addDontWalkIntoElements Helper

```typescript
private addDontWalkIntoElements(element: HTMLElement): void {
  const dontWalkIntoElements = deepQueryTopLevelSelector(element, isDontWalkIntoButTranslateAsChildElement)
  dontWalkIntoElements.forEach(el => this.dontWalkIntoElementsCache.add(el))
}
```

Uses `deepQueryTopLevelSelector` (which also traverses shadow roots) to find all elements with the `notranslate` class or `DONT_WALK_BUT_TRANSLATE_TAGS`, then caches them in the `WeakSet`.

### didChangeToWalkable

```typescript
private didChangeToWalkable(element: HTMLElement): boolean {
  const wasDontWalkInto = this.dontWalkIntoElementsCache.has(element)
  const isDontWalkIntoNow = isDontWalkIntoButTranslateAsChildElement(element)

  if (isDontWalkIntoNow) {
    this.dontWalkIntoElementsCache.add(element)
  } else {
    this.dontWalkIntoElementsCache.delete(element)
  }

  // Only returns true for true→false transitions (was hidden, now visible)
  return wasDontWalkInto === true && isDontWalkIntoNow === false
}
```

---

## 6. shouldFilterSmallParagraph

### Source File

`src/utils/host/translate/filter-small-paragraph.ts`

### Full Implementation

```typescript
import type { LangCodeISO6393 } from "@read-frog/definitions"
import type { Config } from "@/types/config/config"
import { ISO6393_TO_6391 } from "@read-frog/definitions"
import { getDetectedCodeFromStorage, getFinalSourceCode } from "@/utils/config/languages"

function countWords(text: string, sourceCode: LangCodeISO6393): number {
  // Convert ISO 639-3 (e.g., 'eng') to ISO 639-1 (e.g., 'en') for Intl.Segmenter
  const locale = ISO6393_TO_6391[sourceCode] ?? "en"
  const segmenter = new Intl.Segmenter(locale, { granularity: "word" })
  return [...segmenter.segment(text)].filter(s => s.isWordLike).length
}

async function getSourceCode(configSourceCode: LangCodeISO6393 | "auto"): Promise<LangCodeISO6393> {
  const detectedCode = await getDetectedCodeFromStorage()
  return getFinalSourceCode(configSourceCode, detectedCode)
}

export async function shouldFilterSmallParagraph(
  text: string,
  config: Config,
): Promise<boolean> {
  const { minCharactersPerNode, minWordsPerNode } = config.translate.page
  const { sourceCode } = config.language

  if (minCharactersPerNode > 0 && text.length < minCharactersPerNode)
    return true

  if (minWordsPerNode > 0) {
    const finalSourceCode = await getSourceCode(sourceCode)
    if (countWords(text, finalSourceCode) < minWordsPerNode)
      return true
  }

  return false
}
```

### Analysis

**Two independent filter conditions** (either can trigger filtering):

1. **Character count filter**: `config.translate.page.minCharactersPerNode`
   - If > 0 and text length is below threshold → filter out
   - Simple `text.length` comparison (raw character count, not trimmed)

2. **Word count filter**: `config.translate.page.minWordsPerNode`
   - If > 0, uses `Intl.Segmenter` with **locale-aware** word segmentation
   - Converts ISO 639-3 code (e.g., `'eng'`) to ISO 639-1 (e.g., `'en'`) for Segmenter
   - Counts only `isWordLike` segments (filters out punctuation, spaces)
   - If word count is below threshold → filter out

**Language awareness**: 
- `Intl.Segmenter` handles CJK languages correctly (where words aren't space-delimited)
- For Chinese/Japanese, each semantic word unit is counted as one word
- Falls back to `"en"` locale if the source language code can't be mapped

**Usage points** (both in `translation-modes.ts`):
- After `isNumericContent` check in bilingual mode (line 92): `if (await shouldFilterSmallParagraph(textContent, config)) return`
- After `isNumericContent` check in translationOnly mode (line 234): `if (await shouldFilterSmallParagraph(innerTextContent, config)) return`

**Config source**: `config.translate.page.minCharactersPerNode` and `config.translate.page.minWordsPerNode` — user-configurable thresholds.

---

## Appendix: Translation Cleanup Reference

### Source File

`src/utils/host/translate/dom/translation-cleanup.ts`

```typescript
export function removeTranslatedWrapperWithRestore(wrapper: HTMLElement): void {
  removeShadowHostInTranslatedWrapper(wrapper)

  const translationMode = wrapper.getAttribute(TRANSLATION_MODE_ATTRIBUTE)

  if (translationMode === "translationOnly") {
    // For translation-only mode, find nearest ancestor in originalContentMap and restore
    let currentNode = wrapper.parentNode
    while (currentNode && isHTMLElement(currentNode)) {
      const originalContent = originalContentMap.get(currentNode)
      if (originalContent) {
        const nodeToRestore = currentNode
        batchDOMOperation(() => {
          nodeToRestore.innerHTML = originalContent
        })
        originalContentMap.delete(currentNode)
        return
      }
      currentNode = currentNode.parentNode
    }
  }

  // For bilingual mode or when no original content is found, just remove the wrapper
  batchDOMOperation(() => wrapper.remove())
}
```

**Mode-specific cleanup**:
- **Bilingual mode**: Simply remove the wrapper element (original content remains in DOM)
- **Translation-only mode**: Walk up from the wrapper to find an ancestor with saved `originalContentMap` entry, then restore `innerHTML` from that snapshot. This is necessary because translation-only mode replaces the original DOM nodes entirely.
