# Auto-Translation Frontend Technical Spec

*Created: 2026-03-11*
*Revised: 2026-03-12 — Architecture review changes (see Revision History)*
*Status: Complete*
*Author: AI Agent (codebase-derived)*
*Companion document: `260311_auto_translate_backend_tech_spec.md`*

### Revision History

| Date | Changes |
|------|--------|
| 2026-03-11 | Initial version |
| 2026-03-11 | Architecture review: (1) Added comments to `manualTrigger`/`excludedTexts` clarifying they are for backend pipeline filtering only — not passed to LLM, (2) Updated offset comments — backend computes offsets deterministically (not LLM), (3) Removed `reason` field from `AutoCandidate` response type (stripped by backend before sending to frontend), (4) Updated filtering/rendering to handle multiple occurrences of the same candidate text at different positions, (5) Changed "LLM-provided offsets" to "backend-computed offsets" throughout, (6) Updated LLM output format references for CoT field ordering (reason before translation) |
| 2026-03-11 | Design adjustments (second round): (7) Added note that `"phrase"` type includes familiar-word combinations (e.g., "once per", "break down"), not just traditional multi-word phrases, (8) Dynamic budget calculation now factors in `userLevel` — lower proficiency yields more translation results; uses "translation results" terminology instead of "candidates", (9) Updated LLM output format references: `reason` moved to FIRST position (`reason→text→type→translation`) for maximum Chain-of-Thought quality |
| 2026-03-12 | Minor addendum: Added nested block element handling to Section 5.3 edge cases and Section 14.7 risk entry — documents V1 behavior (TreeWalker includes all descendant text) and future shallow-extraction improvement |

## Document Purpose

This document is a self-contained technical specification for the **frontend** implementation of the Automatic Word/Phrase Translation feature. It was produced by deep analysis of the existing content script architecture (`src/1_content/`), background service worker (`src/2_background/`), shared types (`src/0_common/`), translation services (`src/6_translate/`), and LLM generation layer (`src/8_generate/`). All code references point to actual files, functions, and types in the codebase.

---

## 1. Current Frontend Architecture Analysis

### 1.1 Content Script Architecture

**Entry point:** `src/1_content/index.ts`

Initialization sequence:
1. Fires `PAGE_ACTIVATED` message to background (fire-and-forget token warm-up)
2. Loads user settings via `storageManager.getUserSettings()` → caches in module-level `userSettings`
3. Applies dynamic CSS variables for underline colors and offsets via `applyDynamicStyles()`
4. Registers DOM event listeners: `dblclick`, `click` (capture), `mouseup`, `mousedown`, `scroll`
5. Sets up SPA navigation handler to clear stale translation UI on route changes

**Key modules:**

| Module | File | Responsibility |
|--------|------|----------------|
| Event capture | `handlers/InputListener.ts` | Captures click/dblclick/mouseup, validates interactions, forwards to pipeline |
| Translation orchestration | `handlers/TranslationPipeline.ts` | Language detection, classification, range adjustment, routing to word/fragment path |
| Backend communication | `services/translationRequest.ts` | `chrome.runtime.sendMessage` with retry logic |
| UI rendering | `ui/translationDisplayV2.ts` | Range-based tooltip creation, positioning, lifecycle |
| Block detection | `utils/domSanitizer.ts` | `getClosestBlockAncestor()` — block-level ancestor resolution |
| Context extraction | `utils/contextExtractorV2.ts` | Sentence-level context extraction around a Range |
| Overlap detection | `handlers/utils/translationOverlapDetectorV2.ts` | Range-vs-Range overlap checking |

**Settings access pattern:** `contentIndex.getCachedUserSettings()` returns the module-level cached `UserSettings` object. Settings updates are received via `chrome.storage.onChanged` listener.

### 1.2 Manual Translation Flow (Step-by-Step)

The complete flow from user action to rendered result:

**Step 1: User interaction**
- User double-clicks a word → `InputListener.handleDoubleClick()` fires
- Or user selects text, clicks icon → `InputListener.handleTextSelection()` → `iconManager` shows icon → icon click → `TranslationPipeline.handleIconClick()`

**Step 2: Pipeline entry** (`TranslationPipeline.ts`)
- `triggerTranslationWithSplit(range, label)` is called
- `rangeSplitter.splitRangeByBlocks(range)` splits cross-block selections into per-block ranges
- For each sub-range, `processTranslation()` is invoked

**Step 3: Language detection & classification** (`processTranslation()`)
- `domSanitizer.getSurroundingTextForDetection(range, 150)` extracts block text for language detection
- `languageDetector.detectSourceLanguageAsync()` determines source language
- `selectionClassifier.detectSelectionType()` classifies as `"word"` or `"fragment"`
- Routes to `translateWordPath()` or `translateFragmentPath()`

**Step 4: Context extraction**
- `extractContextV2(range)` extracts `leadingText`, `trailingText`, `currentSentence`, `previousSentences`, `nextSentences`
- Context is extracted **before** any DOM mutations

**Step 5: UI loading state**
- `translationDisplay.showTranslationResult(range, text, { status: "loading" }, context, refreshCallback, type, displaySettings)` is called
- Creates a `TranslationEntry` with a cloned Range, appends tooltip to `document.body`
- Returns a unique `anchorId` (e.g., `"translation-0"`)

**Step 6: Background request**
- `translationRequest.requestTranslation(payload)` sends `TRANSLATE_REQUEST` message
- Background `MessageRouter` dispatches to `TranslationRequestHandler.handleTranslationRequest()`
- Handler calls `translateModule.translateWord(params)` → routes by provider → cloud/local/MTranServer/Bing
- Response sent back via `sendResponse()`

**Step 7: UI update**
- `translationDisplay.updateTranslationResult(anchorId, { status: "success", translation, ... }, displaySettings)` renders the final translation
- Tooltip content is re-rendered, position recalculated, text split across line rects

### 1.3 Block Detection Mechanism

**Function:** `domSanitizer.getClosestBlockAncestor(node)` in `src/1_content/utils/domSanitizer.ts`

```typescript
export function getClosestBlockAncestor(node: Node): Element {
    let el: Element | null = node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement
    while (el && el !== document.body) {
        if (BLOCK_ELEMENTS.has(el.tagName)) return el
        el = el.parentElement
    }
    return document.body
}
```

