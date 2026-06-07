Last updated on: 2026-06-07

# 1_content

Content script injected into every host page. Owns all user-interaction detection, translation orchestration, and UI rendering (tooltips, modal, toast, floating button).

## Entry Points

| File | Kind | Role |
|------|------|------|
| `index.ts` | **Script entry** | Browser loads this. Initializes settings cache, registers background message listener. Do NOT import this as a library. |
| `handlers/InputListener.ts` | **Event hub** | All DOM events (mouseup, click, dblclick, keydown) enter here and are dispatched to the pipeline. |
| `handlers/TranslationPipeline.ts` | **Core orchestrator** | Drives the full range-level translation flow: validation → context extraction → language detection → API call → render. |
| `handlers/FullTranslateHandler.ts` | **Full-page translation** | Manages `PageTranslationManager` lifecycle; emits `FullTranslateEvent` for status subscribers. |
| `ui/translationDisplayV2.ts` | **UI coordinator** | Manages the active translation map, tooltip lifecycle, and underline rendering. Stateful singleton. |

## Files

**Root**
- `index.ts` — Script entry point: initializes settings cache, registers background message listener, exports `getCachedUserSettings()`

**constants/**
- `index.ts` — `MAX_SELECTION_LENGTH`, font size constants, re-exports CSS classes and icon colors
- `cssClasses.ts` — CSS class name constants for injected DOM nodes
- `iconColors.ts` — Icon color name → hex map

**handlers/**
- `InputListener.ts` — Event hub: mouseup/click/dblclick/keydown → pipeline calls
- `TranslationPipeline.ts` — Core orchestrator: validation → context → detect → API → render
- `FullTranslateHandler.ts` — Full-page translation lifecycle, emits `FullTranslateEvent`
- `FloatingButtonIntegration.ts` — Wires `FloatingButtonManager` (12_floating_button) to `FullTranslateHandler`
- `SpaNavigationHandler.ts` — SPA navigation detection via MutationObserver + popstate → clears stale UI

**handlers/utils/**
- `selectionValidator.ts` — Async validation gate for all trigger types (icon, single-click, dblclick)
- `translationOverlapDetectorV2.ts` — Two-layer overlap check: DOM boundary comparison + visual rect fallback
- `tapWordDetector.ts` — Resolves word Range from click (x, y) coordinate
- `rangeSplitter.ts` — Multi-block Range → array of per-block sub-ranges
- `rangeAdjuster.ts` — Trims boundary whitespace; expands to word boundaries
- `selectionClassifier.ts` — Classifies Range as "word" or "fragment"
- `singleClickWordCandidate.ts` — Guards against re-translating text already covered by active translation
- `editableElementDetector.ts` — Returns true if element is input/textarea/contenteditable
- `wordBoundary.ts` — Low-level word-boundary character classification helpers

**services/**
- `translationRequest.ts` — Sends `chrome.runtime` messages to background for word/fragment/auto-candidates translation

**ui/**
- `translationDisplayV2.ts` — UI coordinator: active translation map, tooltip lifecycle, underline rendering (stateful singleton)
- `translationModal.ts` — Detailed translation modal in Shadow DOM (word + dictionary + sentence sections)
- `iconManager.ts` — Shows/positions/removes the translation trigger icon next to selected text
- `modalTemplates.ts` — Loads HTML templates; renders word/fragment loading/success/error states

**ui/translationDisplayV2/**
- `types.ts` — Shared types (`LoadingState`, `SuccessState`, `TranslationEntry`, etc.) — no runtime deps
- `tooltipRenderer.ts` — Tooltip DOM creation, content rendering, and style syncing
- `tooltipLayout.ts` — Pure rect normalization and text splitting across multi-line selections
- `hitTesting.ts` — Global click/dblclick delegation via `caretRangeFromPoint`; pending-click cancellation
- `clipVisibility.ts` — Checks whether a source rect is visible (not clipped by overflow ancestors)

**ui/toast/**
- `toastNotification.ts` — Shows timed toast notifications in page
- `toastTemplate.ts` — Toast DOM template builder

**utils/**
- `contextExtractorV2.ts` — Extracts selected text + surrounding sentence context from a DOM Range
- `languageDetector.ts` — Async language detection: Chrome built-in API → franc-min fallback
- `languageValidator.ts` — "Native Speaker Suppression": skips translation if detected lang matches target
- `domSanitizer.ts` — Filtered TreeWalker that skips extension-owned nodes
- `styleCalculator.ts` — Orchestrates tooltip background color, text color, and font size calculation
- `concurrencyLimiter.ts` — FIFO queue limiter; caps parallel translations at 3
- `lineHeightAdjuster.ts` — Expands block line-height for tooltip space; ref-counted per block element
- `modalPositionerV2.ts` — Computes optimal viewport position for modal relative to Range
- `pageLanguageChecker.ts` — Detects page language from HTML metadata + script analysis
- `versionStatus.ts` — Fetches and caches version check result (30-min TTL)
- `styleCalculator/types.ts` — `RgbaColor`, `SpaceCalculation`, `TooltipStyle` types
- `styleCalculator/colors.ts` — RGBA math helpers
- `styleCalculator/dom.ts` — Walks DOM ancestors to resolve effective background color
- `styleCalculator/layout.ts` — Computes optimal tooltip font size given available vertical space
- `styleCalculator/textColor.ts` — Selects tooltip text color for contrast against resolved background

**resources/**
- `content.css` / `modal.css` — Injected styles (underline, icon positioning, modal/tooltip)
- `modal-*.html` / `section-*.html` — HTML templates for loading/success/error states and modal sections

## Key Flows

### 1. Icon-triggered word translation (most common path)
```
InputListener.handleTextSelection()
  → validateSelectionAsync()           # checks length, editable element, overlap
  → iconManager.show(range)            # user sees the icon
  [user clicks icon]
  → InputListener.handleIconClick()
  → TranslationPipeline.handleIconClick(range)
  → contextExtractorV2.extractContextV2()   # selected text + surrounding sentence
  → languageDetector.detect()               # Chrome API → franc-min fallback
  → languageValidator.check()               # "Native Speaker Suppression" — may abort
  → translationRequest.sendWordTranslation()  # chrome.runtime.sendMessage → background
  → translationDisplayV2.showTooltip(result)
```

### 2. Hotkey / double-click direct trigger (fragment or word)
```
InputListener (keydown trigger key OR dblclick)
  → tapWordDetector.resolve(x, y)      # dblclick only: finds word Range at cursor
  → TranslationPipeline.handleDirectTrigger(range)
  → rangeSplitter.split(range)         # multi-block → array of per-block sub-ranges
  → concurrencyLimiter (max 3 parallel)
  → [per sub-range]: same flow as above from contextExtractorV2 onward
  → selectionClassifier decides "word" vs "fragment" path for each sub-range
```

### 3. Full-page translation
```
FloatingButtonIntegration (button click event)
  → FullTranslateHandler.start()
  → PageTranslationManager (11_full_translate) lifecycle
  → emits FullTranslateEvent: "starting" | "started" | "stopped" | "error" | "quota_exhausted"
  ← FloatingButtonIntegration listens and syncs button state
```

### 4. SPA navigation cleanup
```
SpaNavigationHandler (MutationObserver + popstate)
  → detects origin+pathname+search change  # hash changes are ignored
  → translationDisplayV2.clearAll()
  → FullTranslateHandler.stop()
```

## Key Contracts

- **`index.ts` is not a barrel — it is the content script entry point.** It is loaded directly by the browser. Do not import it from other modules expecting a simple utility re-export file.
- **`getCachedUserSettings()` (exported from `index.ts`) is the only sanctioned way to read settings in the content script.** All handlers call this instead of hitting `chrome.storage` per-event. Settings are refreshed via `chrome.storage.onChanged`.
- **`translationDisplayV2` uses zero-DOM-intrusion.** Selected text is tracked via live `Range` objects; tooltips are portalled to `document.body`. Never wrap selected text in `<span>` or modify the host page's DOM structure.
- **`domSanitizer.createFilteredTextWalker()` must be used for all DOM traversal** in context extraction and range operations. Raw `TreeWalker` will accidentally traverse extension-injected nodes and corrupt extracted text.
- **`EXTENSION_OWNED_ATTRIBUTE` must be set on every extension-injected DOM node.** This is how `domSanitizer` identifies and skips extension UI during traversal.
- **`languageValidator` implements "Native Speaker Suppression"**: if the detected source language matches the user's target language, translation is skipped entirely. Short pure-ASCII text (≤10 chars) bypasses the async Chrome API and is assumed to be English.
- **`lineHeightAdjuster` uses reference counting per block element.** Multiple tooltips in the same block share the expanded line-height. The original value is only restored when the last tooltip in that block is removed.
- **`translationModal` renders inside a Shadow DOM** to prevent host page CSS from leaking into the modal. Import `modal.css` as `?raw` and inject it into the shadow root — do not rely on the document stylesheet.
- **`TranslationPipeline` caps parallel translations at 3** via `concurrencyLimiter`. Multi-block selections (from `rangeSplitter`) queue excess sub-ranges and process them in FIFO order.
- **`FullTranslateHandler` emits `FullTranslateEvent`** (`starting` | `started` | `stopped` | `error` | `quota_exhausted`). `FloatingButtonIntegration` subscribes to stay in sync. Any other module needing translation lifecycle events must use `addEventListener` / `removeEventListener` — not polling.
- **`SpaNavigationHandler` ignores pure hash changes.** Only origin + pathname + search changes trigger a UI clear. Do not add hash-based detection.

## Module Boundaries

- ✅ May be imported by: nothing — this module is the content script entry point, not a library
- ✅ May import from: `0_common`, `11_full_translate`, `12_floating_button`
- ❌ Must NOT import from: `2_background`, `3_popup`, `4_options`, `9_offscreen` — these run in different extension contexts; communicate via `chrome.runtime.sendMessage` only
- ❌ Must NOT import from: `5_backend`, `6_translate`, `7_speech`, `8_generate` — infrastructure/service layers belong in the background worker; content script accesses them exclusively through message passing via `services/translationRequest.ts`
