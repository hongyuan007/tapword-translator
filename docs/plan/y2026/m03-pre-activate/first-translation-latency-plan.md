# First Translation Latency Optimization Plan

## Scope

This document analyzes why the first translation after page activation feels slower than subsequent translations, based on:

- `docs/plan/y2026/m03-pre-activate/日志/content脚本日志.txt`
- `docs/plan/y2026/m03-pre-activate/日志/后台脚本日志.txt`
- current implementation in `src/1_content`, `src/2_background`, `src/5_backend`, and `src/6_translate`

The goal is to reduce both:

1. actual cold-path latency
2. perceived latency before the loading UI appears

## What The Logs Show

For the sampled first translation:

- content side reports `TRANSLATE_REQUEST` round-trip in about `1037ms`
- background side reports `/api/v1/translate` itself took about `923ms`
- the first request overlaps with cold-start work:
  - background service initialization
  - config fetch
  - quota initialization
  - JWT token acquisition

This means the backend translation call is still the dominant cost, but the extension is adding avoidable cold-start work on top of it.

## Code-Level Diagnosis

### 1. Pre-warm exists, but it is not reliable enough

The content script sends `PAGE_ACTIVATED` immediately on init ([index.ts](/Users/hongyuan/project/v4/tapword-translator/src/1_content/index.ts#L78)).  
However, the warm-up handler exits early when `AuthService` is not initialized yet ([TokenWarmUpHandler.ts](/Users/hongyuan/project/v4/tapword-translator/src/2_background/handlers/TokenWarmUpHandler.ts#L18)).

That creates a race:

- page activates
- service worker wakes
- `PAGE_ACTIVATED` arrives
- auth is not ready yet
- warm-up is skipped
- first real translation still pays the token-fetch cost

This is the most important structural gap.

### 2. Background startup still awaits non-critical work

The background registers the listener early, which is correct ([index.ts](/Users/hongyuan/project/v4/tapword-translator/src/2_background/index.ts#L33)), but it still awaits:

- API/auth initialization
- config service initialization
- quota manager initialization

in sequence ([ServiceInitializer.ts](/Users/hongyuan/project/v4/tapword-translator/src/2_background/services/ServiceInitializer.ts#L122)).

From the logs, the first translation request overlaps with:

- `ConfigService` cloud fetch
- `QuotaManager` initialization
- network probe

Those are not all required before serving the first translation.

### 3. JWT token is memory-only, so service worker restarts reintroduce cold auth

`AuthService` keeps the token only in memory via `currentToken` ([AuthService.ts](/Users/hongyuan/project/v4/tapword-translator/src/5_backend/services/AuthService.ts#L25)).  
In MV3, the service worker is explicitly ephemeral and may be unloaded between requests. Chrome’s guidance is to persist state needed across worker runs rather than relying on globals:

- [About extension service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers)
- [Migrate to a service worker](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers)
- [`chrome.storage.session`](https://developer.chrome.com/docs/extensions/reference/api/storage)

Best-practice inference: hot auth/session state should survive service-worker restarts when security requirements allow it. `chrome.storage.session` is the right candidate because it is memory-backed for the browser session and not exposed to content scripts by default.

### 4. Quota/config are mostly cache-friendly, but request-path still touches them cold

`ConfigService` already supports cached/default synchronous reads ([ConfigService.ts](/Users/hongyuan/project/v4/tapword-translator/src/5_backend/services/ConfigService.ts#L97)), but initialization still awaits a remote fetch on cold start ([ConfigService.ts](/Users/hongyuan/project/v4/tapword-translator/src/5_backend/services/ConfigService.ts#L68)).

`QuotaManager.checkTranslationQuota()` calls `ensureDataIsToday()` on the request path ([QuotaManager.ts](/Users/hongyuan/project/v4/tapword-translator/src/5_backend/services/QuotaManager.ts#L89)). If quota data is not warm yet, the first request may still trigger storage work.

These costs are small compared with the network call, but they are pure extension overhead and stack onto the cold path.

### 5. Perceived latency starts before the loading card appears

In the content pipeline, loading UI is shown only after:

- surrounding-text extraction for language detection
- async language detection
- selection classification / expansion
- context extraction

([TranslationPipeline.ts](/Users/hongyuan/project/v4/tapword-translator/src/1_content/handlers/TranslationPipeline.ts#L106), [TranslationPipeline.ts](/Users/hongyuan/project/v4/tapword-translator/src/1_content/handlers/TranslationPipeline.ts#L194), [TranslationPipeline.ts](/Users/hongyuan/project/v4/tapword-translator/src/1_content/handlers/TranslationPipeline.ts#L307))

Even if this is only tens of milliseconds, users interpret it as “the first click did not take immediately”.

## Optimization Space

There is still reasonable optimization space. The dominant translation network call will remain, but the extension can remove most extra cold-start cost and make the UI feel immediate.

## Recommended Plan

### Phase 1: Make pre-activation deterministic

Priority: highest  
Risk: low

Actions:

- Introduce a background-level `coreServicesReadyPromise`
- Split startup into:
  - critical: auth + API client
  - non-critical: config refresh, quota warm-up, network probe
- Change `PAGE_ACTIVATED` so it does not bail out when auth is not initialized yet
- Instead, `PAGE_ACTIVATED` should:
  - await critical readiness
  - trigger token warm-up
  - optionally trigger quota/config warm-up in parallel

Expected result:

- first real translation usually finds auth already ready
- warm-up becomes deterministic instead of best-effort

### Phase 2: Stop blocking cold start on config fetch

Priority: high  
Risk: low

Actions:

- refactor `ConfigService.initialize()` into:
  - load cached/default config synchronously
  - mark service ready
  - kick off remote refresh in background without awaiting it
- keep the existing auto-refresh timer
- keep fallback behavior unchanged

Expected result:

- service worker reaches “able to translate” state earlier
- first translation no longer competes with `/api/v1/config` for startup attention

### Phase 3: Persist JWT in `chrome.storage.session`

Priority: high  
Risk: medium

Actions:

- persist `{ token, expiresIn, obtainedAt, baseURL, uid }` in `chrome.storage.session`
- hydrate `AuthService` from session storage during initialization
- validate expiry with the existing buffer logic before reuse
- clear session token whenever:
  - base URL changes
  - credentials change
  - token refresh fails with auth error

Why this matters:

- subsequent service-worker cold starts in the same browser session avoid re-auth
- this directly targets the MV3 “worker got unloaded” problem

Expected result:

- many “first translation on a page” cases become warm even if the worker restarted

### Phase 4: Preload quota state off the request path

Priority: medium  
Risk: low

Actions:

- warm `QuotaManager` during `PAGE_ACTIVATED` or immediately after core readiness
- ensure `checkTranslationQuota()` is read-mostly when already warm
- avoid storage writes during the first translation unless the date actually rolled over

Expected result:

- removes small but unnecessary cold storage work from the translation path

### Phase 5: Improve perceived responsiveness in content script

Priority: medium  
Risk: medium

Actions:

- show a lightweight pending affordance earlier, before async language detection finishes
- keep the richer translation card creation after the final normalized range is known
- add timing logs around:
  - range normalization
  - language detection
  - context extraction
  - message send
  - background handler
  - token fetch
  - translate API call

Expected result:

- user sees immediate reaction on first click
- easier to separate UI delay from backend delay in future traces

## Suggested Implementation Order

1. deterministic `PAGE_ACTIVATED` warm-up
2. split critical vs non-critical background initialization
3. make config fetch non-blocking
4. persist JWT in `chrome.storage.session`
5. preload quota state
6. add earlier pending UI and end-to-end timing metrics

## What I Would Not Optimize First

- language detection algorithm changes
- retry timing in `translationRequest.ts`
- backend translation prompt/model behavior

Reason:

- current logs show the retry path is not the problem
- `chrome.i18n.detectLanguage` is not dominating the sampled trace
- the biggest extension-side win is cold-start orchestration, not micro-optimizing the content pipeline first

## Success Metrics

Track these before/after:

- `page_activated -> token_ready`
- `translate_click -> loading_ui_visible`
- `translate_click -> background_message_received`
- `background_message_received -> api_post_start`
- `api_post_start -> api_post_end`
- `translate_click -> final_result_rendered`

Target:

- remove most extension-added latency before `api_post_start`
- make loading UI appear nearly immediately after click
- reduce repeated token fetches within one browser session

## Bottom Line

Yes, there is still meaningful room to optimize.

The current first-translation delay is not mainly a “translation engine is slow” problem. It is mostly a cold-path orchestration problem:

- pre-warm can race and no-op
- startup still waits on non-critical work
- JWT state is lost across MV3 worker restarts
- perceived responsiveness begins too late in the content pipeline

The highest-value fix is to make `PAGE_ACTIVATED` warm-up deterministic and move auth/config/quota preparation off the critical path of the first real translation.
