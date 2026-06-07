# Remove Legacy Compatibility Logic — Technical Specification

**Date**: 2026-03-07  
**Branch context**: Post-merge of PR #17 (`Huchangzhi/main`)  
**Scope**: Remove backward-compatibility migration that reads legacy `useCustomApi` boolean and converts it to the new `translationProvider` enum.

---

## 1. Background

PR #17 replaced the binary `useCustomApi: boolean` field (stored inside the `customApi` sub-object of `UserSettings`) with a first-class enum field `translationProvider: TranslationProvider`. To avoid breaking existing users who had `useCustomApi: true` saved in storage, the PR added migration logic inside `normalizeUserSettings()`.

The decision has since changed: **old `useCustomApi` data should simply be abandoned**. Users updating the extension will receive the default `translationProvider` value (`"official"`), which is the correct starting point for everyone on a clean read.

---

## 2. New Field Definition

| Property | Type | Default | Location |
|---|---|---|---|
| `translationProvider` | `"official" \| "customApi" \| "mtranserver" \| "bingTranslate"` | `"official"` | `src/0_common/types/index.ts` line 354 |

`DEFAULT_USER_SETTINGS.translationProvider = "official"` — defined in `src/0_common/types/index.ts`.

---

## 3. Legacy Compat Code Inventory

### 3.1 Primary Migration Logic (MUST REMOVE)

**File**: `src/0_common/utils/storageManager.ts`  
**Function**: `normalizeUserSettings()` (line ~107–113)

```typescript
// Migration: Convert legacy useCustomApi to translationProvider
let normalizedTranslationProvider: types.TranslationProvider = "official"
const legacyUseCustomApi = (settings.customApi as any)?.useCustomApi
if (legacyUseCustomApi === true) {
    normalizedTranslationProvider = "customApi"
}
```

This block:
1. Reads `settings.customApi.useCustomApi` via `(settings.customApi as any)?.useCustomApi` to bypass TypeScript typing.
2. If the legacy boolean was `true`, overrides the resolved provider to `"customApi"`.

This is the **only runtime migration code** that needs removal.

### 3.2 Orphaned Locale Keys (OPTIONAL CLEANUP)

The following locale keys exist in all 8 locale JSON files but are **not referenced anywhere in HTML or TypeScript source code** — they were inherited from the pre-PR-17 popup toggle that is no longer present in the current UI.

Affected files (2 keys each, for a total of 16 entries across 8 files):
- `src/0_common/locales/en.json` — lines 81–82
- `src/0_common/locales/zh.json` — lines 81–82
- `src/0_common/locales/de.json` — lines 79–80
- `src/0_common/locales/es.json` — lines 79–80
- `src/0_common/locales/fr.json` — lines 79–80
- `src/0_common/locales/ja.json` — lines 78–79
- `src/0_common/locales/ko.json` — lines 79–80
- `src/0_common/locales/ru.json` — lines 79–80

Keys to remove:
```json
"popup.useCustomApi.label": "...",
"popup.useCustomApi.helper": "..."
```

These cause no runtime harm if left in place (the i18n utility ignores unused keys), but constitute dead code. Removal is recommended for cleanliness but is non-blocking.

---

## 4. Files to Modify

| File | Change Type | Required |
|---|---|---|
| `src/0_common/utils/storageManager.ts` | Remove 4 lines (migration block) | **Yes** |
| `src/0_common/locales/en.json` | Remove 2 orphaned keys | Optional |
| `src/0_common/locales/zh.json` | Remove 2 orphaned keys | Optional |
| `src/0_common/locales/de.json` | Remove 2 orphaned keys | Optional |
| `src/0_common/locales/es.json` | Remove 2 orphaned keys | Optional |
| `src/0_common/locales/fr.json` | Remove 2 orphaned keys | Optional |
| `src/0_common/locales/ja.json` | Remove 2 orphaned keys | Optional |
| `src/0_common/locales/ko.json` | Remove 2 orphaned keys | Optional |
| `src/0_common/locales/ru.json` | Remove 2 orphaned keys | Optional |

**No type definition changes required.** The `UserSettings` interface and `DEFAULT_USER_SETTINGS` are already correct — `translationProvider` is a first-class field with no trace of `useCustomApi`.

---

## 5. Exact Changes

### 5.1 `src/0_common/utils/storageManager.ts` — REQUIRED

**What to remove** (lines 107–113, inclusive of trailing blank line):

```typescript
    // Migration: Convert legacy useCustomApi to translationProvider
    let normalizedTranslationProvider: types.TranslationProvider = "official"
    const legacyUseCustomApi = (settings.customApi as any)?.useCustomApi
    if (legacyUseCustomApi === true) {
        normalizedTranslationProvider = "customApi"
    }
```

**What to keep** (the community-edition default logic immediately follows — it is a separate concern and must NOT be removed):

```typescript
    // Community edition: Default to customApi since official cloud API is not available
    if (isCommunityEdition && settings.translationProvider === undefined) {
        normalizedTranslationProvider = "customApi"
    }
```

**The `normalizedTranslationProvider` variable declaration must be moved into or retained before the community-edition block.** The resulting code should look like:

```typescript
    // Community edition: Default to customApi since official cloud API is not available
    let normalizedTranslationProvider: types.TranslationProvider = "official"
    if (isCommunityEdition && settings.translationProvider === undefined) {
        normalizedTranslationProvider = "customApi"
    }
```

The `translationProvider` field in the merged settings object (line ~134) remains unchanged:

```typescript
    translationProvider: settings.translationProvider ?? normalizedTranslationProvider,
```

This line is correct: if the stored settings have an explicit `translationProvider` it wins; otherwise the community-edition default (`"customApi"`) or the fall-through `"official"` applies via `normalizedTranslationProvider`.

### 5.2 Locale Files — OPTIONAL (remove 2 keys per file)

For each of the 8 locale files listed in §3.2, remove the two consecutive lines:
```json
"popup.useCustomApi.label": "...",
"popup.useCustomApi.helper": "...",
```

The preceding and following lines do not need modification apart from adjusting the trailing comma of the preceding key if `popup.useCustomApi.label` was the last entry before the closing brace.

---

## 6. Tests

**No test changes required.** A search across `tests/**` confirms zero references to `useCustomApi` or `normalizeUserSettings`. There are no test cases that assert the legacy migration behavior, so no tests will break.

---

## 7. Risk Assessment

| Risk | Severity | Notes |
|---|---|---|
| Users with old `useCustomApi: true` lose their selection | Low | Intentional — they will default to `"official"` and can re-select their provider in Options. |
| Community users affected | None | Community-edition default logic is preserved; they will still get `"customApi"` as the default. |
| Type safety | None | The `(settings.customApi as any)` cast is removed along with its containing code. |
| Build breakage | None | No type changes, no interface changes. |
| Locale key removal breaks UI | None | Keys are unreferenced in all HTML and TS files. |

---

## 8. Implementation Steps

1. Edit `src/0_common/utils/storageManager.ts`:
   - Delete the 4-line legacy migration block (comment + `let` declaration + `const legacyUseCustomApi` + `if` block).
   - Move the `let normalizedTranslationProvider: types.TranslationProvider = "official"` declaration to immediately before the community-edition `if` block.
2. *(Optional)* Remove `popup.useCustomApi.label` and `popup.useCustomApi.helper` from all 8 locale files.
3. Run `npm run type-check` to confirm zero TypeScript errors.
4. Manually test: install on a fresh profile → verify `translationProvider` defaults to `"official"`.
