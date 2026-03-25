# Inline Translate Refactor — Detailed Specification

**Date**: 2026-03-25  
**Status**: Draft  
**Goal**: Extract auto-translate orchestration into `src/9_inline_translate/` module and remove all trigger entry points from `1_content`, `3_popup`, and settings infrastructure.

---

## Table of Contents

- [A. New Module Structure](#a-new-module-structure)
- [B. Files to MOVE](#b-files-to-move)
- [C. Files to MODIFY](#c-files-to-modify)
- [D. Files to KEEP AS-IS](#d-files-to-keep-as-is)
- [E. Import Updates](#e-import-updates)

---

## A. New Module Structure

```
src/9_inline_translate/
  index.ts                              — module exports
  README.md                             — module documentation
  services/
    InlineTranslationService.ts         — renamed from autoTranslationService.ts
  utils/
    blockTextExtractor.ts               — moved from 1_content/utils/
    candidateDomMapper.ts               — moved from 1_content/utils/
  types/
    InlineTranslateTypes.ts             — types specific to inline translation
```

### A.1 `index.ts` — Module Exports

```typescript
// Services
export { tryAutoTranslate } from "./services/InlineTranslationService"
export type { AutoTriggerParams } from "./services/InlineTranslationService"

// Utils
export { extractBlockText } from "./utils/blockTextExtractor"
export type { TextNodeSegment, BlockTextResult } from "./utils/blockTextExtractor"
export { mapCandidateToRange } from "./utils/candidateDomMapper"
```

### A.2 `README.md`

Must follow the submodule documentation template convention. Key points to document:
- Module purpose: content-script-level orchestration and DOM utilities for inline (auto) translation
- Architecture: fire-and-forget design, scan-once semantics, conservative filtering pipeline
- Dependency direction: depends on `0_common`, `1_content` (for display and overlap detection), `5_backend` (indirectly via messaging)
- Does NOT include backend request handlers, API services, or LLM generation (those stay in `2_background`, `6_translate`, `8_generate`)

### A.3 `types/InlineTranslateTypes.ts`

Re-export or define types used only within the inline translate module. Initially this may just re-export from `@/0_common/types`:

```typescript
// Re-export shared types used by the inline translation module
export type { AutoCandidate, AutoCandidatesRequestData, AutoCandidatesResponseData } from "@/0_common/types"
export type { LanguageProficiency } from "@/0_common/types"
```

---

## B. Files to MOVE

| # | Source | Destination | Rename? |
|---|--------|-------------|---------|
| 1 | `src/1_content/services/autoTranslationService.ts` | `src/9_inline_translate/services/InlineTranslationService.ts` | Yes — rename file and update internal logger name |
| 2 | `src/1_content/utils/blockTextExtractor.ts` | `src/9_inline_translate/utils/blockTextExtractor.ts` | No |
| 3 | `src/1_content/utils/candidateDomMapper.ts` | `src/9_inline_translate/utils/candidateDomMapper.ts` | No |

### B.1 Move Details for `InlineTranslationService.ts`

**Internal changes after move:**

1. Update import paths for sibling utils:
   - `@/1_content/utils/blockTextExtractor` → `@/9_inline_translate/utils/blockTextExtractor`
   - `@/1_content/utils/candidateDomMapper` → `@/9_inline_translate/utils/candidateDomMapper`

2. Update logger name:
   - `createLogger("autoTranslationService")` → `createLogger("InlineTranslationService")`

3. All other imports remain unchanged (they reference `@/0_common/...`, `@/1_content/index`, `@/1_content/services/translationRequest`, `@/1_content/ui/translationDisplayV2`, `@/1_content/handlers/utils/...`, `@/1_content/utils/domSanitizer` — these are all cross-module dependencies that stay valid).

### B.2 Move Details for `blockTextExtractor.ts`

**Internal changes after move:**

1. Import path update:
   - `@/1_content/utils/domSanitizer` — remains unchanged (still referencing `1_content` utility)

### B.3 Move Details for `candidateDomMapper.ts`

**Internal changes after move:**

1. Import path update for sibling type:
   - `@/1_content/utils/blockTextExtractor` → `@/9_inline_translate/utils/blockTextExtractor`

2. `@/0_common/utils/logger` — remains unchanged

---

## C. Files to MODIFY (Remove Trigger Entry Points)

### C.1 `src/1_content/handlers/TranslationPipeline.ts`

**Remove import (line 25):**

```typescript
// DELETE this line:
import * as autoTranslationService from "@/1_content/services/autoTranslationService"
```

**Remove word-translation auto-trigger block (lines 262–270):**

```typescript
// DELETE this block (after successful word translation rendering):
                // Fire-and-forget auto-translation (never blocks manual flow)
                void autoTranslationService.tryAutoTranslate({
                    triggerRange: range,
                    triggerText: word,
                    triggerType: "word",
                    triggerTranslation: response.data.wordTranslation,
                    detectedLang: detectedLang,
                    targetLang: targetLang,
                })
```

**Remove fragment-translation auto-trigger block (lines 432–440):**

```typescript
// DELETE this block (after successful fragment translation rendering):
                // Fire-and-forget auto-translation (never blocks manual flow)
                void autoTranslationService.tryAutoTranslate({
                    triggerRange: range,
                    triggerText: fragment,
                    triggerType: "phrase",
                    triggerTranslation: response.data.translation,
                    detectedLang: detectedLang,
                    targetLang: targetLang,
                })
```

### C.2 `src/3_popup/index.html`

**Remove the entire auto-translate section (lines 185–222):**

```html
<!-- DELETE: entire <section class="section-card section-auto-translate"> ... </section> -->
        <section class="section-card section-auto-translate">
          <div class="section-floating-title" data-title="Auto-Translate" data-i18n-key="popup.section.autoTranslate"
            data-i18n-attr="data-title"></div>
          <div class="section-body">
            <div class="setting-item">
              <div class="setting-gutter"></div>
              <div class="setting-info">
                <label class="setting-label" for="enableAutoTranslate">
                  <span data-i18n-key="popup.autoTranslate.label">Auto-Translate</span>
                  <span class="help-icon" data-i18n-key="popup.autoTranslate.description"
                    data-i18n-attr="data-tooltip">?</span>
                </label>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="enableAutoTranslate" data-setting="enableAutoTranslate">
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="setting-item" id="settingItem-languageProficiency">
              <div class="setting-gutter"></div>
              <div class="setting-info">
                <label class="setting-label" for="userLanguageProficiency">
                  <span data-i18n-key="popup.languageProficiency.label">Reading Level</span>
                  <span class="help-icon" data-i18n-key="popup.languageProficiency.description"
                    data-i18n-attr="data-tooltip">?</span>
                </label>
              </div>
              <div class="setting-control">
                <select id="userLanguageProficiency" data-setting="userLanguageProficiency" class="language-select">
                  <option value="Beginner" data-i18n-key="popup.proficiency.beginner">Beginner</option>
                  <option value="Intermediate" data-i18n-key="popup.proficiency.intermediate">Intermediate</option>
                  <option value="Advanced" data-i18n-key="popup.proficiency.advanced">Advanced</option>
                </select>
              </div>
            </div>
          </div>
        </section>
```

### C.3 `src/3_popup/modules/settingsManager.ts`

**Remove the `setAutoTranslateDependentControlsEnabled` function (lines 53–63):**

```typescript
// DELETE entire function:
function setAutoTranslateDependentControlsEnabled(enabled: boolean): void {
    const proficiencySelect = document.getElementById("userLanguageProficiency") as HTMLSelectElement | null
    if (!proficiencySelect) return

    proficiencySelect.disabled = !enabled

    const settingItem = proficiencySelect.closest(".setting-item")
    if (settingItem) {
        settingItem.classList.toggle("is-disabled", !enabled)
    }
}
```

**Remove call in `loadSettings()` (line 194):**

```typescript
// DELETE this line:
        setAutoTranslateDependentControlsEnabled(settings.enableAutoTranslate)
```

**Remove conditional block in `setupSettingChangeListeners()` (lines 240–242):**

```typescript
// DELETE this block:
                if (settingKey === "enableAutoTranslate") {
                    setAutoTranslateDependentControlsEnabled(input.checked)
                }
```

### C.4 `src/0_common/types/index.ts`

**KEEP** all shared types (`AutoCandidate`, `AutoCandidatesRequestData`, `AutoCandidatesResponseData`, `LanguageProficiency`, etc.) — they are used by `2_background`, `6_translate`, `8_generate`, and the new `9_inline_translate` module.

**KEEP** `enableAutoTranslate` and `userLanguageProficiency` in `UserSettings` and `DEFAULT_USER_SETTINGS` — these settings are read by the `InlineTranslationService` at runtime via `contentIndex.getCachedUserSettings()`. Removing them from the type would break the service. They control *behavior*, not just popup UI triggers.

> **Rationale**: Even though the popup trigger UI is removed, the settings themselves are still consumed by the inline translation orchestrator. They will be exposed via a future dedicated settings surface or programmatic API. Keeping them in `UserSettings` avoids a breaking migration.

### C.5 `src/0_common/utils/storageManager.ts`

**KEEP** the `enableAutoTranslate` and `userLanguageProficiency` migration/validation lines (lines 174–177):

```typescript
        enableAutoTranslate: mergedSettings.enableAutoTranslate ?? DEFAULT_USER_SETTINGS.enableAutoTranslate,
        userLanguageProficiency: VALID_PROFICIENCY_LEVELS.includes(mergedSettings.userLanguageProficiency)
            ? mergedSettings.userLanguageProficiency
            : DEFAULT_USER_SETTINGS.userLanguageProficiency,
```

> **Rationale**: These ensure existing users' persisted settings are properly validated on load. Removing them would cause `undefined` values at runtime when the `InlineTranslationService` reads settings. They are storage infrastructure, not trigger logic.

### C.6 `src/1_content/services/translationRequest.ts`

**KEEP** the `requestAutoCandidates` function (lines 96–105). It's the messaging bridge between content script and background. The new `InlineTranslationService` in `9_inline_translate` will continue to import it via `@/1_content/services/translationRequest`.

### C.7 `src/1_content/resources/content.css`

**KEEP** all auto-translation CSS rules (lines 117–131):

```css
/* Auto-translation underline: teal color, lower visual weight than manual */
.ai-translator-tooltip--auto { ... }
.ai-translator-tooltip--auto.visible { ... }
@keyframes ai-translator-auto-fade-in { ... }
```

> **Rationale**: These are visual rendering capabilities, not trigger logic. The inline translation module will continue to apply the `ai-translator-tooltip--auto` class.

### C.8 i18n Locale Files (8 files)

**Remove** the following popup-specific auto-translate keys from ALL 8 locale files:

| Key | Reason to Remove |
|-----|-----------------|
| `popup.section.autoTranslate` | Section header in popup — UI removed |
| `popup.autoTranslate.label` | Toggle label in popup — UI removed |
| `popup.autoTranslate.description` | Toggle tooltip in popup — UI removed |
| `popup.languageProficiency.label` | Proficiency selector label — UI removed |
| `popup.languageProficiency.description` | Proficiency selector tooltip — UI removed |
| `popup.proficiency.beginner` | Proficiency option — UI removed |
| `popup.proficiency.intermediate` | Proficiency option — UI removed |
| `popup.proficiency.advanced` | Proficiency option — UI removed |

**Files affected** (all under `src/0_common/locales/`):

| File | Lines to Remove |
|------|----------------|
| `zh.json` | Lines 197–204 (8 keys) |
| `en.json` | Lines 197–204 (8 keys) |
| `ja.json` | Lines 168–175 (8 keys) |
| `de.json` | Lines 168–175 (8 keys) |
| `es.json` | Lines 168–175 (8 keys) |
| `fr.json` | Lines 168–175 (8 keys) |
| `ko.json` | Lines 168–175 (8 keys) |
| `ru.json` | Lines 168–175 (8 keys) |

---

## D. Files to KEEP AS-IS

These backend/infrastructure files remain in their current locations. They provide the API layer and LLM generation capability that the new `9_inline_translate` module (and future callers) depend on.

| File | Module | Reason |
|------|--------|--------|
| `src/2_background/handlers/AutoCandidatesRequestHandler.ts` | `2_background` | Background message handler — infrastructure |
| `src/2_background/messaging/MessageRouter.ts` (AUTO_CANDIDATES_REQUEST case) | `2_background` | Message routing — infrastructure |
| `src/6_translate/services/AutoCandidatesService.ts` | `6_translate` | Cloud API client — infrastructure |
| `src/6_translate/types/AutoCandidatesTypes.ts` | `6_translate` | API request/response types — infrastructure |
| `src/6_translate/constants/TranslationConstants.ts` (AUTO_CANDIDATES endpoint) | `6_translate` | API endpoint constant — infrastructure |
| `src/6_translate/index.ts` (AutoCandidates exports) | `6_translate` | Module index exports — infrastructure |
| `src/8_generate/services/AutoCandidatesGenerationService.ts` | `8_generate` | Local LLM generation — infrastructure |
| `src/8_generate/index.ts` (AutoCandidates exports) | `8_generate` | Module index exports — infrastructure |
| `resources/8_generate/auto_candidates/` | resources | Prompt templates — static assets |
| `src/1_content/resources/content.css` (auto CSS rules) | `1_content` | Visual capability — rendering, not trigger logic |
| `src/1_content/ui/translationDisplayV2/types.ts` (`isAutoTranslation` field) | `1_content` | Display type field — rendering, not trigger logic |
| `src/1_content/services/translationRequest.ts` (`requestAutoCandidates`) | `1_content` | Messaging bridge — infrastructure |
| `src/0_common/types/index.ts` (AutoCandidate types, LanguageProficiency, UserSettings fields) | `0_common` | Shared types — used across modules |
| `src/0_common/utils/storageManager.ts` (validation lines) | `0_common` | Settings persistence — infrastructure |

---

## E. Import Updates

After moving files, the following import paths must be updated:

### E.1 Within the Moved Files

| File (new location) | Old Import | New Import |
|---------------------|-----------|------------|
| `9_inline_translate/services/InlineTranslationService.ts` | `@/1_content/utils/blockTextExtractor` | `@/9_inline_translate/utils/blockTextExtractor` |
| `9_inline_translate/services/InlineTranslationService.ts` | `@/1_content/utils/candidateDomMapper` | `@/9_inline_translate/utils/candidateDomMapper` |
| `9_inline_translate/utils/candidateDomMapper.ts` | `@/1_content/utils/blockTextExtractor` | `@/9_inline_translate/utils/blockTextExtractor` |

### E.2 External Consumers (if any exist)

After the refactor, no external file should import from the old paths. The only consumer of `autoTranslationService` was `TranslationPipeline.ts`, and that import is being **deleted** (not redirected), since the trigger entry points are removed.

**Verification checklist**: After completing the move, run a workspace-wide search for these patterns to confirm zero remaining references:

```
@/1_content/services/autoTranslationService
@/1_content/utils/blockTextExtractor
@/1_content/utils/candidateDomMapper
```

All three should return zero results. If any external consumer is found, update it to `@/9_inline_translate/...`.

### E.3 No Changes Needed

The following imports inside the moved files reference other modules and remain valid:

- `@/0_common/types` — shared types
- `@/0_common/constants/translationFontSize` — font size resolution
- `@/0_common/utils/logger` — logger utility
- `@/1_content/index` — `getCachedUserSettings()`
- `@/1_content/services/translationRequest` — `requestAutoCandidates()`
- `@/1_content/ui/translationDisplayV2` — display rendering
- `@/1_content/handlers/utils/translationOverlapDetectorV2` — overlap detection
- `@/1_content/utils/domSanitizer` — DOM sanitization (used by `blockTextExtractor.ts`)

---

## Appendix: Validation Steps

After completing all changes:

1. **Type check**: `npm run type-check` — must pass with zero errors
2. **Build**: `npm run build` — must succeed
3. **Grep verification**: Search for deleted import paths (see E.2) — must return zero results
4. **Manual test**: Load extension, verify manual translation still works, verify auto-translate section is gone from popup
5. **Unit tests**: Run existing tests — `npm test -- run` — no regressions expected since we are moving code, not changing behavior
