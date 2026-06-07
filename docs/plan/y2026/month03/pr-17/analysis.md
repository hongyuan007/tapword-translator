# PR #17 Analysis: 添加 MTranServer 与必应翻译支持

Date: 2026-03-07  
Branch analyzed: `Huchangzhi/main`  
PR URL: https://github.com/hongyuan007/tapword-translator/pull/17

---

## High-Level Summary

PR #17 introduces two additional translation providers that work **without** the official paid cloud API:

| Provider | Type | Cost | Setup |
|---|---|---|---|
| MTranServer | Self-hosted machine translation | Free (self-deployed) | URL + optional API key |
| 必应翻译 (Bing Translate) | Cloud machine translation | Free (no key) | None |

The PR refactors the translation routing from a binary `useCustomApi` flag to a multi-value `TranslationProvider` enum (`"official" | "customApi" | "mtranserver" | "bingTranslate"`), enabling the extension to route requests to four distinct backends. Both new providers apply to both `translateWord()` and `translateFragment()` paths.

---

## A. New Features Added

### 1. MTranServer Support
**What it is**: [MTranServer](https://github.com/xxnuo/MTranServer) is a self-hosted, lightweight machine translation server designed to be fast and low-resource. It exposes a single `/translate` REST endpoint accepting JSON `{from, to, text}`.

- **Source language**: Always `"auto"` (auto-detection, source code does not attempt to forward source language even if provided by the extension).
- **Language mapping**: A 70+ entry `LANGUAGE_CODE_MAP` converts extension codes (e.g. `"zh"`) to MTranServer codes (e.g. `"zh-Hans"`).
- **Timeout**: 10 seconds via `AbortController`.
- **Auth**: Optional `Authorization: Bearer <key>` header.
- **Context-awareness**: **None** — it translates the raw text only. For word translation, the full sentence (`leadingText + word + trailingText`) is sent as a second request for sentence context, but there is no LLM-level semantic understanding.
- **Configuration**: User sets URL (default `http://127.0.0.1:8989`) and optional key in the options page.
- **Edition**: Available to **all** users (official and community). No backend credentials required.

### 2. 必应翻译 (Bing Translate) Support
**What it is**: Uses Microsoft Bing Translator's internal/unofficial API (reverse-engineered, based on [bing-translate-api](https://github.com/plainheart/bing-translate-api)). No API key or registration is required.

- **Session acquisition**: On first use (or when token expires), the service scrapes `https://cn.bing.com/translator` to extract session tokens (`IG`, `IID`, abuse-prevention `key`/`token`).
- **Subdomain fallback**: Tries `cn.bing.com` → `www.bing.com` → `bing.com` in sequence; caches the first working one.
- **Token caching**: Reuses the session until `tokenExpiryInterval` elapsed; count-increments per request.
- **Language mapping**: 40+ entry map for common languages.
- **Context-awareness**: **None** — same pattern as MTranServer (word + optional full-sentence as separate requests).
- **Configuration**: No user configuration required; `BingTranslateSettings.enabled` is always `true`.
- **Edition**: Available to **all** users. No backend credentials required.

### 3. Options Page Changes
- A new **"Translation Provider"** dropdown in the settings page lets users switch between `official`, `customApi`, `mtranserver`, and `bingTranslate`.
- A collapsible **MTranServer configuration card** appears when `mtranserver` is selected, showing URL field, key field, and a **Test Connection** button.
- The legacy `useCustomApi` checkbox is superseded by the new dropdown.

---

## B. Architecture Changes

### New Types (`src/0_common/types/index.ts`)

```typescript
// New union type replacing the legacy boolean flag
type TranslationProvider = "official" | "customApi" | "mtranserver" | "bingTranslate"

// New settings structs
interface MTranserverSettings { url: string; key: string; enabled: boolean }
interface BingTranslateSettings { enabled: boolean }

// UserSettings extended with:
translationProvider: TranslationProvider
mtranserver: MTranserverSettings          // default: { url: "http://127.0.0.1:8989", key: "", enabled: false }
bingTranslate: BingTranslateSettings      // default: { enabled: true }
```

### New Services (`src/6_translate/services/`)

| File | Pattern | Note |
|---|---|---|
| `MTranServerService.ts` | Standalone functions (`translateWithMTranServer`, `testMTranServerConnection`) + `MTranServerError` class | Does **not** follow `5_backend/APIService` pattern; uses raw `fetch` with `AbortController` |
| `BingTranslateService.ts` | Standalone functions (`translateWithBingTranslate`, `testBingTranslateConnection`) + `BingTranslateError` class + module-level session cache | Does **not** follow `5_backend/APIService` pattern; uses raw `fetch` with session scraping |

Both new services deviate from the existing `APIService` infrastructure pattern, but this is justified because they connect to external third-party endpoints rather than the project's own backend.

### Routing Changes (`src/6_translate/services/TranslationService.ts`)
The `translateWord()` and `translateFragment()` functions now use an if/else chain on `userSettings.translationProvider`:

```
provider === "mtranserver"    → translateWithMTranServer()
provider === "customApi"      → translateWordWithLocal() (8_generate LLM)
provider === "bingTranslate"  → translateWithBingTranslate()
default                       → translateWordWithCloud() (official API)
```

Both `MTranServerError` and `BingTranslateError` are caught in the outer catch block and converted to `TranslationError` with i18n short messages.

### Migration (`src/0_common/utils/storageManager.ts`)
- `normalizeUserSettings()` adds merge/normalization for `mtranserver` settings.
- Legacy `useCustomApi: true` stored on `customApi` object → migrated to `translationProvider: "customApi"`.
- Community edition: when `translationProvider` is not yet set, defaults to `"customApi"` (not `"official"`) so users without backend credentials don't get broken translations.

### Import Style Compliance
The new service files partially follow project conventions:
- ✅ Use `@/` prefixed imports
- ✅ Use `createLogger` from `@/0_common/utils/logger`
- ⚠️ Use named imports (`import { createLogger }`) instead of namespace imports (`import * as loggerModule`). This is inconsistent with the project standard.

---

## C. Key Files Changed

| File | Change Type | Purpose |
|---|---|---|
| `src/6_translate/services/MTranServerService.ts` | **New** (264 lines) | MTranServer client: request/response, language mapping, timeout, connection test |
| `src/6_translate/services/BingTranslateService.ts` | **New** (339 lines) | Bing Translate client: HTML scraping for session tokens, subdomain fallback, translation |
| `src/6_translate/services/TranslationService.ts` | Modified (+199/-6) | Added mtranserver and bingTranslate routing branches in both `translateWord()` and `translateFragment()`; imports two new service modules |
| `src/0_common/types/index.ts` | Modified (+38/-3) | Added `TranslationProvider`, `MTranserverSettings`, `BingTranslateSettings` types; extended `UserSettings` and `DEFAULT_USER_SETTINGS` |
| `src/0_common/utils/storageManager.ts` | Modified (+28/-1) | Added mtranserver normalization, legacy `useCustomApi` migration, community edition default provider logic |
| `src/4_options/index.html` | Modified (+82/-13) | Added provider dropdown, MTranServer configuration card (URL, key, test button), Bing Translate section |
| `src/4_options/modules/settingsManager.ts` | Modified (+175/-89) | Added UI logic for provider show/hide, MTranServer config persistence, test connection handler |
| `src/4_options/index.ts` | Modified (+2/-0) | Registers MTranServer test button event handler on page init |
| `src/0_common/locales/*.json` (×8) | Modified (+34–48 each) | Added i18n keys for provider labels, error messages (`error.mtranserverConfigMissing`, `error.short.bingTranslateError`, etc.); also contains **unrelated** string edits |
| `package.json` / `package-lock.json` | Modified | Dependency changes (net +26 lines in lockfile) |

---

## D. Notable Issues and Risks

### 🔴 High Risk: TypeScript Build Failures
Copilot identified three `noUnusedLocals`/`noUnusedParameters` violations that would fail `tsc`:

1. **`TranslationService.ts`**: `contextInfo` destructured in the MTranServer branch but never used.
   ```typescript
   // Problematic
   const { word, leadingText, trailingText, contextInfo, targetLanguage = "zh" } = params
   // Fix: remove contextInfo
   const { word, leadingText, trailingText, targetLanguage = "zh" } = params
   ```

2. **`MTranServerService.ts` line ~205**: `sourceLanguage` declared as a parameter in an internal function but never used (source language is hardcoded to `"auto"`).

3. **`settingsManager.ts` line ~259**: `CUSTOM_API_CONTROL_SELECTOR` constant declared at module top but the function that used it (`setCustomApiControlsEnabled`) was removed.

> **Status**: The PR author stated fixes were applied on 2026-03-03. Verify by running `npm run type-check`.

### 🟡 Medium Risk: Bing Translate Reliability
- Uses an **undocumented, unofficial internal Bing API** by scraping HTML session tokens.
- Fragile: any Bing website markup change (IG extraction regex, IID attribute, `params_AbusePreventionHelper` JSON) will silently break translation.
- Microsoft may rate-limit or block this pattern with no notice.
- No terms of service compliance guarantee.
- The subdomain fallback (`cn.bing.com` → `www.bing.com`) is a good mitigation for China users but does not solve the structural fragility.

### 🟡 Medium Risk: MTranServer Has No Context-Awareness
- The official API and LLM providers use surrounding text, previous sentences, and book context for disambiguation.
- MTranServer ignores `sourceLanguage`, `contextInfo`, `bookName`, and all other context fields.
- The PR converts the full sentence (`leadingText + word + trailingText`) into a second request but this is purely mechanical concatenation with no semantic contextualization.
- Acknowledged in PR discussion: "上下文有所欠缺" — suitable for cost-sensitive use cases, not for high-quality word disambiguation.

### 🟡 Medium Risk: Locale File Scope Creep
- All 8 locale files contain changes unrelated to MTranServer/Bing support (modal buttons, update copy, etc.).
- Copilot flagged this as increasing review surface and risk of regression in unrelated UI text.
- Should be separated into a dedicated locale cleanup PR before merge.

### 🟢 Low Risk: Missing Test Coverage
- No unit tests added for the new provider routing in `TranslationService`.
- Copilot requested tests for: (1) `translationProvider="mtranserver"` routes correctly, (2) missing URL produces expected `TranslationError`, (3) `MTranServerError` converts to `TranslationError`.
- Acceptable risk for a beta feature, but should be addressed before stable release.

### 🟢 Low Risk: Import Style Inconsistency
- `MTranServerService.ts` and `BingTranslateService.ts` use named imports (`import { createLogger }`) rather than namespace imports (`import * as loggerModule`).
- Minor convention violation; does not affect functionality but inconsistent with project style guide.

---

## Key Architectural Decisions

1. **Provider enum over boolean flag**: Replacing `useCustomApi: boolean` with `translationProvider: TranslationProvider` is the correct long-term design — extensible without further breaking changes.

2. **Independent service files per provider**: Each provider gets its own dedicated file. Clean separation of concerns allowing individual providers to evolve independently.

3. **No shared HTTP infrastructure**: Both new services bypass `5_backend/APIService`. This is appropriate — `APIService` is designed for the project's own JWT-authenticated backend, not for arbitrary third-party APIs. Raw `fetch` + `AbortController` is the right choice here.

4. **Parallel word + sentence translation**: Both MTranServer and Bing providers make two sequential translation calls (word, then full sentence) to replicate the two-result output format of the official API. This is functionally correct but doubles latency for context-rich queries.

5. **Community edition default**: Defaulting to `"customApi"` (not `"official"`) for community builds is correct — community builds lack backend credentials.

---

## Recommended Actions Before Merge

| Priority | Action |
|---|---|
| P0 | Run `npm run type-check` and confirm zero TS errors (especially the 3 Copilot-flagged unused variable issues) |
| P0 | Audit and revert locale file changes unrelated to provider/MTranServer/Bing keys |
| P1 | Add minimal test coverage for `translateWord` provider routing (mtranserver + bingTranslate branches) |
| P1 | Add note in options UI that Bing Translate is unofficial/may be unreliable |
| P2 | Consider making the two MTranServer/Bing translation calls (word + sentence) concurrent with `Promise.all` to halve latency |
| P2 | Fix import style: replace named imports with namespace imports in the two new service files |
