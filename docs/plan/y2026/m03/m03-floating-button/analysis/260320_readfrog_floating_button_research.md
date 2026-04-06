# Read-Frog Floating Button Research Report

**Date**: 2026-03-20
**Purpose**: Research read-frog's floating button implementation as reference for tapword's floating ball feature

---

## 1. File Inventory

| Path | Description |
|------|-------------|
| `entrypoints/side.content/components/floating-button/index.tsx` | Main FloatingButton — renders button, handles drag, close dropdown, position persistence |
| `entrypoints/side.content/components/floating-button/translate-button.tsx` | TranslateButton sub-component — translate icon with green checkmark overlay when active |
| `entrypoints/side.content/components/floating-button/components/hidden-button.tsx` | HiddenButton reusable — round icon button that slides in on hover |
| `entrypoints/side.content/index.tsx` | Content script entry — Shadow DOM setup via `createShadowRootUi` |
| `entrypoints/side.content/app.tsx` | App root — renders FloatingButton + SideContent + FrogToast |
| `entrypoints/side.content/atoms.ts` | Local atoms: `isSideOpenAtom`, `isDraggingButtonAtom`, `enablePageTranslationAtom` |
| `entrypoints/options/pages/floating-button/index.tsx` | Options page: assembles global toggle + click action + disabled sites |
| `entrypoints/options/pages/floating-button/floating-button-click-action.tsx` | Options: click action ("panel" or "translate") |
| `entrypoints/options/pages/floating-button/floating-button-disabled-sites.tsx` | Options: per-site disable domain pattern list |
| `entrypoints/options/pages/floating-button/floating-button-global-toggle.tsx` | Options: global on/off switch |
| `entrypoints/popup/components/floating-button.tsx` | Popup: quick toggle switch for floating button |
| `types/config/config.ts` | Zod schema for `floatingButton` config |
| `utils/constants/config.ts` | Default values: `enabled: true`, `position: 0.66`, `clickAction: "translate"` |
| `utils/atoms/config.ts` | Config atom system — per-field read/write atoms synced to `chrome.storage` |
| `utils/url.ts` | `matchDomainPattern` — hostname matching for disabled sites |

## 2. Component Hierarchy

```
Shadow Root (via createShadowRootUi, position: "overlay")
  └── wrapper (div)
       └── <JotaiProvider store={store}>
            └── <ThemeProvider>
                 └── <App>
                      ├── <FloatingButton>
                      │    ├── <TranslateButton>
                      │    │    └── <HiddenButton> + green IconCheck badge
                      │    ├── Main logo button + DropdownMenu (X close)
                      │    └── <HiddenButton> (Settings — opens options page)
                      ├── <SideContent> (side panel)
                      └── <FrogToast> (notifications)
```

## 3. Visual States

| State | Opacity | Position | Sub-buttons | Description |
|-------|---------|----------|-------------|-------------|
| **Idle** | 60% | `translate-x-5` (partially hidden on right edge) | Hidden | Non-intrusive resting state |
| **Hover** | 100% | `translate-x-0` (slides in fully) | Visible (slide in) | All sub-buttons and X button revealed |
| **Side panel open** | 100% | Offset by panel width | Visible | Main button shifts left to accommodate panel |
| **Dragging** | 100% | Follows mouse vertically | — | `cursor: move`, `user-select: none` on body |
| **Translation active** | — | — | Green ✓ badge on translate button | Visual feedback that translation is running |

## 4. Complete Feature List

### Core Interactions
- **Click**: Toggles page translation (or side panel, configurable)
- **Hover**: Reveals sub-buttons (translate, settings) and X close button
- **Drag**: Vertical drag with 5px threshold to distinguish click vs drag
- **Close menu (X)**: Dropdown with "Disable for this site" / "Disable globally"

### Sub-buttons (appear on hover)
- **Translate button**: Toggle page translation on/off; green checkmark badge when active
- **Settings button**: Opens extension options page

