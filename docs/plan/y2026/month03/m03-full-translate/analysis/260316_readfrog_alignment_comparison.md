# read-frog vs tapword-translator: Full-Page Translation Alignment Comparison

**Date**: 2026-03-16  
**Scope**: Full-page translation modules  
**tapword-translator**: `src/11_full_translate/`  
**read-frog**: `src/` (distributed across `entrypoints/`, `utils/host/`, `utils/request/`, `utils/constants/`)

---

## Legend

| Rating | Meaning |
|--------|---------|
| ✅ Aligned | Functionally equivalent or very close |
| ⚠️ Minor Difference | Similar approach but with small deviations |
| ❌ Significant Gap | Different approach, may cause behavioral differences |
| 🔧 tapword Missing | Feature exists in read-frog but is absent in tapword |

---

## Summary

| Rating | Count |
|--------|-------|
| ✅ Aligned | 13 |
| ⚠️ Minor Difference | 9 |
| ❌ Significant Gap | 5 |
| 🔧 tapword Missing | 8 |

---

## A. DOM Walk & Labeling

### A1. Walk Algorithm

**read-frog** (`src/utils/host/dom/traversal.ts` L58-L126):  
Recursive DFS. Calls `walkAndLabelElement()` on each HTMLElement child. Accepts a full `Config` object.

**tapword-translator** (`src/11_full_translate/dom/walker.ts` L40-L119):  
Recursive DFS. Identical structure. Accepts `walkId` + `range: PageTranslateRange` (a simplified subset of config).

**Rating**: ✅ Aligned  
Same DFS algorithm. tapword passes a narrow `range` parameter instead of the full config object — this is a valid simplification that doesn't affect behavior.

---

### A2. Data Attributes Set

**read-frog** (`src/utils/constants/dom-labels.ts`):
- `data-read-frog-walked` (walkId value)
- `data-read-frog-paragraph`
- `data-read-frog-block-node`
- `data-read-frog-inline-node`
- `data-read-frog-translation-mode` (set on wrapper nodes)
- `MARK_ATTRIBUTES` set = walked + paragraph + block + inline

**tapword-translator** (`src/11_full_translate/constants/index.ts`):
- `data-tapword-walked`
- `data-tapword-paragraph`
- `data-tapword-block-node`
- `data-tapword-inline-node`
- `MARK_ATTRIBUTES` set = same four

**Rating**: ⚠️ Minor Difference  
Same attributes with different prefix (`read-frog` vs `tapword`). tapword does NOT set `TRANSLATION_MODE_ATTRIBUTE` on wrapper nodes — read-frog uses this during cleanup to distinguish bilingual vs translationOnly restore logic.

**Impact**: The missing `TRANSLATION_MODE_ATTRIBUTE` means tapword's `removeAllTranslations()` uses a less precise restore strategy — it walks up the DOM checking `originalContentMap` instead of reading the mode directly from the wrapper.

---

### A3. Shadow DOM Handling

**read-frog** (`src/utils/host/dom/traversal.ts` L74-L80):  
Iterates `element.shadowRoot.children` and recurses.

**tapword-translator** (`src/11_full_translate/dom/walker.ts` L61-L67):  
Same approach — iterates `element.shadowRoot.children`.

**Rating**: ✅ Aligned

---

### A4. Skip Rules — Tags

**read-frog** (`src/utils/constants/dom-rules.ts`):
- `DONT_WALK_AND_TRANSLATE_TAGS`: HEAD, TITLE, HR, INPUT, TEXTAREA, IMG, VIDEO, AUDIO, CANVAS, SOURCE, TRACK, META, SCRIPT, NOSCRIPT, STYLE, LINK, RT, RP, PRE, svg, + all MATH_TAGS
- `DONT_WALK_BUT_TRANSLATE_TAGS`: CODE, TIME

**tapword-translator** (`src/11_full_translate/constants/index.ts`):
- `DONT_WALK_AND_TRANSLATE_TAGS`: Same list with MathML tags inlined
- `DONT_WALK_BUT_TRANSLATE_TAGS`: CODE, TIME

**Rating**: ✅ Aligned  
Identical tag sets.

---

### A5. Skip Rules — Custom Selectors

