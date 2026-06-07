# Read Frog Browser Extension — Architecture Analysis

> **Date**: 2026-03-12  
> **Purpose**: Comprehensive architecture analysis of the Read Frog browser extension to inform our "full-page auto word/phrase translation" feature.  
> **Source Project**: `read-frog` (v1.28.1) — An open-source AI-powered language learning extension.  
> **Project URL**: https://github.com/mengxi-ream/read-frog

---

## Table of Contents

1. [Overall Architecture](#1-overall-architecture)
2. [Full-Page Translation Trigger Flow](#2-full-page-translation-trigger-flow)
3. [Text Extraction & Block Detection](#3-text-extraction--block-detection)
4. [Translation Display](#4-translation-display)
5. [Translation API Integration](#5-translation-api-integration)
6. [State Management](#6-state-management)
7. [Configuration & Settings](#7-configuration--settings)
8. [Key Takeaways for Our Feature](#8-key-takeaways-for-our-feature)

---

## 1. Overall Architecture

### 1.1 Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | React 19 + TypeScript |
| **Extension Framework** | [WXT](https://wxt.dev/) (Manifest V3) |
| **Build Tool** | Vite (via WXT) |
| **State Management** | Jotai (atomic state) |
| **Styling** | Tailwind CSS 4 + shadcn/ui components |
| **Translation AI** | Vercel AI SDK (`ai` package) — supports 20+ LLM providers |
| **Traditional Translate** | Google Translate, Microsoft Translate, DeepLX |
| **Data Querying** | TanStack React Query |
| **Messaging** | `@webext-core/messaging` (typed message passing) |
| **Database** | Dexie.js (IndexedDB wrapper for caching) |
| **Test** | Vitest |
| **Package Manager** | pnpm |

### 1.2 Folder Structure

```
read-frog/
├── src/
│   ├── assets/              # CSS assets (theme, styles)
│   ├── components/          # Shared React components (UI, forms, translation error display)
│   │   ├── translation/     # Translation-specific components (error display)
│   │   ├── ui/              # Base UI components (shadcn/base-ui)
│   │   ├── llm-providers/   # LLM provider selection UI
│   │   └── prompt-configurator/ # Custom prompt editor
│   ├── entrypoints/         # WXT entrypoints (content scripts, background, popup, etc.)
│   │   ├── background/      # Service worker — translation queues, messaging, config
│   │   ├── host.content/    # Main content script — page translation orchestrator
│   │   ├── selection.content/ # Text selection toolbar content script
│   │   ├── side.content/    # Side panel content script (article analysis)
│   │   ├── subtitles.content/ # YouTube subtitle translation
│   │   ├── interceptor.content/ # YouTube player API interceptor
│   │   ├── guide.content/   # New user guide overlay
│   │   ├── popup/           # Extension popup UI
│   │   ├── options/         # Full options page (React Router)
│   │   ├── translation-hub/ # Translation center page
│   │   └── offscreen/       # Offscreen document (TTS playback)
│   ├── hooks/               # React hooks (batch records, TTS, Google Drive)
│   ├── locales/             # i18n locale files
│   ├── types/               # TypeScript types & Zod schemas
│   │   └── config/          # Config type definitions (translate, provider, subtitles, etc.)
│   └── utils/               # Core utilities
│       ├── atoms/           # Jotai atoms for global state
│       ├── config/          # Config storage, migration, helpers
│       ├── constants/       # Named constants (DOM rules, labels, providers)
│       ├── content/         # Content analysis (language detection, article parsing)
│       ├── db/              # Dexie.js IndexedDB (translation cache, summaries)
│       ├── host/            # Host page DOM utilities
│       │   ├── dom/         # DOM traversal, filtering, finding, batching
│       │   └── translate/   # Translation orchestration
│       │       ├── api/     # Translation API clients (AI, Google, Microsoft, DeepLX)
│       │       ├── core/    # Translation walker, modes, state
│       │       ├── dom/     # DOM insertion, cleanup, wrapper management
│       │       └── ui/      # Spinner, decoration, style injection
│       ├── prompts/         # LLM prompt templates (translate, analyze, explain)
│       ├── providers/       # AI SDK provider factory & model registry
│       ├── request/         # Request/Batch queue with token bucket rate limiting
│       └── react-shadow-host/ # Shadow DOM host creation for isolated UI
├── public/                  # Extension icons and static assets
├── scripts/                 # Build & scraping scripts
└── wxt.config.ts            # WXT configuration (manifest, Vite plugins)
```

### 1.3 Extension Organization

| Entrypoint | Type | Purpose |
|---|---|---|
| `host.content` | Content Script | **Core**: Page translation orchestrator. Manages `PageTranslationManager`, `IntersectionObserver`, `MutationObserver`. Injected into all frames. |
| `selection.content` | Content Script | Handles text selection toolbar (click-to-translate individual words/phrases). |
| `side.content` | Content Script | Side panel for article reading/analysis. Uses Shadow DOM for isolation. |
| `subtitles.content` | Content Script | YouTube subtitle translation (only on `youtube.com`). |
| `interceptor.content` | Content Script (MAIN world) | Intercepts YouTube's player API in the page's MAIN world. |
| `guide.content` | Content Script | New user onboarding overlay. |
| `background` | Service Worker | Translation queue management, config initialization, message routing, TTS, proxy fetch. |
| `popup` | Popup | Extension popup — language selector, provider config, translate button, settings. |
| `options` | Options Page | Full settings page with React Router. |
| `translation-hub` | Extension Page | Translation analytics/history dashboard. |
| `offscreen` | Offscreen Document | TTS audio playback (Chrome Offscreen API). |

---

## 2. Full-Page Translation Trigger Flow

This is the most important section. The page translation flow involves several layers working in concert.

### 2.1 Entry Points (How Translation is Triggered)

There are **four** ways to trigger full-page translation:

#### A. Popup "Translate" Button
**File**: `src/entrypoints/popup/components/translate-button.tsx`

```tsx
const toggleTranslation = async () => {
  const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (currentTab.id) {
    void sendMessage("tryToSetEnablePageTranslationByTabId", {
      tabId: currentTab.id, enabled: !isPageTranslated,
    });
    setIsPageTranslated(prev => !prev);
  }
};
```

#### B. Keyboard Shortcut
**File**: `src/entrypoints/host.content/translation-control/bind-translation-shortcut.ts`

Uses `hotkeys-js` to bind a configurable shortcut (default: Alt+A). Directly calls `manager.start()` or `manager.stop()`.

#### C. Four-Finger Touch (Mobile)
**File**: `src/entrypoints/host.content/translation-control/page-translation.ts` → `registerPageTranslationTriggers()`

A 4-finger tap-and-hold gesture toggles translation on mobile devices.

#### D. Auto-Translation
**File**: `src/utils/host/translate/auto-translation.ts`

Automatically starts translation based on URL patterns or detected page language matching user-configured rules.

### 2.2 Complete Trigger-to-Render Flow

```
[User clicks "Translate" in Popup]
    │
    ▼
popup → sendMessage("tryToSetEnablePageTranslationByTabId", { tabId, enabled: true })
    │
    ▼
background/translation-signal.ts
    → onMessage("tryToSetEnablePageTranslationByTabId")
    → sendMessage("askManagerToTogglePageTranslation", { enabled }, tabId)
    │
    ▼
host.content/index.tsx
    → onMessage("askManagerToTogglePageTranslation")
    → manager.start()   // PageTranslationManager
    │
    ▼
PageTranslationManager.start()
    │
    ├─ 1. Validate config (provider, API key, language pair)
    ├─ 2. Notify background: setAndNotifyPageTranslationStateChangedByManager
    ├─ 3. Prime article context (Readability.js parses page for summary)
    ├─ 4. Start document title tracking (translate <title>)
    ├─ 5. Walk & label DOM (walkAndLabelElement on document.body)
    ├─ 6. Create IntersectionObserver → observe paragraph elements
    ├─ 7. Create MutationObserver → watch for new/changed DOM nodes
    │
    ▼
[IntersectionObserver fires for visible elements]
    │
    ▼
translateWalkedElement(element, walkId, config)
    │
    ├─ Walks children, groups consecutive inline nodes
    ├─ For each paragraph: translateNodes(nodes, walkId, toggle, config)
    │
    ▼
translateNodesBilingualMode() / translateNodeTranslationOnlyMode()
    │
    ├─ 1. Extract text via extractTextContent(node, config)
    ├─ 2. Filter small paragraphs (min chars/words)
    ├─ 3. Insert spinner into wrapper node
    ├─ 4. Call translateTextForPage(textContent)
    │
    ▼
translateTextForPage() → translateTextCore() → sendMessage("enqueueTranslateRequest", ...)
    │
    ▼
background/translation-queues.ts
    │
    ├─ Check Dexie cache (hash-based)
    ├─ For LLM: BatchQueue.enqueue() → groups by lang pair + provider
    ├─ For non-LLM: RequestQueue.enqueue() directly
    │
    ▼
BatchQueue (configurable maxItems, maxChars, 100ms delay)
    │
    ├─ Joins texts with "⟨⟩" separator
    ├─ Wraps in RequestQueue for rate limiting
    │
    ▼
RequestQueue (token-bucket rate limiter)
    │
    ├─ executeTranslate(batchText, langConfig, providerConfig, promptResolver)
    │
    ▼
executeTranslate() dispatches to:
    ├─ aiTranslate() → Vercel AI SDK generateText()
    ├─ googleTranslate() → Google Translate API
    ├─ microsoftTranslate() → Microsoft Translate API
    └─ deeplxTranslate() → DeepLX API
    │
    ▼
[Translation result returns to content script]
    │
    ▼
insertTranslatedNodeIntoWrapper()
    │
    ├─ Creates <span> with translated text
    ├─ Adds inline (space + span) or block (<br> + span) based on node type
    ├─ Decorates with configurable styles (preset or custom CSS)
    └─ Batched DOM operations via requestAnimationFrame
```

### 2.3 Key Design Decisions

1. **IntersectionObserver for lazy translation**: Only translates elements as they enter the viewport (with configurable `rootMargin` preload buffer, default 600px).

2. **MutationObserver for dynamic content**: Watches `document.body` for `childList` (new nodes) and `attributes` (style/class changes that reveal hidden content). Also recursively observes shadow roots.

3. **Walk ID (UUID) for versioning**: Each translation session gets a unique `walkId`. Elements are tagged with `data-read-frog-walked="{walkId}"`. This prevents stale translations from mixing with new ones.

4. **Background-based translation queue**: All API calls happen in the background service worker. The content script sends a message and awaits the result. This centralizes rate limiting and caching.

5. **Batch translation**: Multiple text blocks are joined with a separator (`⟨⟩`) and sent as a single request, then parsed apart. This dramatically reduces API calls.

---

## 3. Text Extraction & Block Detection

### 3.1 DOM Traversal Strategy

**File**: `src/utils/host/dom/traversal.ts` → `walkAndLabelElement()`

The algorithm is a **recursive top-down walk** that labels elements with data attributes:

```typescript
function walkAndLabelElement(element: HTMLElement, walkId: string, config: Config) {
  // 1. Skip elements that should not be walked
  if (isDontWalkIntoButTranslateAsChildElement(element) || 
      isDontWalkIntoAndDontTranslateAsChildElement(element, config)) {
    return { forceBlock: false, isInlineNode: false };
  }

  // 2. Mark element as walked with the session ID
  element.setAttribute(WALKED_ATTRIBUTE, walkId);

  // 3. Recurse into shadow roots
  if (element.shadowRoot) { /* walk shadow children */ }

  // 4. Classify children: inline content = "paragraph"; block = recurse
  for (const child of validChildNodes) {
    if (child is text node with content) → hasInlineNodeChild = true
    if (child is HTMLElement) {
      walkAndLabelElement(child, ...) → check if inline
      if (result.isInlineNode) → hasInlineNodeChild = true
    }
  }

  // 5. Label this element
  if (hasInlineNodeChild) → setAttribute("data-read-frog-paragraph", "")
  if (isBlockElement || forceBlock) → setAttribute("data-read-frog-block-node", "")
  else if (isInlineElement) → setAttribute("data-read-frog-inline-node", "")
}
```

**Key data attributes**:
- `data-read-frog-walked="{walkId}"` — marks element as processed in this session
- `data-read-frog-paragraph` — element contains inline text children (translation unit)
- `data-read-frog-block-node` — element is a block-level container
- `data-read-frog-inline-node` — element is inline content

### 3.2 Block vs Inline Detection

**File**: `src/utils/host/dom/filter.ts`

Uses **computed CSS `display`** to determine block/inline:

```typescript
function isShallowInlineHTMLElement(element: HTMLElement): boolean {
  if (FORCE_BLOCK_TAGS.has(element.tagName)) return false;
  const computedStyle = window.getComputedStyle(element);
  if (isLargeInitialFloatingLetter(element)) return true;  // newspaper drop caps
  return isInlineDisplay(computedStyle.display);
}

function isInlineDisplay(display: string): boolean {
  if (display === "contents") return true;
  if (display.startsWith("inline")) return true;
  return ["ruby", "ruby-base", "ruby-text", ...].includes(display);
}
```

### 3.3 What Gets Skipped

Two categories of elements are skipped:

#### Category 1: Don't walk into, but translate as part of parent
**Tags**: `CODE`, `TIME`  
**CSS Class**: `.notranslate`

These elements' text is included when their parent paragraph is translated, but they are not recursed into for further walking.

#### Category 2: Don't walk into AND don't translate
**Tags**: `HEAD`, `TITLE`, `SCRIPT`, `STYLE`, `NOSCRIPT`, `INPUT`, `TEXTAREA`, `IMG`, `VIDEO`, `AUDIO`, `CANVAS`, `SVG`, `PRE`, all MathML tags (`<math>`, etc.)

**CSS conditions**: `display: none`, `visibility: hidden`, `hidden` attribute, `aria-hidden="true"`, `.sr-only`, `.visually-hidden`

**Content range filter**: When config is set to `range: "main"` (not "all"), elements like `HEADER`, `FOOTER`, `NAV` are skipped unless they're inside an `<article>` or `<main>` element.

**Custom per-site selectors**: Site-specific selectors are defined in `CUSTOM_DONT_WALK_INTO_ELEMENT_SELECTOR_MAP`. For example:
- `chatgpt.com` → skip `.ProseMirror` (editor)
- `youtube.com` → skip `#masthead-container *`, `#guide-inner-content *`, etc.
- `github.com` → skip `[aria-labelledby="folders-and-files"] *`, `header *`

### 3.4 Force Block Tags

These elements are always treated as block-level regardless of CSS:
`BODY`, `H1`–`H6`, `BR`, `FORM`, `SELECT`, `BUTTON`, `LABEL`, `UL`, `OL`, `LI`, `BLOCKQUOTE`, `PRE`, `ARTICLE`, `SECTION`, `FIGURE`, `FIGCAPTION`, `HEADER`, `FOOTER`, `MAIN`, `NAV`

### 3.5 Translation Granularity

The granularity is **paragraph-level**, where a "paragraph" is defined as:

> An element that has at least one inline child node with non-empty text content.

This means:
- A `<p>Hello <strong>world</strong></p>` → the `<p>` is the paragraph, "Hello world" is extracted as one unit
- A `<div><p>Text 1</p><p>Text 2</p></div>` → each `<p>` is a separate paragraph
- Mixed block/inline children → inline sequences are grouped, block children are processed recursively

### 3.6 Text Extraction

**File**: `src/utils/host/dom/traversal.ts` → `extractTextContent()`

Recursively extracts text from a node tree:
- Text nodes → trimmed with whitespace normalization
- `<br>` → `\n`
- Elements marked "don't translate as child" → `""` (excluded)
- Other elements → recurse into children

---

## 4. Translation Display

### 4.1 Two Display Modes

**File**: `src/types/config/translate.ts`

```typescript
export const TRANSLATION_MODES = ["bilingual", "translationOnly"] as const;
```

#### Bilingual Mode
- **Original text preserved** — translation is appended after the original
- For **inline** elements: adds `"  "` (space) then an inline `<span>` with the translation
- For **block** elements: adds a `<br>` then a block `<span>` with the translation
- Wrapper: `<span class="notranslate read-frog-translated-content-wrapper">`

#### Translation-Only Mode
- **Original text replaced** with translation
- Saves original HTML in `originalContentMap` (WeakMap-like `Map<Element, string>`)
- On stop/toggle: restores original content via `innerHTML` replacement
- Original is removed from DOM; translated wrapper takes its place

### 4.2 DOM Insertion Strategy

**File**: `src/utils/host/translate/dom/translation-insertion.ts`

```typescript
async function insertTranslatedNodeIntoWrapper(
  translatedWrapperNode, targetNode, translatedText, translationNodeStyle, forceBlockTranslation
) {
  const translatedNode = document.createElement("span");
  
  // Priority: customForceBlock > forceInline > forceBlock > isInline > isBlock
  if (customForceBlock) addBlockTranslation(...)    // <br> + block span
  else if (forceInline) addInlineTranslation(...)   // spaces + inline span
  else if (forceBlock) addBlockTranslation(...)
  else if (isInlineTransNode) addInlineTranslation(...)
  else if (isBlockTransNode) addBlockTranslation(...)
  
  translatedNode.textContent = translatedText;
  translatedWrapperNode.appendChild(translatedNode);
  await decorateTranslationNode(translatedNode, translationNodeStyle);
}
```

### 4.3 DOM Batching for Performance

**File**: `src/utils/host/dom/batch-dom.ts`

A `DOMBatcher` singleton queues DOM operations and executes them in a single `requestAnimationFrame` call to minimize layout thrashing:

```typescript
class DOMBatcher {
  private operations: DOMOperation[] = [];
  queue(operation: DOMOperation): void { /* push + scheduleFlush */ }
  private flush(): void {
    const ops = this.operations.splice(0);
    for (const op of ops) op();  // all in one frame
  }
}
```

### 4.4 Shadow DOM Usage

- **Side panel** (`side.content`): Uses `createShadowRootUi` from WXT for full React UI isolation
- **Translation error display**: Uses a custom `createReactShadowHost` for isolated error components
- **Translation text itself**: Does NOT use Shadow DOM — inserted directly into the host page DOM as `<span>` elements with CSS class-based styling

### 4.5 Translation Styling

Supports preset styles and custom CSS for translated text:
- **Presets**: Configurable visual styles applied via data attributes (`data-read-frog-custom-translation-node`)
- **Custom CSS**: User can write custom CSS (up to 8KB) that is injected into the page/shadow root
- **Style injection**: `ensurePresetStyles(root)` / `ensureCustomCSS(root, css)` injects `<style>` into the appropriate root (document or shadow root)

### 4.6 Loading States

A lightweight CSS spinner (no React overhead) is created with inline styles and Web Animations API:
```typescript
function createLightweightSpinner(ownerDoc: Document): HTMLElement {
  const spinner = ownerDoc.createElement("span");
  spinner.className = "read-frog-spinner";
  spinner.style.cssText = `display: inline-block !important; width: 6px !important; ...`;
  spinner.animate([
    { transform: "rotate(0deg)" },
    { transform: "rotate(360deg)" },
  ], { duration: 600, iterations: Infinity });
  return spinner;
}
```

---

## 5. Translation API Integration

### 5.1 Supported Backends

**File**: `src/utils/host/translate/execute-translate.ts`

| Category | Providers |
|---|---|
| **LLM (AI SDK)** | OpenAI, Anthropic, Google (Gemini), DeepSeek, Groq, Mistral, Cerebras, Cohere, Fireworks, TogetherAI, xAI, Perplexity, Replicate, DeepInfra, Vercel, Amazon Bedrock, OpenRouter, Ollama, OpenAI-compatible, Minimax |
| **Traditional API** | Google Translate, Microsoft Translate |
| **Other API** | DeepLX |

The dispatch logic:
```typescript
if (isNonAPIProvider(provider)) {
  // Google Translate or Microsoft Translate
} else if (isPureAPIProvider(provider)) {
  // DeepLX
} else if (isLLMProviderConfig(providerConfig)) {
  // AI SDK generateText() with configured model
}
```

### 5.2 Batch/Chunk Strategy

**File**: `src/utils/request/batch-queue.ts`, `src/entrypoints/background/translation-queues.ts`

Two-tier queuing system:

#### BatchQueue
- Groups requests by language pair + provider ID (hash key)
- Configurable: `maxCharactersPerBatch`, `maxItemsPerBatch`, `batchDelay` (100ms)
- Joins texts with `⟨⟩` separator
- On result: splits by the same separator to distribute results
- Retry support with fallback to individual requests
- **Only used for LLM providers** (traditional APIs called individually)

#### RequestQueue (Token Bucket Rate Limiter)
- **Token bucket algorithm**: `rate` tokens/sec, `capacity` bucket size
- Priority queue ordered by `scheduleAt` timestamp
- Duplicate detection via hash-based deduplication
- Configurable timeout (20s), max retries (2), exponential backoff

### 5.3 Caching

**File**: `src/utils/db/dexie/app-db.ts`

Uses Dexie.js (IndexedDB) with tables:
- `translationCache` — keyed by SHA-256 hash of (text + provider config + language pair + prompt)
- `articleSummaryCache` — keyed by SHA-256 of article text content + provider config
- `batchRequestRecord` — analytics for batch request tracking
- `aiSegmentationCache` — subtitle segmentation cache

Cache is checked **before** enqueueing in the background script:
```typescript
if (hash) {
  const cached = await db.translationCache.get(hash);
  if (cached) return cached.translation;
}
```

### 5.4 AI Content-Aware Translation

When `enableAIContentAware` is enabled:
1. Uses `@mozilla/readability` to extract article text from the page
2. Generates an AI summary of the article (cached)
3. Includes title and summary in the translation prompt for better context

---

## 6. State Management

### 6.1 Translation State Tracking

**File**: `src/utils/host/translate/core/translation-state.ts`

```typescript
export const translatingNodes = new WeakSet<ChildNode>();  // currently being translated
export const originalContentMap = new Map<Element, string>(); // original HTML for translationOnly mode
```

- `translatingNodes` (WeakSet): prevents duplicate translation of the same node
- `originalContentMap`: stores innerHTML for restore on stop/toggle (translationOnly mode)

### 6.2 Walk ID Versioning

Each `manager.start()` generates a UUID `walkId`. All DOM labels include this ID:
```html
<div data-read-frog-walked="abc-123" data-read-frog-paragraph data-read-frog-block-node>
```

When `manager.stop()` is called:
- `walkId` is set to `null`
- All observers are disconnected
- `removeAllTranslatedWrapperNodes()` cleans up all wrappers

### 6.3 Per-Tab Translation State (Background)

**File**: `src/entrypoints/background/translation-signal.ts`

Translation on/off state is stored per-tab via WXT storage:
```typescript
await storage.setItem<TranslationState>(getTranslationStateKey(tabId), { enabled })
```

Cleaned up when:
- Tab is closed (`tabs.onRemoved`)
- Main frame navigates (`webNavigation.onCommitted`)

### 6.4 SPA / URL Change Handling

**File**: `src/entrypoints/host.content/listen.ts`

Four strategies for detecting URL changes (to support SPAs):
1. **`pushState` / `replaceState` monkey-patching** — intercept History API calls
2. **`popstate` / `hashchange` events** — standard browser events
3. **Navigation API** (`window.navigation.navigate`) — Chrome/Edge only
4. **Polling fallback** (Firefox/Safari) — `setInterval` checks `location.href`

On URL change:
- Stops current translation
- Re-detects page language
- Checks auto-translation rules
- If auto-translate applies, restarts translation

### 6.5 Dynamic Content Handling

The `MutationObserver` in `PageTranslationManager.observeMutations()`:
- **`childList` mutations**: New added HTML elements are walked, labeled, and observed
- **`attributes` mutations** (style/class changes): Checks if a previously hidden element became visible (e.g., lazy-loaded content, tab switches), and if so, triggers observation
- **Shadow root traversal**: Recursively finds and observes shadow roots in shadow DOM content

---

## 7. Configuration & Settings

### 7.1 Config Schema

**File**: `src/types/config/config.ts`

The full config schema is a Zod-validated object:

```typescript
configSchema = z.object({
  language: { sourceCode, targetCode, level },
  providersConfig: [...],            // Array of provider configs (API keys, models, etc.)
  translate: {
    providerId: string,
    mode: "bilingual" | "translationOnly",
    node: { enabled, hotkey },       // Individual node translation
    page: {
      range: "main" | "all",        // Translate main content only or entire page
      autoTranslatePatterns: [...],  // URL patterns for auto-translate
      autoTranslateLanguages: [...], // Languages to auto-translate
      shortcut: [...],               // Hotkey keys
      preload: { margin, threshold },// IntersectionObserver config
      minCharactersPerNode: number,  // Filter short text
      minWordsPerNode: number,
      skipLanguages: [...],          // Don't translate these languages
    },
    enableAIContentAware: boolean,
    customPromptsConfig: { promptId, patterns: [...] },
    requestQueueConfig: { capacity, rate },
    batchQueueConfig: { maxCharactersPerBatch, maxItemsPerBatch },
    translationNodeStyle: { preset, isCustom, customCSS },
  },
  tts: { ... },
  floatingButton: {
    enabled, position, disabledFloatingButtonPatterns,
    clickAction: "panel" | "translate",
  },
  selectionToolbar: { enabled, disabledSelectionToolbarPatterns, features },
  sideContent: { width },
  inputTranslation: { enabled, providerId, fromLang, toLang, enableCycle, timeThreshold },
  videoSubtitles: { ... },
  siteControl: { mode: "blacklist" | "whitelist", blacklistPatterns, whitelistPatterns },
});
```

### 7.2 Storage

- **`chrome.storage.local`** via WXT's `storage` API
- Config key: `local:readFrogConfig`
- Schema migration: `src/utils/config/migration.ts`
- Validated on read via Zod; falls back to `DEFAULT_CONFIG` if invalid

### 7.3 Notable User Settings

| Setting | Purpose |
|---|---|
| `translate.page.range` | "main" (skip header/footer/nav) vs "all" |
| `translate.page.preload.margin` | IntersectionObserver rootMargin (default: 600px) |
| `translate.page.preload.threshold` | IntersectionObserver threshold (default: 0.1) |
| `translate.page.minCharactersPerNode` | Skip paragraphs shorter than this |
| `translate.page.minWordsPerNode` | Skip paragraphs with fewer words than this |
| `translate.page.skipLanguages` | Don't translate text detected as these languages |
| `translate.page.autoTranslatePatterns` | URL patterns for auto-start |
| `translate.page.autoTranslateLanguages` | Auto-translate when page language matches |
| `translate.mode` | Bilingual vs translation-only |
| `translate.node.hotkey` | Hotkey or "clickAndHold" for single-node translation |
| `translate.customPromptsConfig` | User-defined system/user prompts for LLM |
| `translate.translationNodeStyle` | Visual style for translated text |
| `siteControl` | Blacklist/whitelist mode for sites |
| `floatingButton.clickAction` | "panel" (open side panel) or "translate" (toggle translation) |

---

## 8. Key Takeaways for Our Feature

### Architecture Patterns Worth Adopting

1. **IntersectionObserver + MutationObserver combo**: This is the gold standard for page-level translation. IntersectionObserver handles lazy loading ("translate as you scroll"), while MutationObserver handles SPAs and dynamic content.

2. **Walk-and-label approach**: Pre-labeling the DOM with data attributes before translation provides:
   - Clear separation between DOM analysis and translation execution
   - Easy cleanup (query by attribute)
   - Session versioning (walkId prevents stale translations)

3. **Background-based translation queue**: Centralizing API calls in the background service worker enables:
   - Per-tab rate limiting without content script duplication
   - Batch grouping across multiple content scripts
   - Centralized caching in IndexedDB

4. **Token bucket rate limiting**: Clean throttling model that prevents API overload while maximizing throughput.

5. **Batch with separator pattern**: For LLM APIs, joining multiple texts with a unique separator and splitting results is a simple and effective batching technique.

### Block Detection Strategy Summary

The core heuristic is:
1. **Exclude** entire subtrees: scripts, styles, hidden elements, media, math, site-specific selectors
2. **Force block**: semantic elements (h1-h6, li, article, section, etc.)
3. **Classify by CSS `display`**: `getComputedStyle(element).display` determines block vs inline
4. **Paragraph = element with inline children**: The translation unit is an element that directly contains text nodes or inline children

### Critical Differences from Our Use Case

Our "auto word/phrase translation" feature has different requirements:
- **Granularity**: Read Frog works at paragraph level; we may need word/phrase level
- **Display**: Read Frog appends translations; we annotate individual words with floating notes
- **Trigger**: Read Frog translates everything visible; we may want selective auto-marking

However, the DOM traversal, block detection, and IntersectionObserver/MutationObserver patterns are directly applicable to our feature's text scanning phase.

---

## Appendix: Key File Reference

| File Path | Purpose |
|---|---|
| `src/entrypoints/host.content/index.tsx` | Content script entry — creates `PageTranslationManager` |
| `src/entrypoints/host.content/translation-control/page-translation.ts` | `PageTranslationManager` class — orchestrates everything |
| `src/utils/host/dom/traversal.ts` | `walkAndLabelElement()`, `extractTextContent()` |
| `src/utils/host/dom/filter.ts` | Block/inline detection, skip rules |
| `src/utils/constants/dom-rules.ts` | Tag classification constants |
| `src/utils/constants/dom-labels.ts` | Data attribute names |
| `src/utils/host/translate/core/translation-walker.ts` | `translateWalkedElement()` — walks labeled DOM |
| `src/utils/host/translate/core/translation-modes.ts` | Bilingual and translation-only mode logic |
| `src/utils/host/translate/dom/translation-insertion.ts` | DOM insertion of translated content |
| `src/utils/host/translate/translate-text.ts` | `translateTextCore()` — sends to background |
| `src/utils/host/translate/translate-variants.ts` | Page/title/input translation variants |
| `src/utils/host/translate/execute-translate.ts` | Dispatches to AI/Google/Microsoft/DeepLX |
| `src/utils/host/translate/api/ai.ts` | AI SDK integration |
| `src/entrypoints/background/translation-queues.ts` | Background queue setup & message handlers |
| `src/utils/request/batch-queue.ts` | `BatchQueue` implementation |
| `src/utils/request/request-queue.ts` | `RequestQueue` with token bucket |
| `src/utils/host/dom/batch-dom.ts` | `DOMBatcher` — rAF batching |
| `src/entrypoints/background/translation-signal.ts` | Translation state messaging |
| `src/utils/message.ts` | Typed message protocol definition |
| `src/types/config/config.ts` | Full config schema |
| `src/types/config/translate.ts` | Translation-specific config types |
