# P0 Recursive Translation — Technical Specification

**Date**: 2026-03-16  
**Status**: Draft  
**Scope**: Fix P0-1 (Nested Paragraph Translation), P0-2 (Flex Parent Detection), P0-3 (forceBlockTranslation)

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Read-Frog Reference Algorithm](#2-read-frog-reference-algorithm)
3. [Architecture Decision: Recursive Translation in a Batch Pipeline](#3-architecture-decision-recursive-translation-in-a-batch-pipeline)
4. [Proposed Changes](#4-proposed-changes)
5. [Data Flow: Before vs After](#5-data-flow-before-vs-after)
6. [Verification Plan](#6-verification-plan)

---

## 1. Current State Analysis

### 1.1 Current Pipeline

```
walkAndLabelElement(body)          // walker.ts — labels every element with PARAGRAPH / BLOCK / INLINE attributes
    ↓
collectParagraphs(body)            // PageTranslationManager — querySelectorAll([data-tapword-paragraph])
    ↓
filterTopLevelParagraphs()         // PageTranslationManager — removes paragraphs nested inside other paragraphs
    ↓
ViewportObserver.observe(p)        // for each top-level paragraph
    ↓
onParagraphVisible(element)        // triggered when IntersectionObserver fires
    ↓
extractParagraphText(element)      // translationWalker.ts — extracts text; calls extractTranslationUnits
    ↓
batchQueue.enqueue(text)           // BatchQueue.ts — batches texts, sends to background via chrome.runtime.sendMessage
    ↓
insertTranslation(element, text)   // renderer.ts — inserts translated wrapper into DOM
```

### 1.2 Gap: What Happens to Nested Content

Consider this DOM structure after `walkAndLabelElement`:

```html
<div data-tapword-paragraph data-tapword-walked="uuid-1">
  "some inline text"
  <span data-tapword-inline-node>inline child</span>
  <p data-tapword-paragraph data-tapword-block-node data-tapword-walked="uuid-1">
    "block child text"
  </p>
  "more inline text"
</div>
```

**Current behavior**:

1. `filterTopLevelParagraphs()` keeps outer `<div>` but **removes** inner `<p>` (it has a paragraph ancestor).
2. `onParagraphVisible(<div>)` calls `extractParagraphText(<div>)`.
3. `extractTranslationUnits(<div>)` iterates direct children:
   - `"some inline text"` → accumulated into inline group
   - `<span>` → accumulated (has INLINE_ATTRIBUTE)
   - `<p>` → has BLOCK_ATTRIBUTE → **flushes** inline group → block child skipped (comment: "processed independently")
   - `"more inline text"` → accumulated into new inline group
4. The two inline groups get joined: `"some inline text inline child more inline text"`.
5. This text is enqueued as **a single translation unit** for the entire paragraph.
6. The inner `<p>` with `"block child text"` is **never translated** — it was filtered out and nobody processes it.

**Root cause**: `filterTopLevelParagraphs` correctly identifies only top-level paragraphs for observation, matching read-frog's design. But read-frog's `translateWalkedElement` **recursively** processes block children when a top-level paragraph becomes visible. TapWord's `onParagraphVisible` only extracts inline text and sends one translation — it never recurses into block children.

### 1.3 Gap: Missing Flex Parent Detection

**Current behavior in `renderer.ts::shouldUseInlineInsertion()`**:

```typescript
function shouldUseInlineInsertion(element: HTMLElement): boolean {
    if (FORCE_INLINE_TRANSLATION_TAGS.has(element.tagName)) return true;
    if (isCustomForceBlockTranslation(element)) return false;
    if (element.hasAttribute(INLINE_ATTRIBUTE)) return true;
    if (element.hasAttribute(BLOCK_ATTRIBUTE)) return false;
    const display = window.getComputedStyle(element).display;
    return display.startsWith('inline') || display.includes('flex');
}
```

This checks the **element itself** for flex display. But when inserting a translation for an inline group inside a flex parent, the element being checked is the paragraph element (the parent), and this check is on the element receiving the translation wrapper. The issue is that **the parent of the inline group** may be a flex container, in which case block insertion would break the flex layout. The current code partially handles this in the fallback (`display.includes('flex')`), but does not propagate the flex-parent signal from the translation walker to the renderer in the way read-frog does.

### 1.4 Gap: Missing `forceBlockTranslation` Parameter

**Current behavior**: `insertTranslation()` signature:

```typescript
insertTranslation(paragraphElement, translatedText, mode)
```

No `forceBlockTranslation` parameter exists. In read-frog, when a paragraph has mixed inline + block children, inline groups that are siblings of block children are forced to use block-style translation insertion (`forceBlockTranslation = !isFlexParent`). This ensures visual separation between translated segments. TapWord's current code always uses `shouldUseInlineInsertion(paragraphElement)` which only checks the paragraph element itself, not whether the inline group coexists with block siblings.

---

## 2. Read-Frog Reference Algorithm

### 2.1 `translateWalkedElement` — The Recursive Core

```
translateWalkedElement(element, walkId, config):
│
├─ Guard: already translated? walkId mismatch? → return
│
├─ IF element is a PARAGRAPH:
│   │
│   ├─ Scan children for any BLOCK child → hasBlockNodeChild
│   ├─ Compute isFlexParent = getComputedStyle(element).display.includes("flex")
│   │
│   ├─ SIMPLE CASE (no block children):
│   │   └─ translateNodes([element], walkId, toggle, config)
│   │       // Entire element is one translation unit
│   │
│   └─ COMPLEX CASE (mixed block + inline children):
│       ├─ iterate children:
│       │   ├─ inline/text node → accumulate into consecutiveInlineNodes[]
│       │   └─ block node →
│       │       ├─ flush: translateNodes(consecutiveInlineNodes, ..., forceBlock=!isFlexParent)
│       │       ├─ reset accumulator
│       │       └─ recurse: translateWalkedElement(blockChild, ...)
│       └─ flush trailing inline nodes
│
└─ IF element is NOT a PARAGRAPH (structural container):
    └─ recurse into HTML children + shadow root children
```

### 2.2 Key Behaviors

1. **Recursive block-child processing**: When a paragraph has block children, each block child is recursively passed to `translateWalkedElement`. That block child may itself be a paragraph with its own inline groups, or just a structural container.

2. **`forceBlockTranslation = !isFlexParent`**: When flushing inline groups that are siblings of block children, the `forceBlockTranslation` flag is set to `true` UNLESS the parent is a flex container. This ensures visual separation (block-style insertion) in normal flow, but preserves flex layout when the parent is `display: flex`.

3. **Flex parent detection in two places**:
   - **In the walker** (`translateWalkedElement`): `isFlexParent` check on the paragraph element itself to determine `forceBlockTranslation` for inline groups.
   - **In the insertion** (`isForceInlineTranslation`): Checks the **target node** for `display.includes("flex")` or `FORCE_INLINE_TRANSLATION_TAGS`. This is a second layer of protection.

4. **Concurrency**: All `translateNodes()` calls and recursive `translateWalkedElement()` calls are collected as promises and awaited with `Promise.all()`.

### 2.3 `translateNodes` → `insertTranslatedNodeIntoWrapper`

The insertion priority chain in read-frog:

```
customForceBlock > forceInlineTranslation > forceBlockTranslation > isInlineTransNode > isBlockTransNode
```

- `customForceBlock`: Site-specific override (e.g., GitHub task-lists).
- `forceInlineTranslation`: Target node is in `FORCE_INLINE_TRANSLATION_TAGS` **or** target node's display includes "flex".
- `forceBlockTranslation`: Passed from `translateWalkedElement` — `true` when inline group coexists with block siblings in a non-flex parent.
- `isInlineTransNode`: Target has `data-read-frog-inline-node`.
- `isBlockTransNode`: Target has `data-read-frog-block-node`.

---

## 3. Architecture Decision: Recursive Translation in a Batch Pipeline

### 3.1 The Core Difference

| Aspect | Read-Frog | TapWord |
|--------|-----------|---------|
| Translation call | Direct `fetch()` inside `translateNodes()` | `chrome.runtime.sendMessage` → background BatchQueue |
| Concurrency | `Promise.all()` on all inline groups + block children | Single `batchQueue.enqueue(text)` per paragraph |
| Entry point | `translateWalkedElement(element)` called by IntersectionObserver | `onParagraphVisible(element)` called by ViewportObserver |
| Translation granularity | Multiple translation units per paragraph (each inline group is separate) | One text string per paragraph (all inline groups joined) |

### 3.2 Design Decision

**Approach: Recursive processing inside `onParagraphVisible`, one enqueue per translation unit.**

Instead of converting TapWord to read-frog's inline-fetch model, we keep the existing batch pipeline and make `onParagraphVisible` recursively process the paragraph:

1. When `onParagraphVisible(element)` fires for a top-level paragraph:
   - Detect if the paragraph has block children.
   - **Simple case** (no block children): Extract text, enqueue, render — same as today.
   - **Complex case** (mixed children): 
     a. Extract inline groups as separate `TranslationUnit`s (already done by `extractTranslationUnits`).
     b. For each inline group: enqueue separately, then render the translation **adjacent to that group's nodes** (not at the paragraph level).
     c. For each block child: **recursively** call the same paragraph-processing logic on the block child.

2. Each translation unit gets its own `batchQueue.enqueue()` call. The BatchQueue already handles batching multiple enqueue calls into efficient batched requests.

3. The `insertTranslation` function is modified to accept a **target context** (specific nodes within a paragraph) rather than always appending to the paragraph element.

**Why this works**: The BatchQueue already accumulates multiple `enqueue()` calls within `batchDelayMs` (100ms) into a single batch request. So enqueuing 3 inline groups from one paragraph + 2 from a block child will likely be batched together into one or two background requests. The pipeline remains intact.

### 3.3 Key Insight: Translation Unit Rendering

Currently `insertTranslation(paragraphElement, text, mode)` appends the translation wrapper as the last child of the paragraph. For recursive processing, we need to insert translations:
- **After** the last node of each inline group (for groups within a mixed paragraph).
- **Inside** the block child element (handled by recursion — the block child is a paragraph itself).

This means `insertTranslation` needs to support **per-unit insertion** rather than only paragraph-level insertion.

---

## 4. Proposed Changes

### 4.1 File: `src/11_full_translate/types/index.ts`

**Add `TranslationUnit` type enhancement:**

```typescript
/** A group of consecutive inline nodes forming a single translation unit. */
export interface TranslationUnit {
    /** The consecutive inline nodes that form this unit. */
    nodes: Node[];
    /** Extracted text content for translation. */
    text: string;
    /** If true, insert translation as block element (for units sibling to block children). */
    forceBlockTranslation: boolean;
}
```

Move `TranslationUnit` from `translationWalker.ts` to `types/index.ts` so it's shared across modules.

### 4.2 File: `src/11_full_translate/dom/translationWalker.ts`

**Modify `extractTranslationUnits` to detect block presence and set `forceBlockTranslation`:**

```typescript
// Current signature:
export function extractTranslationUnits(
    paragraphElement: HTMLElement,
    range: PageTranslateRange,
): TranslationUnit[]

// New signature (unchanged externally, but the returned TranslationUnit now includes forceBlockTranslation):
export function extractTranslationUnits(
    paragraphElement: HTMLElement,
    range: PageTranslateRange,
): TranslationUnit[]
```

**Implementation changes:**

```typescript
export function extractTranslationUnits(
    paragraphElement: HTMLElement,
    range: PageTranslateRange,
): TranslationUnit[] {
    const units: TranslationUnit[] = [];
    let currentInlineNodes: Node[] = [];

    // P0-1 + P0-2: Detect block children and flex parent
    let hasBlockChild = false;
    for (const child of Array.from(paragraphElement.childNodes)) {
        if (isHTMLElement(child) && child.hasAttribute(BLOCK_ATTRIBUTE)) {
            hasBlockChild = true;
            break;
        }
    }

    // P0-2: Flex parent detection
    const isFlexParent = hasBlockChild
        ? window.getComputedStyle(paragraphElement).display.includes('flex')
        : false;

    // P0-3: forceBlockTranslation = hasBlockChild && !isFlexParent
    const forceBlock = hasBlockChild && !isFlexParent;

    for (const child of Array.from(paragraphElement.childNodes)) {
        if (isTextNode(child) && child.textContent?.trim()) {
            currentInlineNodes.push(child);
        } else if (isHTMLElement(child)) {
            if (isTranslatedWrapperNode(child)) {
                continue;
            }

            if (child.hasAttribute(BLOCK_ATTRIBUTE)) {
                flushInlineGroup(currentInlineNodes, range, units, forceBlock);
                currentInlineNodes = [];
                // Block children are NOT added to units — they are processed recursively
            } else if (child.hasAttribute(INLINE_ATTRIBUTE) || isShallowInlineTransNode(child)) {
                currentInlineNodes.push(child);
            } else {
                flushInlineGroup(currentInlineNodes, range, units, forceBlock);
                currentInlineNodes = [];
            }
        }
    }

    flushInlineGroup(currentInlineNodes, range, units, forceBlock);

    return units;
}
```

**Add: `collectBlockChildren` — returns block child elements for recursive processing:**

```typescript
/**
 * Collect direct block children of a paragraph element.
 * These need to be recursively processed as independent paragraphs.
 */
export function collectBlockChildren(paragraphElement: HTMLElement): HTMLElement[] {
    const blockChildren: HTMLElement[] = [];
    for (const child of Array.from(paragraphElement.childNodes)) {
        if (isHTMLElement(child) && child.hasAttribute(BLOCK_ATTRIBUTE)) {
            blockChildren.push(child);
        }
    }
    return blockChildren;
}
```

**Modify `flushInlineGroup` to accept `forceBlock`:**

```typescript
function flushInlineGroup(
    nodes: Node[],
    range: PageTranslateRange,
    units: TranslationUnit[],
    forceBlockTranslation: boolean = false,
): void {
    if (nodes.length === 0) return;

    const text = nodes
        .map(n => extractTextContent(n as HTMLElement | Text, range))
        .join('')
        .trim();

    if (text) {
        units.push({ nodes: [...nodes], text, forceBlockTranslation });
    }
}
```

**Modify `extractParagraphText` — no signature change needed**, it still joins all unit texts.

### 4.3 File: `src/11_full_translate/dom/renderer.ts`

**Modify `insertTranslation` to support per-unit insertion:**

```typescript
// Current signature:
export function insertTranslation(
    paragraphElement: HTMLElement,
    translatedText: string,
    mode: FullTranslateMode,
): void

// New signature — add optional parameters for unit-level insertion:
export function insertTranslation(
    paragraphElement: HTMLElement,
    translatedText: string,
    mode: FullTranslateMode,
    options?: InsertTranslationOptions,
): void
```

**New type:**

```typescript
export interface InsertTranslationOptions {
    /** If provided, insert after this node instead of appending to paragraphElement. */
    insertAfterNode?: Node;
    /** Force block-style insertion regardless of element classification. */
    forceBlockTranslation?: boolean;
}
```

**Modified `insertTranslation` implementation:**

```typescript
export function insertTranslation(
    paragraphElement: HTMLElement,
    translatedText: string,
    mode: FullTranslateMode,
    options?: InsertTranslationOptions,
): void {
    // For unit-level insertion, check within the local context (not entire paragraph)
    if (!options?.insertAfterNode && hasTranslatedWrapper(paragraphElement)) return;

    const useInline = options?.forceBlockTranslation === true
        ? false  // forceBlock overrides → use block
        : shouldUseInlineInsertion(paragraphElement);

    const wrapperSpan = document.createElement('span');
    wrapperSpan.className = `${NOTRANSLATE_CLASS} ${CONTENT_WRAPPER_CLASS}`;

    const translatedSpan = document.createElement('span');
    translatedSpan.textContent = translatedText;

    if (useInline) {
        appendInlineSeparator(wrapperSpan);
        translatedSpan.className = `${NOTRANSLATE_CLASS} ${INLINE_CONTENT_CLASS}`;
    } else {
        appendBlockSeparator(wrapperSpan);
        translatedSpan.className = `${NOTRANSLATE_CLASS} ${BLOCK_CONTENT_CLASS}`;
    }

    wrapperSpan.appendChild(translatedSpan);

    const batcher = DomBatcher.getInstance();

    if (mode === 'translationOnly') {
        batcher.queue(() => applyTranslationOnlyMode(paragraphElement, wrapperSpan));
    } else if (options?.insertAfterNode) {
        // Unit-level: insert after the last node of the inline group
        batcher.queue(() => {
            options.insertAfterNode!.parentNode?.insertBefore(
                wrapperSpan,
                options.insertAfterNode!.nextSibling,
            );
        });
    } else {
        batcher.queue(() => paragraphElement.appendChild(wrapperSpan));
    }
}
```

**Modify `shouldUseInlineInsertion` to add flex parent check (P0-2):**

```typescript
function shouldUseInlineInsertion(element: HTMLElement): boolean {
    if (FORCE_INLINE_TRANSLATION_TAGS.has(element.tagName)) return true;
    if (isCustomForceBlockTranslation(element)) return false;
    if (element.hasAttribute(INLINE_ATTRIBUTE)) return true;
    if (element.hasAttribute(BLOCK_ATTRIBUTE)) return false;

    // Fallback: check computed display
    const display = window.getComputedStyle(element).display;
    if (display.startsWith('inline')) return true;

    // P0-2: Flex parent → use inline to preserve flex layout
    if (display.includes('flex')) return true;

    return false;
}
```

> Note: The current code already contains `display.includes('flex')` in the fallback. This part is already partially handled. The main fix for P0-2 is the `forceBlockTranslation` parameter override logic above (when `forceBlock = !isFlexParent`, flex parents get `forceBlock = false`).

### 4.4 File: `src/11_full_translate/PageTranslationManager.ts` (Major Changes)

This is where the recursive processing logic lives. The current `onParagraphVisible` treats each paragraph as a single translation unit. We need to make it handle the complex case.

**New import:**

```typescript
import {
    extractTranslationUnits,
    extractParagraphText,
    shouldTranslateParagraph,
    collectBlockChildren,
    insertTranslation,
    removeAllTranslations,
    removeWalkLabels,
    createSpinner,
    removeSpinner,
} from './dom';
import type { TranslationUnit } from './types';
import { PARAGRAPH_ATTRIBUTE, WALKED_ATTRIBUTE, BLOCK_ATTRIBUTE } from './constants';
```

**Replace `onParagraphVisible` with a recursive `translateParagraph`:**

```typescript
/**
 * Recursively translate a paragraph element.
 * For paragraphs with only inline children: translates as a single unit (simple case).
 * For paragraphs with mixed block + inline children: translates each inline group
 * separately and recursively processes block children (complex case).
 * For non-paragraph elements: recurses into child elements.
 */
private async translateElement(element: HTMLElement): Promise<void> {
    // Guard: already processing or session changed
    if (this.translatingNodes.has(element)) return;
    if (!this.isRunning || !this.batchQueue || !this.walkId) return;
    if (element.getAttribute(WALKED_ATTRIBUTE) !== this.walkId) return;

    // Non-paragraph: recurse into children
    if (!element.hasAttribute(PARAGRAPH_ATTRIBUTE)) {
        const promises: Promise<void>[] = [];
        for (const child of Array.from(element.childNodes)) {
            if (isHTMLElement(child)) {
                promises.push(this.translateElement(child));
            }
        }
        await Promise.all(promises);
        return;
    }

    // --- Paragraph element ---
    this.translatingNodes.add(element);

    const blockChildren = collectBlockChildren(element);
    const hasBlockChildren = blockChildren.length > 0;

    if (!hasBlockChildren) {
        // SIMPLE CASE: no block children → single translation unit (existing behavior)
        await this.translateSimpleParagraph(element);
    } else {
        // COMPLEX CASE: mixed block + inline children → multiple units + recursion
        await this.translateMixedParagraph(element, blockChildren);
    }
}

/** Simple case: translate the entire paragraph as one unit. */
private async translateSimpleParagraph(element: HTMLElement): Promise<void> {
    const text = extractParagraphText(element, this.config.range);
    if (!shouldTranslateParagraph(text, this.config.minCharactersPerNode, this.config.minWordsPerNode)) {
        return;
    }

    const spinner = createSpinner();
    element.appendChild(spinner);

    try {
        const translated = await this.translateText(text);
        removeSpinner(element);
        if (translated) {
            insertTranslation(element, translated, this.config.mode);
        }
    } catch (error) {
        logger.error('Translation failed for paragraph', error);
        removeSpinner(element);
    }
}

/** Complex case: translate inline groups separately and recurse into block children. */
private async translateMixedParagraph(
    element: HTMLElement,
    blockChildren: HTMLElement[],
): Promise<void> {
    const units = extractTranslationUnits(element, this.config.range);
    const promises: Promise<void>[] = [];

    // Translate each inline group
    for (const unit of units) {
        if (!shouldTranslateParagraph(unit.text, this.config.minCharactersPerNode, this.config.minWordsPerNode)) {
            continue;
        }
        promises.push(this.translateUnit(element, unit));
    }

    // Recursively translate block children
    for (const blockChild of blockChildren) {
        promises.push(this.translateElement(blockChild));
    }

    await Promise.all(promises);
}

/** Translate a single TranslationUnit (inline group) and insert the result at the correct DOM position. */
private async translateUnit(
    paragraphElement: HTMLElement,
    unit: TranslationUnit,
): Promise<void> {
    const lastNode = unit.nodes[unit.nodes.length - 1];

    try {
        const translated = await this.translateText(unit.text);
        if (translated) {
            insertTranslation(paragraphElement, translated, this.config.mode, {
                insertAfterNode: lastNode,
                forceBlockTranslation: unit.forceBlockTranslation,
            });
        }
    } catch (error) {
        logger.error('Translation failed for unit', error);
    }
}

/** Core translation logic: check cache, rate-limit, enqueue. */
private async translateText(text: string): Promise<string | null> {
    try {
        // Check cache first
        const cached = await this.cache.get(text, this.config.sourceLang, this.config.targetLang);
        if (cached) return cached;

        // Rate limit then enqueue
        await this.rateLimiter.acquire();

        if (!this.isRunning || !this.batchQueue) return null;

        const translated = await this.batchQueue.enqueue(text);

        // Cache the result
        await this.cache.set(text, this.config.sourceLang, this.config.targetLang, translated);

        return translated;
    } catch (error) {
        logger.error('Translation failed', error);
        return null;
    }
}
```

**Modify `onParagraphVisible` to delegate to `translateElement`:**

```typescript
private async onParagraphVisible(element: HTMLElement): Promise<void> {
    await this.translateElement(element);
}
```

**Update `dom/index.ts` exports to include new functions:**

```typescript
export {
    extractTranslationUnits,
    extractParagraphText,
    shouldTranslateParagraph,
    collectBlockChildren,      // NEW
} from './translationWalker';
```

### 4.5 File: `src/11_full_translate/dom/filter.ts`

**Add: `isHTMLElement` import needed by PageTranslationManager.**

No changes needed — `isHTMLElement` is already exported from the dom index.

### 4.6 Summary of All File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `types/index.ts` | Modify | Add `forceBlockTranslation` field to `TranslationUnit` |
| `dom/translationWalker.ts` | Modify | Add block detection, flex parent check, `forceBlockTranslation` flag to units; add `collectBlockChildren()` |
| `dom/renderer.ts` | Modify | Add `InsertTranslationOptions` type; update `insertTranslation` to support per-unit insertion and `forceBlockTranslation` override |
| `dom/index.ts` | Modify | Export `collectBlockChildren` |
| `PageTranslationManager.ts` | Major refactor | Replace flat `onParagraphVisible` with recursive `translateElement` / `translateSimpleParagraph` / `translateMixedParagraph` / `translateUnit` / `translateText` |

---

## 5. Data Flow: Before vs After

### 5.1 Before (Single-Unit Per Paragraph)

```
IntersectionObserver fires for <div paragraph>
    ↓
onParagraphVisible(<div>)
    ↓
extractParagraphText — joins all inline text → "some inline text inline child more inline text"
    ↓
batchQueue.enqueue("some inline text inline child more inline text")
    ↓
insertTranslation(<div>, "translated text", mode)
    ↓
Translation appended as last child of <div>

Block child <p>"block child text"</p> → NEVER TRANSLATED ❌
```

### 5.2 After (Recursive Multi-Unit)

```
IntersectionObserver fires for <div paragraph>
    ↓
translateElement(<div>)
    ↓
detectBlockChildren → [<p>] → COMPLEX CASE
    ↓
extractTranslationUnits(<div>) → [
    { nodes: [text:"some inline text", <span>], text: "some inline text inline child", forceBlock: true },
    { nodes: [text:"more inline text"],         text: "more inline text",              forceBlock: true },
]
collectBlockChildren(<div>) → [<p>]
    ↓
Promise.all([
    translateUnit(unit1) → enqueue("some inline text inline child") → insertTranslation after <span>, forceBlock=true
    translateUnit(unit2) → enqueue("more inline text") → insertTranslation after text node, forceBlock=true
    translateElement(<p>) → RECURSE:
        ↓
        <p> is PARAGRAPH → no block children → SIMPLE CASE
        ↓
        translateSimpleParagraph(<p>) → enqueue("block child text") → insertTranslation(<p>, ...) ✅
])
```

### 5.3 Batch Queue Behavior

All three `enqueue()` calls happen within the same event loop microtask chain. Given `batchDelayMs = 100ms`, they'll accumulate in the same batch:

```
BatchQueue receives within ~0ms:
  1. "some inline text inline child"
  2. "more inline text"
  3. "block child text"

→ One batch request to background with 3 texts
→ Background returns 3 translations
→ Each promise resolves → insertTranslation called for each
```

This is efficient — potentially more efficient than today's approach of joining text (since the LLM can handle per-segment context).

---

## 6. Verification Plan

### 6.1 Type Check

```bash
npm run type-check
```

Must pass with zero errors across all modules.

### 6.2 Manual Test Cases

#### Test Case 1: Nested Block Paragraphs (P0-1)

**Page**: Any page with `<div>text <p>inner text</p> more text</div>` structure (e.g., Wikipedia articles, Medium posts).

**Expected**: Both "text ... more text" and "inner text" get translated.

#### Test Case 2: Flex Layout Preservation (P0-2)

**Page**: Any page with `display: flex` container that has text children (e.g., nav bars, card layouts).

**Expected**: Translation inserted inline (no layout break). No new flex items created.

#### Test Case 3: Block-Style Separation (P0-3)

**Page**: A page with mixed block + inline content inside a non-flex container.

**Expected**: Translated inline groups appear as block-level elements (with `<br>` separator), visually separated from the original text.

#### Test Case 4: Simple Paragraph Regression

**Page**: A page with simple `<p>` elements containing only inline content.

**Expected**: Behavior unchanged — single translation appended to paragraph.

#### Test Case 5: Deeply Nested Recursion

**DOM**:
```html
<article paragraph>
  "Article intro"
  <section paragraph block>
    "Section text"
    <div paragraph block>
      "Deep nested text"
    </div>
  </section>
  "Article outro"
</article>
```

**Expected**: All three levels get translated recursively.

#### Test Case 6: Dynamic Content (MutationObserver)

**Page**: SPA with dynamically loaded content containing nested paragraphs.

**Expected**: New content is walked, labeled, and top-level paragraphs are observed. When visible, recursive translation processes all nested content.

### 6.3 Edge Cases to Verify

- **Empty inline groups**: `<div paragraph><p block>text</p></div>` — no inline text, only block child. Should only translate the block child.
- **All-inline paragraph**: `<div paragraph><span>a</span><span>b</span></div>` — no block children. Simple case, same as before.
- **Flex parent with blocks**: `<div paragraph style="display:flex"><span>a</span><div block>b</div></div>` — `forceBlockTranslation = false` (flex parent), inline insertion used.
- **TranslationOnly mode with units**: Needs investigation — `translationOnlyMode` replaces innerHTML, which may conflict with per-unit insertion. For the initial implementation, `translationOnly` mode with mixed content should fall back to simple paragraph behavior.

### 6.4 Automated Tests

After implementation, add unit tests to:

- `tests/11_full_translate/dom/translationWalker.test.ts`:
  - `extractTranslationUnits` with mixed block + inline children returns correct units with `forceBlockTranslation` flag.
  - `collectBlockChildren` returns only direct block-attributed children.
- `tests/11_full_translate/dom/renderer.test.ts`:
  - `insertTranslation` with `insertAfterNode` inserts at correct position.
  - `insertTranslation` with `forceBlockTranslation: true` uses block separator.
- `tests/11_full_translate/PageTranslationManager.test.ts`:
  - Mock BatchQueue and verify recursive processing calls `enqueue` for each unit + block child.

---

## Appendix A: `translationOnly` Mode Considerations

The `translationOnly` mode in read-frog uses `originalContentMap` to save and restore `innerHTML`. When processing multiple units within the same paragraph, `translationOnly` mode replaces the original content entirely. For the complex case (mixed block + inline), this creates complications:

- Each unit's insertion would overwrite the parent's `innerHTML`.
- Restoring requires knowing which parts were translated.

**Recommendation**: For the initial P0 fix, **restrict recursive multi-unit processing to `bilingual` mode only**. For `translationOnly` mode with mixed content, fall back to the simple case (treat entire paragraph as one unit). This matches the most common use case and avoids HTML mutation issues.

---

## Appendix B: Spinner Behavior in Complex Case

In the simple case, a single spinner is shown for the paragraph. In the complex case (multiple units), showing spinners for each inline group would be visually noisy.

**Recommendation**: Show a single spinner on the paragraph element at the start of `translateMixedParagraph`, then remove it after all promises resolve. Individual units do not show their own spinners.
