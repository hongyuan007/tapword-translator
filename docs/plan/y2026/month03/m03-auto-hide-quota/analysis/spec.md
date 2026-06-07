# Spec: Auto-Hide Floating Button on Quota Exhaustion

## Requirement
When quota is exhausted, allow users to opt into auto-hiding the floating button. This is an opt-in behavior accessed via a conditional close menu item.

## UX Flow

### Close Menu Item
- A third item "Auto-hide when quota runs out" appears **only** when button state is `quota_exhausted`.
- Clicking it:
  1. Saves `autoHideOnQuotaExhausted: true` to config
  2. Immediately hides the floating button via `renderer.hide()`
  3. Closes the dropdown

### Subsequent Behavior  
- When quota runs out during translation (or pre-check), if `autoHideOnQuotaExhausted` is `true`:
  - Button enters `quota_exhausted` state (badge shown)
  - After a delay (AUTO_HIDE_DELAY_MS = 3000ms), button auto-hides via `renderer.hide()`
- When quota is NOT exhausted, button behaves normally regardless of the flag.

### Reset
- The flag persists until user explicitly changes it. On next session/page load, if quota is available, button shows normally. If quota is exhausted again and flag is true, auto-hide triggers.

## Changes

### 1. types.ts
Add `autoHideOnQuotaExhausted: boolean` to `FloatingButtonConfig`.

### 2. constants.ts
Add default `autoHideOnQuotaExhausted: false` to `DEFAULT_CONFIG`.
Add `AUTO_HIDE_DELAY_MS = 3000`.

### 3. CloseMenuHandler.ts
- Accept `getCurrentState: () => FloatingButtonState` in constructor (to check if quota is exhausted).
- In `buildDropdownItems()`, conditionally add a third button when state is `quota_exhausted`.
- Click handler: save config flag, call `onDisable()` to hide immediately.

### 4. FloatingButtonManager.ts
- Pass `getCurrentState` to CloseMenuHandler (returns `this.currentState`).
- In `setTranslationState()`: when state is `quota_exhausted` and config flag is true, schedule `renderer.hide()` after delay.
- Store timeout ID for cleanup.

### 5. i18n (all 8 locales)
Add key `popup.floatingButton.autoHideQuota` with appropriate translations.

## Files Modified
| File | Change |
|------|--------|
| src/12_floating_button/types.ts | Add config field |
| src/12_floating_button/constants.ts | Add default + delay constant |
| src/12_floating_button/handlers/CloseMenuHandler.ts | Add conditional menu item |
| src/12_floating_button/FloatingButtonManager.ts | Add auto-hide delay logic |
| src/0_common/locales/en.json | Add i18n key |
| src/0_common/locales/zh.json | Add i18n key |
| src/0_common/locales/de.json | Add i18n key |
| src/0_common/locales/es.json | Add i18n key |
| src/0_common/locales/fr.json | Add i18n key |
| src/0_common/locales/ja.json | Add i18n key |
| src/0_common/locales/ko.json | Add i18n key |
| src/0_common/locales/ru.json | Add i18n key |
