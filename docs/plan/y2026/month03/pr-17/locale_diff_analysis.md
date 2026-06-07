# PR #17 Locale File Diff Analysis

**Branch**: `Huchangzhi/main` vs `main`  
**Date**: 2026-03-07  
**Scope of PR**: Add MTranServer and Bing Translate as new translation providers

---

## Summary Table

| File Group | Files Changed | Necessary Keys Added | Out-of-Scope Changes |
|---|---|---|---|
| `src/_locales/*/messages.json` | 8 (en, zh_CN, de, es, fr, ja, ko, ru) | 0 | 8 deletions (`extNameFirefox`) |
| `src/0_common/locales/en.json` | 1 | 30 | 3 additions |
| `src/0_common/locales/zh.json` | 1 | 30 | 3 additions |
| `src/0_common/locales/de.json` | 1 | 30 | 17 additions |
| `src/0_common/locales/es.json` | 1 | 30 | 17 additions |
| `src/0_common/locales/fr.json` | 1 | 30 | 17 additions |
| `src/0_common/locales/ja.json` | 1 | 30 | 17 additions |
| `src/0_common/locales/ko.json` | 1 | 30 | 17 additions |
| `src/0_common/locales/ru.json` | 1 | 30 | 17 additions |
| **TOTAL** | **16 files** | **240 key additions** | **8 deletions + 109 additions = 117 out-of-scope** |

**✅ Necessary changes: 240 key additions (across 8 locale files in `0_common/locales/`)**  
**❌ Out-of-scope changes: 117 total (8 deletions + 109 key additions across all file groups)**

---

## Section 1: `src/_locales/*/messages.json` — Chrome Extension Manifest Strings

All 8 locale files were modified identically. Each file had **one key deleted**:

| Key | Change Type | Category |
|---|---|---|
| `extNameFirefox` | ❌ Deleted | ❌ Out-of-scope (Firefox extension name, unrelated to providers) |

**Affected files:**
- `src/_locales/en/messages.json`
- `src/_locales/zh_CN/messages.json`
- `src/_locales/de/messages.json`
- `src/_locales/es/messages.json`
- `src/_locales/fr/messages.json`
- `src/_locales/ja/messages.json`
- `src/_locales/ko/messages.json`
- `src/_locales/ru/messages.json`

> **Impact**: Removing `extNameFirefox` from all locales is unrelated to MTranServer/Bing provider support. This is a destructive change for Firefox compatibility that does not belong in this PR.

---

## Section 2: `src/0_common/locales/en.json` (Primary Locale)

### Added Keys

| Key | Category |
|---|---|
| `popup.section.translationProvider.helper` | ✅ Necessary (provider selector UI) |
| `popup.translationProvider.label` | ✅ Necessary (provider selector label) |
| `popup.translationProvider.helper` | ✅ Necessary (provider selector helper text) |
| `popup.translationProvider.official` | ✅ Necessary (provider option: Official Cloud API) |
| `popup.translationProvider.customApi` | ✅ Necessary (provider option: Custom LLM API) |
| `popup.translationProvider.mtranserver` | ✅ Necessary (provider option: MTranServer) |
| `popup.translationProvider.bingTranslate` | ✅ Necessary (provider option: Bing Translate) |
| `popup.mtranserver.description` | ✅ Necessary (MTranServer description text) |
| `popup.mtranserver.learnMore` | ✅ Necessary (MTranServer learn more link) |
| `popup.mtranserver.url.label` | ✅ Necessary (MTranServer URL field label) |
| `popup.mtranserver.url.helper` | ✅ Necessary (MTranServer URL field helper) |
| `popup.mtranserver.key.label` | ✅ Necessary (MTranServer API key label) |
| `popup.mtranserver.key.helper` | ✅ Necessary (MTranServer API key helper) |
| `popup.mtranserver.test.label` | ✅ Necessary (MTranServer test section label) |
| `popup.mtranserver.test.helper` | ✅ Necessary (MTranServer test section helper) |
| `popup.mtranserver.test.button` | ✅ Necessary (MTranServer test button text) |
| `popup.bingTranslate.description` | ✅ Necessary (Bing Translate description) |
| `popup.bingTranslate.learnMore` | ✅ Necessary (Bing Translate learn more link) |
| `popup.bingTranslate.note.label` | ✅ Necessary (Bing Translate note section label) |
| `popup.bingTranslate.note.helper` | ✅ Necessary (Bing Translate note text) |
| `popup.bingTranslate.test.button` | ✅ Necessary (Bing Translate test button) |
| `settings.bingTranslate.unofficialWarning` | ✅ Necessary (unofficial API warning) |
| `popup.customApi.title` | ✅ Necessary (Custom API section title) |
| `popup.customApi.description` | ✅ Necessary (Custom API description) |
| `error.short.mtranserverConfigMissing` | ✅ Necessary (MTranServer error short label) |
| `error.short.mtranserverError` | ✅ Necessary (MTranServer connection error short label) |
| `error.short.bingTranslateError` | ✅ Necessary (Bing Translate error short label) |
| `error.mtranserverConfigMissing` | ✅ Necessary (MTranServer config missing error message) |
| `error.mtranserverError` | ✅ Necessary (MTranServer connection error message) |
| `error.bingTranslateError` | ✅ Necessary (Bing Translate connection error message) |
| `update.status_combined` | ❌ Out-of-scope (single/double click toggle UI, unrelated to providers) |
| `update.toast_revert` | ❌ Out-of-scope (click mode revert toast, unrelated to providers) |
| `update.status_double` | ❌ Out-of-scope (double-click status display, unrelated to providers) |