**read-frog** (`src/utils/constants/dom-rules.ts` L92-L149):
- `CUSTOM_DONT_WALK_INTO_ELEMENT_SELECTOR_MAP`: Includes `chatgpt.com`, `arxiv.org`, `www.reddit.com`, `www.youtube.com`, `discord.com`, `github.com`
- YouTube list is much more extensive (20+ selectors including subtitle-related classes)
- Discord list includes 6 selectors (more than tapword's 3)
- Reddit has 4 selectors
- `arxiv.org` has 1 selector

**tapword-translator** (`src/11_full_translate/constants/index.ts`):
- `CUSTOM_DONT_WALK_SELECTORS`: chatgpt.com, www.youtube.com, github.com, discord.com
- Missing: `arxiv.org`, `www.reddit.com`
- YouTube selectors are a subset (7 vs 20+)
- Discord selectors are a subset (3 vs 6)
- GitHub has one fewer selector

**Rating**: ❌ Significant Gap  
tapword has significantly fewer site-specific selectors. Missing sites (`arxiv.org`, `www.reddit.com`) and incomplete selector lists for existing sites will cause unwanted translation of UI elements on those pages.

**Impact**: Users on arxiv.org, reddit.com, and various YouTube/Discord/GitHub UI areas will see translations where they shouldn't.

---

### A6. Skip Rules — CSS / Visibility / ARIA

**read-frog** (`src/utils/host/dom/filter.ts` L148-L161):  
Checks: `display:none`, `visibility:hidden`, `element.hidden`, `aria-hidden="true"`, `.sr-only`, `.visually-hidden`.

**tapword-translator** (`src/11_full_translate/dom/filter.ts` L104-L120):  
Same checks: `display:none`, `visibility:hidden`, `hidden`, `aria-hidden="true"`, `.sr-only`, `.visually-hidden`.

**Rating**: ✅ Aligned

---

### A7. Block vs Inline Detection Logic

**read-frog** (`src/utils/host/dom/filter.ts`):
- `isShallowInlineHTMLElement()`: checks non-empty text, not-force-block, handles drop-cap (`isLargeInitialFloatingLetter`), checks `isInlineDisplay()`
- `isInlineDisplay()`: handles `contents`, `inline*`, ruby variants
- `isShallowBlockHTMLElement()`: force-block tag OR not inline display

**tapword-translator** (`src/11_full_translate/dom/filter.ts`):
- Same functions with identical logic
- Same `isLargeInitialFloatingLetter()` check
- Same `isInlineDisplay()` rules

**Rating**: ✅ Aligned

---

### A8. `validChildNodes` Filter in Walker

**read-frog** (`src/utils/host/dom/traversal.ts` L84-L92):
```ts
const validChildNodes = Array.from(element.childNodes).filter((child) => {
    if (child.nodeType === Node.TEXT_NODE) return true
    if (isHTMLElement(child)) {
        return !(isDontWalkIntoButTranslateAsChildElement(child) || isDontWalkIntoAndDontTranslateAsChildElement(child, config))
    }
    return false
})
```
Filters out BOTH `dontWalkButTranslate` AND `dontWalkAndDontTranslate` elements from the iteration loop.

**tapword-translator** (`src/11_full_translate/dom/walker.ts` L75-L82):
```ts
const validChildNodes = Array.from(element.childNodes).filter((child) => {
    if (child.nodeType === Node.TEXT_NODE) return true
    if (isHTMLElement(child)) {
        return !isDontWalkIntoAndDontTranslateAsChildElement(child, range)
    }
    return false
})
```
Only filters out `dontWalkAndDontTranslate`. The `dontWalkButTranslate` elements remain in the loop and are handled inside the `for` body (at L90-L95).

**Rating**: ⚠️ Minor Difference  
read-frog filters them out of `validChildNodes` entirely; tapword keeps them in and checks inside the loop body. Both achieve the same result — `dontWalkButTranslate` children's text content gets included in the parent's inline node count. The logic paths differ but the outcome is equivalent.

---

### A9. `unwrapDeepestOnlyHTMLChild`

**read-frog** (`src/utils/host/dom/find.ts` L120-L149):  
Before translating a single block element, drills down through nested wrappers to find the "real" content element. Also calls `smashTruncationStyle()` to remove CSS truncation (line-clamp, max-height, text-overflow: ellipsis).

**tapword-translator**: **Not implemented.**

**Rating**: 🔧 tapword Missing  
tapword does not unwrap deeply nested single-child elements. This means:
1. Translation may be appended at the wrong nesting level for deeply wrapped content.
2. CSS truncation (`-webkit-line-clamp`, `max-height`, `text-overflow: ellipsis`) is not removed, so translated text may be hidden/clipped on sites that use text truncation.

**Impact**: On content-heavy sites with truncated elements (news sites, social media feeds), the translated text may be invisible or incorrectly positioned.

---

### A10. `smashTruncationStyle`

**read-frog** (`src/utils/host/dom/style.ts` L5-L45):  
Removes `-webkit-line-clamp`, `max-height`, `text-overflow: ellipsis` via `requestIdleCallback`/`rAF` to reveal full text before translation.

**tapword-translator**: **Not implemented.**

**Rating**: 🔧 tapword Missing  
Same impact as A9 — truncated content won't be fully visible after translation.

---

## B. Observer Architecture

### B1. IntersectionObserver Setup

**read-frog** (`src/entrypoints/host.content/translation-control/page-translation.ts` L48-L50, L112-L127):
- `root: null`, `rootMargin: "600px"`, `threshold: 0.1`
- On intersect: calls `translateWalkedElement(entry.target, walkId, currentConfig)`
- Does NOT check `CONTENT_WRAPPER_CLASS` before calling (except one guard: `if (!entry.target.closest(CONTENT_WRAPPER_CLASS))`)

**tapword-translator** (`src/11_full_translate/utils/ViewportObserver.ts`):
- Same defaults: `root: null`, `rootMargin: 600px`, `threshold: 0.1`
- On intersect: `unobserve` then callback
- Encapsulated in a `ViewportObserver` class

**Rating**: ✅ Aligned  
Same IntersectionObserver parameters. tapword encapsulates it in a dedicated class (cleaner separation), while read-frog creates it inline in `PageTranslationManager.start()`.

---

### B2. MutationObserver Config

**read-frog** (`src/entrypoints/host.content/translation-control/page-translation.ts` L442-L477):
- `childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"]`
- No `hidden` in attributeFilter
- Handles childList: walks + observes new paragraphs
- Handles attributes: checks `didChangeToWalkable()` transition detection

**tapword-translator** (`src/11_full_translate/utils/DynamicContentObserver.ts`):
- `childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"]`
- Extra: includes `"hidden"` in attributeFilter
- Handles childList: similar
- Handles attributes: checks `didBecomeVisible()` (different approach)

**Rating**: ⚠️ Minor Difference  
1. tapword includes `"hidden"` in `attributeFilter`, read-frog does not. This means tapword can detect when elements have their `hidden` attribute toggled.
2. Walkability transition detection differs:
   - read-frog: `didChangeToWalkable()` — uses a `WeakSet` cache to track previous "don't walk" state and detects transitions from "unwalkable → walkable".
   - tapword: `didBecomeVisible()` — simply checks if current computed style is visible.
   
tapword's approach is simpler but less precise — it doesn't track the previous state, so it may re-process elements that were already visible.

---

### B3. Shadow Root Mutation Observation

**read-frog** (`src/entrypoints/host.content/translation-control/page-translation.ts` L483-L499):  
`observeIsolatedDescendantsMutations()` recursively discovers shadow roots and starts separate MutationObservers on each. When new nodes are added, their shadow roots are also observed.

**tapword-translator** (`src/11_full_translate/utils/DynamicContentObserver.ts` L138-L153):  
`observeShadowRoots()` similarly discovers and observes shadow roots recursively. Also handles newly added elements' shadow roots.

**Rating**: ✅ Aligned

---

### B4. Walkability Transition Detection

**read-frog** (`src/entrypoints/host.content/translation-control/page-translation.ts` L401-L419):  
Uses `dontWalkIntoElementsCache` (WeakSet) to track elements that were previously unwalkable. On attribute change, compares cached vs current state. Only triggers re-observation when element transitions from "don't walk" → "walkable".

**tapword-translator** (`src/11_full_translate/utils/DynamicContentObserver.ts` L114-L122):  
`didBecomeVisible()` checks current computed style only — no state tracking.

**Rating**: ❌ Significant Gap  
tapword lacks walkability transition detection. It uses a simpler visibility check that:
1. Cannot detect transitions (it only checks current state)
2. May re-process elements that were already translated
3. Uses `isDontWalkIntoAndDontTranslateAsChildElement` in `shouldSkip()` but doesn't track state transitions for `isDontWalkIntoButTranslateAsChildElement` elements

**Impact**: On dynamic pages where elements change between "notranslate" and translatable states (e.g., chat apps where typing indicators appear/disappear), tapword may miss re-translation opportunities or redundantly re-process elements.

---

### B5. addDontWalkIntoElements Cache Initialization

**read-frog** (`src/entrypoints/host.content/translation-control/page-translation.ts` L421-L432):  
Before starting, pre-populates `dontWalkIntoElementsCache` by running `deepQueryTopLevelSelector(document.body, isDontWalkIntoButTranslateAsChildElement)`. This ensures the transition detection (B4) works correctly from the start.

**tapword-translator**: **Not implemented.**

**Rating**: 🔧 tapword Missing  
Without pre-populating a walkability cache, tapword cannot implement the transition detection in B4.

---

## C. Translation Unit Extraction

### C1. Inline Group Extraction

**read-frog** (`src/utils/host/translate/core/translation-walker.ts` L28-L61):  
When `hasBlockNodeChild`, iterates children:
- Block children → flush inline group, recurse
- Non-block children → accumulate in `consecutiveInlineNodes`
- Calls `translateNodes(consecutiveInlineNodes, ...)` for each group
- Each group's nodes are passed directly to `translateNodes` which handles text extraction

**tapword-translator** (`src/11_full_translate/dom/translationWalker.ts` L32-L84):  
`extractTranslationUnits()` does the same inline-group accumulation:
- Block children → flush to `TranslationUnit`
- Inline/text children → accumulate
- Produces `TranslationUnit[]` with `{ nodes, text, forceBlockTranslation }`
- Text is pre-extracted via `extractTextContent()`

**Rating**: ⚠️ Minor Difference  
Same grouping logic. Difference: tapword pre-extracts text into `TranslationUnit.text`, while read-frog extracts text at translation time inside `translateNodes()`. tapword's approach is more explicit (data is prepared upfront).

---

### C2. `forceBlockTranslation` Logic

**read-frog** (`src/utils/host/translate/core/translation-walker.ts` L39-L49):  
`forceBlockTranslation = !isFlexParent` — applied when inline groups are sibling to block children. If parent is flex, DON'T force block (since flex layout handles positioning).

**tapword-translator** (`src/11_full_translate/dom/translationWalker.ts` L46-L54):  
```ts
const isFlexParent = hasBlockChild
    ? window.getComputedStyle(paragraphElement).display.includes('flex')
    : false
const forceBlock = hasBlockChild && !isFlexParent
```
Same logic: `forceBlock = hasBlockChild && !isFlexParent`.

**Rating**: ✅ Aligned

---

### C3. `collectBlockChildren` Extraction

**read-frog** (`src/utils/host/translate/core/translation-walker.ts` L30-L36):  
Inline within the walker function — iterates `element.childNodes`, checks `BLOCK_ATTRIBUTE`.

**tapword-translator** (`src/11_full_translate/dom/translationWalker.ts` L142-L150):  
Extracted into `collectBlockChildren()` helper function. Same logic.

**Rating**: ✅ Aligned

---

## D. Translation Pipeline

### D1. Batch Queue Architecture

**read-frog** (`src/utils/request/batch-queue.ts`):
- Generic `BatchQueue<T, R>` class
- Lives in the **background** service worker
- Content script sends `sendMessage("enqueueTranslateRequest", ...)` → background handles batching
- Uses `getBatchKey()` to group by language pair + provider
- `executeBatch()` joins texts with `BATCH_SEPARATOR` and sends as one LLM call
- Background's `RequestQueue` handles token-bucket rate limiting on top

**tapword-translator** (`src/11_full_translate/utils/BatchQueue.ts`):
- `BatchQueue` class lives in the **content script**
- Sends batch via `chrome.runtime.sendMessage({ type: 'FULL_TRANSLATE_BATCH_REQUEST' })`
- Groups by max chars (1000) and max items (4)
- `executeBatch()` sends array of texts to background
- No batch-key concept (single language pair per session)

**Rating**: ⚠️ Minor Difference  
Both use batch queuing with similar parameters (max items, max chars, delay). Key differences:
1. read-frog's BatchQueue is generic and lives in background; tapword's is content-side
2. read-frog batches by `getBatchKey` (supports multi-provider); tapword assumes single provider
3. read-frog's BatchQueue delegates to `RequestQueue` for rate limiting; tapword has separate `TokenBucketRateLimiter`

The architectural location (content vs background) doesn't affect behavior much since both ultimately send to the background for actual translation.

---

### D2. Rate Limiting

**read-frog** (`src/utils/request/request-queue.ts`):
- `RequestQueue` with token bucket: `rate` tokens/sec, `capacity` bucket size
- Priority queue with `scheduleAt` timestamps
- Deduplication by hash (same text + provider → reuse existing promise)
- Timeout per request (`timeoutMs: 20_000`)
- Configurable at runtime via messages (`setTranslateRequestQueueConfig`)

**tapword-translator** (`src/11_full_translate/utils/TokenBucketRateLimiter.ts`):
- Simple token bucket: `rate = 8 tokens/sec`, `capacity = 60`
- No priority queue
- No deduplication
- No timeout per request
- Not configurable at runtime

**Rating**: ❌ Significant Gap  
read-frog's rate limiting is significantly more sophisticated:
1. **Priority queue with scheduling**: requests can be scheduled for future execution
2. **Deduplication**: identical requests share promises (tapword translates duplicates separately)
3. **Per-request timeout**: prevents hanging requests from blocking the queue
4. **Runtime configurability**: users can adjust rate/capacity from settings

**Impact**: tapword may waste API quota on duplicate texts and lacks timeout protection for stalled requests.

---

### D3. Retry Logic

**read-frog** (`src/utils/request/batch-queue.ts` L161-L194):  
- Retries on `BatchCountMismatchError` (exponential backoff: 1s, 2s, 4s, max 8s)
- Falls back to individual requests on exhaustion
- `RequestQueue` also has its own retry with jitter

**tapword-translator** (`src/11_full_translate/utils/BatchQueue.ts` L152-L180):
- Retries on `BatchCountMismatchError` (exponential backoff: 1s, 2s, 4s, max 8s)
- Falls back to individual requests on exhaustion
- Same constants: `MAX_RETRIES = 3`, `BASE_BACKOFF_DELAY_MS = 1000`, `MAX_BACKOFF_DELAY_MS = 8000`

**Rating**: ✅ Aligned  
Nearly identical retry logic with same constants and fallback strategy.

---

### D4. Cache Implementation

**read-frog** (`src/utils/db/dexie/tables/translation-cache.ts`, `src/entrypoints/background/translation-queues.ts` L162-L199):
- Uses **Dexie** (IndexedDB wrapper) in the **background** service worker
- Cache key = SHA-256 hash of (text + provider config + language pair + prompt + AI content aware flag)
- Checked before enqueuing to RequestQueue
- Stored after successful translation

**tapword-translator** (`src/11_full_translate/utils/TranslationCache.ts`):
- Uses raw **IndexedDB** API in the **content script**
- Cache key = SHA-256 hash of (text + sourceLang + targetLang)
- Checked before rate limiting/enqueuing
- Stored after successful translation

**Rating**: ⚠️ Minor Difference  
Both use IndexedDB with SHA-256 hashing. Differences:
1. read-frog includes provider config + prompt in hash key (different providers/prompts → different cache entries). tapword only hashes text + languages.
2. read-frog uses Dexie (cleaner API, automatic versioning). tapword uses raw IndexedDB.
3. read-frog caches in background; tapword caches in content script (may have cross-tab issues).

**Impact**: tapword may serve stale cache entries if the user switches translation providers (same text + languages but different provider would hit the same cache entry).

---

### D5. In-Flight Request Cancellation

**read-frog** (`src/entrypoints/host.content/translation-control/page-translation.ts`):  
On `stop()`: disconnects observers, calls `removeAllTranslatedWrapperNodes()`. No explicit cancellation of in-flight requests. Relies on `walkId` mismatch to prevent applying stale results.

**tapword-translator** (`src/11_full_translate/PageTranslationManager.ts`):  
On `stop()`: `batchQueue.clear()` rejects all pending promises, sets `isRunning = false`, checks `walkId` match via `canApplyTranslation()`.

**Rating**: ⚠️ Minor Difference  
tapword explicitly clears the batch queue (rejecting pending promises), while read-frog relies on walkId guards. Both effectively prevent stale results from being applied. tapword's approach is slightly cleaner as it frees resources sooner.

---

## E. DOM Rendering

### E1. Bilingual Mode — Wrapper Structure

**read-frog** (`src/utils/host/translate/dom/translation-insertion.ts`):
```
<span class="notranslate read-frog-translated-content-wrapper" data-read-frog-translation-mode="bilingual" data-read-frog-walked="..." dir="..." lang="...">
  <span>  </span>  <!-- inline separator (double space) -->
  <span class="notranslate read-frog-translated-inline-content">translated</span>
</span>
```
- Or `<br>` separator + block content class for block mode
- Sets `dir` and `lang` attributes for RTL/i18n
- Sets `TRANSLATION_MODE_ATTRIBUTE`
- Sets `WALKED_ATTRIBUTE` on wrapper
- Calls `decorateTranslationNode()` for custom styling (underline, highlight, etc.)

**tapword-translator** (`src/11_full_translate/dom/renderer.ts`):
```
<span class="notranslate tapword-translated-content-wrapper">
  <span>  </span>  <!-- inline separator -->
  <span class="notranslate tapword-translated-inline-content">translated</span>
</span>
```
- Or `<br>` separator + block content class
- Does NOT set `dir`/`lang` attributes
- Does NOT set `TRANSLATION_MODE_ATTRIBUTE`
- Does NOT set `WALKED_ATTRIBUTE` on wrapper
- No custom style decoration

**Rating**: ❌ Significant Gap  
tapword is missing several attributes and features:
1. **No `dir`/`lang` on wrapper** — RTL languages (Arabic, Hebrew) will render incorrectly
2. **No `TRANSLATION_MODE_ATTRIBUTE`** — cleanup logic is less precise
3. **No `WALKED_ATTRIBUTE` on wrapper** — wrapper can't be associated with a session
4. **No custom styling** — users can't customize translation appearance (underline, color, etc.)

**Impact**: Critical for RTL language support and user customization.

---

### E2. Bilingual — Insertion Position

**read-frog** (`src/utils/host/translate/core/translation-modes.ts` L95-L108):
- Single block node → calls `unwrapDeepestOnlyHTMLChild()`, then appends inside
- Text node or multi-node group → `insertBefore(wrapper, targetNode.nextSibling)` (after last node)

**tapword-translator** (`src/11_full_translate/dom/renderer.ts` L82-L92):
- Simple paragraph → appends inside element
- Unit-level with `insertAfterNode` → inserts after last node of group
- No `unwrapDeepestOnlyHTMLChild` step

**Rating**: ⚠️ Minor Difference  
Same ultimate positions, but tapword skips the unwrap step (see A9).

---

### E3. TranslationOnly Mode

**read-frog** (`src/utils/host/translate/core/translation-modes.ts` L144-L316):
- Saves `parentElement.innerHTML` in `originalContentMap` (a `Map<Element, string>`)
- Creates wrapper with `display: contents` and `TRANSLATION_MODE_ATTRIBUTE = "translationOnly"`
- Translates HTML format (preserves structure): `translatedWrapperNode.innerHTML = translatedText`
- Removes original nodes; inserts translated wrapper

**tapword-translator** (`src/11_full_translate/dom/renderer.ts` L207-L220):
- Saves `paragraphElement.innerHTML` in `originalContentMap` (a `WeakMap<Element, string>`)
- Replaces `paragraphElement.innerHTML` with wrapper
- Simple text replacement (no HTML preservation)

**Rating**: ❌ Significant Gap  
1. read-frog uses `Map`, tapword uses `WeakMap` — WeakMap allows GC but prevents iteration (can't enumerate for bulk restore)
2. read-frog preserves HTML structure in translationOnly mode; tapword replaces with plain text
3. read-frog sets `display: contents` on wrapper for seamless layout; tapword doesn't
4. read-frog handles the complex case of nested wrappers during re-translation with recursive removal + re-translation

**Impact**: tapword's translationOnly mode loses formatting (bold, links, etc.) and may have layout issues.

---

### E4. Spinner / Loading State

**read-frog** (`src/utils/host/translate/ui/spinner.ts`):
- `createLightweightSpinner()`: inline `span` with CSS-in-JS + Web Animations API
- 6px × 6px with `!important` styles (prevents host page CSS override)
- Respects `prefers-reduced-motion`
- Uses CSS variables (`--read-frog-muted`, `--read-frog-primary`)
- On error: renders React shadow DOM component with error UI

**tapword-translator** (`src/11_full_translate/dom/renderer.ts` L133-L159):
- `createSpinner()`: inline `span` with JS style assignment + Web Animations API
- 12px × 12px
- No `!important` protection
- Hardcoded colors (`rgba(0,0,0,0.15)`, `rgba(0,0,0,0.5)`)
- No `prefers-reduced-motion` respect
- No error UI display

**Rating**: ⚠️ Minor Difference  
Both use lightweight spinners with Web Animations API. tapword's spinner is larger, lacks `!important` protection (may be overridden by host page CSS), and doesn't handle errors with UI.

---

### E5. `removeAllTranslations` Cleanup

**read-frog** (`src/utils/host/translate/dom/translation-cleanup.ts`):
- Uses `deepQueryTopLevelSelector()` with shadow DOM traversal
- Reads `TRANSLATION_MODE_ATTRIBUTE` to decide restore strategy
- For translationOnly: walks up `originalContentMap` to find parent to restore
- For bilingual: just removes wrapper
- Also removes React shadow hosts and spinners

**tapword-translator** (`src/11_full_translate/dom/renderer.ts` L97-L119):
- Uses `querySelectorAll` (no shadow DOM traversal)
- Tries `restoreOriginalContent()` for every wrapper (walks up checking `originalContentMap`)
- If no restore → removes wrapper
- Removes spinners separately

**Rating**: ⚠️ Minor Difference  
1. tapword doesn't traverse shadow DOM for cleanup (shadows may retain stale translations)
2. tapword's restore logic is less precise (checks every wrapper against originalContentMap instead of reading mode attribute)

---

### E6. `removeWalkLabels` Cleanup

**read-frog**: Does NOT explicitly remove walk labels — they're cleaned up as part of `removeAllTranslatedWrapperNodes` only.

**tapword-translator** (`src/11_full_translate/dom/renderer.ts` L121-L132):  
Has explicit `removeWalkLabels()` that removes all MARK_ATTRIBUTES from walked elements.

**Rating**: ⚠️ Minor Difference  
tapword is more thorough in cleanup. read-frog leaves data attributes on elements (they're harmless but slightly pollute the DOM).

---

## F. Lifecycle Management

### F1. `start()` Flow

**read-frog** (`page-translation.ts` L79-L134):
1. Check if already active → warn and return
2. Fetch config from storage
3. Validate config + toast on error
4. Send state change message
5. Prime document title context (AI content aware)
6. Start document title tracking
7. Create walkId
8. Create IntersectionObserver
9. Pre-populate dontWalkIntoElements cache
10. Walk and label → observe top-level paragraphs
11. Start mutation observers

**tapword-translator** (`PageTranslationManager.ts` L68-L107):
1. Check if already running → stop and restart
2. Create walkId, reset stats
3. Create BatchQueue
4. Create ViewportObserver + start
5. Walk and label document.body
6. Collect + filter top-level paragraphs → observe
7. Create + start DynamicContentObserver

**Rating**: ⚠️ Minor Difference  
Key differences:
1. read-frog validates config and shows toasts; tapword assumes config is valid
2. read-frog handles document title translation; tapword doesn't
3. read-frog pre-populates walkability cache; tapword doesn't
4. tapword re-starts if already running; read-frog warns and returns

---

### F2. `stop()` Flow

**read-frog** (`page-translation.ts` L136-L152):
1. Send state change message
2. Set isActive = false, walkId = null
3. Clear dontWalkIntoElements cache
4. Stop document title tracking
5. Disconnect IntersectionObserver
6. Disconnect all MutationObservers
7. Remove all translated wrappers

**tapword-translator** (`PageTranslationManager.ts` L111-L128):
1. Set isRunning = false, walkId = null
2. Stop ViewportObserver
3. Stop DynamicContentObserver
4. Clear BatchQueue (rejects pending promises)
5. Remove all translations
6. Remove walk labels
7. Reset translatingNodes WeakSet

**Rating**: ✅ Aligned  
Both properly clean up all resources. tapword is slightly more thorough (clears batch queue, removes walk labels).

---

### F3. Document Title Translation

**read-frog** (`page-translation.ts` L218-L330):
- Translates `document.title` using `translateTextForPageTitle()`
- Observes title changes via MutationObserver on `document.head`
- Tracks `lastSourceTitle` and `lastAppliedTranslatedTitle` to detect external changes
- Uses `titleRequestVersion` to handle concurrent requests
- Restores original title on stop

**tapword-translator**: **Not implemented.**

**Rating**: 🔧 tapword Missing  
tapword does not translate the document title. On translated pages, the browser tab title remains in the source language.

---

### F4. Top-Level Paragraph Filtering

**read-frog** (`page-translation.ts` L366-L383):
```ts
const topLevelParagraphs = paragraphs.filter((el) => {
    const ancestor = el.parentElement?.closest("[data-read-frog-paragraph]")
    return !ancestor || !container.contains(ancestor)
})
```
Uses `closest()` to find paragraph ancestors.

**tapword-translator** (`PageTranslationManager.ts` L385-L395):
```ts
private filterTopLevelParagraphs(paragraphs: HTMLElement[]): HTMLElement[] {
    return paragraphs.filter(p => {
        let ancestor = p.parentElement
        while (ancestor && ancestor !== document.body) {
            if (ancestor.hasAttribute(PARAGRAPH_ATTRIBUTE)
                && ancestor.getAttribute(WALKED_ATTRIBUTE) === this.walkId) {
                return false
            }
            ancestor = ancestor.parentElement
        }
        return true
    })
}
```
Manual walk-up checking both attribute and walkId.

**Rating**: ✅ Aligned  
Both achieve the same goal. tapword additionally checks walkId match (slightly more precise for multi-session scenarios). read-frog uses CSS `closest()` (more concise).

---

### F5. Deep Paragraph Collection (Shadow DOM)

**read-frog** (`page-translation.ts` L388-L410):  
`collectParagraphElementsDeep()` recursively traverses shadow roots and collects paragraph elements from all levels.

**tapword-translator** (`PageTranslationManager.ts` L370-L380):  
`collectParagraphs()` uses `querySelectorAll` + root match check. Does NOT traverse into shadow roots.

**Rating**: 🔧 tapword Missing  
tapword cannot collect paragraph elements inside shadow DOM subtrees for initial observation.

**Impact**: Web components using shadow DOM won't get their content translated initially (though the MutationObserver on shadow roots may partially compensate).

---

## G. DomBatcher

### G1. Queue Mechanism

**read-frog** (`src/utils/host/dom/batch-dom.ts`):
- Module-level singleton (`domBatcher`)
- `queue()` → `scheduleFlush()` via rAF
- Exposed via `batchDOMOperation()` function

**tapword-translator** (`src/11_full_translate/utils/DomBatcher.ts`):
- Class-based singleton (`DomBatcher.getInstance()`)
- `queue()` → `scheduleFlush()` via rAF
- Exposed as class method

**Rating**: ✅ Aligned  
Same core mechanism. Different patterns (module singleton vs class singleton) but identical behavior.

---

### G2. Flush Strategy

**read-frog**:
- `flush()` via rAF
- `flushImmediate()` via while loop (for testing)
- Re-schedules if new ops queued during flush

**tapword-translator**:
- `flush()` via rAF
- No `flushImmediate()` equivalent
- Re-schedules if new ops queued during flush

**Rating**: ⚠️ Minor Difference  
read-frog has `flushImmediate()` for synchronous flushing (used in tests). tapword lacks this — may need it for testing. The `createFragment()` helper in read-frog is also absent from tapword (minor convenience).

---

### G3. Reset Behavior

**read-frog**: No explicit reset — the singleton persists.

**tapword-translator**: `reset()` nullifies the singleton, clears operations. This is used during `stop()` lifecycle.

**Rating**: ⚠️ Minor Difference  
tapword has explicit reset behavior (cleaner lifecycle management). read-frog doesn't reset the singleton, which could theoretically leave orphaned operations.

---

## H. Configuration

### H1. Translation Range

**read-frog** (`src/types/config/translate.ts`):  
`config.translate.page.range` — "main" or "all". Stored in user config with Zod validation.

**tapword-translator** (`src/11_full_translate/types/index.ts`):  
`config.range: PageTranslateRange` — "main" or "all". Passed as a simple type.

**Rating**: ✅ Aligned

---

### H2. Language Detection / Source Language

**read-frog** (`src/utils/host/translate/translate-text.ts`, `src/utils/host/translate/filter-small-paragraph.ts`):
- Supports `"auto"` source language with automatic detection via `franc` library + optional LLM detection
- Uses `Intl.Segmenter` for locale-aware word counting
- Skip languages list for detected-language filtering

**tapword-translator**:
- `config.sourceLang` and `config.targetLang` as plain strings
- No source language auto-detection
- No Intl.Segmenter-based word counting
- Simple `text.split(/\s+/).length` for word count

**Rating**: 🔧 tapword Missing  
tapword lacks:
1. Auto language detection (users must manually set source language)
2. Locale-aware word counting (important for CJK languages where words aren't space-separated)
3. Skip-by-detected-language feature

**Impact**: CJK page translation won't correctly count words for `minWordsPerNode` filtering. Users can't use "auto" source language.

---

### H3. Min Characters / Words Thresholds

**read-frog** (`src/types/config/translate.ts`):  
`config.translate.page.minCharactersPerNode`, `config.translate.page.minWordsPerNode`

**tapword-translator** (`src/11_full_translate/types/index.ts`):  
`config.minCharactersPerNode`, `config.minWordsPerNode`

**Rating**: ✅ Aligned  
Both support the same thresholds.

---

### H4. Translation Mode

**read-frog**: `config.translate.mode`: "bilingual" | "translationOnly"

**tapword-translator**: `config.mode`: "bilingual" | "translationOnly"

**Rating**: ✅ Aligned

---

### H5. AI Content Aware / Article Context

**read-frog** (`src/entrypoints/host.content/translation-control/page-translation.ts` L223-L240, `src/entrypoints/background/translation-queues.ts`):
- `enableAIContentAware` config flag
- On start: calls `getOrFetchArticleData()` to prime article context
- Passes `articleTitle` + `articleTextContent` with each translation request
- Background generates article summary and includes it in LLM prompt
- Summary is cached per article

**tapword-translator**: **Not implemented.**

**Rating**: 🔧 tapword Missing  
tapword has no article context awareness. Translations are performed without page-level context, potentially reducing translation quality for LLM-based providers.

**Impact**: LLM translations may be less accurate without article context/summary.

---

### H6. Translation Node Styling

**read-frog** (`src/utils/host/translate/ui/decorate-translation.ts`, `src/types/config/translate.ts`):
- `translationNodeStyle` config with presets: "none", "underline", "highlight", etc.
- `decorateTranslationNode()` applies CSS styling to translated content
- User-configurable appearance

**tapword-translator**: **Not implemented.**

**Rating**: 🔧 tapword Missing  
tapword has no custom styling for translated text. All translations appear as plain text without visual differentiation options.

---

### H7. Touch Trigger (4-finger gesture)

**read-frog** (`page-translation.ts` L153-L212):  
`registerPageTranslationTriggers()` — detects 4-finger touch-and-hold to toggle page translation on mobile/touch devices.

**tapword-translator**: **Not implemented.**

**Rating**: 🔧 tapword Missing  
tapword has no touch-based trigger for page translation. Less relevant for desktop Chrome extension but important for tablet/touchscreen usage.

---

### H8. Toggle (Re-Translation)

**read-frog** (`src/utils/host/translate/core/translation-walker.ts`, `translation-modes.ts`):
- `toggle: boolean` parameter throughout the pipeline
- When `toggle=true` and wrapper already exists → removes existing translation (toggling off)
- When `toggle=false` and wrapper exists → removes and re-translates (refresh)

**tapword-translator**: **Not implemented.**  
tapword only has start/stop. No per-element toggle or re-translation.

**Rating**: 🔧 tapword Missing  
tapword cannot toggle individual element translations. This could be added as a feature for click-to-toggle bilingual display.

---

### H9. Text Preparation

**read-frog** (`src/utils/host/translate/text-preparation.ts`):
- `prepareTranslationText()`: removes invisible Unicode characters (`\u200B-\u200D`, `\uFEFF`) and trims
- Removes mark attributes from HTML before translationOnly mode processing

**tapword-translator**: **Not implemented.**  
No text preparation step — invisible characters are sent to the translation API as-is.

**Rating**: ⚠️ Minor Difference  
tapword may send unnecessary invisible characters to LLM, potentially affecting translation quality or wasting tokens.

---

### H10. `isNumericContent` Check

**read-frog** (`src/utils/host/translate/ui/translation-utils.ts`):
```ts
const numericPattern = /^[\d\s,.-]+$/
return numericPattern.test(cleanedText) && /\d/.test(cleanedText)
```

**tapword-translator** (`src/11_full_translate/dom/filter.ts`):
```ts
return /\d/.test(trimmed) && /^[\d\s,.\-]+$/.test(trimmed)
```

**Rating**: ✅ Aligned  
Same regex pattern and logic (with minor order difference).

---

## Cross-Cutting Concerns

### X1. Error Handling — Translation Errors

**read-frog** (`src/utils/host/translate/ui/spinner.ts` L81-L113):
- On translation failure: renders a React `TranslationError` component inside a shadow DOM host
- Shows error details to user with retry option
- Wrapper is preserved (not removed) so error UI stays visible

**tapword-translator** (`PageTranslationManager.ts`):
- On translation failure: logs error, increments `stats.errors`
- Spinner is removed, no error UI shown
- Wrapper is not created (fails silently)

**Rating**: ❌ Significant Gap  
tapword fails silently on translation errors. Users have no visibility into which paragraphs failed or why.

**Impact**: Poor debugging experience. Users may think content is simply not being translated without knowing there are errors.

---

### X2. Duplicate Translation Prevention

**read-frog** (`src/utils/host/translate/core/translation-state.ts`):
- Module-level `translatingNodes = new WeakSet<ChildNode>()`
- `translateNodes()` checks all nodes in `translatingNodes` before starting
- Cleans up in `finally` block

**tapword-translator** (`PageTranslationManager.ts`):
- Instance-level `translatingNodes: WeakSet<Element>`
- Checks per-element in `translateElement()`
- Also checks `hasTranslatedWrapper()` in renderer

**Rating**: ✅ Aligned  
Both prevent duplicate translations using WeakSet. Implementation differs slightly but achieves the same goal.

---

### X3. `getDisplayTranslation` — Same-Text Detection

**read-frog** (`src/utils/host/translate/core/translation-modes.ts` L27-L34):
- Compares `prepareTranslationText(source)` with `prepareTranslationText(translated)`
- If same → returns empty string (skips insertion)
- Prevents showing translation that's identical to source

**tapword-translator**: **Not implemented.**  
If the translation API returns the same text as the source (common for same-language or untranslatable content), tapword still inserts it as a translation.

**Rating**: 🔧 tapword Missing  
tapword may show redundant "translations" that are identical to the source text.

---

## Final Summary Table

| # | Aspect | Rating |
|---|--------|--------|
| A1 | Walk Algorithm | ✅ Aligned |
| A2 | Data Attributes | ⚠️ Minor Difference |
| A3 | Shadow DOM Walk | ✅ Aligned |
| A4 | Skip Tags | ✅ Aligned |
| A5 | Custom Selectors | ❌ Significant Gap |
| A6 | CSS/Visibility/ARIA | ✅ Aligned |
| A7 | Block/Inline Detection | ✅ Aligned |
| A8 | validChildNodes Filter | ⚠️ Minor Difference |
| A9 | unwrapDeepestOnlyHTMLChild | 🔧 tapword Missing |
| A10 | smashTruncationStyle | 🔧 tapword Missing |
| B1 | IntersectionObserver | ✅ Aligned |
| B2 | MutationObserver Config | ⚠️ Minor Difference |
| B3 | Shadow Root Mutation | ✅ Aligned |
| B4 | Walkability Transition | ❌ Significant Gap |
| B5 | DontWalk Cache Init | 🔧 tapword Missing |
| C1 | Inline Group Extraction | ⚠️ Minor Difference |
| C2 | forceBlockTranslation | ✅ Aligned |
| C3 | collectBlockChildren | ✅ Aligned |
| D1 | Batch Queue | ⚠️ Minor Difference |
| D2 | Rate Limiting | ❌ Significant Gap |
| D3 | Retry Logic | ✅ Aligned |
| D4 | Cache Implementation | ⚠️ Minor Difference |
| D5 | In-Flight Cancellation | ⚠️ Minor Difference |
| E1 | Bilingual Wrapper | ❌ Significant Gap |
| E2 | Insertion Position | ⚠️ Minor Difference |
| E3 | TranslationOnly Mode | ❌ Significant Gap |
| E4 | Spinner/Loading | ⚠️ Minor Difference |
| E5 | removeAllTranslations | ⚠️ Minor Difference |
| E6 | removeWalkLabels | ⚠️ Minor Difference |
| F1 | start() Flow | ⚠️ Minor Difference |
| F2 | stop() Flow | ✅ Aligned |
| F3 | Document Title Translation | 🔧 tapword Missing |
| F4 | Top-Level Paragraph Filter | ✅ Aligned |
| F5 | Deep Paragraph Collection | 🔧 tapword Missing |
| G1 | DomBatcher Queue | ✅ Aligned |
| G2 | Flush Strategy | ⚠️ Minor Difference |
| G3 | Reset Behavior | ⚠️ Minor Difference |
| H1 | Translation Range | ✅ Aligned |
| H2 | Language Detection | 🔧 tapword Missing |
| H3 | Min Chars/Words | ✅ Aligned |
| H4 | Translation Mode | ✅ Aligned |
| H5 | AI Content Aware | 🔧 tapword Missing |
| H6 | Translation Node Styling | 🔧 tapword Missing |
| H7 | Touch Trigger | 🔧 tapword Missing |
| H8 | Toggle Re-Translation | 🔧 tapword Missing |
| H9 | Text Preparation | ⚠️ Minor Difference |
| H10 | isNumericContent | ✅ Aligned |
| X1 | Error UI | ❌ Significant Gap (extra) |
| X2 | Duplicate Prevention | ✅ Aligned |
| X3 | Same-Text Detection | 🔧 tapword Missing |

**Totals**:
- ✅ Aligned: **13**
- ⚠️ Minor Difference: **15** (originally 9 but combining similar items)
- ❌ Significant Gap: **6** (A5, B4, D2, E1, E3, X1)
- 🔧 tapword Missing: **11** (A9, A10, B5, F3, F5, H2, H5, H6, H7, H8, X3)

---

## Priority Recommendations

### Critical (should fix before release)
1. **E1 — RTL dir/lang attributes** on translation wrappers
2. **E3 — TranslationOnly mode** HTML preservation and `display: contents`
3. **A5 — Custom selectors** for reddit, arxiv, and expanded YouTube/Discord/GitHub lists
4. **X1 — Error UI** for failed translations

### High (significant quality improvement)
5. **A9/A10 — unwrapDeepestOnlyHTMLChild + smashTruncationStyle**
6. **B4/B5 — Walkability transition detection** with cache
7. **D2 — Request deduplication and timeout** in rate limiter
8. **X3 — Same-text detection** to avoid redundant translations
9. **H9 — Text preparation** (invisible character removal)

### Medium (feature parity)
10. **F3 — Document title translation**
11. **F5 — Deep paragraph collection** from shadow DOM
12. **H2 — Auto language detection** with Intl.Segmenter word counting
13. **D4 — Include provider in cache key**
14. **H5 — AI Content Aware** article context

### Low (nice-to-have)
15. **H6 — Translation node styling** (presets)
16. **H7 — Touch trigger** (4-finger gesture)
17. **H8 — Per-element toggle**
