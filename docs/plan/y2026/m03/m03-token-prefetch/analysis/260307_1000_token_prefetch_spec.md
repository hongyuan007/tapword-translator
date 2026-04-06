# Token Pre-Warming: Technical Specification

**Date**: 2026-03-07  
**Version**: 1.0  
**Status**: Draft  

---

## 1. Problem Statement

Every time a user opens a fresh web page and triggers their first translation, there is a noticeable cold-start delay of **300–500 ms** compared to subsequent translations. This delay is caused by a JWT token fetch that happens synchronously on the critical path of the translation request.

---

## 2. Summary of Current Auth Flow

### 2.1 Token Lifecycle Constants

| Constant | Value | File |
|---|---|---|
| `TOKEN_REFRESH_BUFFER_SECONDS` | 300 s (5 min) | `src/5_backend/constants/index.ts` |
| `AUTO_REFRESH_INTERVAL_MS` | 120 000 ms (2 min) | `src/5_backend/constants/index.ts` |
| Token TTL (from JWT `exp`) | ~1200 s (20 min) | Observed in background logs |
| Effective valid window | 1200 - 300 = 900 s (15 min) | Computed |

### 2.2 AuthService Key Behaviors (`src/5_backend/services/AuthService.ts`)

- **Storage**: Token is kept in an **in-memory** field `currentToken: JWTToken | null`. It is **not persisted** to `chrome.storage`.
- **`getToken()`**: Checks validity first. If token is missing or `isTokenValid()` returns `false` (within buffer), triggers a `fetchNewToken()` HTTP call.
- **`isTokenValid()`**: Returns `false` if `now >= (obtainedAt + expiresIn*1000) - bufferTime`.
- **In-flight deduplication**: A `refreshPromise: Promise<string> | null` field exists. If a refresh is already in progress, subsequent callers `await` the same promise — only **one HTTP call** is ever made concurrently. This is already correct.
- **`startAutoRefresh()`**: Runs a `setInterval` at `AUTO_REFRESH_INTERVAL_MS` (2 min) to check and refresh near-expiry tokens. **Critical gap**: the timer body has `if (this.currentToken)` — if there is no token in memory (e.g. service worker just restarted), the timer does nothing. No proactive fetch occurs.
- **`refreshToken()`**: Clears `currentToken` then calls `getToken()`. Public.
- No `ensureValidToken()` / `warmUp()` method exists.

### 2.3 Current First-Translation Sequence

```
Content Script (page)               Background Service Worker           Backend Server
      |                                        |                               |
      | -- dblclick / drag selection --------> |                               |
      |                                        |                               |
      | -- TRANSLATE_REQUEST message --------> |                               |
      |                                        |                               |
      |                          TranslationRequestHandler                     |
      |                          calls translateModule.translateWord()         |
      |                                        |                               |
      |                          APIService.performRequest()                   |
      |                            calls AuthService.getToken()               |
      |                                        |                               |
      |                            [token missing / expired]                   |
      |                            fetchNewToken()  -------- POST /auth -----> |
      |                                        |                               |
      |                                        | <------- JWT (~300-500 ms) -- |
      |                                        |                               |
      |                            performRequest()  --- POST /translate ----> |
      |                                        |                               |
      |                                        | <------- translation -------- |
      |                                        |                               |
      | <-- TRANSLATE_RESPONSE message ------- |                               |
```

Total user-perceived latency on first request = **auth round-trip + translation round-trip**.

---

## 3. Root Cause of Cold-Start Latency

There are two compounding conditions:

**Condition A — Service worker is ephemeral.**  
Chrome may suspend the background service worker after ~30 seconds of inactivity. When suspended, the V8 heap (including `AuthService.currentToken`) is deallocated. On next wake-up (triggered by a message from a content script), the token is gone and must be refetched.

**Condition B — No proactive prefetch on page load.**  
The content script (`src/1_content/index.ts`) sends no initialization message to the background on injection. The background therefore has no opportunity to pre-warm the token while the user is reading the page.

**Combined result:** When a user opens a new tab, the background worker restarts with no token, the auto-refresh timer does nothing (it skips when no token exists), and the token fetch races with the user's first translation action.

---

## 4. Proposed Solutions

### Option A: Content Script Sends `PAGE_ACTIVATED` on Injection

**How it works:**  
Immediately after the content script is injected (inside `init()` in `src/1_content/index.ts`), it sends a lightweight fire-and-forget message `PAGE_ACTIVATED` to the background. The background handler calls `authService.getToken()` proactively. By the time the user selects text and triggers a translation (typically ≥ 2 seconds after page load), the token is already cached.

