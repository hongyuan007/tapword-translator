# Font Size Default Change — Technical Spec

**Date:** 2026-05-04  
**Branch context:** `feat/260306/auto-translate`  
**Goal:** Change the default word-translation tooltip font size from `medium` (12 px) to `large` (14 px) for **both** new users and existing users who haven't manually changed the setting.

---

## 1. Current State Analysis

### 1.1 Preset definitions

File: `src/0_common/constants/translationFontSize.ts`

```
TRANSLATION_FONT_SIZE_MAP:
  small      →  10 px
  medium     →  12 px   ← current default
  large      →  14 px   ← proposed new default
  extraLarge →  16 px
```

```ts
export const DEFAULT_TRANSLATION_FONT_SIZE_PRESET: TranslationFontSizePreset = "medium"
```

### 1.2 UserSettings type and default object

File: `src/0_common/types/index.ts`

| Field | Type | Current Default |
|---|---|---|
| `translationFontSizePreset` | `TranslationFontSizePreset` | `"medium"` |
| `translationFontSize` | `number` | `10` (stale — overwritten by `resolveTranslationFontSize`) |

`DEFAULT_USER_SETTINGS` (line ~411–424):
```ts
translationFontSizePreset: "medium",
translationFontSize: 10,   // effectively unused; resolved by normalizeUserSettings
```

**Note:** `translationFontSize` in `DEFAULT_USER_SETTINGS` is `10` but this value is never used as-is; `normalizeUserSettings` always calls `resolveTranslationFontSize(preset)` to recompute it from the preset.

### 1.3 How `getUserSettings()` works

File: `src/0_common/utils/storageManager.ts`

1. **New user** (no stored data): calls `normalizeUserSettings({ targetLanguage })` → spreads `DEFAULT_USER_SETTINGS` → preset is `"medium"`, px is `12`.
2. **Existing user**: reads stored `Partial<UserSettings>` → calls `normalizeUserSettings(storedSettings)` → spreads `DEFAULT_USER_SETTINGS` first, then overlays stored values → if user has `translationFontSizePreset: "medium"` stored, they stay at `medium`.

`normalizeUserSettings` resolves font size like this:
```ts
const resolvedFont = resolveTranslationFontSize(mergedSettings.translationFontSizePreset)
// resolvedFont.preset = stored preset or DEFAULT
// resolvedFont.px    = TRANSLATION_FONT_SIZE_MAP[preset]
```

### 1.4 UI exposure

- `src/3_popup/index.html` — `<select id="translationFontSizePreset">` with options: small / medium / large / extraLarge
- `src/4_options/index.html` — same select

### 1.5 No existing migration infrastructure

`UserSettings` has **no** `settingsVersion` or `migrationFlags` field. The only migration pattern in `normalizeUserSettings` today is a hard-coded behavioural override for the `doubleClickTranslateV2` key.

---

## 2. Proposed Changes

### 2.1 Target new default value

`large` = **14 px**

### 2.2 Files to change

#### A. `src/0_common/constants/translationFontSize.ts`

```diff
-export const DEFAULT_TRANSLATION_FONT_SIZE_PRESET: TranslationFontSizePreset = "medium"
+export const DEFAULT_TRANSLATION_FONT_SIZE_PRESET: TranslationFontSizePreset = "large"
```

#### B. `src/0_common/types/index.ts` — `DEFAULT_USER_SETTINGS`

```diff
-  translationFontSizePreset: "medium",
-  translationFontSize: 10,
+  translationFontSizePreset: "large",
+  translationFontSize: 14,
```

> `translationFontSize` is technically ignored at runtime (always resolved), but keeping it consistent avoids confusion.

### 2.3 Migration strategy for existing users

#### Problem

Existing users who never touched the font size setting have `translationFontSizePreset: "medium"` **explicitly persisted** in `chrome.storage.sync`. When `normalizeUserSettings` merges stored data over `DEFAULT_USER_SETTINGS`, the stored `"medium"` wins — the new default has no effect on them.

#### Chosen strategy: `settingsVersion`-based one-shot migration

Add a `settingsVersion` integer field to `UserSettings`. When the stored version is below the target version, apply the migration in `normalizeUserSettings`.

##### Step 1 — Add `settingsVersion` to the type

File: `src/0_common/types/index.ts`

```ts
// In UserSettings interface
settingsVersion?: number   // undefined = pre-versioning (legacy)
```

```ts
// In DEFAULT_USER_SETTINGS
settingsVersion: 2,   // increment whenever a migration is applied
```

##### Step 2 — Define the migration constant

File: `src/0_common/constants/translationFontSize.ts` (or a new `constants/migrations.ts`)

