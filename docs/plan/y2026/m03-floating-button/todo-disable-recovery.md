# Floating Button Disable Recovery

## Background
- Currently users can disable the floating button globally or per-site via the close menu
- Global disable can be re-enabled via popup checkbox toggle
- Per-site disable has NO recovery UI — once a site is disabled, there's no way to re-enable it without manually editing chrome.storage.local

## TODO Items

### 1. Per-site disable management UI
- Add a list of disabled sites in the Options page (Appearance section)
- Each site should have a "remove" button to re-enable
- Location: Options page → Appearance → below floating button color settings

### 2. Per-site re-enable from close menu
- When visiting a disabled site, consider showing a subtle indicator or providing a way to re-enable
- Optional: Add a "Re-enable on this site" option in the popup when the current site is disabled

### 3. "Disable on all sites" vs "Disable floating button"
- Clarify UX language to distinguish between global disable and per-site disable

## References
- Config store: `src/12_floating_button/config/FloatingButtonConfigStore.ts`
- Close menu: `src/12_floating_button/handlers/CloseMenuHandler.ts`
- Manager: `src/12_floating_button/FloatingButtonManager.ts`
- Popup toggle: `src/3_popup/index.ts`
