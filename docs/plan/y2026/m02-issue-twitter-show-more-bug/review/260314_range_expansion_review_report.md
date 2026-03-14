# Code Review Report — Hidden Text Range Expansion Fix

**Reviewer**: Orchestrator Agent  
**Date**: 2026-03-14  
**Manifest**: `docs/manual/manifest__hidden-text-range-expansion_2026-03-14.md`  
**Type-check**: ✅ PASS (0 errors)

---

## Summary

The fix correctly addresses the original bug: hidden accessibility helper text (e.g., a `<button class="sr-only">Copy</button>` next to code on GitHub) was being captured in word expansion and text extraction. The new `isReadableTextNode` / `isVisuallyHiddenElement` filter architecture properly excludes such nodes via class name pattern matching (fast path) and `getComputedStyle` (fallback).

**Verdict**: Safe to test. One medium issue (M1: missing display types) could regress legitimate word expansion on modern sites. Recommended fix before release.

---

## Issues

### 🟡 MEDIUM — M1: `INLINE_DISPLAY_VALUES` missing modern inline display types

| Field | Value |
|---|---|
| File | `src/1_content/utils/domSanitizer.ts` |
| Location | Top of file: `const INLINE_DISPLAY_VALUES = new Set(["inline", "contents"])` |

`isInlineTextContainer()` uses this set to decide if an element between two text nodes is "passable" for cross-node expansion. Elements with `display: inline-block`, `inline-flex`, or `inline-grid` return false → `pathUsesInlineTextContainersOnly()` → false → `canExpandAcrossTextNodes()` blocks expansion.

Modern web UIs heavily use `inline-block` (e.g., `<code>` styling, React component wrappers, Material UI chips). Selecting text that spans across inline children of an `inline-block` wrapper would fail to expand to the word boundary.

**Concrete example**:
```html
<code style="display:inline-block">hello <em>world</em></code>
```
Selecting "hello w" would fail to expand to "hello world" because `<code>` is `inline-block`, not `inline`.

**Fix**:
```typescript
const INLINE_DISPLAY_VALUES = new Set([
    "inline",
    "inline-block",
    "inline-flex",
    "inline-grid",
    "inline-table",
    "contents",
])
```

---

### 🟡 MEDIUM — M2: `getComputedStyle` fires per-ancestor on every text node evaluation

| Field | Value |
|---|---|
| File | `src/1_content/utils/domSanitizer.ts` |
| Location | `isVisuallyHiddenElement()`, `isInsideNonReadableElement()`, `isReadableTextNode()` |

Call chain: `getCleanTextFromRange` → TreeWalker → `isReadableTextNode` per node → `isInsideNonReadableElement` → full parent chain walk → `isVisuallyHiddenElement` per ancestor → `getComputedStyle` when attr/class checks don't match early.

For a text node 15 levels deep in Twitter's DOM, a 5-node range expansion may call `getComputedStyle` up to 75 times. This runs on every selection event (word click, drag select, double-click).

Note: The `hidden` attribute, `aria-hidden`, and class name checks run before `getComputedStyle` and short-circuit early for common cases. Performance is acceptable in typical pages but could degrade on highly nested structures.

**Fix**: Cache `isVisuallyHiddenElement` results (e.g., `WeakMap<Element, boolean>`) per micro-task, or limit the ancestor walk to a maximum depth (e.g., 8 levels — screen-reader elements are almost never deeply nested).

---

### 🟢 LOW — L1: `<a>` (anchor) in `INTERACTIVE_TEXT_TAGS` blocks intra-link expansion

| Field | Value |
|---|---|
| File | `src/1_content/utils/domSanitizer.ts` |
| Location | `INTERACTIVE_TEXT_TAGS`, `isSemanticTextBoundaryElement()` |

`<a>` is treated as a semantic boundary. When text inside an anchor is split across inline children (e.g., `<a><em>hel</em>lo</a>`), `pathUsesInlineTextContainersOnly` encounters `<a>` on the path and returns false → expansion blocked.

For the common case (direct text node in anchor), this does not matter. Only affects rare split-text-inside-anchor patterns on custom-rendered rich text.

---

### 🟢 LOW — L2: `isInlineTextContainer` returns `true` for disconnected elements

| Field | Value |
|---|---|
| File | `src/1_content/utils/domSanitizer.ts` |
| Location | `isInlineTextContainer()`, early exit `if (!element.isConnected) return true` |

Functionally harmless: disconnected text nodes wouldn't be reached from an active selection's expansion path. But semantically inconsistent — an unknown-context element treated as passable inline. Should return `false` for disconnected elements.

---

## Core Logic Verification

| Check | Result |
|---|---|
| GitHub `.sr-only` button text excluded | ✅ `VISUALLY_HIDDEN_CLASS_PATTERN` catches class name before `getComputedStyle` |
| `aria-hidden="true"` nodes excluded | ✅ Attribute check in `isVisuallyHiddenElement` (fast path) |
| `display:none` / `visibility:hidden` nodes excluded | ✅ Via `getComputedStyle` fallback |
| Cross-block expansion prevented | ✅ `getClosestBlockAncestor` scoping in `expandToWordBoundaries` (primary guard) |
| Cross-table-cell expansion prevented | ✅ `TD`/`TH` in `STRUCTURAL_TEXT_TAGS` blocks `pathUsesInlineTextContainersOnly` |
| Cross-list-item expansion prevented | ✅ `LI` in both `BLOCK_ELEMENTS` (scope root) and `STRUCTURAL_TEXT_TAGS` |
| Space insertion between different-flow nodes | ✅ `shouldInsertSpaceBetween` correctly checks `areNodesInSameInlineTextFlow` |
| Fallback `rangeIntersectsNode` logic | ✅ `compareBoundaryPoints` boundary math is correct |
| `<p>` absent from `STRUCTURAL_TEXT_TAGS` | ✅ Intentional — `BLOCK_ELEMENTS` scoping in `expandToWordBoundaries` handles `<p>` |

---

## Required Actions Before Release

| Priority | Action |
|---|---|
| 🟡 Should | Add `inline-block`, `inline-flex`, `inline-grid`, `inline-table` to `INLINE_DISPLAY_VALUES` |
| 🟡 Should | Add depth limit or caching to `isInsideNonReadableElement` ancestor walk |
| 🟢 Optional | Return `false` for disconnected in `isInlineTextContainer` |
| 🟢 Optional | Document `<a>` semantic boundary behavior and edge case in code comments |