**Pros:**
- Directly targets the observed problem with minimal code change.
- Works even if the service worker was dormant — the message arrival wakes it up.
- No polling or alarms needed.
- Race condition is already handled by the existing `refreshPromise` deduplication in `AuthService`.

**Cons:**
- Relies on the content script being injected on every tab/navigation. Pages that block content script injection (e.g., `chrome://` pages) won't trigger warm-up.
- Adds one extra message per page load (negligible overhead — no response is expected).

---

### Option B: Background Timer / Alarm-Based Proactive Refresh

**How it works:**  
Fix the `startAutoRefresh()` timer body so that it also fetches a token when `currentToken === null` (not just when a token exists and is near expiry). Additionally, register a `chrome.alarms` listener in `src/2_background/index.ts` so that even if the timer is cleared on suspend/resume, the alarm re-triggers warm-up.

**Pros:**
- Keeps the token warm even during extended browsing sessions without page loads.

**Cons:**
- `chrome.alarms` minimum interval is 1 minute, which means the worst-case cold start is still ~60 seconds (albeit an unlikely scenario with Option A in place).
- The timer fix alone does not help on cold start because the service worker must first be woken up by some event.
- Fixing the timer body to fetch when `currentToken === null` means every service-worker restart will immediately trigger a network round-trip even if the user never opens a tab that uses the extension.

---

### Option C: Combination (Recommended)

Use **Option A as the primary fix** and **a partial fix to Option B** as a secondary safety net:

1. `PAGE_ACTIVATED` message: the main mechanism that directly eliminates the observed cold-start delay.
2. Fix `startAutoRefresh()`: remove the `if (this.currentToken)` guard so that on service-worker restart the first timer tick also fetches a fresh token. This closes the edge case where the user already has a tab open when the worker restarts.

The `chrome.alarms` approach is deliberately omitted as it adds disproportionate complexity for a marginal gain.

---

## 5. Recommended Approach

**Use Option C** (combination), phased to keep the diff small and reviewable.

**Rationale:**
- Option A alone eliminates the observed cold-start on new page loads — which is the reported UX issue.
- The `startAutoRefresh()` fix is a one-line change that closes a secondary gap with zero additional infrastructure.
- The existing `refreshPromise` deduplication in `AuthService` already handles multi-tab race conditions — no additional locking is required.

---

## 6. Exact Code Changes Required

### 6.1 Add `PAGE_ACTIVATED` to `MessageType`

**File**: `src/0_common/types/index.ts`

```typescript
// Before
export type MessageType = "TRANSLATE_REQUEST" | "FRAGMENT_TRANSLATE_REQUEST" | "SPEECH_SYNTHESIS_REQUEST" | "SPEECH_STOP_REQUEST" | "POPUP_BOOTSTRAP_REQUEST"

// After
export type MessageType = "TRANSLATE_REQUEST" | "FRAGMENT_TRANSLATE_REQUEST" | "SPEECH_SYNTHESIS_REQUEST" | "SPEECH_STOP_REQUEST" | "POPUP_BOOTSTRAP_REQUEST" | "PAGE_ACTIVATED"

// Add new message interface after existing message interfaces:

/**
 * Page activated message (sent by content script on injection for token pre-warming)
 */
export interface PageActivatedMessage {
    type: "PAGE_ACTIVATED"
}
```

### 6.2 Content Script: Send Pre-Warm Message on Injection

**File**: `src/1_content/index.ts`

Add a fire-and-forget pre-warm call at the very beginning of `init()`, before awaiting `initializeUserSettings()`. This ensures the message is sent as early as possible.

```typescript
import type { PageActivatedMessage } from "@/0_common/types"

async function init(): Promise<void> {
    // Pre-warm: fire-and-forget, non-blocking. Wakes up the
    // background worker and triggers proactive token refresh.
    chrome.runtime.sendMessage({ type: "PAGE_ACTIVATED" } as PageActivatedMessage).catch(() => {
        // Ignore: background may not be ready yet on first install
    })

    // Initialize user settings (existing code follows...)
    await initializeUserSettings()
    // ... rest of init unchanged
}
```

### 6.3 New Handler: `TokenWarmUpHandler.ts`

**File**: `src/2_background/handlers/TokenWarmUpHandler.ts` *(new file)*

