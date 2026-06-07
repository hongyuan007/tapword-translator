# Font Size Default Change — Progress

**Date:** 2026-05-04

## Status: Implementation Complete (pending manual QA)

---

## Changes Made

### `src/0_common/constants/translationFontSize.ts`
- Changed `DEFAULT_TRANSLATION_FONT_SIZE_PRESET` from `"medium"` to `"large"`
- Added `SETTINGS_VERSION_LARGE_FONT_DEFAULT = 2`
- Added `OLD_DEFAULT_FONT_SIZE_PRESET = "medium" as const`

### `src/0_common/types/index.ts`
- Added `settingsVersion?: number` field to `UserSettings` interface
- Updated `DEFAULT_USER_SETTINGS.translationFontSizePreset` from `"medium"` to `"large"`
- Updated `DEFAULT_USER_SETTINGS.translationFontSize` from `10` to `14`
- Added `DEFAULT_USER_SETTINGS.settingsVersion = 2`

### `src/0_common/utils/storageManager.ts`
- Added migration block at the start of `normalizeUserSettings`, before `mergedSettings` is built
- Migration condition: `storedVersion < 2 && preset === "medium"` → upgrades preset to `"large"` and sets `settingsVersion = 2`
- `mergedSettings` now spreads `migratedSettings` instead of raw `settings`

---

## Implementation Decisions

- No deviations from spec. The migration constants are placed in `translationFontSize.ts` as suggested (option 1 in spec), rather than a separate `constants/migrations.ts`.
- `settingsVersion` is passed through to the return value implicitly via the `...mergedSettings` spread in the `return` statement — no additional override needed.

---

## Remaining

- [ ] Unit tests for migration v2 (spec §4.5)
- [ ] Manual QA per verification plan (spec §4.1–4.4)
