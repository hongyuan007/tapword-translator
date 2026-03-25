# Auto-Hide Floating Button on Quota Exhaustion

## Task ID: m03-auto-hide-quota

## Status: Complete

## Description
When the user's free translation quota is exhausted, the floating button auto-hides after a short delay (3s). This behavior is **enabled by default** and can be toggled from the Options page under General settings.

## Approach (Simplified)
- Default `autoHideOnQuotaExhausted` changed to `true` — auto-hide is on for all users out of the box
- Removed the conditional close-menu item that previously let users opt in from the dropdown
- Added a toggle on the Options page (General section) so users can disable auto-hide if desired
- The runtime auto-hide logic in `FloatingButtonManager.setTranslationState()` remains unchanged

## Progress
- [x] Research phase completed
- [x] Spec document created
- [x] Initial implementation (close-menu approach)
- [x] Simplified: reverted close-menu changes, default to true, added options page toggle
- [x] Verification passed
