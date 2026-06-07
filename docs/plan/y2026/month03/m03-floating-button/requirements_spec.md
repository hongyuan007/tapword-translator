# Floating Ball — Requirements Specification

**Date**: 2026-03-20
**Status**: Draft
**Module**: `src/12_floating_button/`

---

## 1. Overview

Add a floating ball button on the page that allows users to trigger and control full-text translation without opening the popup. The ball provides visual state feedback and quick disable options.

## 2. Functional Requirements

### 2.1 Core Behavior

| ID | Requirement | Priority |
|----|-------------|----------|
| F-01 | Floating ball renders as a fixed-position button on the right edge of the viewport | P0 |
| F-02 | Click toggles full-text translation (start / stop) | P0 |
| F-03 | Visual state indicates current translation status (idle vs bilingual-active) | P0 |
| F-04 | Ball is vertically draggable along the right edge | P1 |
| F-05 | Drag position is persisted to `chrome.storage.local` | P1 |
| F-06 | Hover reveals a close (X) button | P1 |
| F-07 | X button opens dropdown: "Disable on this site" / "Disable globally" | P1 |
| F-08 | Ball appears only on HTTP/HTTPS pages (not on chrome://, extension pages, etc.) | P0 |

### 2.2 State Machine

```
┌─────────────────────────────────────┐
│ Global/Per-site disabled → HIDDEN   │
└──────────────┬──────────────────────┘
               │ enabled && !disabled
               ▼
┌──────────────────────┐
│       IDLE           │  60% opacity, partially hidden on right edge
│  (no translation)    │
└──────────┬───────────┘
           │ click
           ▼
┌──────────────────────┐
│     TRANSLATING      │  Loading animation / spinner
│  (translation active)│
└──────────┬───────────┘
           │ translation complete
           ▼
┌──────────────────────┐
│   BILINGUAL ACTIVE   │  Green checkmark badge / color change
│ (translations shown) │
└──────────┬───────────┘
           │ click (stop)
           ▼
           IDLE
```

### 2.3 Visual States

| State | Opacity | Icon | Additional |
|-------|---------|------|------------|
| Idle | 60% | TapWord logo or translate icon | Partially hidden (shifted right) |
| Hover | 100% | Same | Slides in fully, X button appears |
| Translating | 100% | Spinner/pulse animation | — |
| Bilingual Active | 100% | Logo + green ✓ badge | — |
| Dragging | 100% | Same as current | `cursor: move` |

### 2.4 Configuration (stored in `chrome.storage.local`)

```typescript
interface FloatingButtonConfig {
  enabled: boolean;           // Global on/off (default: true)
  position: number;           // 0-1 viewport height ratio (default: 0.66)
  disabledSites: string[];    // Hostname patterns (default: [])
}
```

### 2.5 Disable Options

| Action | Behavior |
|--------|----------|
| "Disable on this site" | Adds `window.location.hostname` to `disabledSites[]` |
| "Disable globally" | Sets `enabled = false` |

Re-enabling is done from the popup or options page.

## 3. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF-01 | Button must not interfere with page layout (uses `position: fixed`, max z-index) |
| NF-02 | Button renders in page DOM (not Shadow DOM for v1 — simpler implementation) |
| NF-03 | All CSS classes must be prefixed (`tw-fab-*`) to avoid conflicts with host page |
| NF-04 | Drag must distinguish click vs drag (5px movement threshold) |
| NF-05 | Position clamped to viewport bounds (min 30px from top, max innerHeight - 100px) |
| NF-06 | Must handle `print` media query (hidden when printing) |

## 4. Integration Points

### 4.1 With Full-Text Translation Module (`11_full_translate`)
- Clicking the ball triggers the same flow as the popup "Translate Page" button
- Ball receives translation state updates to reflect active/idle status
- Uses existing messaging infrastructure (`MessageRouter` / `chrome.runtime.sendMessage`)

### 4.2 With Background Script (`2_background`)
- No new message types needed — reuses existing full-translate messages
- State sync: ball listens for translation state changes via content script events

### 4.3 With Popup (`3_popup`)
- Popup's "Translate Page" button and floating ball are independent triggers for the same feature
- Both should reflect the same translation state

### 4.4 With Content Script (`1_content`)
- The floating ball module is injected as part of the content script
- Must be initialized after DOM is ready
- Must be cleaned up on extension context invalidation

## 5. UI Specification

### 5.1 Dimensions
- **Main button**: 40px height × 48px width, left-rounded pill shape
- **X close button**: 16px circle, positioned at top-left corner of main button
- **Dropdown menu**: Standard menu width (~180px), 2 items

### 5.2 Positioning
- **Initial**: `right: 0`, `top: 66vh`
- **Idle offset**: `translateX(8px)` — partially off-screen, only icon visible
- **Hover**: `translateX(0)` — fully visible
- **Transition**: `300ms ease` for opacity and transform

### 5.3 Colors
- **Background**: White with subtle border and box-shadow
- **Idle opacity**: 0.6
- **Hover opacity**: 1.0
- **Active badge**: Green (#22c55e) circle with white checkmark
- **X button**: Neutral gray

### 5.4 Z-index
- `2147483647` (maximum 32-bit integer) — ensures it renders above all host page content

## 6. Out of Scope (v1)

- Shadow DOM isolation (can add in v2 if CSS conflicts arise)
- Dark mode support
- Configurable click actions (always "toggle translation")
- Settings sub-button (use popup/options instead)
- Side panel integration
- Keyboard shortcuts for the ball
- Animation beyond simple opacity/translate transitions
