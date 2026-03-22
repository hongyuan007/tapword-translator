# Spec: Customizable Translation Icon Position (Issue #31)

**Author:** Lao Xue (AI CTO)  
**Date:** 2026-03-23  
**Status:** Draft  
**Difficulty:** Low  
**Scope:** Frontend only (`tapword-translator`)

---

## 1. Problem Statement

The translation trigger icon currently appears at a **fixed bottom-right** position relative to selected text (specifically, at `rect.bottom + scrollY + 4` and `rect.right + scrollX + 4`). Users report this position conflicts with other browser extension popup icons. We need a settings option to customize the icon's placement.

---

## 2. Current State Analysis

### 2.1 Icon Position Logic

**File:** `src/1_content/ui/iconManager.ts` → `calculateIconPosition(range)`

```typescript
// Current: hardcoded bottom-right with 4px offset
const top = rect.bottom + winScrollY + (winScrollY === 0 ? (document.body?.scrollTop || 0) : 0) + 4
const left = rect.right + winScrollX + (winScrollX === 0 ? (document.body?.scrollLeft || 0) : 0) + 4
```

- Uses the **last client rect** of the selection range (`rects[rects.length - 1]`)
- Accounts for body-scroll pages (Quirks Mode)
- Adds a fixed `+4px` gap in both directions
- No viewport boundary clamping — the icon can appear off-screen

### 2.2 Settings Architecture

| Layer | File | Role |
|---|---|---|
| **Type definition** | `src/0_common/types/index.ts` → `UserSettings` interface | Defines all setting keys & types |
| **Defaults** | `src/0_common/types/index.ts` → `DEFAULT_USER_SETTINGS` | Default values for new users |
| **Storage** | `src/0_common/utils/storageManager.ts` → `getUserSettings()` / `updateUserSettings()` | Chrome storage read/write |
| **Options page UI** | `src/4_options/index.html` + `src/4_options/modules/settingsManager.ts` | Full settings page |
| **Popup page UI** | `src/3_popup/index.html` + `src/3_popup/modules/settingsManager.ts` | Quick-access popup (limited) |
| **Content script** | `src/1_content/handlers/InputListener.ts` | Reads `settings.iconColor` and passes to `showTranslationIcon()` |

Settings flow: `storageManager` → cached in content script → passed as function arguments to `iconManager.showTranslationIcon()`.

### 2.3 Existing Position Type (Modal)

**File:** `src/1_content/utils/modalPositionerV2.ts`

Already defines `ModalPositionCorner = "bottom-right" | "bottom-left" | "top-right" | "top-left"` — this type can be reused or serve as a reference pattern.

### 2.4 i18n

Locale files are in `src/0_common/locales/` (8 languages: en, zh, ja, ko, fr, de, es, ru).  
The `_locales/en/messages.json` only has extension metadata — app UI strings are in `src/0_common/locales/`.

---

## 3. Proposed Changes

### 3.1 New Setting: `iconPosition`

**Type:** A union type extending the four corners concept, plus an option to mimic the translation modal's smart positioning.

```typescript
export type IconPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "auto"
```

- `"bottom-right"` — current behavior (default for backward compatibility)
- `"bottom-left"` — below selection, aligned left
- `"top-right"` — above selection, aligned right
- `"top-left"` — above selection, aligned left
- `"auto"` — smart positioning: try bottom-right first, fallback to other corners based on viewport space (mirrors `ModalPositionerV2.computeForWord` logic)

### 3.2 Files to Modify

| # | File | Change |
|---|---|---|
| 1 | `src/0_common/types/index.ts` | Add `IconPosition` type; add `iconPosition: IconPosition` field to `UserSettings`; add `"bottom-right"` to `DEFAULT_USER_SETTINGS` |
| 2 | `src/1_content/ui/iconManager.ts` | Modify `calculateIconPosition()` to accept `IconPosition` param and compute position based on the selected mode; add viewport boundary clamping for all modes |
| 3 | `src/1_content/handlers/InputListener.ts` | Read `settings.iconPosition` and pass to `showTranslationIcon()` |
| 4 | `src/1_content/ui/iconManager.ts` | Update `showTranslationIcon()` signature to accept `IconPosition` |
| 5 | `src/4_options/index.html` | Add icon position selector UI (radio buttons or select dropdown) in the "Appearance" section, near the existing icon color setting |
| 6 | `src/4_options/modules/settingsManager.ts` | Handle loading/saving of `iconPosition` setting (already generic via `data-setting` pattern — may not need code changes if we use radio buttons with `data-setting="iconPosition"`) |
| 7 | `src/0_common/locales/en.json` | Add i18n keys for icon position labels |
| 8 | `src/0_common/locales/zh.json` | Add Chinese translations |
| 9 | `src/0_common/locales/{ja,ko,fr,de,es,ru}.json` | Add translations (can be English fallback initially) |

### 3.3 UI Design (Options Page)

Place the icon position control in the **Appearance** section of `src/4_options/index.html`, directly below the icon color radio group.

**Recommended: Radio buttons** (consistent with existing icon color UI pattern):

