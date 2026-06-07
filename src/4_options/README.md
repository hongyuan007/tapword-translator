Last updated on: 2026-06-07

# 4_options

Renders and manages the extension's full-page settings UI, persisting all user preferences to `chrome.storage` via `storageManager`.

## Entry Points

| File | Kind | Role |
|------|------|------|
| `index.html` | **UI structure** | Complete HTML markup for the options page; defines all form controls with `data-setting` and `data-i18n-key` attributes |
| `index.ts` | **Script entry / UI coordinator** | Called on `DOMContentLoaded`; orchestrates i18n, settings load, all preview systems, navigation, and floating-button pickers |

## Files

**/** (root)
- `index.ts` — page entry point; coordinates init order: i18n → community overrides → settings load → event listeners → translation engine section → color pickers → tooltip preview → appearance preview → navigation → version display
- `index.html` — settings page markup; six sections (General, Appearance, Translation Engine, Text, Audio, Advanced) accessed via sidebar nav; uses `data-setting` for auto-binding and hash-based deep-linking
- `styles.css` — options page stylesheet; uses CSS variables, custom range slider fill via `--range-progress`, and custom `.custom-select-wrapper` dropdown styling

**modules/**
- `settingsManager.ts` — loads all `UserSettings` from storage into DOM controls, saves individual setting changes, sets up `data-setting` change listeners, manages custom select dropdowns, and enforces business rules (single/double-click mutual exclusion, community auto-play lock, trigger restore guard)
- `translationEngineManager.ts` — initializes the Translation Engine section: renders the custom AI provider CRUD list, syncs provider options into both `<select>` elements, and handles add/edit/delete/test flows for `CustomAiProvider` entries

## Key Flows

### Page initialization
```
DOMContentLoaded → initializeOptions()
  → i18nModule.applyTranslations()
  → applyCommunityUiOverrides()          # hides connection card, disables audio in community build
  → settingsManagerModule.loadSettings() # populates all data-setting controls from storage
  → settingsManagerModule.setupSettingChangeListeners()
  → settingsManagerModule.setupCustomSelects()
  → translationEngineManagerModule.initTranslationEngineSection()
  → initFloatingButtonColorPicker() / initIconVariantPicker()
  → setupTooltipSpacingPreview()         # live inline-text spacing preview with rAF positioning
  → updateAppearancePreview()            # FAB + color swatch side-by-side preview
  → setupNavigation()                    # sidebar + hash deep-link routing
```

### Custom AI provider save
```
"Save" button click → handleFormSave()
  → reads form fields (name, endpoint, apiKey, model)
  → storageManagerModule.updateUserSettings({ customProviders: [...] })
  → renderProviderList()                 # rebuilds DOM list
  → refreshSelectOptions()              # re-injects options into both provider <select>s
```

### Tooltip spacing live preview
```
slider input / font preset change / resize / settingChange event
  → updatePreview()
    → computePreviewTooltipFontPx()     # derives tooltip font size and required line-height
    → applies font/spacing CSS to preview DOM nodes
    → schedulePosition() via rAF        # skips if preview section is not visible/measurable
      → positionPreviewTooltip()        # centers tooltip over anchor, clamps to stage bounds
```

## Key Contracts

- **`data-setting` attribute drives auto-binding.** `settingsManager.loadSettings()` queries all `[data-setting]` form controls to populate them, and `setupSettingChangeListeners()` attaches `change` handlers to save them. Adding a new setting to the page requires adding this attribute — no manual wiring needed.
- **Single-click / double-click mutual exclusion is enforced in `settingsManager`.** Enabling `singleClickTranslate` programmatically disables `doubleClickTranslateV2` and vice versa. Never set these independently via direct storage calls from this page.
- **`restoreDependentTogglesIfAllOff()` prevents a dead state.** If all four trigger controls (`showIcon`, `singleClickTranslate`, `doubleClickTranslateV2`, `doubleClickSentenceTranslate`) are disabled simultaneously, `showIcon` and `singleClickTranslate` are force-restored. This guard runs on every trigger `change` event.
- **Floating button config (`FloatingButtonConfig`) is stored in `chrome.storage.local` separately from `UserSettings`.** `loadFloatingButtonEnabledSetting` and `saveFloatingButtonColor` / `initIconVariantPicker` access it directly via `floatingButtonConstants` keys, not through the `data-setting` mechanism.
- **Tooltip preview skips positioning when off-screen.** `schedulePosition` checks `offsetParent !== null` and non-zero `getBoundingClientRect` before calling `positionPreviewTooltip`. This prevents incorrect layout calculations when the "Text" section is hidden.
- **Community edition overrides must run before `loadSettings`.** `applyCommunityUiOverrides` disables the auto-play toggle in the DOM before settings are loaded; `lockAutoPlayAudioToggle` inside `loadSettings` re-enforces it. Reversing this order could briefly show the toggle as enabled.

## Module Boundaries

- ✅ May be imported by: nothing — this is a page entry module, not a library
- ❌ Must NOT import from: `1_content`, `2_background`, `3_popup`; must not contain business logic that belongs in `6_translate` or `5_backend`