```typescript
/**
 * Token Warm-Up Handler
 *
 * Handles PAGE_ACTIVATED messages from content scripts.
 * Proactively fetches a JWT token before the user's first translation request.
 */

import * as loggerModule from "@/0_common/utils/logger"
import { getAuthService } from "@/5_backend"

const logger = loggerModule.createLogger("TokenWarmUpHandler")

/**
 * Handle PAGE_ACTIVATED message from content script.
 * Proactively ensures a valid JWT token is cached.
 * Fire-and-forget from the content script side — no response payload needed.
 */
export function handlePageActivated(sendResponse: (response: { status: string }) => void): void {
    const authService = getAuthService()

    if (!authService.isInitialized()) {
        logger.debug("AuthService not yet initialized, skipping warm-up")
        sendResponse({ status: "not_initialized" })
        return
    }

    // Non-blocking: kick off token prefetch but do not wait for it
    authService
        .getToken()
        .then(() => {
            logger.debug("Token pre-warm completed")
        })
        .catch((error) => {
            // Warm-up errors are non-fatal — the actual translate request will retry
            logger.warn("Token pre-warm failed (non-fatal):", error)
        })

    // Respond immediately; the actual fetch continues asynchronously
    sendResponse({ status: "warming" })
}
```

### 6.4 Register Handler in `MessageRouter.ts`

**File**: `src/2_background/messaging/MessageRouter.ts`

```typescript
// Add import at top:
import * as TokenWarmUpHandler from "../handlers/TokenWarmUpHandler"

// Add case in the switch statement:
case "PAGE_ACTIVATED":
    TokenWarmUpHandler.handlePageActivated(sendResponse)
    return true
```

### 6.5 Fix `startAutoRefresh()` in `AuthService.ts`

**File**: `src/5_backend/services/AuthService.ts`

Remove the `if (this.currentToken)` guard so that a timer tick also triggers a fetch when no token is cached (i.e., after a service-worker restart).

```typescript
// Before (inside setInterval callback):
if (this.currentToken) {
    const now = Date.now()
    // ...
    if (!this.isTokenValid(this.currentToken)) {
        logger.info("Token near expiration, refreshing...")
        await this.refreshToken()
        logger.info("Auto-refresh completed successfully")
    } else {
        logger.debug("Token still valid, no refresh needed")
    }
} else {
    logger.info("No token cached, will be fetched on next API request")
}

// After:
if (this.currentToken && this.isTokenValid(this.currentToken)) {
    logger.debug("Auto-refresh: token still valid, no action needed")
    return
}

// Token is missing or near expiration — fetch proactively
logger.info("Auto-refresh: token missing or near expiry, pre-fetching...")
await this.getToken()
logger.info("Auto-refresh: pre-fetch completed")
```

---

## 7. Race Condition Handling

Multiple tabs opening simultaneously will each send `PAGE_ACTIVATED` to the background. Each triggers `authService.getToken()`. The `AuthService` already deduplicates concurrent refresh calls via `refreshPromise`:

```typescript
// Already in AuthService.getToken():
if (this.refreshPromise) {
    logger.info("Token refresh already in progress, waiting...")
    return await this.refreshPromise  // ← second caller waits; no second HTTP call
}
this.refreshPromise = this.fetchNewToken()
```

**Result:** Regardless of how many tabs are open and send `PAGE_ACTIVATED`, exactly **one** HTTP call is made to the auth endpoint. All subsequent callers share the same resolved token. No lock or additional synchronization is required.

---

## 8. Expected Latency Improvement

| Scenario | Before | After |
|---|---|---|
| First translation after fresh tab open | auth RTT (~400 ms) + translate RTT | translate RTT only |
| First translation after service worker restart | auth RTT + translate RTT | translate RTT only (token fetched during page load) |
| Subsequent translations | translate RTT | translate RTT (unchanged) |
| Two tabs open simultaneously | 2× auth RTT risk | 1× auth RTT (deduplication) |

---

## 9. Complete List of Files to Be Modified

| File | Change Type | Description |
|---|---|---|
| `src/0_common/types/index.ts` | Modify | Add `"PAGE_ACTIVATED"` to `MessageType` union; add `PageActivatedMessage` interface |
| `src/1_content/index.ts` | Modify | Fire-and-forget `PAGE_ACTIVATED` message at start of `init()` |
| `src/2_background/messaging/MessageRouter.ts` | Modify | Import `TokenWarmUpHandler`; add `case "PAGE_ACTIVATED"` |
| `src/2_background/handlers/TokenWarmUpHandler.ts` | **New file** | Handler that calls `authService.getToken()` proactively |
| `src/5_backend/services/AuthService.ts` | Modify | Fix `startAutoRefresh()` to fetch token even when `currentToken` is null |

---

## 10. Out of Scope

- Persisting the JWT token to `chrome.storage` — adds complexity (token rotation, race with storage reads) and was not requested. The pre-warm approach eliminates the need for persistence.
- `chrome.alarms`-based refresh — disproportionate complexity for the marginal gain.
- Backend changes — none required.
