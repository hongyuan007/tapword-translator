Last updated on: 2026-06-07

# 12_floating_button

Floating ball button fixed to the right edge of web pages that provides a one-click trigger for full-text translation, with draggable position, visual state feedback, and per-site or global disable options.

## Entry Points

| File | Kind | Role |
|------|------|------|
| `FloatingButtonManager.ts` | **Core class** | Top-level orchestrator — the only class the content script instantiates; call `initialize()` then `setTranslationState()` |
| `index.ts` | **Barrel** | Re-exports all public types, constants, and classes; external callers must import exclusively from here |

## Files

**root/**
- `FloatingButtonManager.ts` — lifecycle orchestrator: loads config, creates DOM, wires up drag/close handlers, handles cross-context config changes and button recreation
- `types.ts` — `FloatingButtonConfig`, `FloatingButtonState` (`idle | translating | active | quota_exhausted`), `IconVariant` (`v1`–`v6`), `ConfigChangeCallback`
- `constants.ts` — storage key, `DEFAULT_CONFIG`, `CSS_PREFIX` (`tw-fab`), `Z_INDEX` (max int), drag thresholds, and all CSS class name constants
- `index.ts` — public barrel; explicitly exports types, constants, `FloatingButtonManager`, and `FloatingButtonConfigStore`

**config/**
- `FloatingButtonConfigStore.ts` — reads/writes `FloatingButtonConfig` in `chrome.storage.local`; provides `addDisabledSite()`, `setEnabled()`, `setPosition()`, hostname match check, and `onChanged()` cross-context listener

**handlers/**
- `DragHandler.ts` — vertical drag with 5 px click-vs-drag threshold; fires `onClick` on tap, `onDragEnd` with viewport ratio on release; suppresses text selection during drag
- `CloseMenuHandler.ts` — X button toggle that opens a dropdown with "Disable on this site" / "Disable globally"; persists via `FloatingButtonConfigStore`; `mousedown` on X is stopped to prevent parent drag

**ui/**
- `FloatingButtonRenderer.ts` — builds the DOM tree (container → main button → active/exhausted badges + spinner + close button + dropdown), injects the `<style>` tag, manages visual state and position
- `styles.ts` — CSS string constant injected as a `<style>` tag; all classes use `tw-fab-*` prefix; includes print hide, hover transition, and spinner keyframe
- `iconVariants.ts` — `ICON_VARIANTS` map: six inline-SVG functions keyed by `IconVariant`; v2 uses `colorUtils` for gradient generation; v5 has a hardcoded gold star accent
- `colorUtils.ts` — HSL-based `lightenHex` / `darkenHex` helpers used exclusively by `iconVariants.ts` for v2 gradient

## Key Flows

### Initialization
```
FloatingButtonManager.initialize(onToggleTranslation)
  → FloatingButtonConfigStore.load()              # merge stored config with DEFAULT_CONFIG
  → isRenderableContext()                         # abort if non-HTTP or site disabled
  → FloatingButtonRenderer.create(variant, color) # build DOM, inject styles
  → renderer.hide() then setPosition()            # prevent flash-of-content
  → document.body.appendChild(container)
  → renderer.show()                               # only if config.enabled === true
  → DragHandler.attach()                          # listen on main button mousedown
  → CloseMenuHandler.attach()                     # listen on close button click
  → FloatingButtonConfigStore.onChanged()         # register cross-context sync listener
```

### Cross-context config update (popup / options page)
```
chrome.storage.onChanged fires
  → FloatingButtonConfigStore notifies Manager via handleConfigChanged(updatedConfig)
      → if !enabled: renderer.hide()
      → if variant/color changed: recreateButton()  # full DOM rebuild + re-attach DragHandler
      → else: renderer.setPosition() + renderer.show()
```

### User drag → position persisted
```
DragHandler mousedown → mousemove > 5px → onDragStart (renderer.setDragging(true))
  → mousemove: onDragMove(ratio) → renderer.setPosition(ratio)   # live update
  → mouseup: onDragEnd(ratio)
      → renderer.setDragging(false)
      → FloatingButtonConfigStore.setPosition(ratio)              # persisted to storage
```

## Key Contracts

- **Position is stored as a 0–1 viewport-height ratio**, not pixels. Converting to `px` happens only in `FloatingButtonRenderer.setPosition()`.
- **`DEFAULT_CONFIG.enabled` is `false`**. The button is opt-in; newly installed users see nothing until they toggle it on.
- **`isRenderableContext()` is checked before DOM creation**, not before `show()`. The DOM is never created for non-HTTP pages or disabled sites, so `destroy()` can be safely called even if `initialize()` returned early.
- **Icon variant changes require a full DOM rebuild** (`recreateButton()`). The SVG is baked into `innerHTML` at creation time; there is no live re-render path.
- **`CloseMenuHandler` calls `e.stopPropagation()` on `mousedown` of the X button** to prevent `DragHandler` from triggering. Any new clickable child added to the container must do the same.
- **All CSS classes use the `tw-fab-*` prefix** (from `CSS_PREFIX`). Never introduce bare class names or IDs to avoid collisions with host-page styles.

## Module Boundaries

- ✅ May be imported by: `1_content`, `3_popup`, `4_options`
- ❌ Must NOT import from: `1_content`, `2_background`, `6_translate`, `7_speech`, `8_generate` — this is a pure UI/config component with no knowledge of translation business logic