### Configuration
- **Click action**: `"translate"` (default) or `"panel"` — what main button click does
- **Global enable/disable**: Toggle button visibility everywhere
- **Per-site disable**: Domain pattern matching (e.g., `gmail.com` matches `mail.gmail.com`)
- **Position**: Stored as 0-1 ratio of viewport height (default: 0.66)

## 5. State Machine

```
                     ┌──────────────────────────────────────┐
                     │  Check: enabled && !matchDisabled    │
                     │  false → render null (hidden)        │
                     └──────────┬───────────────────────────┘
                                │ true
                                ▼
                     ┌──────────────────────┐
                     │     IDLE (60%)       │
                     │  Logo partially      │
                     │  hidden on right     │
                     └──────────┬───────────┘
                     hover │         │ mouseDown
                           ▼         ▼
              ┌────────────────┐  ┌─────────────────┐
              │  HOVER (100%)  │  │  DRAG TRACKING   │
              │  Sub-buttons   │  │  (5px threshold) │
              │  revealed      │  └────┬────────┬────┘
              └────────────────┘       │        │
                              moved>5px│        │ released<5px
                                       ▼        ▼
                          ┌──────────────┐  ┌──────────────┐
                          │   DRAGGING   │  │    CLICK      │
                          │  cursor:move │  │ (toggle based │
                          │  follows Y   │  │  on setting)  │
                          └──────┬───────┘  └──────────────┘
                                 │ mouseUp
                                 ▼
                          ┌──────────────┐
                          │ PERSIST POS  │
                          │ → storage    │
                          └──────────────┘
```

## 6. Config Schema

```typescript
floatingButton: {
  enabled: boolean                        // Global on/off (default: true)
  position: number                        // 0-1 viewport height ratio (default: 0.66)
  disabledFloatingButtonPatterns: string[] // Domain patterns (default: [])
  clickAction: "panel" | "translate"      // Main button click behavior (default: "translate")
}
```

## 7. Drag Implementation Detail

1. `onMouseDown` records `initialClientY`, sets `isDraggingButton = true`
2. Tracks `mousemove`; if distance > 5px → `hasMoved = true` (click vs drag)
3. During drag: `newY = initialY + deltaY`, clamped `[30px, innerHeight - 200]`
4. Converts to ratio: `newY / window.innerHeight`, stored in local state
5. On `mouseUp`: sets `isDraggingButton = false`
6. Effect watches `isDragging === false && dragPosition !== null` → persists to config
7. During drag: `document.body.style.userSelect = "none"` prevents text selection

## 8. Communication Pattern

| Direction | Message | Purpose |
|-----------|---------|---------|
| Content → BG | `tryToSetEnablePageTranslationOnContentScript` | Toggle translation |
| Content → BG | `openOptionsPage` | Open options |
| BG → Content | `notifyTranslationStateChanged` | Sync translation state |
| Content → BG | `getEnablePageTranslationFromContentScript` | Initial state fetch |

## 9. UI Sizing & Styling

| Element | Size | Shape | Colors |
|---------|------|-------|--------|
| Main button | 40×60px (`h-10 w-15`) | Left-rounded pill | White bg, border, shadow |
| Sub-buttons | ~32px (icon 5×5 = 20px + padding) | Circle | White bg, border |
| X close | ~12px (icon 3×3) | Circle | Neutral colors |
| Active badge | ~12px (icon 3×3) | Circle | Green (#22c55e) |

**Z-index**: `2147483647` (max 32-bit)
**Transitions**: `duration-300` for all opacity/translate animations

## 10. Per-Site Disable Logic

```typescript
// On render: check if floating button should be hidden for current site
const isDisabled = disabledPatterns.some(
    pattern => matchDomainPattern(window.location.hostname, pattern)
);
// matchDomainPattern: exact match OR subdomain match (pattern "gmail.com" matches "mail.gmail.com")
```

Adding from X dropdown: pushes `window.location.hostname` to `disabledFloatingButtonPatterns[]`.
