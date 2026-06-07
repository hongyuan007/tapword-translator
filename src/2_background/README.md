Last updated on: 2026-06-07

# 2_background

The extension's background service worker: initializes all backend services on startup, routes Chrome runtime messages to typed handlers, and manages audio playback via an offscreen document (Chrome) or direct DOM (Firefox).

## Entry Points

| File | Kind | Role |
|------|------|------|
| `index.ts` | **Script entry** | Bootstraps the background worker: registers the message listener early (race-free), starts critical service initialization, then fires warm-up; also handles `onInstalled` lifecycle events. |
| `messaging/MessageRouter.ts` | **Event hub** | Single `chrome.runtime.onMessage` listener; dispatches every `MessageType` to the correct handler and returns `true` to keep the channel open for async responses. |
| `services/ServiceInitializer.ts` | **Service coordinator** | Singleton-promise pattern for critical service init (API auth + config cache); exposes `ensureCriticalServicesReady()` called by every handler before doing real work. |

## Files

**handlers/**
- `TranslationRequestHandler.ts` — handles `TRANSLATE_REQUEST`; checks quota, calls `@/6_translate/translateWord`, increments quota on success
- `FragmentTranslationRequestHandler.ts` — handles `FRAGMENT_TRANSLATE_REQUEST`; same quota+translate flow for sentence fragments
- `FullTranslateBatchHandler.ts` — handles `FULL_TRANSLATE_BATCH_REQUEST`; routes to official API, Microsoft Free, Google Free, Bing, or custom OpenAI-compatible providers; falls back to `microsoftFree` on quota exhaustion
- `SpeechSynthesisRequestHandler.ts` — handles `SPEECH_SYNTHESIS_REQUEST`; calls `@/7_speech`, skips quota increment on cache hit, delegates audio playback to `OffscreenManager`
- `AutoCandidatesRequestHandler.ts` — handles `AUTO_CANDIDATES_REQUEST`; routes to `@/6_translate` or `@/8_generate` based on user's `wordTranslationProvider` setting
- `PopupBootstrapHandler.ts` — handles `POPUP_BOOTSTRAP_REQUEST`; assembles a single aggregated response (version info, update flag, website URL) for the popup's init call
- `TokenWarmUpHandler.ts` — handles `PAGE_ACTIVATED`; proactively fetches a JWT token so the first real request is faster; fire-and-forget, non-fatal on failure
- `QuotaUsageHandler.ts` — handles `QUOTA_USAGE_REQUEST`; returns cached full-text translation quota usage and active provider for popup display
- `BackgroundErrorHandler.ts` — shared error-response utility; maps `QuotaExceededError`, `TranslationError`, and `SpeechError` to typed response payloads

**messaging/**
- `MessageRouter.ts` — maps every `MessageType` to its handler via a `switch`; also handles `FULL_TRANSLATE_TOGGLE` and `SPEECH_STOP_REQUEST` inline

**services/**
- `ServiceInitializer.ts` — initializes `AuthService` (JWT) and `APIService` (HTTP client) with build-time credentials; resolves China-region fallback URL; listens for `networkRegion` setting changes and hot-swaps the base URL; exposes `ensureCriticalServicesReady()` (singleton promise) and `startBackgroundWarmUp()` (one-shot token pre-fetch)
- `OffscreenManager.ts` — browser-agnostic audio playback: Chrome path creates/reuses the `9_offscreen` offscreen document; Firefox path plays `Audio` directly in the background script DOM; recovers interrupted playback via `chrome.storage.session` intent store

## Key Flows

### Cold-start initialization
```
index.ts → initialize()
  → MessageRouter.setupMessageListener()          # registered first to avoid race on first message
  → ServiceInitializer.ensureCriticalServicesReady()
      → initializeAPIService()                    # loads build-time credentials, resolves base URL
      → configService.ensureCacheLoaded()         # fetches remote config
  → ServiceInitializer.startBackgroundWarmUp()
      → authService.getToken()                    # pre-fetches JWT token
```

### Word translation request
```
chrome.runtime.onMessage (TRANSLATE_REQUEST)
  → MessageRouter → TranslationRequestHandler.handleTranslationRequest()
      → ServiceInitializer.ensureCriticalServicesReady()   # no-op after first call
      → quotaManager.checkTranslationQuota()
      → translateModule.translateWord()
      → quotaManager.incrementTranslationCount()
      → sendResponse(TranslateResponseMessage)
```

### Speech synthesis request
```
chrome.runtime.onMessage (SPEECH_SYNTHESIS_REQUEST)
  → MessageRouter → SpeechSynthesisRequestHandler.handleSpeechSynthesisRequest()
      → quotaManager.checkSpeechQuota()
      → speechModule.synthesizeSpeech()
      → quotaManager.incrementSpeechCount()       # skipped on cache hit
      → OffscreenManager.playAudio()
          → Chrome: chrome.offscreen document → 9_offscreen plays audio
          → Firefox: HTMLAudioElement played directly
      → sendResponse(SpeechSynthesisResponseMessage)
```

### Page activation token warm-up
```
chrome.runtime.onMessage (PAGE_ACTIVATED)
  → MessageRouter → TokenWarmUpHandler.handlePageActivated()
      → ServiceInitializer.ensureCriticalServicesReady()
      → authService.getToken()                    # caches JWT for next real request
      → sendResponse({ status: "warmed" | "failed" })
```

## Key Contracts

- **Register message listener before awaiting init.** `index.ts` calls `MessageRouter.setupMessageListener()` before `ServiceInitializer.ensureCriticalServicesReady()` resolves; each handler then gates on `ensureCriticalServicesReady()` internally so no message is lost on cold start.
- **`ensureCriticalServicesReady()` is idempotent.** It creates a singleton promise on first call; subsequent calls return the same promise. Handlers may call it unconditionally on every request without re-running initialization.
- **`startBackgroundWarmUp()` runs at most once.** Guarded by `backgroundWarmUpPromise`; safe to call from multiple handlers.
- **Quota increment is gated on success.** All handlers increment the quota counter only after a successful API response — never before or on error.
- **Speech quota is not incremented on cache hits.** `SpeechSynthesisRequestHandler` checks `result.cacheHit` and skips `incrementSpeechCount()` to avoid penalizing cached playback.
- **OffscreenManager playback intent persists across worker restarts.** A `PlaybackIntent` is written to `chrome.storage.session` before audio plays; `recoverInterruptedDirectAudioPlayback()` can resume it after a service-worker restart within a 3-minute window.
- **No credentials at runtime.** Credentials come exclusively from build-time injection (`BUILD_TIME_CREDENTIALS`). If `hasBuildTimeCredentials()` returns false, the API service is not initialized and all translation requests will fail gracefully.

## Module Boundaries

- ✅ May be imported by: no other module — this is the script entry; it is loaded by the browser directly via `manifest.json`
- ❌ Must NOT import from: `@/1_content`, `@/3_popup`, `@/4_options`, `@/10_welcome`, `@/11_full_translate`, `@/12_floating_button`, `@/9_inline_translate` — those are UI/content-script modules; the background worker must remain environment-agnostic and dependency-free of DOM-bound code
