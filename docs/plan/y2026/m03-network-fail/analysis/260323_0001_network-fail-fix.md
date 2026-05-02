# Spec: #22 Network Translation Failure Fix

**Issue**: #22 — 连接美国学校网络后翻译失败，切换到手机热点翻译正常  
**Date**: 2026-03-23  
**Status**: Draft  
**Scope**: tapword-translator (frontend) + translate-api (backend)  
**Severity**: S2 (Major) — feature partially broken on restricted networks

---

## 1. Current State Analysis

### 1.1 Frontend API Call Flow

```
User selects text → TranslationService.translateWord()
  → (provider switch based on userSettings.translationProvider)
  → "official" path: post("/api/v1/translate", request) via APIService
  → APIService.performRequest() → fetch() with AbortController timeout
```

**Key files:**
- `src/5_backend/services/APIService.ts` — Central HTTP client
- `src/6_translate/services/TranslationService.ts` — Provider routing + error handling
- `src/2_background/services/ServiceInitializer.ts` — Base URL config + network probe
- `src/5_backend/constants/index.ts` — `API_BASE_URL_MAP` (auto/china/global)

**Current network error handling in APIService:**
- `timeout` (AbortError) → thrown as `APIError({ type: "timeout" })`
- Network failures (Failed to fetch, DNS error, etc.) → caught as generic `Error`, wrapped as `APIError({ type: "unexpectedError" })`
- HTTP 403/429/5xx → `APIError({ type: "requestError", code })`
- No explicit timeout is passed for translation requests (defaults to none — browser's fetch has no built-in timeout)
- **No retry logic** for transient network errors

**Current fallback mechanism:**
- `APIService` has a `fallbackBaseURL` feature: on 403/429/5xx/timeout/unexpected, it probes the fallback URL
- Fallback is only enabled for Chinese users in `auto` region mode (`resolveFallbackBaseURL`)
- **Non-Chinese users get NO fallback** — if `global` URL is blocked, they're stuck

**Current error mapping in `handleAPIError()`:**
- `requestError`, `timeout`, `unexpectedError` ALL map to generic `error.serverBusy`
- No distinction between "your network is blocking us" vs "our server is down"

### 1.2 Backend Translation Flow

```
POST /api/v1/translate → jwtMiddleware → versionMiddleware → rateLimiter → translateHandler
  → translation.service.translateWord()
  → Routes to LLM provider based on REGION env var:
    - REGION=america → Atlas Cloud (OpenRouter)
    - Default (china) → Qwen (BIANLIAN)
```

**Key files:**
- `src/1_translate/services/translation.service.ts` — Provider routing
- `src/1_translate/services/translate/openai.service.ts` — OpenAI-compatible client (10s timeout)
- `src/1_translate/controllers/translation.controller.ts` — Request handling

**Backend timeout:** 10s for upstream LLM calls. Errors mapped to `UPSTREAM_PROVIDER_TIMEOUT` (20504).

### 1.3 Network Probe

`ServiceInitializer.performNetworkProbe()` runs at startup for Chinese users on `auto`:
1. Probes default (auto) URL with 5s timeout
2. If fails, probes China URL
3. If China works, auto-switches setting to `china`

**Gap:** This only runs for Chinese users (`isLikelyChineseUser()`). International users with restricted networks (US school firewalls) are never probed or auto-switched.

---

## 2. Root Cause Analysis

### Primary Cause: Frontend `fetch()` Fails Silently on Restricted Networks

When a user on a US school network connects to the global API endpoint:

1. **The school firewall/proxy blocks or drops connections** to the API server (DNS poisoning, IP blocking, HTTPS interception, or SNI-based filtering)
2. `fetch()` throws a `TypeError: Failed to fetch` (no network response)
3. `APIService` wraps it as `APIError({ type: "unexpectedError" })`
4. `TranslationService.handleAPIError()` maps ALL unhandled errors to generic `error.serverBusy`
5. User sees "服务异常, 请稍后重试" — **no indication it's a network issue**

### Secondary Causes

| Cause | Likelihood | Evidence |
|---|---|---|
| School proxy/firewall blocks API server IP/domain | **High** | Works on mobile hotspot; school networks commonly block non-whitelisted domains |
| DNS resolution failure on restricted DNS | Medium | School DNS may not resolve the API domain |
| No timeout on translation requests | Medium | `performRequest` uses `options?.timeout` which is never passed from `TranslationService` |
| Upstream LLM provider blocked from backend server | Low | Backend is hosted on Alibaba Cloud (China), so LLM calls go to Chinese providers |
| CORS preflight blocked by proxy | Low | POST with JSON body triggers preflight; proxies may block OPTIONS requests |

### Key Insight

The issue is almost certainly **client-side network blocking** (extension → API server connection), NOT backend issues. The backend server itself is likely fine since it's hosted on Alibaba Cloud and uses Chinese LLM providers. The user's restricted network is blocking the outbound HTTPS connection from the browser to the API server.

---

## 3. Proposed Changes

### 3.1 Frontend: Better Error Classification (tapword-translator)

**File:** `src/6_translate/services/TranslationService.ts`

**Change:** Update `handleAPIError()` to distinguish network errors from server errors:

```typescript
function handleAPIError(error: APIError): never {
    switch (error.type) {
        // NEW: Network-level errors (user's network is the problem)
        case "timeout":
            throw new TranslationError(
                i18nModule.translate("error.networkTimeout"),
                i18nModule.translate("error.short.networkTimeout")
            )
        case "requestError":
            if (error.code && error.code >= 500) {
                // 5xx = server-side issue
                throw new TranslationError(
                    i18nModule.translate("error.serverBusy"),
                    i18nModule.translate("error.short.serverBusy")
                )
            }
            // 4xx or no code = likely network/proxy issue
            throw new TranslationError(
                i18nModule.translate("error.networkError"),
                i18nModule.translate("error.short.networkError")
            )
        case "unexpectedError":
            // "Failed to fetch" = network blocked/unreachable
            throw new TranslationError(
                i18nModule.translate("error.networkError"),
                i18nModule.translate("error.short.networkError")
            )
        // ... existing cases for rateLimited, businessError, etc.
    }
}
```

### 3.2 Frontend: Add Default Timeout for Translation Requests (tapword-translator)

**File:** `src/6_translate/services/TranslationService.ts`

**Change:** Pass a default timeout to all cloud translation requests:

```typescript
const TRANSLATION_REQUEST_TIMEOUT_MS = 15000 // 15 seconds

const data = await post<TranslationApiResponse, TranslationApiRequest>(
    TRANSLATION_API_ENDPOINTS.TRANSLATE,
    request,
    { timeout: TRANSLATION_REQUEST_TIMEOUT_MS }
)
```

This prevents requests from hanging indefinitely on restricted networks that don't immediately reject but silently drop packets.

### 3.3 Frontend: Network Error i18n Keys (tapword-translator)

**Files:** `_locales/en/messages.json`, `_locales/zh_CN/messages.json`

**Add keys:**
- `error.networkError` / `error.networkTimeout` — Full message explaining network issue + suggestion to try another network
- `error.short.networkError` / `error.short.networkTimeout` — Compact display message

### 3.4 Frontend: Provider Auto-Fallback (tapword-translator) — Future Enhancement

**File:** `src/6_translate/services/TranslationService.ts`

**Concept:** When the official cloud API fails with a network error, automatically retry with an available fallback provider (Bing Translate, which uses Microsoft's CDN and is less likely to be blocked on school networks).

```
Official API fails (networkError) → Retry with Bing Translate → Return result or show combined error
```

**This is a larger change — recommend as Phase 2 after basic error messaging is shipped.**

### 3.5 Backend: No Changes Required

The backend's error handling is adequate. The issue is client-side network blocking, not server-side failures. The backend already:
- Returns proper error codes (20504 for upstream timeout)
- Has 10s timeout on LLM calls
- Has proper CORS headers (configured elsewhere)

---

## 4. Risks / Edge Cases

| Risk | Mitigation |
|---|---|
| False positive: classifying a transient server error as "network error" | `requestError` with 5xx codes still shows "server busy"; only 4xx/no-code shows "network error" |
| Timeout too aggressive: slow but working connections | 15s timeout is generous; most school networks either block immediately or within seconds |
| Auto-fallback to Bing may have different translation quality | Fallback should be opt-in or clearly indicated to user; Phase 2 only |
| i18n keys missing in some locales | Default fallback to English; add keys for all supported locales |
| User on VPN/proxy that intermittently blocks | Network error message should suggest checking network/VPN settings |
| AbortController timeout not supported in all Chrome versions | MV3 targets Chrome 116+; AbortController is well-supported |

## 5. Verification Plan

### Unit Tests

1. **`handleAPIError` error mapping**: Verify each `APIErrorType` produces the correct `TranslationError` message
2. **Timeout propagation**: Verify translation requests include the timeout option

### Integration Tests

3. **Network block simulation**: Use Vitest to mock `fetch` to throw `TypeError: Failed to fetch` and verify user sees network error message
4. **Timeout simulation**: Mock `fetch` to never resolve (use delayed promise + abort) and verify timeout message

### Manual Testing

5. **Chrome DevTools throttling**: Set network to "Offline" or "Slow 3G" and verify appropriate error message
6. **Blocked domain**: Use hosts file to block the API domain and verify network error message appears
7. **Verify existing functionality**: Ensure normal translation still works on unrestricted networks

### Test Matrix

| Scenario | Expected Behavior |
|---|---|
| Normal network, official API | Translation succeeds (no change) |
| Network offline | "Network error" message with helpful suggestion |
| API server returns 502/503 | "Server busy" message |
| Request times out (15s) | "Request timeout" message |
| Rate limited (429) | "Rate limited" message (no change) |
| Business error (content blocked) | "Content blocked" message (no change) |

---

## 6. Implementation Priority

### Phase 1 (This fix — Small scope, high value)
1. Add timeout to translation requests (3.2)
2. Improve error classification in `handleAPIError()` (3.1)
3. Add i18n keys for network errors (3.3)

**Estimated effort**: ~1-2 hours, low risk

### Phase 2 (Future — Medium scope, medium value)
4. Auto-fallback to Bing Translate on network error (3.4)
5. Network health indicator in settings UI
6. Provider selection UI (per reviewer suggestion in #22)

**Estimated effort**: ~4-6 hours, medium risk

### Phase 3 (Future — Larger scope)
7. Offline translation support (cached results)
8. Multiple cloud server endpoints with load balancing
