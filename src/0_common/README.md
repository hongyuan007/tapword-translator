Last updated on: 2026-06-07

# 0_common

Shared utilities, types, constants, and i18n resources used across the entire extension. All other modules depend on this one; it depends on nothing else in `src/`.

## Files

**/** (root)
- `index.ts` — public barrel: re-exports logger, storageManager, version, i18n utilities, all types, and all constants

**constants/**
- `index.ts` — feature flags (`APP_EDITION`, `PRIVATE_CLOUD_ENABLED`, `ADVANCED_FEATURES_ENABLED`, `UPGRADE_MODEL_ENABLED`), DOM marker (`EXTENSION_OWNED_ATTRIBUTE`), cache/interval durations, and visual styling constants
- `customApi.ts` — fixed LLM API params (temperature, maxTokens, timeout)
- `errorMessages.ts` — user-facing UI error strings (Chinese)
- `translationFontSize.ts` — font size preset map and resolver helpers (`getFontSizePxFromPreset`, `resolveTranslationFontSize`)

**types/**
- `index.ts` — core types: `TranslationContextData`, `FragmentTranslationContextData`, `MessageType`, `UserSettings`, `DEFAULT_USER_SETTINGS`, and all chrome-message interfaces
- `QuotaExceededError.ts` — custom error class thrown by QuotaManager on quota exhaustion

**utils/**
- `storageManager.ts` — chrome.storage wrapper; loads, validates, and migrates `UserSettings`; normalizes trigger keys per platform
- `i18n.ts` — runtime UI i18n: locale detection, DOM injection (`applyTranslations`), `translate()` and `translateTemplate()` helpers; supports 8 locales
- `logger.ts` — singleton logger with level filtering; disabled in production via `VITE_LOGGER_ENABLED`
- `platformDetector.ts` — OS detection via `chrome.runtime.getPlatformInfo` with UA fallback
- `regionDetector.ts` — detects likely Chinese user by language + timezone
- `version.ts` — semver comparison helpers (`compareSemver`, `isLowerVersion`)
- `languageDisplay.ts` — resolves language code to human-readable name via `Intl.DisplayNames`
- `textUtils.ts` — `isSingleWord`, `containsMeaningfulWords` — text classification helpers
- `textTruncator.ts` — canvas-based pixel-accurate text truncation
- `colorUtils.ts` — `addOpacityToHex` — appends alpha channel to a hex color string
- `audioUtils.ts` — `detectAudioMimeType` — sniffs WAV/MP3 from Base64 header bytes
- `translationManager.ts` — empty stub; header comments only, no exports; do not import

**locales/**
- `en.json` — English UI strings (canonical source); `zh.json`, `es.json`, `ja.json`, `fr.json`, `de.json`, `ko.json`, `ru.json` — translated equivalents

## Key Contracts

- **Logger is disabled in production.** Controlled by `VITE_LOGGER_ENABLED=true`. Never rely on log output in prod builds. Always use `createLogger()` — never call `console.log` directly.
- **`getUserSettings()` always returns a fully-populated `UserSettings` object.** It normalizes missing fields against `DEFAULT_USER_SETTINGS` and applies platform-specific trigger key fixes (Mac: `alt` → `meta`; Windows/Linux: `meta`/`option` → `alt`). Callers must never assume raw storage values are valid.
- **`DEFAULT_USER_SETTINGS` trigger key is `"alt"`.** The actual platform default is resolved lazily at read-time inside `getUserSettings()`, not baked into the constant.
- **i18n is not auto-initialized.** Call `initI18n()` once per UI context before calling `translate()` or `applyTranslations()`. Locale strings may contain safe HTML (bold/italic); the module strips `<script>` tags and inline event handlers before rendering.
- **`EXTENSION_OWNED_ATTRIBUTE`** (`"data-tapword-ext"`) must be set on all extension-injected DOM nodes. The full-text translation module uses it to skip translating extension UI.
- **Feature flags are bundle-time constants** (`APP_EDITION`, `PRIVATE_CLOUD_ENABLED`, `ADVANCED_FEATURES_ENABLED`, `UPGRADE_MODEL_ENABLED`) — sourced from Vite env vars, not runtime config.
- **`translationManager.ts` is an empty stub** — it has no exports. Do not import from it.

## Module Boundaries

- ✅ May be imported by: any module (`1_content`, `2_background`, `3_popup`, `4_options`, `5_backend`, `6_translate`, `7_speech`, `8_generate`, and all feature modules)
- ❌ Must NOT import from: any other `src/` module — this module must remain dependency-free within the project to avoid circular imports