`BLOCK_ELEMENTS` is a `Set<string>` containing 30+ block-level tags: `P`, `DIV`, `LI`, `H1`–`H6`, `BLOCKQUOTE`, `ARTICLE`, `SECTION`, `TABLE`, `TD`, `TH`, `PRE`, `FIGURE`, `HEADER`, `FOOTER`, `NAV`, `MAIN`, `ASIDE`, `FORM`, `FIELDSET`, `DL`, `DT`, `DD`, `OL`, `UL`, `HR`, `ADDRESS`, `FIGCAPTION`, `THEAD`, `TBODY`, `TFOOT`, `TR`.

**Usage in range splitting:** `rangeSplitter.splitRangeByBlocks()` walks text nodes in the selection and groups them by their closest block ancestor.

**Usage in context extraction:** `contextExtractorV2.ts` uses `findBoundaryRoot()` which walks up to find the boundary ancestor using the same block-level tag set (`DEFAULT_BOUNDARY_TAGS`).

### 1.4 Translation State Management

**Primary state:** `activeTranslations: Map<string, TranslationEntry>` in `src/1_content/ui/translationDisplayV2.ts`

```typescript
interface TranslationEntry {
    id: string                          // e.g., "translation-0"
    range: Range                        // Cloned Range referencing original text nodes
    tooltips: HTMLElement[]             // Tooltip DOM elements (one per visual line)
    translationData: TranslationDetailData  // Full data for modal display
    originalText: string                // The raw selected string
    translationType: "word" | "fragment" // Classification
    creationTime: number                // Date.now() at creation
}
```

**Supporting caches:**
- `rectSignatureCache: Map<string, string>` — prevents redundant text re-splitting on scroll
- `tooltipSegmentsCache: Map<string, string[]>` — cached split text per translation
- `adjustedBlocks: Map<string, HTMLElement>` — tracks which blocks had line-height adjusted

**Public accessors:**
- `getActiveRanges(): Map<string, Range>` — used by overlap detector
- `isPointInsideActiveTranslation(x, y): boolean` — used by selection validator

**There is no per-block state tracking currently.** Translations are tracked individually by ID, not grouped by block. This is a key gap that auto-translation must address.

### 1.5 UI Rendering Pipeline

**Architecture:** V2 uses a Range-based, zero-DOM-intrusion approach. No anchor `<span>` elements are created. The original DOM is never mutated.

**Rendering flow:**
1. `showTranslationResult()` creates a `TranslationEntry` with cloned Range
2. `createTooltipElement()` creates a `<div class="ai-translator-tooltip">` with inner `<div class="ai-translator-tooltip-content">`
3. Fragment translations get additional class `ai-translator-tooltip--fragment`
4. `renderTooltipContent()` sets font, color, loading/success/error state
5. Tooltip appended to `document.body` (portalled)
6. `positionTooltip()` reads `Range.getClientRects()`, computes absolute `top`/`left`
7. Multi-line selections split text across multiple tooltip segments using `splitTextAcrossRects()`
8. Fade-in via CSS: `opacity: 0` → add class `visible` → `opacity: 0.8`

**Underline mechanism:** The tooltip's `border-top` acts as the visual underline. Word translations use `var(--modal-blue-accent-color)` (blue, default `#1F7FDB`), fragment translations use `var(--modal-accent-color)` (gold, default `#E9C46A`). These CSS variables are set dynamically from user settings in `applyDynamicStyles()`.

**Hit testing:** `hitTesting.ts` uses global click/dblclick listeners with `Range.getClientRects()` to determine which translation was clicked. Single-click opens the detail modal; double-click removes the translation.

### 1.6 Settings System

**Type:** `UserSettings` interface in `src/0_common/types/index.ts` — 40+ fields covering behavior toggles, visual styling, provider config, and layout offsets.

**Storage:** `chrome.storage.sync` via `storageManager.ts`. CRUD operations: `getUserSettings()`, `saveUserSettings()`, `updateUserSettings()`, `resetUserSettings()`.

**Default values:** `DEFAULT_USER_SETTINGS` constant in `src/0_common/types/index.ts`.

**Settings flow:**
1. Content script calls `storageManager.getUserSettings()` on init → caches in module-level `userSettings`
2. `chrome.storage.onChanged` listener updates the cache in real-time
3. All code reads settings via `contentIndex.getCachedUserSettings()`
4. Popup/options pages write settings via `storageManager.saveUserSettings()`

**Normalization:** `normalizeUserSettings()` in `storageManager.ts` handles migration from legacy formats and platform-specific defaults.

---

## 2. Frontend Integration Points

### 2.1 Trigger Point: After Manual Translation Success

The auto-translation trigger point is inside `TranslationPipeline.ts`, specifically at the point where manual translation succeeds. Both `translateWordPath()` and `translateFragmentPath()` have a clear success callback pattern:

```
translateWordPath() → performRequest() → response.success → updateTranslationResult() → ★ TRIGGER AUTO-TRANSLATION HERE
translateFragmentPath() → performFragmentRequest() → response.success → updateTranslationResult() → ★ TRIGGER AUTO-TRANSLATION HERE
```

The trigger should be a fire-and-forget async call placed immediately after `translationDisplay.updateTranslationResult()` succeeds in the `response.success` branch.

### 2.2 Existing APIs/Services That Can Be Reused

| Component | Reuse |
|-----------|-------|
| `domSanitizer.getClosestBlockAncestor()` | Block element resolution |
| `domSanitizer.getCleanTextFromRange()` | Clean text extraction from block |
| `domSanitizer.createLocalTextWalker()` | Text node traversal for offset→Range mapping |
| `translationDisplay.showTranslationResult()` | Rendering auto-translation underlines + tooltips |
| `translationDisplay.getActiveRanges()` | Checking existing manual translations |
| `translationDisplay.updateTranslationResult()` | Updating auto-translation state |
| `translationOverlapDetectorV2` | Checking overlap between auto-candidates and existing translations |
| `translationRequest.ts` pattern | Model for new `requestAutoCandidates()` function |
| `TranslationPipeline.buildDisplaySettings()` | Display settings resolution |
| `contentIndex.getCachedUserSettings()` | Settings access |

### 2.3 New Modules Required

| New Module | Location | Purpose |
|------------|----------|---------|
| Auto-translation orchestrator | `src/1_content/services/autoTranslationService.ts` | Trigger logic, block scanning, candidate filtering, rendering |
| Auto-candidates request | `src/1_content/services/translationRequest.ts` (add function) | `requestAutoCandidates()` — sends `AUTO_CANDIDATES_REQUEST` |
| Block text extractor | `src/1_content/utils/blockTextExtractor.ts` | Extracts full text of a block with offset mapping |
| Candidate-to-DOM mapper | `src/1_content/utils/candidateDomMapper.ts` | Maps `AutoCandidate` offsets to live DOM Range objects |
| Auto-candidates service | `src/6_translate/services/AutoCandidatesService.ts` | Cloud API call for `POST /api/v1/translate/auto-candidates` |
| Auto-candidates handler | `src/2_background/handlers/AutoCandidatesRequestHandler.ts` | Background message handler |
| Auto-candidates types | `src/6_translate/types/AutoCandidatesTypes.ts` | API request/response type definitions |