**Subtotal: 30 ✅ Necessary, 3 ❌ Out-of-scope**

---

## Section 3: `src/0_common/locales/zh.json` (Primary Locale)

Identical structure to `en.json`:

| Key | Category |
|---|---|
| `popup.section.translationProvider.helper` | ✅ Necessary |
| `popup.translationProvider.label` | ✅ Necessary |
| `popup.translationProvider.helper` | ✅ Necessary |
| `popup.translationProvider.official` | ✅ Necessary |
| `popup.translationProvider.customApi` | ✅ Necessary |
| `popup.translationProvider.mtranserver` | ✅ Necessary |
| `popup.translationProvider.bingTranslate` | ✅ Necessary |
| `popup.mtranserver.description` | ✅ Necessary |
| `popup.mtranserver.learnMore` | ✅ Necessary |
| `popup.mtranserver.url.label` | ✅ Necessary |
| `popup.mtranserver.url.helper` | ✅ Necessary |
| `popup.mtranserver.key.label` | ✅ Necessary |
| `popup.mtranserver.key.helper` | ✅ Necessary |
| `popup.mtranserver.test.label` | ✅ Necessary |
| `popup.mtranserver.test.helper` | ✅ Necessary |
| `popup.mtranserver.test.button` | ✅ Necessary |
| `popup.bingTranslate.description` | ✅ Necessary |
| `popup.bingTranslate.learnMore` | ✅ Necessary |
| `popup.bingTranslate.note.label` | ✅ Necessary |
| `popup.bingTranslate.note.helper` | ✅ Necessary |
| `popup.bingTranslate.test.button` | ✅ Necessary |
| `settings.bingTranslate.unofficialWarning` | ✅ Necessary |
| `popup.customApi.title` | ✅ Necessary |
| `popup.customApi.description` | ✅ Necessary |
| `error.short.mtranserverConfigMissing` | ✅ Necessary |
| `error.short.mtranserverError` | ✅ Necessary |
| `error.short.bingTranslateError` | ✅ Necessary |
| `error.mtranserverConfigMissing` | ✅ Necessary |
| `error.mtranserverError` | ✅ Necessary |
| `error.bingTranslateError` | ✅ Necessary |
| `update.status_combined` | ❌ Out-of-scope |
| `update.toast_revert` | ❌ Out-of-scope |
| `update.status_double` | ❌ Out-of-scope |

**Subtotal: 30 ✅ Necessary, 3 ❌ Out-of-scope**

---

## Section 4: Other Locales in `src/0_common/locales/` (de, es, fr, ja, ko, ru)

These 6 files each received **47 new keys**: 30 provider-related (✅ Necessary) + 17 out-of-scope additions.

> **Why 17 out-of-scope here vs 3 in en/zh?**  
> In `main`, `en.json` and `zh.json` already contained the `update.*` and `contact.*` keys. The other 6 locale files were **missing** these keys in `main` (the files ended after `error.customApiConfigMissing`). This PR added both the provider keys AND the missing update/contact keys — the latter being out-of-scope for this PR's purpose.

### Out-of-scope keys added to de, es, fr, ja, ko, ru (17 keys each):

