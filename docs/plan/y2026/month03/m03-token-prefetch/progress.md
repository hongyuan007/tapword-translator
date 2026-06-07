# m03-token-prefetch Progress

## Goal
Optimize first-translation latency by proactively refreshing the JWT token before the user makes their first translation request.

## Status: Complete

## Tasks
- [x] Research: analyze AuthService, content script messaging, and background handler patterns
- [x] Research: identify best practices for token pre-warming in browser extensions
- [x] Implementation: add token pre-warm logic
- [x] Bug fix: critical race condition [C-1] — cold-start PAGE_ACTIVATED always lost

## Changes Implemented

| File | Change |
|---|---|
| `src/0_common/types/index.ts` | Added `"PAGE_ACTIVATED"` to `MessageType` union; added `PageActivatedMessage` interface |
| `src/1_content/index.ts` | Fire-and-forget `PAGE_ACTIVATED` sendMessage at the start of `init()` before `initializeUserSettings()` |
| `src/2_background/handlers/TokenWarmUpHandler.ts` | **New file** — calls `authService.getToken()` proactively, responds immediately; `not_initialized` case logs at debug level (non-error) |
| `src/2_background/messaging/MessageRouter.ts` | Imported `TokenWarmUpHandler`; added `case "PAGE_ACTIVATED"` dispatch |
| `src/2_background/index.ts` | Added proactive cold-start warm-up: calls `getAuthService().getToken()` fire-and-forget immediately after `initializeServices()` completes; fixes [C-1] race condition |
| `src/5_backend/services/AuthService.ts` | Fixed `startAutoRefresh()` — removed silent `else` branch; now calls `getToken()` proactively when no token is cached or token is near expiry |

## Log
- 260307: Task initialized
- 260307: Implementation complete; `npm run type-check` passes with zero errors
- 260307: Code review [C-1] race condition fix applied — added cold-start proactive warm-up in `src/2_background/index.ts`; `npm run type-check` passes with zero errors
