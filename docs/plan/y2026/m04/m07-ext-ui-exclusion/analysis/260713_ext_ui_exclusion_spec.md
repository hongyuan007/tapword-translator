# Extension UI Exclusion from Full-Text Translation — Spec

## Problem
The full-text translation walker collects text from ALL DOM elements, including the extension's own injected UI (floating button close menu, translation tooltips, modal, icon, toasts). These extension elements should be excluded from translation.

## Current State
- The walker (`src/11_full_translate/dom/walker.ts`) recurses DOM including shadow roots.
- `filter.ts` has skip logic (`isDontWalkIntoAndDontTranslateAsChildElement`) but no check for extension-owned elements.
- `DynamicContentObserver.shouldSkip()` also lacks extension-owned checks.
- Only `tapword-translated-content-wrapper` (translation output) is currently filtered via `isTranslatedWrapperNode()`.

## Extension UI Injection Points

| Component | File | DOM Identifier | Injection Target |
|-----------|------|---------------|-----------------|
| Floating button | `src/12_floating_button/ui/FloatingButtonRenderer.ts` | `.tw-fab-container` | `document.body` |
| Translation icon | `src/1_content/ui/iconManager.ts` | `.ai-translator-icon` | `document.body` |
| Tooltip | `src/1_content/ui/translationDisplayV2/tooltipRenderer.ts` | `.ai-translator-tooltip` | `document.body` |
| Modal | `src/1_content/ui/translationModal.ts` | Shadow host (no class) | `document.body` |
| Toast | `src/1_content/ui/toastNotification.ts` | `.ai-translator-toast` | `document.body` |

## Proposed Solution: Unified Data Attribute

### Approach
Add a single `data-tapword-ext` attribute to all extension UI root containers. The walker's filter checks this attribute and completely excludes the element (don't walk, don't translate).

### Why data attribute over CSS class
- Extension UI uses 3 different class prefixes (`ai-translator-*`, `tw-fab-*`, `tapword-*`)
- A data attribute is prefix-agnostic and works as a unified marker
- Semantic: it signals "this is extension-owned" rather than styling

### Why NOT `notranslate` class (read-frog's approach)
- `notranslate` triggers `isDontWalkIntoButTranslateAsChildElement` — element text is still included in parent's translation
- For extension UI, we need complete exclusion: don't walk AND don't translate

## Files to Modify

### 1. Constants — `src/11_full_translate/constants/index.ts`
Add: `EXTENSION_OWNED_ATTRIBUTE = "data-tapword-ext"`

### 2. Filter — `src/11_full_translate/dom/filter.ts`  
Add check in `isDontWalkIntoAndDontTranslateAsChildElement()`:
```typescript
if (element.hasAttribute(EXTENSION_OWNED_ATTRIBUTE)) return true
```

### 3. DynamicContentObserver — `src/11_full_translate/utils/DynamicContentObserver.ts`
Add extension-owned check in `shouldSkip()`.

### 4. UI Files — Add `data-tapword-ext` attribute at creation
- `src/12_floating_button/ui/FloatingButtonRenderer.ts` — on container element
- `src/1_content/ui/iconManager.ts` — on icon element
- `src/1_content/ui/translationDisplayV2/tooltipRenderer.ts` — on tooltip element
- `src/1_content/ui/translationModal.ts` — on shadow host element
- `src/1_content/ui/toastNotification.ts` — on toast element

## Risks
- None significant. Adding a data attribute is non-breaking. The filter check is at the top of an existing function.

## Verification
- Type-check passes
- Manual test: enable full-text translation, verify extension UI text is not translated