---

## 3. New Message Types & Communication

### 3.1 Message Type Extension

Add to `MessageType` union in `src/0_common/types/index.ts`:

```typescript
export type MessageType =
    | "TRANSLATE_REQUEST"
    | "FRAGMENT_TRANSLATE_REQUEST"
    | "SPEECH_SYNTHESIS_REQUEST"
    | "SPEECH_STOP_REQUEST"
    | "POPUP_BOOTSTRAP_REQUEST"
    | "PAGE_ACTIVATED"
    | "AUTO_CANDIDATES_REQUEST"   // NEW
```

### 3.2 Request Message

```typescript
export interface AutoCandidatesRequestData {
    /** Source language code (e.g. "en") */
    sourceLang: string
    /** Target language code (e.g. "zh-CN") */
    targetLang: string
    /** Full raw text of the current block */
    blockText: string
    /** The word/phrase the user just manually translated.
     *  Used by backend hard-rule pipeline for filtering/exclusion.
     *  NOT passed to LLM prompt (difficulty is calibrated by userLevel). */
    manualTrigger: {
        text: string
        type?: "word" | "phrase"
        translation?: string
    }
    /** User proficiency level */
    userLevel: "Beginner" | "Intermediate" | "Advanced"
    /** Texts to exclude from candidate results (already translated items).
     *  Used by backend hard-rule pipeline only, NOT passed to LLM prompt. */
    excludedTexts: string[]
    /** Frontend budget hint (max translation results desired) */
    limit: number
}

export interface AutoCandidatesRequestMessage {
    type: "AUTO_CANDIDATES_REQUEST"
    data: AutoCandidatesRequestData
}
```

### 3.3 Response Message

```typescript
export interface AutoCandidate {
    /** Exact text as it appears in blockText */
    text: string
    /** Candidate granularity. "phrase" includes not only traditional multi-word
     *  phrases, but also combinations of individually familiar words that form an
     *  unfamiliar expression (e.g., "once per", "break down", "in terms of"). */
    type: "word" | "phrase"
    /** Start offset in blockText (0-based, inclusive). Computed by backend, not LLM. */
    start: number
    /** End offset in blockText (0-based, exclusive). Computed by backend, not LLM. */
    end: number
    /** Translation in target language */
    translation: string
    /** Selection source */
    source: "llm" | "rule" | "hybrid"
    // NOTE: `reason` is intentionally excluded from the API response.
    // The LLM produces a `reason` field (for Chain-of-Thought quality),
    // and the backend logs it for debugging, but it is stripped before
    // sending the response to the frontend.
}

export interface AutoCandidatesResponseData {
    traceId: string
    candidates: AutoCandidate[]
    meta: {
        sourceLang: string
        targetLang: string
        limitApplied: number
        degraded: boolean
        model?: string
    }
    warnings?: string[]
}

export interface AutoCandidatesResponseSuccessMessage {
    type: "AUTO_CANDIDATES_RESPONSE"
    success: true
    data: AutoCandidatesResponseData
}

export interface AutoCandidatesResponseErrorMessage {
    type: "AUTO_CANDIDATES_RESPONSE"
    success: false
    error: string
}

export type AutoCandidatesResponseMessage =
    | AutoCandidatesResponseSuccessMessage
    | AutoCandidatesResponseErrorMessage
```

### 3.4 Discriminated Union Fit

These types follow the existing pattern established by `TranslateRequestMessage / TranslateResponseMessage` and `FragmentTranslateRequestMessage / FragmentTranslateResponseMessage`. The `type` field serves as the discriminant. The `success: true | false` split in the response follows the same union pattern used by all existing response types.

---

## 4. Auto-Translation Trigger Logic

### 4.1 Trigger Entry Point

The trigger is placed inside `TranslationPipeline.ts`, in both `translateWordPath()` and `translateFragmentPath()`, immediately after a successful response:

```typescript
// In translateWordPath(), after translationDisplay.updateTranslationResult(anchorId, { status: "success", ... })
if (response.success) {
    translationDisplay.updateTranslationResult(anchorId, { status: "success", ... }, displaySettings)

    // Fire-and-forget auto-translation
    void autoTranslationService.tryAutoTranslate({
        triggerRange: range,
        triggerText: word,
        triggerType: "word",
        triggerTranslation: response.data.wordTranslation,
        detectedLang: detectedLang,
        targetLang: targetLang,
    })
}
```

The same pattern applies to `translateFragmentPath()` with `triggerType: "fragment"`.

### 4.2 Trigger Condition Checking Algorithm

```typescript
async function tryAutoTranslate(params: AutoTriggerParams): Promise<void> {
    // 1. Check feature enabled
    const settings = contentIndex.getCachedUserSettings()
    if (!settings?.enableAutoTranslate) return

    // 2. Resolve block element
    const blockElement = domSanitizer.getClosestBlockAncestor(params.triggerRange.startContainer)

    // 3. Check scan-once tracking
    if (scannedBlocks.has(blockElement)) return
    scannedBlocks.add(blockElement)

    // 4. Extract block text with offset mapping
    const { blockText, textNodes } = extractBlockText(blockElement)

    // 5. Check minimum block length
    if (blockText.length < MIN_BLOCK_TEXT_LENGTH) return

    // 6. Build excludedTexts from existing translations in this block
    //    (sent to backend for hard-rule pipeline filtering, NOT passed to LLM prompt)
    const excludedTexts = buildExcludedTexts(blockElement, params.triggerText)

    // 7. Compute dynamic budget (factors in text length and user proficiency)
    const limit = computeDynamicBudget(blockText.length, settings.userLanguageProficiency)

    // 8. Send auto-candidates request (async, fire-and-forget error handling)
    try {
        const response = await requestAutoCandidates({ ... })
        if (response.success && response.data.candidates.length > 0) {
            await processAndRenderCandidates(response.data.candidates, blockElement, blockText, textNodes, params)
        }
    } catch (error) {
        logger.warn("Auto-translation failed silently:", error)
    }
}
```

### 4.3 Block Scan-Once Tracking

```typescript
/** WeakSet allows garbage collection when block elements are removed from DOM */
const scannedBlocks = new WeakSet<Element>()
```

