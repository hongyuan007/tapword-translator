# Floating Button — Progress Tracker

**Task ID**: m03-floating-button
**Branch**: `feat/260306/auto-translate` (or new branch TBD)
**Created**: 2026-03-20

---

## Task Breakdown

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | **Research**: read-frog floating button analysis | ✅ Done | `analysis/260320_readfrog_floating_button_research.md` |
| 2 | **Spec**: Requirements specification | ✅ Done | `analysis/260320_requirements_spec.md` |
| 3 | **Module scaffold**: Create `src/12_floating_button/` with types, constants, README | Not started | — |
| 4 | **Config & storage**: FloatingButtonConfig type, storage read/write, defaults | Not started | `chrome.storage.local` |
| 5 | **DOM rendering**: Create floating ball element, styles, inject into page | Not started | Position: fixed, right edge, z-max |
| 6 | **Visual states**: Idle (60% opacity, shifted right) → hover (100%, slide in) → active (badge) | Not started | CSS transitions |
| 7 | **Click handler**: Toggle full-text translation on click | Not started | Reuse existing message flow |
| 8 | **State sync**: Listen for translation state changes, update badge | Not started | — |
| 9 | **Drag behavior**: Vertical drag with 5px threshold, position persistence | Not started | mousedown/move/up handlers |
| 10 | **Close menu**: X button + dropdown (disable site / disable globally) | Not started | — |
| 11 | **Per-site disable**: Hostname matching, storage of disabled sites | Not started | — |
| 12 | **Content script integration**: Initialize on DOM ready, cleanup on invalidation | Not started | Wire into `1_content` |
| 13 | **Popup integration**: Sync state with popup's translate button | Not started | — |
| 14 | **Type-check & build verification** | Not started | — |

## Dependencies
- Full-text translation module (`src/11_full_translate/`) — must be functional
- Background message router (`src/2_background/`) — existing infrastructure
- Popup translate button (`src/3_popup/`) — state sync

## Key Decisions
- **v1 scope**: No Shadow DOM, no dark mode, no side panel, no configurable click actions
- **Architecture**: Vanilla TS + DOM (no React), CSS class prefix `tw-fab-*`
- **Storage key**: `floatingButtonConfig` in `chrome.storage.local`
