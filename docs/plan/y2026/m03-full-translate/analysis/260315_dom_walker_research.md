# Read Frog DOM Walker — Deep Research & Code Analysis

> **Date**: 2026-03-15  
> **Purpose**: Detailed code-level analysis of Read Frog's DOM Walker, Block Detector, Filter logic, Translation Walker, and DOM Insertion strategy.  
> **Source Project**: `read-frog` — https://github.com/mengxi-ream/read-frog  
> **Complements**: `read_frog_architecture_analysis.md` (high-level architecture); this document focuses on exact algorithms and code.

---

## Table of Contents

1. [Core Types & Constants](#1-core-types--constants)
2. [walkAndLabelElement() — Complete Algorithm](#2-walkandlabelelement--complete-algorithm)
3. [extractTextContent() — Complete Algorithm](#3-extracttextcontent--complete-algorithm)
4. [Filter Functions — Complete Reference](#4-filter-functions--complete-reference)
5. [translateWalkedElement() — Translation Walker](#5-translatewalkedelement--translation-walker)
6. [Translation Modes — Bilingual & TranslationOnly](#6-translation-modes--bilingual--translationonly)
7. [Translation Insertion Strategy](#7-translation-insertion-strategy)
8. [DOM Batching Strategy](#8-dom-batching-strategy)
9. [Supporting Utilities](#9-supporting-utilities)
10. [Key Adaptation Notes for TapWord](#10-key-adaptation-notes-for-tapword)

---

## 1. Core Types & Constants

### 1.1 TransNode Type

**File**: `src/types/dom.ts`

```typescript
export interface Point {
  x: number
  y: number
}

export type TransNode = HTMLElement | Text
```

`TransNode` is the fundamental union type — every node in the translation pipeline is either an `HTMLElement` or a `Text` node. This simplification deliberately excludes `Comment`, `ProcessingInstruction`, `SVGElement`, etc.

### 1.2 DOM Label Constants

**File**: `src/utils/constants/dom-labels.ts`

```typescript
export const CONTENT_WRAPPER_CLASS = "read-frog-translated-content-wrapper"
export const INLINE_CONTENT_CLASS = "read-frog-translated-inline-content"
export const BLOCK_CONTENT_CLASS = "read-frog-translated-block-content"

export const WALKED_ATTRIBUTE = "data-read-frog-walked"
export const PARAGRAPH_ATTRIBUTE = "data-read-frog-paragraph"
export const BLOCK_ATTRIBUTE = "data-read-frog-block-node"
export const INLINE_ATTRIBUTE = "data-read-frog-inline-node"

export const TRANSLATION_MODE_ATTRIBUTE = "data-read-frog-translation-mode"

export const MARK_ATTRIBUTES = new Set([
  WALKED_ATTRIBUTE, PARAGRAPH_ATTRIBUTE, BLOCK_ATTRIBUTE, INLINE_ATTRIBUTE
])

export const NOTRANSLATE_CLASS = "notranslate"
export const REACT_SHADOW_HOST_CLASS = "read-frog-react-shadow-host"
export const TRANSLATION_ERROR_CONTAINER_CLASS = "read-frog-translation-error-container"
```

**Key semantics**:
- `WALKED_ATTRIBUTE` (`data-read-frog-walked`): Value is the `walkId` (UUID). Marks an element as visited in a specific walk session.
- `PARAGRAPH_ATTRIBUTE` (`data-read-frog-paragraph`): No value — presence means "this element contains inline text children and is a translation unit."
- `BLOCK_ATTRIBUTE` (`data-read-frog-block-node`): This element is classified as block-level.
- `INLINE_ATTRIBUTE` (`data-read-frog-inline-node`): This element is classified as inline.
- `CONTENT_WRAPPER_CLASS`: The `<span>` that wraps all translated output.
- `NOTRANSLATE_CLASS`: Standard `notranslate` class that signals "do not translate this element."

### 1.3 DOM Rule Constants

**File**: `src/utils/constants/dom-rules.ts`

```typescript
export const FORCE_BLOCK_TAGS = new Set([
  "BODY", "H1", "H2", "H3", "H4", "H5", "H6", "BR",
  "FORM", "SELECT", "BUTTON", "LABEL",
  "UL", "OL", "LI",
  "BLOCKQUOTE", "PRE",
  "ARTICLE", "SECTION", "FIGURE", "FIGCAPTION",
  "HEADER", "FOOTER", "MAIN", "NAV",
])

export const MATH_TAGS = new Set([
  "math", "maction", "annotation", "annotation-xml", "menclose", "merror",
  "mfenced", "mfrac", "mi", "mmultiscripts", "mn", "mo", "mover",
  "mpadded", "mphantom", "mprescripts", "mroot", "mrow", "ms", "mspace",
  "msqrt", "mstyle", "msub", "msubsup", "msup", "mtable", "mtd", "mtext",
  "mtr", "munder", "munderover", "semantics",
])

export const DONT_WALK_AND_TRANSLATE_TAGS = new Set([
  "HEAD", "TITLE", "HR", "INPUT", "TEXTAREA", "IMG", "VIDEO", "AUDIO",
  "CANVAS", "SOURCE", "TRACK", "META", "SCRIPT", "NOSCRIPT", "STYLE",
  "LINK", "RT", "RP", "PRE", "svg", ...MATH_TAGS,
])

export const DONT_WALK_BUT_TRANSLATE_TAGS = new Set(["CODE", "TIME"])

export const FORCE_INLINE_TRANSLATION_TAGS = new Set([
  "A", "BUTTON", "SELECT", "OPTION", "SPAN",
])

export const MAIN_CONTENT_IGNORE_TAGS = new Set(["HEADER", "FOOTER", "NAV", "NOSCRIPT"])

export const CUSTOM_DONT_WALK_INTO_ELEMENT_SELECTOR_MAP: Record<string, string[]> = {
  "chatgpt.com": [".ProseMirror"],
  "arxiv.org": [".ltx_listing"],
  "www.reddit.com": [
    "faceplate-screen-reader-content > *",
    "reddit-header-large *",
    "shreddit-comment-action-row > *",
    "shreddit-post-flair",
  ],
  "www.youtube.com": [
    "#masthead-container *", "#guide-inner-content *", "#metadata *",
    "#channel-name", ".translate-button",
    ".yt-lockup-metadata-view-model__metadata",
    ".yt-spec-avatar-shape__badge-text",
    ".shortsLockupViewModelHostOutsideMetadataSubhead",
    "ytd-comments-header-renderer", "#top-row", "#header-author",
    "#reply-button-end", "#more-replies", "#info", "#badges *",
    ".ytp-caption-window-container",
    ".read-frog-subtitles-view",
    ".read-frog-subtitles-state-message",
    ".read-frog-subtitles-translate-button",
  ],
  "discord.com": [
    "[id^=\"message-username\"]", "span[class*=\"-timestamp\"]",
    "div[class*=\"-repliedMessage\"]", "li[class*=\"-containerDefault\"]",
    "[class*=\"-subtitleContainer\"]",
    "[class*=\"-formWithLoadedChatInput\"]",
  ],
  "github.com": [
    "[aria-labelledby=\"folders-and-files\"] *", "header *",
    "#repository-container-header *",
    "[class*=\"OverviewContent-module__Box_1--\"] *",
  ],
}

export const CUSTOM_FORCE_BLOCK_TRANSLATION_SELECTOR_MAP: Record<string, string[]> = {
  "github.com": ["task-lists"],
  "engoo.com": [
    "#windowexercise-2 > div > div > div.css-ep7xq6 > div > div > div.css-19m2fbm *",
  ],
  "www.youtube.com": ["yt-attributed-string > span"],
}
```

**Three-tier classification of tags**:

| Category | Tags | Behavior |
|---|---|---|
| `FORCE_BLOCK_TAGS` | BODY, H1-H6, BR, LI, ARTICLE, etc. | Always block, regardless of CSS display |
| `DONT_WALK_AND_TRANSLATE_TAGS` | HEAD, SCRIPT, STYLE, IMG, SVG, PRE, MathML, etc. | Skip entirely — don't walk into, don't include in parent text |
| `DONT_WALK_BUT_TRANSLATE_TAGS` | CODE, TIME | Don't recurse into, but include their text when parent is translated |
| `FORCE_INLINE_TRANSLATION_TAGS` | A, BUTTON, SELECT, OPTION, SPAN | Force inline translation style (not inline node classification) |
| `MAIN_CONTENT_IGNORE_TAGS` | HEADER, FOOTER, NAV, NOSCRIPT | Skipped when `range !== "all"` and not inside `<article>` or `<main>` |

---

## 2. walkAndLabelElement() — Complete Algorithm

**File**: `src/utils/host/dom/traversal.ts`

### 2.1 Full Source Code

```typescript
export function walkAndLabelElement(
  element: HTMLElement,
  walkId: string,
  config: Config,
): { forceBlock: boolean, isInlineNode: boolean } {
  // STEP 1: Early exit for elements that should not be walked into
  if (isDontWalkIntoButTranslateAsChildElement(element) ||
      isDontWalkIntoAndDontTranslateAsChildElement(element, config)) {
    return {
      forceBlock: false,
      isInlineNode: false,
    }
  }

  // STEP 2: Mark this element as walked with the session UUID
  element.setAttribute(WALKED_ATTRIBUTE, walkId)

  // STEP 3: Handle Shadow DOM — recurse into shadow root children
  if (element.shadowRoot) {
    for (const child of element.shadowRoot.children) {
      if (isHTMLElement(child)) {
        walkAndLabelElement(child, walkId, config)
      }
    }
  }

  let hasInlineNodeChild = false
  let forceBlock = false

  // STEP 4: Filter valid child nodes (text nodes + walkable HTML elements)
  const validChildNodes = Array.from(element.childNodes).filter((child: ChildNode) => {
    if (child.nodeType === Node.TEXT_NODE)
      return true
    if (isHTMLElement(child)) {
      return !((isDontWalkIntoButTranslateAsChildElement(child) ||
                isDontWalkIntoAndDontTranslateAsChildElement(child, config)))
    }
    return false
  })

  // STEP 5: Iterate valid children — classify and recurse
  for (const child of validChildNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent?.trim()) {
        hasInlineNodeChild = true
      }
      continue
    }

    if (isHTMLElement(child)) {
      const result = walkAndLabelElement(child, walkId, config)

      // forceBlock propagates upward from descendants
      forceBlock = forceBlock || result.forceBlock

      if (result.isInlineNode) {
        hasInlineNodeChild = true
      }
    }
  }

  // STEP 6: If any inline child exists, mark as paragraph
  if (hasInlineNodeChild) {
    element.setAttribute(PARAGRAPH_ATTRIBUTE, "")
  }

  // STEP 7: Check if this element itself forces block
  forceBlock = forceBlock || FORCE_BLOCK_TAGS.has(element.tagName)

  // STEP 8: Skip empty elements (unless forceBlock)
  if (element.textContent?.trim() === "" && !forceBlock) {
    return {
      forceBlock: false,
      isInlineNode: false,
    }
  }

  // STEP 9: Determine and apply block/inline classification
  const isInlineNode = isShallowInlineHTMLElement(element)

  if (isShallowBlockHTMLElement(element) || forceBlock || isCustomForceBlockTranslation(element)) {
    element.setAttribute(BLOCK_ATTRIBUTE, "")
  }
  else if (isInlineNode) {
    element.setAttribute(INLINE_ATTRIBUTE, "")
  }

  return {
    forceBlock,
    isInlineNode,
  }
}
```

### 2.2 Step-by-Step Walkthrough

**Step 1 — Gate Check**: Before doing anything, check if this element should be skipped entirely. Two categories:
- `isDontWalkIntoButTranslateAsChildElement`: tags like `<code>`, `<time>`, or elements with `.notranslate` class. Their inner text IS included in parent translation; we just don't recurse.
- `isDontWalkIntoAndDontTranslateAsChildElement`: tags like `<script>`, `<style>`, hidden elements, per-site custom selectors. Their content is excluded from everything.

**Step 2 — Mark as walked**: Sets `data-read-frog-walked="<walkId>"`. The walkId is a UUID generated per translation session. This enables:
- Session versioning (stale translations from previous sessions are identifiable)
- Cleanup by attribute query
- `translateWalkedElement()` validates the walkId before processing

**Step 3 — Shadow DOM traversal**: If the element has an open `shadowRoot`, iterates its direct children and recurses. This enables translation inside web components (e.g., GitHub's `<task-lists>`, YouTube's custom elements).

**Step 4 — Filter valid children**: Creates a filtered list of child nodes that are either:
- Text nodes (always valid)
- HTML elements that are NOT in the "don't walk into" categories

Note: `isDontWalkIntoButTranslateAsChildElement` elements ARE filtered OUT from the walk list, but their text content IS still used during `extractTextContent()` — this is the key distinction.

**Step 5 — Iterate and classify**: For each valid child:
- **Text nodes**: If they have non-whitespace content, set `hasInlineNodeChild = true`. This signals that the current element is a paragraph candidate.
- **HTML elements**: Recursively walk. The returned `forceBlock` propagates upward (logical OR). If the child `isInlineNode`, the parent now `hasInlineNodeChild = true`.

**Step 6 — Paragraph labeling**: If any inline child was found, tag with `data-read-frog-paragraph`. This is the critical attribute that `translateWalkedElement()` uses to identify translation units. A "paragraph" in Read Frog's model = "an element that directly contains inline text content."

**Step 7 — forceBlock propagation**: OR-merge the element's own tag (checked against `FORCE_BLOCK_TAGS`) with any descendant's forceBlock. This means if a `<li>` is nested deep inside `<div><span>...</span></div>`, the forceBlock from `<li>` propagates upward through the `<span>` and `<div>`.

**Step 8 — Empty element pruning**: If `textContent` is empty and not forceBlock, return early with `{false, false}`. This prevents empty wrappers from being labeled.

**Step 9 — Apply classification**: Determine the final classification:
- **Block** if: `isShallowBlockHTMLElement(element)` OR `forceBlock` OR `isCustomForceBlockTranslation(element)` → sets `data-read-frog-block-node`
- **Inline** if none of the above: `isShallowInlineHTMLElement(element)` → sets `data-read-frog-inline-node`
- **Neither** if not block and not inline (rare edge cases) → no attribute set

### 2.3 How forceBlock Propagates Upward

```
<div>                     ← gets BLOCK_ATTRIBUTE (because forceBlock=true from child)
  <span>                  ← normally inline, but forceBlock=true propagates through
    <ul>                  ← FORCE_BLOCK_TAGS → forceBlock=true starts here
      <li>Item</li>
    </ul>
  </span>
</div>
```

The `forceBlock` return value flows bottom-up through the recursion stack:
1. `<li>` → `FORCE_BLOCK_TAGS.has("LI")` → `forceBlock = true`
2. `<ul>` → `FORCE_BLOCK_TAGS.has("UL")` → `forceBlock = true` (already true)
3. `<span>` → receives `result.forceBlock = true` from `<ul>` → `forceBlock = true`
4. `<div>` → receives `result.forceBlock = true` from `<span>` → `forceBlock = true`

This ensures that when a block-level semantic element is nested inside inline containers, all ancestors up to the root are forced to block classification.

### 2.4 How Shadow DOM is Handled

```typescript
if (element.shadowRoot) {
  for (const child of element.shadowRoot.children) {
    if (isHTMLElement(child)) {
      walkAndLabelElement(child, walkId, config)
    }
  }
}
```

- Only processes **open** shadow roots (`.shadowRoot` is `null` for closed shadow roots)
- Walks direct children of the shadow root, not the shadow root itself
- The shadow root's children are labeled independently — they get their own block/inline/paragraph attributes
- The `forceBlock` / `isInlineNode` results from shadow DOM children are **NOT propagated** back up to the host element. Shadow children are walked as independent subtrees.

### 2.5 DOM State After Walking

After `walkAndLabelElement(document.body, walkId, config)`, the DOM looks like:

```html
<body data-read-frog-walked="abc-123" data-read-frog-block-node>
  <article data-read-frog-walked="abc-123" data-read-frog-block-node>
    <p data-read-frog-walked="abc-123" data-read-frog-paragraph data-read-frog-block-node>
      Hello <strong data-read-frog-walked="abc-123" data-read-frog-inline-node>world</strong>
    </p>
    <div data-read-frog-walked="abc-123" data-read-frog-block-node>
      <span data-read-frog-walked="abc-123" data-read-frog-inline-node data-read-frog-paragraph>
        Some inline <em data-read-frog-walked="abc-123" data-read-frog-inline-node>text</em>
      </span>
    </div>
  </article>
  <!-- <script> tags are NOT walked — no attributes -->
  <!-- <style> tags are NOT walked — no attributes -->
  <code>preserved</code>  <!-- NOT walked, but text included in parent extraction -->
</body>
```

---

## 3. extractTextContent() — Complete Algorithm

**File**: `src/utils/host/dom/traversal.ts`

### 3.1 Full Source Code

```typescript
export function extractTextContent(node: TransNode, config: Config): string {
  // Case 1: Text node — normalize whitespace
  if (isTextNode(node)) {
    const text = node.textContent ?? ""
    const trimmed = text.trim()
    if (trimmed === "")
      return " "
    const leadingWs = text.slice(0, text.length - text.trimStart().length)
    const trailingWs = text.slice(text.trimEnd().length)
    const hasLeading = /[^\S\n]/.test(leadingWs)
    const hasTrailing = /[^\S\n]/.test(trailingWs)
    return (hasLeading ? " " : "") + trimmed + (hasTrailing ? " " : "")
  }

  // Case 2: <br> element → line break
  if (isHTMLElement(node) && node.tagName === "BR") {
    return "\n"
  }

  // Case 3: Don't-translate-as-child elements → excluded from text
  if (isDontWalkIntoAndDontTranslateAsChildElement(node, config)) {
    return ""
  }

  // Case 4: Recurse into children
  const childNodes = Array.from(node.childNodes)
  return childNodes.reduce((text: string, child: Node): string => {
    if (isTextNode(child) || isHTMLElement(child)) {
      return text + extractTextContent(child, config)
    }
    return text
  }, "")
}
```

### 3.2 Whitespace Normalization (Text Nodes)

The whitespace handling is nuanced. For a text node with content:

1. **Empty/whitespace-only text**: Returns `" "` (single space). This preserves word boundaries between adjacent inline elements (e.g., `<em>hello</em> <strong>world</strong>` — the space between them).

2. **Non-empty text**: 
   - Extracts leading and trailing whitespace
   - Tests if the whitespace contains non-newline whitespace characters using `/[^\S\n]/`
   - If leading whitespace has non-newline chars → prefix with single space
   - If trailing whitespace has non-newline chars → suffix with single space
   - The core content is `trimmed`

**Why `/[^\S\n]/` instead of just checking for spaces?** This regex matches any whitespace character that is NOT a newline (`\n`). This ensures:
- Tabs and regular spaces are normalized to a single space
- Newlines at the start/end of text nodes are NOT converted to spaces (they're collapse per HTML spec)
- This prevents artificial spacing where there should be none

**Example walkthrough**:

| Input textContent | trimmed | hasLeading | hasTrailing | Output |
|---|---|---|---|---|
| `"  Hello  "` | `"Hello"` | ✓ (spaces) | ✓ (spaces) | `" Hello "` |
| `"\n  Hello"` | `"Hello"` | ✓ (has space after newline) | ✗ | `" Hello"` |
| `"\nHello\n"` | `"Hello"` | ✗ (only newline) | ✗ (only newline) | `"Hello"` |
| `"  \t  "` | `""` | — | — | `" "` |
| `"Hello"` | `"Hello"` | ✗ | ✗ | `"Hello"` |

### 3.3 BR Handling

`<br>` elements are converted to `"\n"`. This is important because `<br>` is both in `FORCE_BLOCK_TAGS` (treated as block for labeling) and handled specially in text extraction.

### 3.4 Don't-Translate Elements

Note the commented-out block in the source:

```typescript
// We already don't walk and label the element which isDontWalkIntoElement
// for the parent element we already walk and label, if we have a notranslate element
// inside this parent element, we should extract the text content of the parent.
// see this issue: https://github.com/mengxi-ream/read-frog/issues/249
// if (isDontWalkIntoButTranslateAsChildElement(node)) {
//   return ''
// }
```

This reveals an important design decision: `isDontWalkIntoButTranslateAsChildElement` elements (like `<code>`, `<time>`, `.notranslate`) **ARE included** in text extraction. Only `isDontWalkIntoAndDontTranslateAsChildElement` elements (like `<script>`, hidden elements) return `""`.

This means `<code>` content IS sent to the translation API as part of the paragraph text. The walker doesn't recurse into `<code>`, but the text extractor does include it.

### 3.5 Recursive Child Processing

For HTML elements that don't match any special case, `extractTextContent` recurses into each child that is either a `Text` node or `HTMLElement`. Other node types (comments, processing instructions, SVG elements) are silently skipped.

---

## 4. Filter Functions — Complete Reference

**File**: `src/utils/host/dom/filter.ts`

### 4.1 Base Type Guards

```typescript
export function isHTMLElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE
    && node.nodeName !== undefined
    && "tagName" in node
    && "getAttribute" in node
    && "setAttribute" in node
}

export function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE
}

export function isTextNode(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE
    && "textContent" in node
    && "data" in node
}

export function isTransNode(node: Node): node is TransNode {
  return isHTMLElement(node) || isTextNode(node)
}

export function isIFrameElement(node: Node): node is HTMLIFrameElement {
  return node.nodeType === Node.ELEMENT_NODE
    && node.nodeName === "IFRAME"
}
```

**Why duck-typing instead of `instanceof`?** The comment says: "More reliable check for HTML elements that works across different contexts (iframe, shadow DOM) — avoid using `instanceof HTMLElement`". In cross-origin iframes and shadow DOMs, `instanceof` can fail because different `HTMLElement` constructors exist in different realms.

### 4.2 Editable Element Check

```typescript
export function isEditable(element: HTMLElement): boolean {
  const tag = element.tagName
  if (tag === "INPUT" || tag === "TEXTAREA")
    return true
  if (element.isContentEditable)
    return true
  return false
}
```

### 4.3 Inline Display Detection

```typescript
function isInlineDisplay(display: string): boolean {
  const normalizedDisplay = display.trim().toLowerCase()

  if (!normalizedDisplay) return false
  if (normalizedDisplay === "contents") return true
  if (normalizedDisplay.startsWith("inline")) return true  // inline, inline-block, inline-flex, etc.

  return [
    "ruby", "ruby-base", "ruby-text",
    "ruby-base-container", "ruby-text-container",
  ].includes(normalizedDisplay)
}
```

`display: contents` is treated as inline because it makes the element's box disappear — children render as if they were direct children of the grandparent. Ruby display values are for East Asian typography annotations.

### 4.4 Large Initial Floating Letter Detection

```typescript
function isLargeInitialFloatingLetter(element: HTMLElement): boolean {
  const computedStyle = window.getComputedStyle(element)
  return computedStyle.float === "left"
    && !!element.nextSibling
    && isShallowInlineTransNode(element.nextSibling)
}
```

Some news sites (e.g., The Economist) use a large floating first letter (drop cap). This function detects them: a left-floated element followed by an inline sibling. Treated as inline to keep it grouped with the paragraph text.

### 4.5 isShallowInlineTransNode / isShallowInlineHTMLElement

```typescript
// "shallow" means only check the node itself, not the children
export function isShallowInlineTransNode(node: Node): boolean {
  if (isTextNode(node) && node.textContent?.trim()) {
    return true
  }
  else if (isHTMLElement(node)) {
    return isShallowInlineHTMLElement(node)
  }
  return false
}

export function isShallowInlineHTMLElement(element: HTMLElement): boolean {
  // Prevent too many inline nodes that make <body> a paragraph node
  if (!element.textContent?.trim()) return false

  if (FORCE_BLOCK_TAGS.has(element.tagName)) return false

  const computedStyle = window.getComputedStyle(element)

  if (isLargeInitialFloatingLetter(element)) return true

  return isInlineDisplay(computedStyle.display)
}
```

**Key insight**: An element is "shallow inline" only if:
1. It has non-empty text content
2. Its tag is NOT in `FORCE_BLOCK_TAGS`
3. Its **computed CSS display** is an inline-family value

The "shallow" qualifier means this doesn't consider children. A `<span>` containing a `<div>` is still "shallow inline" — the mismatch is handled at the parent level during walking.

The empty-text check (`!element.textContent?.trim()`) prevents empty inline elements from making their parent a paragraph. Without this, invisible elements could trigger unnecessary translation.

### 4.6 isShallowBlockTransNode / isShallowBlockHTMLElement

```typescript
export function isShallowBlockTransNode(node: Node): boolean {
  if (isTextNode(node)) return false
  else if (isHTMLElement(node)) return isShallowBlockHTMLElement(node)
  return false
}

export function isShallowBlockHTMLElement(element: HTMLElement): boolean {
  const computedStyle = window.getComputedStyle(element)

  if (FORCE_BLOCK_TAGS.has(element.tagName)) return true

  if (isLargeInitialFloatingLetter(element)) return false

  return !isInlineDisplay(computedStyle.display)
}
```

**Note**: `!(inline)` ≠ `block`. The comment in the source says: "Note: !(inline node) != block node because of `notranslate` class and all cases not in the if-else block." An element with `.notranslate` is neither inline nor block in this classification.

### 4.7 isDontWalkIntoButTranslateAsChildElement

```typescript
export function isDontWalkIntoButTranslateAsChildElement(element: HTMLElement): boolean {
  const dontWalkClass = element.classList.contains(NOTRANSLATE_CLASS)
  const dontWalkTag = DONT_WALK_BUT_TRANSLATE_TAGS.has(element.tagName)
  // const dontWalkAttr = element.getAttribute('translate') === 'no'  // disabled per issue #459
  return dontWalkClass || dontWalkTag
}
```

Returns `true` for:
- Elements with `.notranslate` CSS class
- `<code>` and `<time>` tags

These elements are NOT recursed into during walking, but their text IS included when their parent's text is extracted for translation. The `translate="no"` attribute check was disabled due to issue #459.

### 4.8 isDontWalkIntoAndDontTranslateAsChildElement

```typescript
function isInsideContentContainer(element: HTMLElement): boolean {
  let current: HTMLElement | null = element.parentElement
  while (current) {
    if (current.tagName === "ARTICLE" || current.tagName === "MAIN") return true
    current = current.parentElement
  }
  return false
}

export function isDontWalkIntoAndDontTranslateAsChildElement(
  element: HTMLElement, config: Config
): boolean {
  const dontWalkCustomElement = isCustomDontWalkIntoElement(element)
  const dontWalkContent = config.translate.page.range !== "all"
    && MAIN_CONTENT_IGNORE_TAGS.has(element.tagName)
    && !isInsideContentContainer(element)
  const dontWalkInvalidTag = DONT_WALK_AND_TRANSLATE_TAGS.has(element.tagName)
  const dontWalkCSS
    = window.getComputedStyle(element).display === "none"
      || window.getComputedStyle(element).visibility === "hidden"
  const dontWalkHidden = element.hidden
  const dontWalkAriaHidden = element.getAttribute("aria-hidden") === "true"
  const dontWalkVisuallyHidden = ["sr-only", "visually-hidden"].some(cls =>
    element.classList.contains(cls),
  )
  return dontWalkCustomElement || dontWalkContent || dontWalkInvalidTag
    || dontWalkCSS || dontWalkHidden || dontWalkAriaHidden || dontWalkVisuallyHidden
}
```

**Seven independent skip conditions** (any one triggers skip):

| Condition | What it catches |
|---|---|
| `isCustomDontWalkIntoElement` | Per-site CSS selectors (YouTube nav, GitHub file tree, ChatGPT editor, etc.) |
| `dontWalkContent` | HEADER/FOOTER/NAV when `range !== "all"` and not inside `<article>`/`<main>` |
| `dontWalkInvalidTag` | HEAD, SCRIPT, STYLE, IMG, VIDEO, AUDIO, CANVAS, SVG, MathML, PRE, etc. |
| `dontWalkCSS` | `display: none` or `visibility: hidden` |
| `dontWalkHidden` | HTML `hidden` attribute |
| `dontWalkAriaHidden` | `aria-hidden="true"` |
| `dontWalkVisuallyHidden` | `.sr-only` or `.visually-hidden` classes |

The `isInsideContentContainer` check is important: `<header>` and `<nav>` inside `<article>` ARE translated (they're article-internal navigation), but site-wide `<header>` and `<nav>` are skipped.

### 4.9 isCustomDontWalkIntoElement / isCustomForceBlockTranslation

```typescript
export function isCustomDontWalkIntoElement(element: HTMLElement): boolean {
  const dontWalkIntoElementSelectorList =
    CUSTOM_DONT_WALK_INTO_ELEMENT_SELECTOR_MAP[window.location.hostname] ?? []
  const dontWalkSelector = dontWalkIntoElementSelectorList.join(",")
  if (!dontWalkSelector) return false
  return element.matches(dontWalkSelector)
}

export function isCustomForceBlockTranslation(element: HTMLElement): boolean {
  const forceBlockSelectorList =
    CUSTOM_FORCE_BLOCK_TRANSLATION_SELECTOR_MAP[window.location.hostname] ?? []
  const forceBlockSelector = forceBlockSelectorList.join(",")
  if (!forceBlockSelector) return false
  return element.matches(forceBlockSelector)
}
```

These use `element.matches()` with CSS selectors looked up by hostname from the constant maps. If the current site has no custom rules, returns `false` immediately.

### 4.10 isTranslatedWrapperNode / isTranslatedContentNode

```typescript
export function isTranslatedWrapperNode(node: Node) {
  return isHTMLElement(node)
    && node.classList.contains(CONTENT_WRAPPER_CLASS)
}

export function isTranslatedContentNode(node: Node): boolean {
  return isHTMLElement(node)
    && (node.classList.contains(BLOCK_CONTENT_CLASS)
        || node.classList.contains(INLINE_CONTENT_CLASS))
}
```

Used to identify our own injected translation elements, preventing double-translation and enabling cleanup.

### 4.11 isInlineTransNode / isBlockTransNode

```typescript
export function isInlineTransNode(node: TransNode): boolean {
  if (isTextNode(node)) return true
  return node.hasAttribute(INLINE_ATTRIBUTE)
}

export function isBlockTransNode(node: TransNode): boolean {
  if (isTextNode(node)) return false
  return node.hasAttribute(BLOCK_ATTRIBUTE)
}
```

These read the attributes set by `walkAndLabelElement()`. Text nodes are always inline, never block.

### 4.12 hasNoWalkAncestor

```typescript
export function hasNoWalkAncestor(element: HTMLElement, config: Config): boolean {
  let current: HTMLElement | null = element.parentElement
  while (current) {
    if (isDontWalkIntoButTranslateAsChildElement(current)
        || isDontWalkIntoAndDontTranslateAsChildElement(current, config)) {
      return true
    }
    current = current.parentElement
  }
  return false
}
```

Walks up the ancestor chain to check if any ancestor is a "don't walk" element. Used by MutationObserver to decide whether a newly added element should be processed.

---

## 5. translateWalkedElement() — Translation Walker

**File**: `src/utils/host/translate/core/translation-walker.ts`

### 5.1 Full Source Code

```typescript
export async function translateWalkedElement(
  element: HTMLElement,
  walkId: string,
  config: Config,
  toggle: boolean = false,
): Promise<void> {
  // Guard: skip if already translated (unless toggling)
  if (!toggle && element.querySelector(`.${CONTENT_WRAPPER_CLASS}`))
    return

  // Guard: skip if walkId doesn't match (stale session)
  if (element.getAttribute(WALKED_ATTRIBUTE) !== walkId)
    return

  const promises: Promise<void>[] = []

  if (element.hasAttribute(PARAGRAPH_ATTRIBUTE)) {
    // --- THIS IS A PARAGRAPH NODE ---
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
      // CASE A: Pure inline paragraph — translate all children as one unit
      promises.push(translateNodes([element], walkId, toggle, config))
    }
    else {
      // CASE B: Mixed paragraph — split by block children
      const children = Array.from(element.childNodes)
      let consecutiveInlineNodes: ChildNode[] = []
      for (const child of children) {
        if (isTransNode(child) && isBlockTransNode(child) && !isTextNode(child)) {
          // Flush accumulated inline nodes as one translation unit
          promises.push(translateNodes(
            consecutiveInlineNodes, walkId, toggle, config, !isFlexParent
          ))
          consecutiveInlineNodes = []
          // Recurse into block child
          promises.push(translateWalkedElement(child, walkId, config, toggle))
        }
        else {
          consecutiveInlineNodes.push(child)
        }
      }
      // Flush remaining inline nodes
      if (consecutiveInlineNodes.length) {
        promises.push(translateNodes(
          consecutiveInlineNodes, walkId, toggle, config, !isFlexParent
        ))
        consecutiveInlineNodes = []
      }
    }
  }
  else {
    // --- THIS IS NOT A PARAGRAPH NODE — just recurse ---
    for (const child of element.childNodes) {
      if (isHTMLElement(child)) {
        promises.push(translateWalkedElement(child, walkId, config, toggle))
      }
    }
    // Also recurse into shadow DOM
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

### 5.2 Algorithm Walkthrough

**Entry point**: Called for each paragraph element that becomes visible (via IntersectionObserver).

**Guard checks**:
1. If the element already has a translated wrapper (`.read-frog-translated-content-wrapper`) and we're not toggling, skip to prevent double translation.
2. If the element's `data-read-frog-walked` doesn't match the current `walkId`, skip — it's from a stale session.

**Paragraph processing** (`hasAttribute(PARAGRAPH_ATTRIBUTE)`):

The critical insight is that a paragraph element may have mixed block and inline children:

```html
<div data-read-frog-paragraph>
  "Some text"                          ← inline (text node)
  <span data-read-frog-inline-node>    ← inline
  <div data-read-frog-block-node>      ← block: splits the inline run
    <p data-read-frog-paragraph>...</p>
  </div>
  "More text"                          ← inline
</div>
```

**Case A — No block children**: All children are inline. The entire element is one translation unit → `translateNodes([element], ...)`.

**Case B — Mixed children**: Children are iterated left-to-right. Consecutive inline nodes are accumulated. When a block child is hit:
1. The accumulated inline sequence is flushed as one translation unit
2. The block child is recursed into separately
3. After the loop, any remaining inline nodes are flushed

The `forceBlockTranslation` parameter is `!isFlexParent` — if the parent is flex, inline translation style is preserved; otherwise block translation is forced.

**Non-paragraph elements**: Simply recurse into HTML children (and shadow root children). These are structural containers that don't contain direct inline text.

### 5.3 Connection Between Walking and Translating

```
walkAndLabelElement()          translateWalkedElement()
──────────────────────         ────────────────────────
1. Top-down recursive walk     1. Top-down recursive walk (same pattern)
2. Labels: WALKED, PARAGRAPH,  2. Reads: WALKED (session check),
   BLOCK, INLINE                  PARAGRAPH (identifies translation units),
                                  BLOCK (splits inline runs)
3. Returns forceBlock,         3. Groups inline nodes → translateNodes()
   isInlineNode                   Recurses into block children
```

The walker (phase 1) labels the DOM. The translator (phase 2) reads those labels to decide what to translate and how to group nodes. The two phases are decoupled — walking happens once synchronously, while translation happens asynchronously as elements enter the viewport.

---

## 6. Translation Modes — Bilingual & TranslationOnly

**File**: `src/utils/host/translate/core/translation-modes.ts`

### 6.1 translateNodes() — Dispatcher

```typescript
export async function translateNodes(
  nodes: ChildNode[],
  walkId: string,
  toggle: boolean = false,
  config: Config,
  forceBlockTranslation: boolean = false,
): Promise<void> {
  const translationMode = config.translate.mode
  if (translationMode === "translationOnly") {
    await translateNodeTranslationOnlyMode(nodes, walkId, config, toggle)
  }
  else if (translationMode === "bilingual") {
    await translateNodesBilingualMode(nodes, walkId, config, toggle, forceBlockTranslation)
  }
}
```

### 6.2 Bilingual Mode

```typescript
export async function translateNodesBilingualMode(
  nodes: ChildNode[],
  walkId: string,
  config: Config,
  toggle: boolean = false,
  forceBlockTranslation: boolean = false,
): Promise<void> {
  const transNodes = nodes.filter(node => isTransNode(node))
  if (transNodes.length === 0) return

  try {
    // Prevent duplicate translation
    if (transNodes.every(node => translatingNodes.has(node))) return
    transNodes.forEach(node => translatingNodes.add(node))

    // Determine target node (unwrap single-child wrappers)
    const lastNode = transNodes[transNodes.length - 1]
    const targetNode
      = transNodes.length === 1 && isBlockTransNode(lastNode) && isHTMLElement(lastNode)
        ? await unwrapDeepestOnlyHTMLChild(lastNode)
        : lastNode

    // Check for existing translation (toggle support)
    const existedTranslatedWrapper = findPreviousTranslatedWrapperInside(targetNode, walkId)
    if (existedTranslatedWrapper) {
      removeTranslatedWrapperWithRestore(existedTranslatedWrapper)
      if (toggle) return
      else {
        nodes.forEach(node => translatingNodes.delete(node))
        void translateNodesBilingualMode(nodes, walkId, config, toggle)
        return
      }
    }

    // Extract text
    const textContent = transNodes.map(node => extractTextContent(node, config)).join("").trim()
    if (!textContent || isNumericContent(textContent)) return

    // Filter small paragraphs
    if (await shouldFilterSmallParagraph(textContent, config)) return

    // Create wrapper and spinner
    const ownerDoc = getOwnerDocument(targetNode)
    const translatedWrapperNode = ownerDoc.createElement("span")
    translatedWrapperNode.className = `${NOTRANSLATE_CLASS} ${CONTENT_WRAPPER_CLASS}`
    translatedWrapperNode.setAttribute(TRANSLATION_MODE_ATTRIBUTE, "bilingual")
    translatedWrapperNode.setAttribute(WALKED_ATTRIBUTE, walkId)
    setTranslationDirAndLang(translatedWrapperNode, config)
    const spinner = createSpinnerInside(translatedWrapperNode)

    // Batch DOM insertion
    batchDOMOperation(() => {
      if (isTextNode(targetNode) || transNodes.length > 1) {
        targetNode.parentNode?.insertBefore(translatedWrapperNode, targetNode.nextSibling)
      }
      else {
        targetNode.appendChild(translatedWrapperNode)
      }
    })

    // Await translation result
    const realTranslatedText = await getTranslatedTextAndRemoveSpinner(
      nodes, textContent, spinner, translatedWrapperNode
    )
    const translatedText = getDisplayTranslation(textContent, realTranslatedText)

    if (!translatedText) {
      if (translatedText === "") {
        batchDOMOperation(() => translatedWrapperNode.remove())
      }
      return
    }

    // Insert translated content
    await insertTranslatedNodeIntoWrapper(
      translatedWrapperNode, targetNode, translatedText,
      config.translate.translationNodeStyle, forceBlockTranslation,
    )
  }
  finally {
    transNodes.forEach(node => translatingNodes.delete(node))
  }
}
```

**Key flow**:
1. Filter to `TransNode` types, check `translatingNodes` for duplicates
2. For single block nodes, `unwrapDeepestOnlyHTMLChild()` dives into nested single-child wrappers (e.g., `<div><div><p>text</p></div></div>` → finds `<p>`)
3. Check for existing translation wrapper (for toggle/re-translate)
4. Extract text content, filter out numeric-only and short paragraphs
5. Create wrapper `<span>` with classes: `notranslate read-frog-translated-content-wrapper`
6. Insert wrapper into DOM (batched), show spinner
7. Await API translation
8. `getDisplayTranslation()`: if source ≈ translation (after removing invisible chars), return `""` (skip)
9. `insertTranslatedNodeIntoWrapper()`: adds the final translated `<span>`

**Wrapper placement logic**:
- Text nodes or multi-node groups: `insertBefore(wrapper, targetNode.nextSibling)` — places wrapper right after the target
- Single HTML element: `appendChild(wrapper)` — places wrapper inside the element

### 6.3 TranslationOnly Mode

```typescript
export async function translateNodeTranslationOnlyMode(
  nodes: ChildNode[], walkId: string, config: Config, toggle: boolean = false
): Promise<void> {
  // ... (similar guards) ...

  // Save original innerHTML for restoring
  const outerParentElement = outerTransNodes[0].parentElement
  if (outerParentElement && !originalContentMap.has(outerParentElement) && !hasExistingWrapper) {
    originalContentMap.set(outerParentElement, outerParentElement.innerHTML)
  }

  // Unwrap single-child wrappers
  let transNodes, allChildNodes
  if (outerTransNodes.length === 1 && isHTMLElement(outerTransNodes[0])) {
    const unwrappedHTMLChild = await unwrapDeepestOnlyHTMLChild(outerTransNodes[0])
    allChildNodes = Array.from(unwrappedHTMLChild.childNodes)
    transNodes = allChildNodes.filter(isTransNodeAndNotTranslatedWrapper)
  }

  // ... text extraction, filtering ...

  // Clean mark attributes from text content
  const cleanTextContent = (content: string): string => {
    let cleanedContent = content.replace(MARK_ATTRIBUTES_REGEX, "")
    cleanedContent = cleanedContent.replace(/<!--[\s\S]*?-->/g, " ")
    return cleanedContent
  }

  // Get string format from mixed nodes (outerHTML for elements, textContent for text)
  const textContent = cleanTextContent(transNodes.map(getStringFormatFromNode).join(""))

  // Create wrapper, get translation...

  // CRITICAL DIFFERENCE: Set innerHTML directly with translated text
  translatedWrapperNode.innerHTML = translatedText

  // Replace originals with translation
  batchDOMOperation(() => {
    const lastChildNode = allChildNodes[allChildNodes.length - 1]
    lastChildNode.parentNode?.insertBefore(translatedWrapperNode, lastChildNode.nextSibling)
    allChildNodes.forEach(childNode => childNode.remove())
  })
}
```

**Key differences from bilingual mode**:
1. **Original content is saved**: `originalContentMap.set(parentElement, innerHTML)` for restoration
2. **Text includes HTML**: Uses `outerHTML` for elements and `textContent` for text nodes, then strips mark attributes
3. **Mark attributes are cleaned**: The regex `MARK_ATTRIBUTES_REGEX` removes `data-read-frog-*` attributes from the HTML string before sending to API
4. **Original nodes are removed**: After inserting the translated wrapper, all original nodes are deleted
5. **Wrapper uses `innerHTML`**: The translated text is set as innerHTML (potentially HTML-structured), not textContent
6. **Wrapper has `display: contents`**: `translatedWrapperNode.style.display = "contents"` makes it invisible as a container

### 6.4 Translation State Management

**File**: `src/utils/host/translate/core/translation-state.ts`

```typescript
export const translatingNodes = new WeakSet<ChildNode>()
export const originalContentMap = new Map<Element, string>()

export const MARK_ATTRIBUTES_REGEX = new RegExp(
  `\\s*(?:${Array.from(MARK_ATTRIBUTES).join("|")})(?:=['""][^'"]*['""]|=[^\\s>]*)?`, "g"
)
```

- `translatingNodes`: WeakSet prevents duplicate concurrent translation of the same node. Entries are cleaned in `finally` blocks.
- `originalContentMap`: Stores original innerHTML for TranslationOnly mode restoration. Strong references (Map, not WeakMap) ensure content survives DOM manipulation.
- `MARK_ATTRIBUTES_REGEX`: Pre-compiled regex matching `data-read-frog-walked="..."`, `data-read-frog-paragraph`, etc. — used to strip these from HTML before sending to translation API.

---

## 7. Translation Insertion Strategy

**File**: `src/utils/host/translate/dom/translation-insertion.ts`

### 7.1 Full Source Code

```typescript
export function addInlineTranslation(
  ownerDoc: Document, translatedWrapperNode: HTMLElement, translatedNode: HTMLElement
): void {
  const spaceNode = ownerDoc.createElement("span")
  spaceNode.textContent = "  "
  translatedWrapperNode.appendChild(spaceNode)
  translatedNode.className = `${NOTRANSLATE_CLASS} ${INLINE_CONTENT_CLASS}`
}

export function addBlockTranslation(
  ownerDoc: Document, translatedWrapperNode: HTMLElement, translatedNode: HTMLElement
): void {
  const brNode = ownerDoc.createElement("br")
  translatedWrapperNode.appendChild(brNode)
  translatedNode.className = `${NOTRANSLATE_CLASS} ${BLOCK_CONTENT_CLASS}`
}

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
  const customForceBlock = isHTMLElement(targetNode)
    && isCustomForceBlockTranslation(targetNode)

  // Priority: customForceBlock > forceInlineTranslation > forceBlockTranslation
  //           > isInlineTransNode > isBlockTransNode
  if (customForceBlock) {
    addBlockTranslation(ownerDoc, translatedWrapperNode, translatedNode)
  }
  else if (forceInlineTranslation) {
    addInlineTranslation(ownerDoc, translatedWrapperNode, translatedNode)
  }
  else if (forceBlockTranslation) {
    addBlockTranslation(ownerDoc, translatedWrapperNode, translatedNode)
  }
  else if (isInlineTransNode(targetNode)) {
    addInlineTranslation(ownerDoc, translatedWrapperNode, translatedNode)
  }
  else if (isBlockTransNode(targetNode)) {
    addBlockTranslation(ownerDoc, translatedWrapperNode, translatedNode)
  }
  else {
    return  // not inline or block (e.g., notranslate)
  }

  translatedNode.textContent = translatedText
  translatedWrapperNode.appendChild(translatedNode)
  await decorateTranslationNode(translatedNode, translationNodeStyle)
}
```

### 7.2 Inline vs Block Insertion

**Inline insertion** (for inline nodes like `<span>`, `<a>`, text nodes):
```html
<span class="notranslate read-frog-translated-content-wrapper">
  <span>  </span>                                          <!-- double-space separator -->
  <span class="notranslate read-frog-translated-inline-content">
    translated text
  </span>
</span>
```

**Block insertion** (for block nodes like `<p>`, `<div>`, `<li>`):
```html
<span class="notranslate read-frog-translated-content-wrapper">
  <br>                                                      <!-- line break separator -->
  <span class="notranslate read-frog-translated-block-content">
    translated text
  </span>
</span>
```

### 7.3 Priority Chain for Inline/Block Decision

1. **customForceBlock** (per-site CSS selector match) → block
2. **forceInlineTranslation** (tags: A, BUTTON, SELECT, OPTION, SPAN; or `display: flex`) → inline
3. **forceBlockTranslation** (parameter from `translateWalkedElement`, `true` when parent has mixed block+inline children and parent is not flex) → block
4. **isInlineTransNode** (element has `data-read-frog-inline-node`, or is text node) → inline
5. **isBlockTransNode** (element has `data-read-frog-block-node`) → block
6. **Else** → no insertion (element is `notranslate` or unlabeled)

### 7.4 isForceInlineTranslation

```typescript
export function isForceInlineTranslation(targetNode: TransNode): boolean {
  if (isHTMLElement(targetNode)) {
    const computedStyle = window.getComputedStyle(targetNode)
    return FORCE_INLINE_TRANSLATION_TAGS.has(targetNode.tagName)
      || computedStyle.display.includes("flex")
  }
  return false
}
```

`FORCE_INLINE_TRANSLATION_TAGS` = `{A, BUTTON, SELECT, OPTION, SPAN}`. These elements always get inline-style translation regardless of their block/inline classification, because block insertion (with `<br>`) would break their visual presentation.

### 7.5 Wrapper Cleanup

**File**: `src/utils/host/translate/dom/translation-cleanup.ts`

```typescript
export function removeTranslatedWrapperWithRestore(wrapper: HTMLElement): void {
  removeShadowHostInTranslatedWrapper(wrapper)

  const translationMode = wrapper.getAttribute(TRANSLATION_MODE_ATTRIBUTE)

  if (translationMode === "translationOnly") {
    // Walk up to find original content in the map
    let currentNode = wrapper.parentNode
    while (currentNode && isHTMLElement(currentNode)) {
      const originalContent = originalContentMap.get(currentNode)
      if (originalContent) {
        batchDOMOperation(() => {
          nodeToRestore.innerHTML = originalContent
        })
        originalContentMap.delete(currentNode)
        return
      }
      currentNode = currentNode.parentNode
    }
  }

  // Bilingual mode: just remove the wrapper
  batchDOMOperation(() => wrapper.remove())
}
```

**Translation wrapper finding**:

```typescript
export function findPreviousTranslatedWrapperInside(
  node: Element | Text, walkId: string
): HTMLElement | null {
  if (isHTMLElement(node)) {
    if (node.classList.contains(CONTENT_WRAPPER_CLASS)
        && node.getAttribute(WALKED_ATTRIBUTE) !== walkId) {
      return node
    }
    return node.querySelector(
      `.${CONTENT_WRAPPER_CLASS}:not([${WALKED_ATTRIBUTE}="${walkId}"])`
    )
  }
  return null
}
```

Finds a translated wrapper from a **previous** walkId (not the current one). This is used for toggle and re-translation scenarios.

---

## 8. DOM Batching Strategy

**File**: `src/utils/host/dom/batch-dom.ts`

### 8.1 Full Implementation

```typescript
type DOMOperation = () => void

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
    const ops = this.operations.splice(0)

    for (const op of ops) {
      try { op() }
      catch (error) { console.error("Error executing batched DOM operation:", error) }
    }

    this.isProcessing = false

    // If new operations were queued during execution, schedule another flush
    if (this.operations.length > 0) {
      this.scheduleFlush()
    }
  }

  flushImmediate(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    while (this.operations.length > 0) {
      this.flush()
    }
  }
}

// Singleton
const domBatcher = new DOMBatcher()

export function batchDOMOperation(operation: DOMOperation): void {
  domBatcher.queue(operation)
}

export function flushBatchedOperations(): void {
  domBatcher.flushImmediate()
}

export function createFragment(ownerDocument: Document = document): DocumentFragment {
  return ownerDocument.createDocumentFragment()
}
```

### 8.2 How It Works

1. **Single instance**: Global singleton `domBatcher` — all DOM mutations across the entire extension go through one queue.
2. **requestAnimationFrame scheduling**: Operations are deferred to the next animation frame, coalescing multiple DOM writes into a single frame.
3. **Self-rescheduling**: If new operations are queued during a flush (e.g., one operation triggers another), a new rAF is scheduled.
4. **Error isolation**: Each operation is wrapped in try/catch — a failing operation doesn't block others.
5. **Immediate flush**: `flushImmediate()` cancels the pending rAF and processes all operations synchronously (used in tests and cleanup).

### 8.3 Usage Pattern in Translation

```typescript
// 1. Wrapper insertion — batched
batchDOMOperation(() => {
  targetNode.parentNode?.insertBefore(translatedWrapperNode, targetNode.nextSibling)
})

// 2. Wrapper removal — batched
batchDOMOperation(() => translatedWrapperNode.remove())

// 3. TranslationOnly mode — remove originals in batch
batchDOMOperation(() => {
  lastChildNode.parentNode?.insertBefore(translatedWrapperNode, lastChildNode.nextSibling)
  allChildNodes.forEach(childNode => childNode.remove())
})
```

The batching prevents layout thrashing when multiple paragraphs are being translated concurrently (e.g., after a scroll reveals several elements at once).

---

## 9. Supporting Utilities

### 9.1 DOM Node Utilities

**File**: `src/utils/host/dom/node.ts`

```typescript
export function getOwnerDocument(node: Node): Document {
  return node.ownerDocument || document
}

export function getContainingShadowRoot(node: Node): ShadowRoot | null {
  const root = node.getRootNode()
  return root instanceof ShadowRoot ? root : null
}
```

### 9.2 Style Utilities

**File**: `src/utils/host/dom/style.ts`

```typescript
export function smashTruncationStyle(element: HTMLElement) {
  if (typeof window === "undefined") return

  const scheduleIdleTask = (callback: () => void) => {
    if (typeof window.requestIdleCallback === "function")
      window.requestIdleCallback(callback)
    else if (typeof window.requestAnimationFrame === "function")
      window.requestAnimationFrame(callback)
    else
      setTimeout(callback, 0)
  }

  scheduleIdleTask(() => {
    const computedStyle = window.getComputedStyle(element)
    if (computedStyle.webkitLineClamp && computedStyle.webkitLineClamp !== "none")
      element.style.webkitLineClamp = "unset"
    if (computedStyle.maxHeight && computedStyle.maxHeight !== "none")
      element.style.maxHeight = "unset"
    if (computedStyle.textOverflow === "ellipsis")
      element.style.textOverflow = "unset"
  })
}
```

Removes CSS truncation styles (`-webkit-line-clamp`, `max-height`, `text-overflow: ellipsis`) that would hide translated content. Scheduled during idle time to minimize performance impact.

### 9.3 DOM Finding Utilities

**File**: `src/utils/host/dom/find.ts`

**`findElementAt(root, point)`**: Traverses shadow roots to find the deepest element at a screen coordinate.

**`findNearestAncestorBlockNodeFor(element)`**: Walks up from an element until it finds a non-inline ancestor.

**`deepQueryTopLevelSelector(element, selectorFn)`**: Recursively searches through shadow DOMs for top-level elements matching a predicate function.

**`unwrapDeepestOnlyHTMLChild(element)`**: Given an element with deeply nested single-child wrappers, returns the deepest meaningful child. Also calls `smashTruncationStyle()` on each ancestor level:

```typescript
export async function unwrapDeepestOnlyHTMLChild(element: HTMLElement) {
  const config = await getLocalConfig() ?? DEFAULT_CONFIG
  let currentElement = element
  while (currentElement) {
    smashTruncationStyle(currentElement)
    const effectiveChildNodes = Array.from(currentElement.childNodes)
      .filter(shouldKeepNode)
    const effectiveChildren = effectiveChildNodes
      .filter(child => child.nodeType === Node.ELEMENT_NODE)
    if (!(effectiveChildren.length === 1 && effectiveChildNodes.length === 1)) break
    const onlyChildElement = effectiveChildren[0]
    if (!isHTMLElement(onlyChildElement)) break
    currentElement = onlyChildElement
  }
  return currentElement
}
```

This is used by both bilingual and translationOnly modes to find the actual content node when there are unnecessary wrapper `<div>`s.

### 9.4 Text Preparation

**File**: `src/utils/host/translate/text-preparation.ts`

```typescript
const INVISIBLE_TRANSLATION_CHARACTERS_REGEX = /[\u200B-\u200D\uFEFF]/g

export function prepareTranslationText(value: string | null | undefined): string {
  return value?.replace(INVISIBLE_TRANSLATION_CHARACTERS_REGEX, "").trim() ?? ""
}
```

Removes zero-width spaces, zero-width non-joiner/joiner, and BOM before comparing source and translated text.

### 9.5 Small Paragraph Filtering

**File**: `src/utils/host/translate/filter-small-paragraph.ts`

```typescript
export async function shouldFilterSmallParagraph(text: string, config: Config): Promise<boolean> {
  const { minCharactersPerNode, minWordsPerNode } = config.translate.page
  const { sourceCode } = config.language

  if (minCharactersPerNode > 0 && text.length < minCharactersPerNode) return true

  if (minWordsPerNode > 0) {
    const finalSourceCode = await getSourceCode(sourceCode)
    if (countWords(text, finalSourceCode) < minWordsPerNode) return true
  }

  return false
}
```

Uses `Intl.Segmenter` for locale-aware word counting. Paragraphs below the configured threshold are skipped.

### 9.6 Numeric Content Detection

```typescript
export function isNumericContent(text: string): boolean {
  const cleanedText = text.trim()
  if (!cleanedText) return false
  const numericPattern = /^[\d\s,.-]+$/
  if (!numericPattern.test(cleanedText)) return false
  return /\d/.test(cleanedText)
}
```

---

## 10. Key Adaptation Notes for TapWord

### 10.1 What to Keep Identical

| Component | Reason |
|---|---|
| **walkAndLabelElement() core algorithm** | The recursive walk + attribute labeling approach is battle-tested and handles edge cases well |
| **Filter function logic** | The multi-layered skip rules (hidden, notranslate, per-site custom, semantic) are comprehensive |
| **FORCE_BLOCK_TAGS set** | Standard HTML semantic block elements |
| **Shadow DOM traversal pattern** | Critical for modern web apps (GitHub, YouTube, etc.) |
| **Duck-typed type guards** (isHTMLElement/isTextNode) | Essential for cross-iframe/shadow DOM compatibility |
| **DOMBatcher pattern** | Simple, effective rAF batching |

### 10.2 What to Simplify (We Don't Need)

| Component | Reason |
|---|---|
| **Zod config schemas** | We use our own config approach; pass needed config directly |
| **WXT framework** | We build on vanilla Vite + Chrome extension APIs |
| **React / Jotai** | Our UI layer is different |
| **`unwrapDeepestOnlyHTMLChild()`** | Complex and specific to their paragraph-level translation; may not be needed for word/phrase level |
| **`smashTruncationStyle()`** | Only needed if we inject block-level content that would be truncated |
| **`translateNodeTranslationOnlyMode()`** | We do bilingual-style annotation, not content replacement |
| **`originalContentMap`** | Only needed for TranslationOnly restore |
| **CUSTOM_DONT_WALK_INTO_ELEMENT_SELECTOR_MAP** | Per-site selector map is Read Frog specific; we can start simpler and add as needed |
| **`MARK_ATTRIBUTES_REGEX`** | Only needed if we strip our own attributes from HTML before sending to API |

### 10.3 What to Modify for Our Architecture

| Component | Adaptation Needed |
|---|---|
| **Config parameter** | Replace `Config` type with our own config structure. The walk function only needs: `translate.page.range` (for MAIN_CONTENT_IGNORE_TAGS filtering) and any future per-site rules |
| **Data attributes** | Change prefix from `data-read-frog-*` to `data-tapword-*` |
| **CSS classes** | Change from `read-frog-*` to `tapword-*` |
| **Translation unit granularity** | Read Frog translates entire paragraphs. We may want finer granularity (sentence/phrase level within a paragraph) for word annotation. The walker can remain the same — we modify how `translateNodes()` splits text |
| **Translation insertion** | Read Frog inserts `<span>` after original text. We insert hoverable annotation elements around specific words/phrases |
| **extractTextContent()** | May need to preserve position mapping (character offset → DOM node) so we can insert annotations at the right positions |
| **Walk trigger** | Read Frog uses IntersectionObserver on paragraph elements. We should keep this approach but may also need MutationObserver for SPA content changes |
| **walkId lifecycle** | Keep the UUID session concept, but tie it to our feature's on/off state |

### 10.4 Critical Design Observations

1. **`getComputedStyle()` is expensive**: Both `isShallowInlineHTMLElement()` and `isShallowBlockHTMLElement()` call `window.getComputedStyle()`. During a full-page walk, this is called for every element. This is a known performance cost; Read Frog accepts it because the walk happens once and the result is cached in attributes.

2. **Walk is synchronous, translation is async**: `walkAndLabelElement()` is a synchronous recursive function. `translateWalkedElement()` is async. This separation allows the walk to complete quickly (labeling only) while translations happen lazily.

3. **Paragraph detection is parent-centric**: A "paragraph" is identified by having inline children — not by being a `<p>` tag. This correctly handles cases like `<div>text</div>`, `<td>text</td>`, etc.

4. **The `PARAGRAPH_ATTRIBUTE` is the primary translation trigger**: IntersectionObserver observes elements with `[data-read-frog-paragraph]`. Without this attribute, an element is never directly translated — only recursed through.

5. **forceBlock propagation prevents paragraph fragmentation**: Without upward propagation, a `<span>` containing a `<ul>` could be labeled as inline, causing the `<ul>` to be grouped with its sibling text nodes as a single paragraph — visually incorrect.

6. **`isDontWalkIntoButTranslateAsChildElement` vs `isDontWalkIntoAndDontTranslateAsChildElement`**: The naming is explicit about the two dimensions: (a) whether we recurse, and (b) whether the text is included. This 2x2 matrix also has "walk into AND translate" (normal elements) and theoretically "walk into but don't translate" (not used).

---

*End of analysis.*