Using `WeakSet<Element>` instead of `Set` or `Map` ensures that:
- Memory is freed automatically when the host page removes or replaces block elements
- SPA navigations that remove old content automatically clean up tracking
- No explicit cleanup code is needed

### 4.4 Dynamic Budget Calculation

```typescript
const MIN_BLOCK_TEXT_LENGTH = 20
const CHARS_PER_RESULT = 80
const MAX_AUTO_CANDIDATES = 5
const MIN_AUTO_CANDIDATES = 1

/** Level multiplier: lower proficiency → more translation results */
const LEVEL_MULTIPLIER: Record<string, number> = {
    Beginner: 1.5,
    Intermediate: 1.0,
    Advanced: 0.6,
}

function computeDynamicBudget(blockTextLength: number, userLevel: string): number {
    // Base: roughly 1 result per 80 chars, min 1
    const base = Math.max(1, Math.floor(blockTextLength / CHARS_PER_RESULT))
    // Level multiplier: lower level → more results
    const multiplier = LEVEL_MULTIPLIER[userLevel] ?? 1.0
    return Math.min(MAX_AUTO_CANDIDATES, Math.round(base * multiplier))
}
```

Example outputs (Intermediate):
80 chars → 1 result, 160 → 2, 240 → 3, 320 → 4, 400+ → 5.

Example outputs (Beginner):
80 chars → 2 results, 160 → 3, 240 → 5, 320+ → 5.

Example outputs (Advanced):
80 chars → 1 result, 160 → 1, 240 → 2, 400 → 3, 800+ → 5.

`userLevel` directly influences the number of translation results — not just the difficulty threshold. This ensures Beginner readers get denser help while Advanced readers see a cleaner page.

---

## 5. Block Text Extraction

### 5.1 Purpose

The auto-candidates API requires the full block text as a string, plus the ability to map character offsets back to DOM positions. This requires extracting text with offset tracking metadata.

### 5.2 Extraction Algorithm

New utility: `src/1_content/utils/blockTextExtractor.ts`

```typescript
export interface TextNodeSegment {
    node: Text
    /** Start offset of this node's text within the concatenated blockText */
    blockOffset: number
    /** Length of this node's text contribution */
    length: number
}

export interface BlockTextResult {
    /** Full concatenated text of the block */
    blockText: string
    /** Ordered list of text node segments with their offset mapping */
    textNodes: TextNodeSegment[]
    /** The block element itself */
    blockElement: Element
}

export function extractBlockText(blockElement: Element): BlockTextResult {
    const walker = domSanitizer.createLocalTextWalker(blockElement)
    // Scope walker to only text nodes within blockElement
    const textNodes: TextNodeSegment[] = []
    let blockText = ""

    // Manually walk only within the block element's subtree
    let node = walker.firstChild()
    while (node) {
        if (!blockElement.contains(node)) break
        const text = node.textContent || ""
        if (text.length > 0) {
            textNodes.push({
                node: node as Text,
                blockOffset: blockText.length,
                length: text.length,
            })
            blockText += text
        }
        node = walker.nextNode()
        if (node && !blockElement.contains(node)) break
    }

    return { blockText, textNodes, blockElement }
}
```

### 5.3 Edge Cases

| Edge Case | Handling |
|-----------|----------|
| Nested inline elements (`<em>`, `<strong>`, `<a>`, `<span>`) | TreeWalker only visits text nodes; inline wrappers are transparent |
| Extension UI elements (tooltips, icons) | `createLocalTextWalker()` uses `isInsideIgnoredElement()` to skip them |
| Whitespace normalization | Text is extracted verbatim (no normalization). The API receives exact text so offsets map correctly |
| Empty text nodes | Skipped (length check) |
| Very long blocks (>5000 chars) | Backend truncates; frontend sends full text. Could optionally truncate on frontend as well |
| Nested block elements (`<div>` inside `<div>`) | V1: TreeWalker includes all descendant text nodes including those in nested blocks. If user selects a word in the outer block, `blockText` will contain text from nested blocks too, and LLM may recommend words from nested blocks. This is acceptable for V1 — most real-world pages don't have deeply nested blocks, and any recommended words are still helpful for reading the same content area. **Future improvement**: If testing reveals UX issues, implement "shallow extraction" that skips text nodes whose closest block ancestor differs from the target block element. See `getClosestBlockAncestor()` in `domSanitizer.ts`. |

---

## 6. Frontend Hard-Rule Filtering

### 6.1 Pre-Request Filtering: `excludedTexts` Construction

Before sending the auto-candidates request, the frontend builds an `excludedTexts` array. These are sent to the backend for hard-rule pipeline filtering (not passed to the LLM prompt):

```typescript
function buildExcludedTexts(blockElement: Element, manualTriggerText: string): string[] {
    const excluded: string[] = []

    // 1. The manually triggered word/phrase
    excluded.push(manualTriggerText.toLowerCase())

    // 2. All existing manual translations in this block
    const activeRanges = translationDisplay.getActiveRanges()
    for (const [id, range] of activeRanges) {
        // Check if the translation's range is within this block
        if (blockElement.contains(range.startContainer)) {
            const entry = getActiveTranslationEntry(id)
            if (entry) {
                excluded.push(entry.originalText.toLowerCase())
            }
        }
    }

    return [...new Set(excluded)] // deduplicate
}
```

### 6.2 Post-Response Filtering Pipeline

After receiving candidates from the backend, the frontend applies a multi-stage filter:

```
Backend Response (candidates[])
    │
    ▼
Stage 1: Skip already-translated items (word translations)
    │  Check each candidate against activeTranslations where
    │  translationType === "word" and block contains range
    ▼
Stage 2: Skip already-translated items (fragment translations)
    │  Check if candidate's [start,end) overlaps any active fragment range
    ▼
Stage 3: Skip already-rendered auto-translations
    │  Check against autoRenderedOffsets set for this block
    │  Dedup by [start,end) offset range, NOT by text alone
    │  (backend may return multiple candidates with the same text
    │   at different positions — each is a distinct occurrence)
    ▼
Stage 4: DOM Range validation
    │  Verify candidate can be mapped to a valid DOM Range
    │  Verify blockText.substring(start, end) matches range text
    │  Drop candidates that fail mapping
    ▼
Stage 5: Overlap detection with existing translations
    │  Use translationOverlapDetectorV2.detectOverlappingTranslations()
    │  Drop candidates whose Range overlaps any active translation
    ▼
Stage 6: Density check
    │  If remaining candidates + existing translations in block exceed threshold,
    │  truncate to stay within visual budget
    │  NOTE: backend may return more entries than `limit` due to
    │  occurrence expansion (all positions of each candidate text),
    │  so density check is the critical safeguard
    ▼
Filtered Candidate List → render
```