| Key | Category | Note |
|---|---|---|
| `update.title` | ❌ Out-of-scope | v0.4.0 release note title |
| `update.brand_version` | ❌ Out-of-scope | Version string display |
| `update.heading` | ❌ Out-of-scope | Single-click feature heading |
| `update.demo_placeholder` | ❌ Out-of-scope | Demo GIF placeholder text |
| `update.description` | ❌ Out-of-scope | Single-click feature description |
| `update.status_combined` | ❌ Out-of-scope | Click toggle status display |
| `update.btn_close` | ❌ Out-of-scope | Close button for update modal |
| `contact.title` | ❌ Out-of-scope | Contact section title |
| `contact.xhs_group.text` | ❌ Out-of-scope | Xiaohongshu group link text |
| `contact.xhs.alt` | ❌ Out-of-scope | Xiaohongshu image alt |
| `contact.wechat.alt` | ❌ Out-of-scope | WeChat image alt |
| `contact.twitter.alt` | ❌ Out-of-scope | Twitter image alt |
| `contact.email.alt` | ❌ Out-of-scope | Gmail image alt |
| `update.btn_restore_single` | ❌ Out-of-scope | Restore single-click button |
| `update.toast_revert` | ❌ Out-of-scope | Revert to double-click toast |
| `update.toast_single` | ❌ Out-of-scope | Single-click enabled toast |
| `update.status_double` | ❌ Out-of-scope | Double-click status display |

### Necessary keys added to de, es, fr, ja, ko, ru (same 30 as en/zh): ✅

(See Section 2 for the full key list — all `popup.translationProvider.*`, `popup.mtranserver.*`, `popup.bingTranslate.*`, `popup.customApi.*`, `error.short.*`, `error.mtranserver*`, `error.bingTranslate*`, `settings.bingTranslate.unofficialWarning`)

**Subtotal per file: 30 ✅ Necessary, 17 ❌ Out-of-scope**  
**Subtotal for all 6 files: 180 ✅ Necessary, 102 ❌ Out-of-scope**

> **Notable localization quality issue in ja.json and ko.json**: The `contact.title` was added as `"联系我们："` (Chinese) and `contact.xhs_group.text` as `"小红书群聊"` (Chinese) instead of being translated to Japanese/Korean. This is an additional quality defect within the out-of-scope additions.

---

## Section 5: Complete Count

### ✅ Necessary Changes Total: **240 key additions**

Provider-related keys per locale file: 30  
Files: 8 (en, zh, de, es, fr, ja, ko, ru)  
Total: 30 × 8 = **240 key additions**

### ❌ Out-of-scope Changes Total: **117 changes**

| Source | Change Type | Count |
|---|---|---|
| `src/_locales/` (8 files) | `extNameFirefox` key deleted | 8 deletions |
| `src/0_common/locales/en.json` | update.* keys added | 3 additions |
| `src/0_common/locales/zh.json` | update.* keys added | 3 additions |
| `src/0_common/locales/de.json` | update.* + contact.* keys added | 17 additions |
| `src/0_common/locales/es.json` | update.* + contact.* keys added | 17 additions |
| `src/0_common/locales/fr.json` | update.* + contact.* keys added | 17 additions |
| `src/0_common/locales/ja.json` | update.* + contact.* keys added | 17 additions |
| `src/0_common/locales/ko.json` | update.* + contact.* keys added | 17 additions |
| `src/0_common/locales/ru.json` | update.* + contact.* keys added | 17 additions |
| **TOTAL** | | **117 out-of-scope** |

---

## Section 6: What Was Unnecessarily Modified

### 1. `extNameFirefox` deletion (8 files in `src/_locales/`)
The `extNameFirefox` key provides the extension name for Firefox. Removing it from all 8 locale manifests is completely unrelated to adding MTranServer/Bing Translate support and could break Firefox builds. **Should be reverted.**

### 2. `update.status_combined`, `update.toast_revert`, `update.status_double` (en.json, zh.json)
These keys relate to the single-click vs. double-click UI toggle introduced in v0.4.0 — a separate feature. They were not needed for provider support. However, since en/zh were already partially missing them in main, this is a lower-risk addition. Still, it conflates two unrelated features in one PR.

### 3. Full `update.*` + `contact.*` localization for de, es, fr, ja, ko, ru (6 files × 17 keys)
These 102 additions backfill translations for the v0.4.0 update modal and contact section into the non-primary locales. This should have been a separate PR/commit. Additionally, `ja.json` and `ko.json` contain untranslated Chinese strings (`"联系我们："`, `"小红书群聊"`, etc.), indicating low quality AI-generated translations for this out-of-scope content.

---

## Recommendation

| Action | Priority |
|---|---|
| Accept the 30 provider-related keys per locale file (240 total) | ✅ Accept |
| Revert `extNameFirefox` deletion from all `src/_locales/` files | 🔴 Must fix |
| Remove the out-of-scope `update.*` / `contact.*` additions from de, es, fr, ja, ko, ru | 🟡 Should fix |
| Remove `update.status_combined`, `update.toast_revert`, `update.status_double` from en/zh | 🟡 Should fix (or separate PR) |
| Fix untranslated Chinese strings in ja.json and ko.json contact/update keys | 🟡 Fix if keeping those keys |
