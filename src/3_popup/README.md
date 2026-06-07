Last updated on: 2026-06-07

# 3_popup

Extension popup UI that lets users configure translation settings and displays full-page translation quota status.

## Entry Points

| File | Kind | Role |
|------|------|------|
| `index.ts` | **UI coordinator** | Orchestrates popup initialization: i18n, settings load, event wiring, quota display, tooltip setup, and provider select injection |
| `index.html` | **HTML entry** | Popup page loaded by Chrome when the toolbar icon is clicked; references `index.ts` via script tag |

## Files

**modules/**
- `settingsManager.ts` — loads settings from storage into DOM controls, saves individual setting changes, manages `enableTapWord` master toggle (disables/enables dependent controls, auto-restores trigger options if all become off)
- `quotaDisplay.ts` — renders the full-page translation quota progress bar; shows cached data immediately then fetches fresh data from background via `QUOTA_USAGE_REQUEST`; hides quota section for non-official providers; tracks fallback-exhausted state
- `websiteLinkManager.ts` — fetches `POPUP_BOOTSTRAP_REQUEST` from background to get website URL and update availability; highlights update link with `update-available` CSS class when a newer version exists
- `tooltipManager.ts` — portal-based tooltip renderer (appends single `div` to `body`) that positions tooltips above/below `.help-icon` anchors with viewport-clamping; reads tooltip text from `data-tooltip` attribute
- `toastManager.ts` — shows and auto-dismisses (3 s) inline notification toasts with `info | success | warning` types; only one toast active at a time; used by `settingsManager` on save feedback
- `debugUtils.ts` — `logDimensions(phase)` utility that dumps key popup element sizes to the logger; diagnostic-only, not called in production flows

**styles/**
- `popup.css` — all popup styling including `.popup-container`, `.setting-item`, `.is-disabled`, `.section-master-off`, `.popup-tooltip-portal`, and quota progress bar color states

## Key Flows

### Popup open — initialization
```
index.ts initialize()
  → i18nModule.initI18n() + applyTranslations()       # localize all data-i18n-key elements
  → settingsManager.loadSettings()                     # read storage → populate checkboxes/selects
  → setupFullTranslateButton()                         # wire full-page translate toggle, returns reset fn
  → settingsManager.setupSettingChangeListeners()      # change events on all [data-setting] inputs
  → tooltipManager.setupTooltipClickHandlers()         # click-to-show tooltips on .help-icon
  → setupFloatingButtonToggle()                        # floating button config sync
  → quotaDisplay.initQuotaDisplay()                    # render cached quota, then fetch fresh from BG
  → setupFullPageProviderSelect()                      # inject custom providers, wire provider change
  → document.documentElement.classList.remove("loading")
```

### Provider change → quota update
```
fullPageTranslationProvider <select> change
  → if "__add_provider__" sentinel selected → open options page, revert select
  → storageManager.updateUserSettings({ fullPageTranslationProvider })
  → quotaDisplay.updateForProvider(newValue)           # hide/show quota section per provider type
```

### Full-page translate toggle
```
fullTranslateButton click
  → chrome.tabs.sendMessage(FULL_TRANSLATE_STATUS_REQUEST)  # query current page state
  → if active → send FULL_TRANSLATE_TOGGLE{ enable: false }
  → if inactive → send FULL_TRANSLATE_TOGGLE{ enable: true }
  → update button text/state from response
```

## Key Contracts

- **`loading` class gates content visibility.** `document.documentElement` starts with class `loading`; it is removed only at the end of `initialize()`. Removing it early will flash unstyled/uninitialized controls.
- **`data-setting` attribute drives generic listeners.** All `<input type="checkbox">` and `<select>` elements that should auto-save must have a `data-setting` attribute matching a key in `UserSettings`. Adding a new setting to the UI requires adding this attribute — no manual event wiring needed.
- **Auto-restore prevents all-triggers-off state.** `settingsManager.restoreDependentTogglesIfAllOff()` re-enables `showIcon` and `singleClickTranslate` if all three trigger mechanisms are simultaneously off. Never remove this guard without an equivalent safeguard.
- **`APP_EDITION` attribute controls edition-specific UI.** `data-app-edition` is set on `<html>` before any rendering; CSS rules gate visibility of audio/speech settings in community builds. Read this attribute; do not query `APP_EDITION` inside modules.
- **Quota display uses a local cache key (`quotaDisplayCache`) in `chrome.storage.local`.** Stale cache is shown instantly; fresh data replaces it asynchronously. Do not remove the cache path — it prevents a flash of empty quota bar on every open.
- **`__add_provider__` is a sentinel option value, not a real provider ID.** `setupFullPageProviderSelect` intercepts it to redirect to the options page. Never persist it as the current provider.

## Module Boundaries

- ✅ May be imported by: nothing (this is a terminal UI module, loaded only by `index.html`)
- ❌ Must NOT import from: `1_content`, `2_background` (content/background layers); any module that imports Chrome service-worker-only APIs. All background communication must go through `chrome.runtime.sendMessage`.