### 6.3 Overlap Detection Details

Reuses the existing `translationOverlapDetectorV2.detectOverlappingTranslations()`:

```typescript
function candidateOverlapsExisting(candidateRange: Range): boolean {
    const activeRanges = translationDisplay.getActiveRanges()
    const overlapping = translationOverlapDetector.detectOverlappingTranslations(candidateRange, activeRanges)
    return overlapping.length > 0
}
```

### 6.4 Density Check

```typescript
const MAX_TRANSLATIONS_PER_BLOCK = 8  // manual + auto combined

function computeRemainingBudget(blockElement: Element): number {
    const activeRanges = translationDisplay.getActiveRanges()
    let count = 0
    for (const [, range] of activeRanges) {
        if (blockElement.contains(range.startContainer)) count++
    }
    return Math.max(0, MAX_TRANSLATIONS_PER_BLOCK - count)
}
```

### 6.5 Final Display Veto

Per the requirements, the frontend has final display authority. Any candidate that survives all pipeline stages is rendered. The pipeline is designed to be conservative — prefer under-selection over over-selection.

---

## 7. Candidate-to-DOM Mapping

### 7.1 Purpose

Each `AutoCandidate` has `start` and `end` offsets relative to `blockText` (computed deterministically by the backend, not by the LLM). These must be converted to live DOM `Range` objects for rendering.

### 7.2 Text Node Walking Algorithm

New utility: `src/1_content/utils/candidateDomMapper.ts`

```typescript
export interface CandidateMappingResult {
    range: Range
    valid: boolean
}

/**
 * Map a candidate's [start, end) offsets in blockText to a DOM Range.
 *
 * @param candidate - The AutoCandidate with start/end offsets
 * @param textNodes - Ordered TextNodeSegment array from extractBlockText()
 * @param blockText - The full block text string
 * @returns A Range if mapping succeeds, or null if validation fails
 */
export function mapCandidateToRange(
    candidate: { text: string; start: number; end: number },
    textNodes: TextNodeSegment[],
    blockText: string
): Range | null {
    // Step 1: Verify offset correctness
    const extracted = blockText.substring(candidate.start, candidate.end)
    if (extracted !== candidate.text) {
        logger.warn(`Offset mismatch: expected "${candidate.text}", got "${extracted}"`)
        return null
    }

    // Step 2: Find start text node and offset
    let startNode: Text | null = null
    let startOffset = 0
    let endNode: Text | null = null
    let endOffset = 0

    for (const segment of textNodes) {
        const segStart = segment.blockOffset
        const segEnd = segment.blockOffset + segment.length

        // Find the text node containing candidate.start
        if (!startNode && candidate.start >= segStart && candidate.start < segEnd) {
            startNode = segment.node
            startOffset = candidate.start - segStart
        }

        // Find the text node containing candidate.end
        if (candidate.end > segStart && candidate.end <= segEnd) {
            endNode = segment.node
            endOffset = candidate.end - segStart
        }

        // Optimization: break early if both found
        if (startNode && endNode) break
    }

    if (!startNode || !endNode) {
        logger.warn(`Could not locate DOM nodes for candidate "${candidate.text}"`)
        return null
    }

    // Step 3: Create Range
    try {
        const range = document.createRange()
        range.setStart(startNode, startOffset)
        range.setEnd(endNode, endOffset)

        // Step 4: Validate Range text matches candidate text
        const rangeText = range.toString()
        if (rangeText !== candidate.text) {
            logger.warn(`Range text mismatch: expected "${candidate.text}", got "${rangeText}"`)
            return null
        }

        return range
    } catch (error) {
        logger.warn(`Failed to create Range for candidate "${candidate.text}":`, error)
        return null
    }
}
```

### 7.3 Handling Complex DOM Structures

| Scenario | Handling |
|----------|----------|
| Candidate spans multiple text nodes (e.g., `<em>ten</em>acity`) | Walker finds start in one node, end in another; Range spans both |
| Existing highlight overlays present | V2 system doesn't wrap text in spans, so existing translations don't fragment text nodes |
| SPA framework virtual DOM updates | If text nodes are recycled between extraction and rendering, Range creation will fail gracefully (returns null) |
| Text node split by browser (e.g., after `normalize()` call) | The walker addresses nodes in DOM order; split nodes still concatenate correctly |

### 7.4 Validation Strategy

Every candidate Range is validated by comparing `range.toString()` against `candidate.text`. This catches:
- Stale offsets from DOM mutations
- Browser text node splits
- Extension UI elements interfering with text content

---

## 8. UI Rendering

### 8.1 Rendering Auto-Translation Underlines

Auto-translations reuse the existing `translationDisplayV2.showTranslationResult()` API. Each candidate is rendered as an independent translation entry:

```typescript
async function renderAutoCandidate(
    candidateRange: Range,
    candidate: AutoCandidate,
    displaySettings: DisplayUserSettings
): Promise<string | null> {
    const state: SuccessState = {
        status: "success",
        translation: candidate.translation,
    }

    const anchorId = translationDisplay.showTranslationResult(
        candidateRange,
        candidate.text,
        state,
        undefined,  // no context needed for auto-translations (no modal refresh)
        undefined,  // no refresh callback
        candidate.type === "phrase" ? "fragment" : "word",
        displaySettings
    )

    return anchorId
}
```

### 8.2 Teal Color Styling

Per requirements, auto-translated items use **Teal** color for underlines (both word and phrase). The system-defined teal is `#2A9D8F` (already used as `wordUnderlineColor` default in `DEFAULT_USER_SETTINGS`).

**Implementation approach:** Add a new CSS class `ai-translator-tooltip--auto` that overrides the `border-top-color`:

```css
/* Auto-translation underline: Teal color, reduced opacity for lower visual weight */
.ai-translator-tooltip--auto {
    border-top-color: #2A9D8F;
    border-top-width: 1px;  /* Thinner than manual's 1.5px */
}

.ai-translator-tooltip--auto.visible {
    opacity: 0.6;  /* Lower than manual's 0.8 */
}
```

This CSS class is added in `showTranslationResult()` or immediately after by the auto-translation service:

```typescript
// After showTranslationResult returns anchorId
const entry = activeTranslations.get(anchorId)
if (entry) {
    for (const tooltip of entry.tooltips) {
        tooltip.classList.add("ai-translator-tooltip--auto")
    }
}
```

### 8.3 Lower Visual Weight

Three mechanisms achieve lower visual weight:

1. **Reduced opacity:** Auto-translations render at `opacity: 0.6` vs manual's `0.8`
2. **Thinner underline:** `border-top-width: 1px` vs manual's `1.5px`
3. **Unified color:** Both word and phrase auto-translations use teal, creating visual uniformity that recedes behind the more prominent manual translations

### 8.4 Reuse of Existing UI Components

| Component | Reuse Strategy |
|-----------|---------------|
| `translationDisplayV2.showTranslationResult()` | Fully reused — creates TranslationEntry, tooltip, positions it |
| `translationDisplayV2.updateTranslationResult()` | Used if auto-translation needs state update |
| `translationDisplayV2.removeTranslationResult()` | Used for cleanup |
| `tooltipRenderer.createTooltipElement()` | Reused via `showTranslationResult` |
| `hitTesting.ts` | Reused — auto-translations are clickable/removable like manual ones |
| Position management (`positionTooltip`, scroll/resize listeners) | Automatically attached by existing system |

**New components needed:**
- CSS class `ai-translator-tooltip--auto` in `content.css`
- No new DOM element types required

### 8.5 Translation Card/Tooltip for Auto-Translations

Auto-translations display the translation text directly in the inline tooltip (same as manual translations). Clicking an auto-translation opens the detail modal with the available data (text, translation, type). There is no "refresh" callback since auto-translations don't support re-triggering.

### 8.6 Animation Strategy

Per requirements: "Do not use attention-grabbing animation for multiple auto results."

Auto-translations use the same subtle fade-in (`opacity 0.2s ease`) as manual translations. Multiple candidates are rendered sequentially (not simultaneously) with a small stagger delay:

```typescript
const RENDER_STAGGER_MS = 50

// filteredCandidates may include multiple entries with the same text
// but different [start, end) offsets (all occurrences of a word in the block)
for (let i = 0; i < filteredCandidates.length; i++) {
    const candidate = filteredCandidates[i]
    const candidateRange = candidateRanges.get(i)
    if (!candidateRange) continue
    if (i > 0) await delay(RENDER_STAGGER_MS)
    await renderAutoCandidate(candidateRange, candidate, displaySettings)
}
```

---

## 9. Settings Integration

### 9.1 New Settings Fields

Add to `UserSettings` interface in `src/0_common/types/index.ts`:

```typescript
export interface UserSettings {
    // ... existing fields ...

    /** Enable automatic supplementary translation after manual translation */
    enableAutoTranslate: boolean

    /** User language proficiency level for auto-translation candidate selection */
    userLanguageProficiency: "Beginner" | "Intermediate" | "Advanced"
}
```

### 9.2 Default Values

Add to `DEFAULT_USER_SETTINGS` in `src/0_common/types/index.ts`:

```typescript
export const DEFAULT_USER_SETTINGS: UserSettings = {
    // ... existing ...
    enableAutoTranslate: false,
    userLanguageProficiency: "Intermediate",
}
```

### 9.3 Type Alias

Add for cleaner imports:

```typescript
export type LanguageProficiency = "Beginner" | "Intermediate" | "Advanced"
```

### 9.4 Settings Normalization

In `storageManager.ts` `normalizeUserSettings()`, add validation:

```typescript
const VALID_PROFICIENCY_LEVELS: LanguageProficiency[] = ["Beginner", "Intermediate", "Advanced"]

// In normalizeUserSettings:
const normalizedProficiency = VALID_PROFICIENCY_LEVELS.includes(mergedSettings.userLanguageProficiency)
    ? mergedSettings.userLanguageProficiency
    : DEFAULT_USER_SETTINGS.userLanguageProficiency
```

### 9.5 Popup/Options UI Changes

**Popup (`src/3_popup/`):**
Add two new settings controls:

1. **Enable Auto-Translate toggle** — same toggle pattern as existing settings (`showIcon`, `doubleClickTranslate`, etc.)
2. **Language Proficiency selector** — a dropdown/select control with three options

These follow the existing `settingsManager.ts` module pattern for loading, saving, and change listening.

**Options page (`src/4_options/`):**
Same controls mirrored with more detailed descriptions.

### 9.6 Settings Flow

```
chrome.storage.sync
    │
    ▼ (getUserSettings)
Content Script init → userSettings (cached)
    │                      │
    │                      ├─→ contentIndex.getCachedUserSettings()
    │                      │     └─→ autoTranslationService reads enableAutoTranslate,
    │                      │         userLanguageProficiency
    │                      │
    ▼ (onChanged listener)
Settings update → userSettings cache updated
    │
    ▼
Next auto-translation trigger reads fresh values
```

---

## 10. State Management

### 10.1 New State for Auto-Translation Tracking

**Per-block scan tracking:**

```typescript
// In autoTranslationService.ts
const scannedBlocks = new WeakSet<Element>()
```

**Per-block rendered auto-translations:**

```typescript
// Tracks which auto-translation IDs belong to each block (for density check and cleanup)
const autoTranslationsByBlock = new WeakMap<Element, Set<string>>()
```

**Rendered auto-items tracking (for Stage 3 filtering):**

```typescript
// Tracks auto-rendered item offset ranges per block (for dedup).
// Keyed by "start:end" string. Dedup by offset range, NOT by text alone,
// because the backend may return multiple candidates with the same text
// at different positions (all occurrences of a word in the block).
const autoRenderedOffsets = new WeakMap<Element, Set<string>>()
```

### 10.2 How Auto-Translations Coexist with Manual Translations

Auto-translations are stored in the same `activeTranslations` Map in `translationDisplayV2.ts`. There is no separate store. This means:
- Overlap detection works uniformly across manual and auto translations
- Removal via double-click works the same way
- Scroll repositioning covers all translations
- SPA navigation cleanup clears everything

To distinguish auto from manual, the `TranslationEntry` type can be extended:

```typescript
export interface TranslationEntry {
    // ... existing fields ...
    /** Whether this translation was created by the auto-translation system */
    isAutoTranslation?: boolean
}
```

Or, the auto-translation service can track IDs externally via `autoTranslationsByBlock`.

### 10.3 Cleanup / Lifecycle Management

| Scenario | Cleanup |
|----------|---------|
| SPA navigation | `spaNavigationHandler` calls `removeAllTranslationResults()` → clears `activeTranslations`; `scannedBlocks` WeakSet entries are GC'd when elements are removed |
| DOM mutation (block removed) | Orphan observer detects `!range.startContainer.isConnected` → `cleanupTranslationById()` |
| User removes an auto-translation | `removeTranslationResult(id)` → normal cleanup path |
| Page unload | Browser cleans up everything |
| `scannedBlocks` memory | WeakSet allows GC when element is no longer referenced |
| `autoTranslationsByBlock` memory | WeakMap allows GC when element is no longer referenced |

