Last updated on: 2026-06-07

# 11_full_translate

Implements full-page translation via a **Walk → Observe → Batch → Render** pipeline: walks the DOM tree, lazily translates paragraphs as they enter the viewport, and inserts bilingual or translation-only results.

## Entry Points

| File | Kind | Role |
|------|------|------|
| `PageTranslationManager.ts` | **Core class** | Top-level orchestrator — call `start()`/`stop()` to manage the full translation session lifecycle |
| `index.ts` | **Barrel** | Public API — all types, constants, and utilities are imported by consumers through this file only |

## Files

**Root**
- `PageTranslationManager.ts` — session orchestrator: walks DOM, wires observers, drives the translate pipeline, exposes `onQuotaExhausted` / `onProviderFallback` callbacks
- `index.ts` — explicit re-exports of all public types, constants, and utilities

**types/**
- `index.ts` — core type definitions: `TransNode`, `FullTranslateMode`, `PageTranslateRange`, `FullTranslateConfig`, `PreloadConfig`, `WalkResult`, `ParagraphInfo`, `TranslationUnit`, `BatchTranslationItem`, `BatchTranslationResult`

**constants/**
- `index.ts` — data attributes (`WALKED_ATTRIBUTE`, `PARAGRAPH_ATTRIBUTE`, `BLOCK_ATTRIBUTE`, `INLINE_ATTRIBUTE`), wrapper metadata attrs, CSS class names, tag classification sets, batch/rate-limiter defaults, site-specific skip selectors

**dom/**
- `filter.ts` — element classification: block/inline checks, skip decisions (`isDontWalkIntoAndDontTranslateAsChildElement`), numeric-content detection, `hasNoWalkAncestor` for mutation filtering
- `walker.ts` — `walkAndLabelElement()` recursive DOM labeler; `extractTextContent()` normalizes text with `<br>` → `\n` and whitespace collapsing; handles Shadow DOM
- `translationWalker.ts` — `extractTranslationUnits()` groups consecutive inline children into `TranslationUnit[]`; detects flex-parent layout; `shouldTranslateParagraph()` filters short/numeric text
- `renderer.ts` — `insertTranslation()` writes translated `<span>` wrappers via `DomBatcher`; handles bilingual vs. translationOnly; `removeAllTranslations()` / `removeWalkLabels()` teardown; `createSpinner()` / `removeSpinner()` inline loading indicator
- `helpers.ts` — `unwrapDeepestOnlyHTMLChild()` traverses single-child wrapper chains to find the true insertion target; `smashTruncationStyle()` removes CSS that clips translated text

**utils/**
- `ViewportObserver.ts` — `IntersectionObserver` wrapper; fires a one-shot callback when a paragraph enters the expanded viewport (default 600px margin); auto-unobserves on trigger
- `DynamicContentObserver.ts` — `MutationObserver` wrapper; detects `childList` additions and `style`/`class`/`hidden` attribute reveals; handles Shadow DOM roots recursively
- `BatchQueue.ts` — accumulates translation texts, flushes as batched `chrome.runtime.sendMessage`; per-entry `Promise<string>`; retry with exponential backoff on count mismatch; individual fallback after 3 retries
- `TokenBucketRateLimiter.ts` — token-bucket throttle (default 60 capacity, 8 tokens/s); `acquire()` awaits until a token is available
- `TranslationCache.ts` — IndexedDB cache keyed on SHA-256 of `text|sourceLang|targetLang`; checked before every API call, written after success
- `DomBatcher.ts` — singleton `requestAnimationFrame` write batcher; coalesces all DOM mutations into a single frame; `reset()` destroys the singleton (called on `stop()`)

## Key Flows

### Session start
```
PageTranslationManager.start()
  → generate walkId (UUID)
  → walkAndLabelElement(document.body)   # stamps data-tapword-* attrs on every element
  → collectParagraphs() → filterTopLevelParagraphs()
  → ViewportObserver.observe(paragraph)  # for each top-level paragraph
  → DynamicContentObserver.start()       # watch for future DOM mutations
```

### Paragraph enters viewport — simple path (no block children)
```
ViewportObserver fires → onParagraphVisible(element)
  → translateSimpleParagraph(element)
  → extractParagraphText()               # normalized full text
  → shouldTranslateParagraph()           # reject short/numeric
  → createSpinner()
  → TranslationCache.get()               # cache hit → skip API
  → TokenBucketRateLimiter.acquire()     # throttle
  → BatchQueue.enqueue(text)             # returns Promise<string>
      → timer/size threshold → flush
      → chrome.runtime.sendMessage(FULL_TRANSLATE_BATCH_REQUEST)
      → background: translateFragment() × N → response
  → TranslationCache.set()
  → removeSpinner()
  → renderer.insertTranslation(element, translatedText, mode)
      → DomBatcher.queue(() => DOM write)
      → next rAF: append <span class="tapword-translated-content-wrapper">
```

### Paragraph enters viewport — mixed path (block children, bilingual mode)
```
onParagraphVisible(element)
  → translateMixedParagraph(element)
  → extractTranslationUnits(element)     # groups inline runs between block boundaries
  → for each TranslationUnit: translateText() → insertTranslation(insertAfterNode)
  → collectBlockChildren(element)
  → for each block child: translateElement() recursively  # parallel via Promise.all
```

### Dynamic content detected
```
DynamicContentObserver fires → onNewContentDetected(elements)
  → for each element: walkAndLabelElement()
  → collectParagraphs() → filterTopLevelParagraphs()
  → ViewportObserver.observe()           # resume normal flow
```

### Session stop
```
PageTranslationManager.stop()
  → ViewportObserver.stop()
  → DynamicContentObserver.stop()
  → BatchQueue.clear()
  → removeAllTranslations()              # restore translationOnly originals, remove wrappers
  → removeWalkLabels()                   # strip all data-tapword-* attrs
  → DomBatcher.reset()                   # destroy singleton
```

## Key Contracts

- **Walk ID isolation.** Every walked element is stamped with `data-tapword-walked=<walkId>`. `translateElement` exits immediately if the element's walkId does not match the current session's `walkId`. Never skip this guard when adding new translation paths.
- **Top-level paragraphs only for observers.** `ViewportObserver` observes only the top-level paragraphs (ancestors first). Nested paragraphs are handled by recursive `translateElement()` calls. Observing nested paragraphs would cause duplicate translations.
- **TranslationOnly falls back to simple path on mixed paragraphs.** When `mode === "translationOnly"` and a paragraph has block children, `translateSimpleParagraph` is used — never `translateMixedParagraph`. Unit-level replacement in mixed layouts is undefined behavior.
- **Flex parent disables forceBlockTranslation.** When `extractTranslationUnits` detects `display: flex` on a paragraph with block children, it sets `forceBlockTranslation = false`. Block-level insertion (adding `<br>` or block wrappers) breaks flex layouts.
- **BatchQueue retry → individual fallback.** On `BatchCountMismatchError`, retry ≤3 times (1s/2s/4s backoff). If all retries fail, each text is sent as a separate single-item request. Never silently drop a translation unit.
- **DomBatcher is a singleton reset on stop.** All DOM writes must go through `DomBatcher.queue()`. Calling `reset()` in `stop()` destroys the instance; subsequent writes after `reset()` will create a new instance automatically.
- **Cache key includes language pair.** `TranslationCache` SHA-256 hashes `text|sourceLang|targetLang`. Never reuse cache entries across language pairs.

## Module Boundaries

- ✅ May be imported by: `src/1_content` (via `FullTranslateHandler`)
- ❌ Must NOT import from: `src/1_content`, `src/2_background`, `src/3_popup`, `src/4_options` — this module contains pure translation/DOM logic and must remain environment-agnostic (no handler or UI state)
- ✅ May import from: `src/0_common` (types, constants, utils), `src/5_backend` (only type imports if needed)