```ts
export const SETTINGS_VERSION_LARGE_FONT_DEFAULT = 2
export const OLD_DEFAULT_FONT_SIZE_PRESET = "medium" as const
```

##### Step 3 — Apply migration in `normalizeUserSettings`

File: `src/0_common/utils/storageManager.ts`

Inside `normalizeUserSettings`, **before** building `mergedSettings`, add:

```ts
// [Migration v2] Upgrade users whose font was still at the old "medium" default
const storedVersion = settings.settingsVersion ?? 0
let migratedSettings = { ...settings }

if (
    storedVersion < SETTINGS_VERSION_LARGE_FONT_DEFAULT &&
    migratedSettings.translationFontSizePreset === OLD_DEFAULT_FONT_SIZE_PRESET
) {
    // User never changed from old default — bump them to the new default
    migratedSettings.translationFontSizePreset = "large"
    migratedSettings.settingsVersion = SETTINGS_VERSION_LARGE_FONT_DEFAULT
}
```

Then replace `settings` with `migratedSettings` in the rest of the function.

Because `normalizeUserSettings` is called by both `getUserSettings` and `saveUserSettings`, the migration fires at every read and the corrected value gets persisted on the next save.

#### Alternative considered: skip migration, only change default

Changing only `DEFAULT_TRANSLATION_FONT_SIZE_PRESET` and `DEFAULT_USER_SETTINGS` would help **new users only**. Existing users who had never touched the setting keep `"medium"` permanently. Rejected because the goal is to upgrade all users.

#### Alternative considered: always-override (no version check)

Forcibly set every existing-`"medium"` user to `"large"` without a version guard. Risk: users who deliberately chose `"medium"` get silently upgraded. Rejected.

---

## 3. Risks and Edge Cases

| Risk | Severity | Mitigation |
|---|---|---|
| Users who explicitly chose `"medium"` get silently upgraded | Medium | The version guard means only users on `settingsVersion < 2` are touched. New installs start at version 2, so once a user has saved settings post-migration they are protected. |
| `settingsVersion` field adds chrome.storage sync bytes | Low | A single integer ≈ negligible against the 8 KB quota. |
| `translationFontSize` legacy field in old stored data | Low | Already overwritten at every `normalizeUserSettings` call via `resolveTranslationFontSize`. No action needed. |
| TypeScript type breaking change (`settingsVersion` optional) | Low | Declared as `number | undefined` with `?`; all spread logic tolerates it. |
| Unit tests for `normalizeUserSettings` may hard-code `"medium"` expectations | Medium | Must audit `tests/0_common/` and update expected defaults. |

---

## 4. Verification Plan

### 4.1 New user
1. Clear all extension storage.
2. Install / reload extension.
3. Open popup → Font Size should show `Large` (14 px).
4. Translate any word → tooltip should render at 14 px.

### 4.2 Existing user — never changed font size (migration path)
1. Seed `chrome.storage.sync` with `{ translationFontSizePreset: "medium", settingsVersion: undefined }` (simulates old data with no version).
2. Reload extension.
3. Call `getUserSettings()` — returned preset must be `"large"`.
4. Verify popup shows `Large`.

### 4.3 Existing user — explicitly set `medium`
1. Seed storage with `{ translationFontSizePreset: "medium", settingsVersion: 2 }` (version already migrated, user re-selected medium intentionally).
2. Reload extension.
3. Returned preset must remain `"medium"`.

### 4.4 Existing user — already on `large` or higher
1. Seed storage with `{ translationFontSizePreset: "large" }` (no version).
2. Migration condition (`preset === "medium"`) is false → no change.
3. Returned preset must be `"large"`.

### 4.5 Unit test coverage
- `tests/0_common/storageManager.test.ts` (or equivalent) — add cases for migration v2.
- Verify `DEFAULT_TRANSLATION_FONT_SIZE_PRESET` export equals `"large"`.

---

## 5. Implementation Checklist

- [ ] `src/0_common/constants/translationFontSize.ts` — change `DEFAULT_TRANSLATION_FONT_SIZE_PRESET` to `"large"`; add `SETTINGS_VERSION_LARGE_FONT_DEFAULT` and `OLD_DEFAULT_FONT_SIZE_PRESET` constants
- [ ] `src/0_common/types/index.ts` — add `settingsVersion?: number` to `UserSettings`; update `DEFAULT_USER_SETTINGS` preset to `"large"`, px to `14`, `settingsVersion` to `2`
- [ ] `src/0_common/utils/storageManager.ts` — add migration block in `normalizeUserSettings`
- [ ] Update/add unit tests for new migration path
- [ ] Manual QA per verification plan (§4)