---

## 11. Error Handling

### 11.1 Silent Failure Strategy

The auto-translation feature follows a strict **never-fail-visibly** principle. All errors are logged at `warn` level and silently abandoned.

```typescript
async function tryAutoTranslate(params: AutoTriggerParams): Promise<void> {
    try {
        // ... entire auto-translation flow ...
    } catch (error) {
        logger.warn("Auto-translation failed silently:", error)
        // No user-facing error, no toast, no state corruption
    }
}
```

### 11.2 Network Error Handling

If the `AUTO_CANDIDATES_REQUEST` fails at the network level:
- Background handler catches the error and returns a degraded empty response:
  ```typescript
  { success: true, data: { candidates: [], meta: { degraded: true, ... } } }
  ```
- Frontend receives an empty candidates list → no auto-translations rendered → no visible effect

### 11.3 Timeout Handling

The request uses the existing `sendMessageWithRetry` pattern with 2 retries and 150ms delay. If all retries fail, the Promise rejects, caught by the outer try/catch.

Alternatively, a dedicated timeout can be added:

```typescript
const AUTO_CANDIDATES_TIMEOUT_MS = 20000

const response = await Promise.race([
    requestAutoCandidates(requestData),
    new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Auto-candidates timeout")), AUTO_CANDIDATES_TIMEOUT_MS)
    ),
])
```

### 11.4 Partial Candidate Processing

If some candidates fail DOM mapping (Stage 4) or overlap detection (Stage 5), the successfully mapped candidates are still rendered. The pipeline processes candidates independently — one failure does not block others.

### 11.5 Recovery from DOM Mutation During Async Processing

Between sending the request and receiving the response, the page DOM may change (SPA navigation, lazy loading, user interaction). Mitigations:

1. **Block element check:** After response arrives, verify `blockElement.isConnected`. If not, abandon.
2. **Text validation:** Each candidate's Range is validated by comparing `range.toString()` against `candidate.text`. DOM mutations that shift text will cause mismatches → candidate dropped.
3. **Block text re-check:** Optionally re-extract block text and compare against the original `blockText`. If significantly different, abandon all candidates.

```typescript
// Post-response safety check
if (!blockElement.isConnected) {
    logger.warn("Block element removed during async request, abandoning")
    return
}
```

---

## 12. Multi-Provider Support

### 12.1 Cloud API Path (Official Provider)

When `translationProvider === "official"`:
1. Background handler calls `autoCandidatesService.fetchAutoCandidates(request)`
2. `fetchAutoCandidates()` calls `post<AutoCandidatesApiResponse>(TRANSLATION_API_ENDPOINTS.AUTO_CANDIDATES, request)`
3. Returns typed response

This is the primary path and uses the backend endpoint defined in the companion spec.

### 12.2 Custom API Path (Local LLM)

When `translationProvider === "customApi"`:
1. Background handler detects custom API provider from user settings
2. Builds `LLMConfig` from `userSettings.customApi` (same pattern as `TranslationService.buildLocalLlmConfig()`)
3. Creates a new `AutoCandidatesGenerationService` (following `WordTranslationService` / `FragmentTranslationService` pattern)
4. Assembles system + user prompt (from `resources/8_generate/auto_candidates/`)
5. Calls `OpenAICompatibleClient.generate(messages)` with `response_format: { type: "json_object" }`
6. Parses JSON response (LLM output format: `reason`, `text`, `type`, `translation` — no offsets; `reason` as first field for maximum Chain-of-Thought quality)
7. Computes offsets deterministically (find all occurrences of each candidate text in blockText)
8. Strips `reason` field from candidates (for CoT quality only; not exposed to frontend)
9. Applies same hard-rule filtering pipeline as backend
10. Returns result

**New files for local LLM path:**

| File | Purpose |
|------|---------|
| `src/8_generate/services/AutoCandidatesService.ts` | Service class following existing pattern |
| `resources/8_generate/auto_candidates/system_prompt.txt` | LLM system prompt (same content as backend spec Section 4.2) |
| `resources/8_generate/auto_candidates/user_prompt_template.txt` | User prompt template (same as backend spec Section 4.3) |

### 12.3 Provider-Specific Considerations

| Provider | Auto-Candidates Support | Notes |
|----------|------------------------|-------|
| `official` | Full support | Uses cloud endpoint |
| `customApi` | Full support | Uses local LLM generation with same prompt |
| `mtranserver` | Not supported in V1 | MTranServer is a translation engine, not an LLM — cannot do candidate selection |
| `bingTranslate` | Not supported in V1 | Bing Translate has no candidate selection API |

For unsupported providers, `tryAutoTranslate()` should check the provider and early-return:

```typescript
const provider = settings?.translationProvider
if (provider === "mtranserver" || provider === "bingTranslate") {
    logger.info("Auto-translation not supported for provider:", provider)
    return
}
```

---

## 13. Implementation Plan

### Phase 1: Types and Infrastructure

| Step | Action | Files |
|------|--------|-------|
| 1.1 | Add new message types | `src/0_common/types/index.ts` (modify) |
| 1.2 | Add `enableAutoTranslate` and `userLanguageProficiency` to `UserSettings` | `src/0_common/types/index.ts` (modify) |
| 1.3 | Add default values | `src/0_common/types/index.ts` (modify) |
| 1.4 | Add settings normalization | `src/0_common/utils/storageManager.ts` (modify) |
| 1.5 | Add `AUTO_CANDIDATES` endpoint constant | `src/6_translate/constants/TranslationConstants.ts` (modify) |
| 1.6 | Add API request/response types | `src/6_translate/types/AutoCandidatesTypes.ts` (create) |
| 1.7 | Export new types from module index | `src/6_translate/index.ts` (modify) |

### Phase 2: Backend Communication Layer

| Step | Action | Files |
|------|--------|-------|
| 2.1 | Create cloud auto-candidates service | `src/6_translate/services/AutoCandidatesService.ts` (create) |
| 2.2 | Create background message handler | `src/2_background/handlers/AutoCandidatesRequestHandler.ts` (create) |
| 2.3 | Register handler in message router | `src/2_background/messaging/MessageRouter.ts` (modify) |
| 2.4 | Add `requestAutoCandidates()` to translationRequest | `src/1_content/services/translationRequest.ts` (modify) |

### Phase 3: Core Auto-Translation Logic