```html
<div class="setting-item">
  <div class="setting-info">
    <label class="setting-label" data-i18n-key="popup.iconPosition.label">Icon position</label>
    <p class="setting-helper" data-i18n-key="popup.iconPosition.tooltip">
      Choose where the translation icon appears relative to selected text.
    </p>
  </div>
  <div class="radio-group">
    <label class="radio-option">
      <input type="radio" name="iconPosition" value="bottom-right" data-setting="iconPosition">
      <span data-i18n-key="popup.iconPosition.bottomRight">Bottom-right</span>
    </label>
    <label class="radio-option">
      <input type="radio" name="iconPosition" value="bottom-left" data-setting="iconPosition">
      <span data-i18n-key="popup.iconPosition.bottomLeft">Bottom-left</span>
    </label>
    <label class="radio-option">
      <input type="radio" name="iconPosition" value="top-right" data-setting="iconPosition">
      <span data-i18n-key="popup.iconPosition.topRight">Top-right</span>
    </label>
    <label class="radio-option">
      <input type="radio" name="iconPosition" value="top-left" data-setting="iconPosition">
      <span data-i18n-key="popup.iconPosition.topLeft">Top-left</span>
    </label>
    <label class="radio-option">
      <input type="radio" name="iconPosition" value="auto" data-setting="iconPosition">
      <span data-i18n-key="popup.iconPosition.auto">Auto (smart)</span>
    </label>
  </div>
</div>
```

### 3.4 i18n Keys Required

```json
{
  "popup.iconPosition.label": "Icon position",
  "popup.iconPosition.tooltip": "Choose where the translation icon appears relative to selected text.",
  "popup.iconPosition.bottomRight": "Bottom-right",
  "popup.iconPosition.bottomLeft": "Bottom-left",
  "popup.iconPosition.topRight": "Top-right",
  "popup.iconPosition.topLeft": "Top-left",
  "popup.iconPosition.auto": "Auto (smart)"
}
```

### 3.5 Position Calculation Logic

For fixed corners (bottom-right, bottom-left, top-right, top-left):

```
bottom-right: top = rect.bottom + scrollY + GAP, left = rect.right + scrollX + GAP
bottom-left:  top = rect.bottom + scrollY + GAP, left = rect.left - ICON_SIZE - GAP
top-right:    top = rect.top + scrollY - ICON_SIZE - GAP, left = rect.right + scrollX + GAP
top-left:     top = rect.top + scrollY - ICON_SIZE - GAP, left = rect.left - ICON_SIZE - GAP
```

For `"auto"`: reuse `ModalPositionerV2.computeForWord` logic adapted for icon size (24×24px instead of modal size).

**Viewport clamping** (new — current code lacks this):
- Clamp `left` to `[0, window.innerWidth - ICON_SIZE - PAD]`
- Clamp `top` to `[0, window.innerHeight + scrollY - ICON_SIZE - PAD]`
- Apply scroll offset corrections for body-scroll pages (preserve existing Quirks Mode handling)

---

## 4. Risks & Edge Cases

| Risk | Severity | Mitigation |
|---|---|---|
| **Body-scroll pages** (window.scrollY = 0, body.scrollTop ≠ 0) | Medium | Reuse existing scroll correction logic in all position modes |
| **Icon off-screen** (selection near viewport edges) | Medium | Add viewport boundary clamping (missing in current code — fix as part of this change) |
| **Existing users unaffected** | High | Default `"bottom-right"` preserves current behavior; no migration needed |
| **Multi-rect selections** (wrapped text spanning multiple lines) | Low | Current code uses last rect; preserve this behavior for all modes |
| **Settings data type mismatch** | Low | `UserSettings` interface enforces type; `data-setting` + radio pattern is well-tested |
| **`"auto"` mode flickering on scroll** | Low | Position is computed once on selection, not on scroll — no issue |
| **CSS class `visible` animation** | None | Unaffected — animation is position-agnostic |

---

## 5. Verification Plan

### 5.1 Manual Testing Checklist

- [ ] Default (`bottom-right`) behaves identically to pre-change behavior
- [ ] Each fixed corner position places icon correctly relative to selection
- [ ] `auto` mode picks optimal corner when selection is near viewport edges
- [ ] Icon does not render off-screen in any position mode
- [ ] Setting persists across page reloads and browser restarts
- [ ] Options page radio buttons display correct selection on load
- [ ] Options page radio buttons save correctly on change
- [ ] Body-scroll pages (e.g., legacy sites) position icon correctly

### 5.2 Cross-browser Testing

- [ ] Chrome (primary)
- [ ] Firefox (secondary — code is shared)
- [ ] Edge (Chromium-based — should work same as Chrome)

### 5.3 i18n Verification

- [ ] All 8 locale files have the new keys
- [ ] Missing translations fall back gracefully (no blank labels)

### 5.4 Regression

- [ ] Single-click translate still works
- [ ] Double-click translate still works
- [ ] Icon color setting still works independently
- [ ] `showIcon` toggle still hides/shows icon

---

## 6. Out of Scope

- Custom pixel offset values (beyond the 4 presets + auto)
- Popup page UI for this setting (options page only — popup is intentionally limited)
- Animated icon positioning / transitions
- Per-site icon position overrides

---

## 7. Estimated Effort

| Component | Lines Changed (est.) | Time |
|---|---|---|
| Type + defaults | ~10 | 5 min |
| `iconManager.ts` position logic | ~60 | 30 min |
| `InputListener.ts` plumbing | ~3 | 2 min |
| Options HTML + CSS | ~30 | 15 min |
| i18n (8 locales) | ~48 | 15 min |
| Testing | — | 20 min |
| **Total** | **~150** | **~1.5 hours** |
