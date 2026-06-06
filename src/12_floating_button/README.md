Last updated on: 2026-03-20

# 12_floating_button: Floating Ball Button Module

## Module Overview

This module implements a floating ball button that hovers on the right edge of web pages, providing a one-click trigger for full-text translation without opening the extension popup. It displays visual state feedback (idle, translating, active), supports vertical dragging with position persistence, and offers quick disable options via a dropdown menu.

## File Structure

```
12_floating_button/
├── README.md                               # This document
├── index.ts                                # Public API barrel — re-exports types, constants, core classes
├── types.ts                                # FloatingButtonConfig, FloatingButtonState type definitions
├── constants.ts                            # Storage keys, CSS prefixes, dimensions, thresholds
├── FloatingButtonManager.ts                # Top-level orchestrator (lifecycle, coordination)
├── config/
│   └── FloatingButtonConfigStore.ts        # chrome.storage.local read/write with cross-context sync
├── handlers/
│   ├── DragHandler.ts                      # Vertical drag with click-vs-drag threshold
│   └── CloseMenuHandler.ts                 # X button + dropdown menu (disable site/globally)
└── ui/
    ├── FloatingButtonRenderer.ts           # DOM creation, style injection, visual state management
    └── styles.ts                           # CSS string constant (injected via <style> tag)
```

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     FloatingButtonManager                        │
│  (Orchestrator — lifecycle, config, handler coordination)        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌── Config ──────────────────────────────────────────────┐     │
│  │  FloatingButtonConfigStore                              │     │
│  │  • load/save from chrome.storage.local                  │     │
│  │  • cross-context change listener                        │     │
│  │  • disabled-site hostname matching                      │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌── UI ──────────────────────────────────────────────────┐     │
│  │  FloatingButtonRenderer                                 │     │
│  │  • DOM tree creation (container > main button > badges) │     │
│  │  • <style> tag injection (tw-fab-* classes)             │     │
│  │  • Visual state: idle / translating / active            │     │
│  │  • Position management (viewport ratio)                 │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌── Handlers ────────────────────────────────────────────┐     │
│  │  DragHandler                                            │     │
│  │  • mousedown → mousemove → mouseup on document          │     │
│  │  • 5px threshold to distinguish click from drag         │     │
│  │  • Position clamped to [30px, innerHeight - 100px]      │     │
│  │                                                         │     │
│  │  CloseMenuHandler                                       │     │
│  │  • X button click → dropdown toggle                     │     │
│  │  • "Disable on this site" / "Disable globally"          │     │
│  │  • Click-outside to dismiss                             │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Entry Point (`index.ts`)

Barrel file providing the module's public API. External consumers (e.g., content script) import from `@/12_floating_button` and never reach into sub-files directly.

### 2. FloatingButtonManager (`FloatingButtonManager.ts`)

The top-level orchestrator. Manages the full lifecycle:

- **`initialize(onToggleTranslation)`**: Loads config, checks visibility (enabled, not disabled for site, HTTP/HTTPS page), creates DOM, attaches handlers, listens for cross-context changes.
- **`setTranslationState(state)`**: Updates visual indicators (idle → translating → active).
- **`destroy()`**: Tears down all listeners, removes DOM elements.

### 3. Config Store (`config/FloatingButtonConfigStore.ts`)

Manages persistent configuration via `chrome.storage.local`:

| Method | Purpose |
|--------|---------|
| `load()` | Read config from storage, merge with defaults |
| `save(partial)` | Write partial config update |
| `addDisabledSite(hostname)` | Append hostname to disabled list |
| `setEnabled(enabled)` | Toggle global visibility |
| `setPosition(position)` | Persist drag position |
| `isDisabledForSite(hostname)` | Check hostname match (exact or subdomain) |
| `onChanged(callback)` | Listen for cross-context changes |

### 4. UI Renderer (`ui/FloatingButtonRenderer.ts`)

Creates and manages the DOM tree:

```
.tw-fab-container (fixed, right: 0)
  └── .tw-fab-main (pill button, left-rounded)
       ├── SVG translate icon
       ├── .tw-fab-close (X button, top-left corner)
       ├── .tw-fab-badge (green checkmark, bottom-right)
       ├── .tw-fab-spinner (loading indicator, bottom-right)
       └── .tw-fab-dropdown (menu, positioned left of button)
            ├── .tw-fab-dropdown-item ("Disable on this site")
            └── .tw-fab-dropdown-item ("Disable globally")
```

### 5. Styles (`ui/styles.ts`)

CSS injected via a `<style>` tag. All classes prefixed with `tw-fab-`. Includes:
- Print media query (hidden when printing)
- Hover transitions (opacity 0.6 → 1.0, translateX slide-in)
- Drag visual state (cursor: move, no transition)
- Spinner keyframe animation

### 6. DragHandler (`handlers/DragHandler.ts`)

Handles vertical dragging along the right edge:
1. `mousedown` on main button → record start position
2. `mousemove` on document → if moved > 5px, enter drag mode
3. `mouseup` → if dragged: persist position; if not: fire click callback
4. During drag: `document.body.style.userSelect = 'none'`

### 7. CloseMenuHandler (`handlers/CloseMenuHandler.ts`)

Manages the X button and its dropdown:
- Click X → toggle dropdown visibility
- "Disable on this site" → `configStore.addDisabledSite(hostname)`
- "Disable globally" → `configStore.setEnabled(false)`
- Click outside → close dropdown
- `mousedown` on X button is stopped to prevent parent drag

## State Machine

```
┌─────────────────────────────────────┐
│ Global/Per-site disabled → HIDDEN   │
└──────────────┬──────────────────────┘
               │ enabled && !disabled
               ▼
┌──────────────────────┐
│       IDLE           │  60% opacity, partially hidden (translateX 8px)
└──────────┬───────────┘
           │ click
           ▼
┌──────────────────────┐
│     TRANSLATING      │  Spinner badge visible
└──────────┬───────────┘
           │ translation complete
           ▼
┌──────────────────────┐
│   BILINGUAL ACTIVE   │  Green checkmark badge visible
└──────────┬───────────┘
           │ click (stop)
           ▼
           IDLE
```

## Integration Points

### Content Script (`1_content`)
The `FloatingButtonManager` is instantiated and initialized from the content script. The content script provides the `onToggleTranslation` callback that triggers the same flow as the popup's "Translate Page" button.

### Full-Text Translation (`11_full_translate`)
The button reflects translation state by receiving `setTranslationState()` calls from the content script when translation starts, completes, or stops.

### Cross-Context Sync
Config changes from the popup or options page are detected via `chrome.storage.onChanged` and automatically update the button's visibility and position.

## Usage Example

```typescript
import { FloatingButtonManager } from '@/12_floating_button';

const manager = new FloatingButtonManager();

await manager.initialize(() => {
    // Toggle full-text translation
    toggleFullTranslation();
});

// Update state when translation starts
manager.setTranslationState('translating');

// Update state when translation completes
manager.setTranslationState('active');

// Clean up
manager.destroy();
```