| Step | Action | Files |
|------|--------|-------|
| 3.1 | Create block text extractor utility | `src/1_content/utils/blockTextExtractor.ts` (create) |
| 3.2 | Create candidate-to-DOM mapper utility | `src/1_content/utils/candidateDomMapper.ts` (create) |
| 3.3 | Create auto-translation orchestrator service | `src/1_content/services/autoTranslationService.ts` (create) |

### Phase 4: UI Integration

| Step | Action | Files |
|------|--------|-------|
| 4.1 | Add `ai-translator-tooltip--auto` CSS class | `src/1_content/resources/content.css` (modify) |
| 4.2 | Extend `TranslationEntry` type (optional `isAutoTranslation` flag) | `src/1_content/ui/translationDisplayV2/types.ts` (modify) |
| 4.3 | Add auto-translation trigger calls to pipeline | `src/1_content/handlers/TranslationPipeline.ts` (modify) |

### Phase 5: Settings UI

| Step | Action | Files |
|------|--------|-------|
| 5.1 | Add auto-translate toggle to popup HTML | `src/3_popup/index.html` (modify) |
| 5.2 | Add proficiency selector to popup HTML | `src/3_popup/index.html` (modify) |
| 5.3 | Wire new settings in popup logic | `src/3_popup/modules/settingsManager.ts` (modify) |
| 5.4 | Add i18n keys for new settings | `src/_locales/en/messages.json`, `src/0_common/locales/*.json` (modify) |

### Phase 6: Local LLM Support (Custom API)

| Step | Action | Files |
|------|--------|-------|
| 6.1 | Create auto-candidates prompt templates | `resources/8_generate/auto_candidates/system_prompt.txt` (create), `user_prompt_template.txt` (create) |
| 6.2 | Create `AutoCandidatesGenerationService` | `src/8_generate/services/AutoCandidatesService.ts` (create) |
| 6.3 | Wire custom API path in background handler | `src/2_background/handlers/AutoCandidatesRequestHandler.ts` (modify) |

### Dependency Order

```
Phase 1 (types) → Phase 2 (communication) → Phase 3 (core logic) → Phase 4 (UI) → Phase 5 (settings UI)
                                                                                  → Phase 6 (local LLM, parallel with Phase 5)
```

---

## 14. Key Risks & Mitigations

### 14.1 DOM Mutation During Async Candidate Request

**Risk:** The user navigates, scrolls to lazy-load new content, or the SPA framework updates the DOM between the time the request is sent and the response arrives (1–5 seconds).

**Mitigations:**
1. Check `blockElement.isConnected` before processing response
2. Validate each candidate's Range text against `candidate.text`
3. Wrap entire candidate processing in try/catch with silent failure
4. `scannedBlocks` uses WeakSet — GC'd elements don't prevent re-scanning if content reloads

### 14.2 Performance Impact on Page

**Risk:** Auto-translation adds extra DOM elements (tooltip divs), event listeners, and background API calls.

**Mitigations:**
1. Auto-translation tooltip count is bounded by `MAX_TRANSLATIONS_PER_BLOCK` density check. The backend may return multiple entries per candidate text (all occurrences in the block), so the density check — not `limit` alone — is the critical safeguard
2. No additional event listeners needed — reuses existing global scroll/resize/click handlers
3. One extra API call per block (not per page) — bounded by scan-once rule
4. Rendering is sequential with stagger delay to avoid layout thrashing
5. `positionTooltip()` uses rect signature caching to avoid redundant calculations

### 14.3 Memory Leaks from State Accumulation

**Risk:** `scannedBlocks`, `autoTranslationsByBlock`, and `autoRenderedOffsets` could accumulate over long browsing sessions.

**Mitigations:**
1. All three use `WeakSet`/`WeakMap` keyed by DOM element references — entries are GC'd when elements are removed
2. SPA navigation handler calls `removeAllTranslationResults()` which clears `activeTranslations`
3. Orphan observer removes translations whose Range becomes disconnected
4. No unbounded `Set`/`Map` with string keys

### 14.4 Conflict with Manual Translation During Auto-Translation

**Risk:** User manually translates a word while auto-candidates are still being fetched, creating a race condition where auto-translation renders over the new manual translation.

**Mitigations:**
1. Post-response filtering (Stage 5) checks against the latest `activeTranslations` — new manual translations added during the request will be detected
2. Overlap detector catches any Range-level conflicts
3. Manual translations always take precedence because they are committed to `activeTranslations` before auto-translation renders
4. The scan-once rule prevents auto-translation from re-triggering in the same block

### 14.5 Provider Mismatch

**Risk:** User changes translation provider while an auto-candidates request is in-flight.

**Mitigation:** Provider is resolved at trigger time. If the response arrives after a provider change, it is still rendered normally (the candidates are still valid translations). This is an acceptable edge case given the low frequency.

### 14.6 Stale Settings Cache

**Risk:** User toggles `enableAutoTranslate` off while an auto-translation is in progress.

**Mitigation:** Settings are checked at trigger time only. An in-flight request will complete and render normally. The next manual translation will respect the updated setting. This is acceptable behavior — disabling the setting stops new triggers, not in-flight ones.

### 14.7 Nested Block Text Extraction May Produce Suboptimal Candidates

**Risk:** When a block contains nested block-level elements, the extracted `blockText` includes all descendant text. LLM candidates may come from nested blocks that the user wasn't focused on.

**Severity:** Low (most paragraphs don't contain nested blocks)

**Mitigation V1:** Accept as-is; the words are still contextually relevant.

**Mitigation V2:** Implement shallow extraction — only include text nodes whose `getClosestBlockAncestor()` equals the target block element.

**Validation needed:** Test with real-world pages (Reddit, Medium, Wikipedia, StackOverflow) to determine if this is a practical problem.

---

## 15. Summary of Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Fire-and-forget from translation pipeline | Auto-translation must never block or delay the manual translation success rendering |
| `WeakSet` for scan tracking | Automatic memory cleanup when block elements are GC'd; no explicit cleanup needed |
| Reuse `translationDisplayV2` for rendering | Avoids duplicating the complex Range-based tooltip system; auto-translations benefit from existing scroll/resize/overlap handling |
| CSS class for visual differentiation | Minimal code change; leverages existing CSS architecture; easy to adjust visual weight |
| Frontend final display veto | Even if backend returns candidates, frontend drops those that conflict with current page state |
| Sequential rendering with stagger | Avoids layout thrashing; produces a pleasant "appear one by one" effect |
| Single `activeTranslations` Map for both manual and auto | Unified overlap detection, unified cleanup, unified hit testing |
| Custom API uses same prompt as backend | Ensures consistent candidate quality across providers |
