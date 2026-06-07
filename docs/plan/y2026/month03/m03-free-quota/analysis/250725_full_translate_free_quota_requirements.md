# Full-Text Translation Free Quota — Product Requirements Document

> Date: 2025-07-25  
> Status: Draft (Revised 2026-03-21)  
> Module: Backend (`translate-api`) + Frontend (`tapword-translator`)  
> Objective: Implement server-side daily free quota enforcement for full-text translation, with frontend UI for quota visibility and user guidance

---

## 1. Background & Problem Statement

### 1.1 Current State

Full-text translation (Page Translate) is the extension's flagship feature. Currently:

| Aspect | Status | Risk |
|--------|--------|------|
| **Server-side quota enforcement** | ❌ Does not exist | Any user can consume unlimited LLM tokens via full-text translation |
| **Client-side quota** | ⚠️ Exists for word/fragment translation only | `QuotaManager` tracks daily counts in `chrome.storage.local`, but `FullTranslateBatchHandler` **skips** the check entirely |
| **Quota UI in popup** | ❌ Does not exist | Users have no visibility into their remaining quota |
| **User guidance on quota exhaustion** | ❌ Does not exist for full-text translation | When quota is consumed, no feedback is provided |
| **Server-side usage tracking** | ❌ No database table, no per-user tracking | `TokenTracker` is global in-memory aggregate only |

### 1.2 Business Goals

1. **Cost Control**: Full-text translation consumes significantly more LLM tokens per request than word/fragment translation. Without server-side enforcement, costs are unbounded.
2. **Fair Usage**: Ensure every user gets a reasonable daily free allowance.
3. **User Experience**: Provide clear, non-intrusive quota visibility so users understand their usage and the product's value.
4. **Upgrade Path**: Lay the groundwork for a future paid tier (not in scope for V1, but the data model should accommodate it).

---

## 2. Quota Model Design

### 2.1 Quota Type: Full-Text Translation Quota

A new quota type **independent** from the existing word/fragment translation quota:

| Quota Type | Identifier | What Counts | Scope |
|-----------|-----------|-------------|-------|
| Existing: Word/Fragment Translation | `translation` | Each word or fragment translate API call | Per user per day |
| Existing: Speech Synthesis | `speech` | Each TTS API call | Per user per day |
| **New: Full-Text Translation** | `fullTextTranslation` | Total character count of all text segments in a batch request | Per user per day |

### 2.2 Counting Unit

**One "credit" = one character of source text translated via full-text batch API.**

Each full-text batch request's character consumption = **sum of `text.length`** for all segments in the batch.

Rationale:
- A single `POST /api/v1/translate/full-text-batch` request contains 1–30 text segments of varying length
- Counting characters (rather than segments or requests) provides a much more accurate proxy for LLM token consumption, similar to how LLM APIs charge by token count
- Short segments (e.g., a heading "Introduction") should cost less than long paragraphs
- A typical web page contains roughly 3,000–10,000 characters of translatable text, so a daily free quota of ~50,000 characters allows translating 5–15 pages of average web content

### 2.3 Default Free Quota

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `dailyFreeFullTextTranslationChars` | **50,000** | ~5–15 pages per day depending on content density. Generous enough for casual use, bounded enough for cost control |

This value is configurable via backend environment variable and returned via the `/api/v1/config` endpoint.

### 2.4 Quota Reset

- Daily reset at **00:00 UTC** (server-side, consistent across time zones)
- The `date` field in the usage record uses UTC date string (`YYYY-MM-DD`)

---

## 3. Backend Requirements

### 3.1 Database Schema: `daily_usage` Table

A new SQLite table to persist per-user daily usage:

```sql
CREATE TABLE IF NOT EXISTS daily_usage (
    id                                INTEGER PRIMARY KEY AUTOINCREMENT,
    uid                               TEXT    NOT NULL,
    date                              TEXT    NOT NULL,   -- YYYY-MM-DD (UTC)
    full_text_translation_char_count  INTEGER NOT NULL DEFAULT 0,
    translation_count                 INTEGER NOT NULL DEFAULT 0,   -- future: migrate existing client-side tracking
    speech_count                      INTEGER NOT NULL DEFAULT 0,   -- future: migrate existing client-side tracking
    created_at                        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at                        TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (uid, date)
);

CREATE INDEX idx_daily_usage_date ON daily_usage(date);
```

**Design decisions:**
- **Surrogate primary key**: Auto-increment `id` as PRIMARY KEY, with `(uid, date)` as a UNIQUE constraint. This is a general database design rule: always prefer a surrogate integer PK over composite natural keys for better ORM compatibility, simpler foreign key references, and consistent conventions across tables. **This rule should be documented in the server repo's `AGENTS.md`.**
- Includes `translation_count` and `speech_count` columns for future migration (V1 only uses `full_text_translation_char_count`)
- SQLite `UPSERT` (INSERT ... ON CONFLICT ... DO UPDATE) for atomic increment
- Date index for efficient cleanup of old records

### 3.2 Data Access Layer

New mapper: `src/3_database/mapper/dailyUsage.mapper.ts`

```typescript
interface DailyUsageMapper {
    // Get today's usage for a user (returns null if no record yet)
    getUsageByUidAndDate(uid: string, date: string): DailyUsageRow | null;
    
    // Atomically increment full-text translation character count, return new count
    incrementFullTextTranslationCharCount(uid: string, date: string, charCount: number): number;
    
    // Cleanup records older than N days (cron/scheduled)
    deleteOlderThan(date: string): number;
}
```

### 3.3 Quota Service

New service: `src/6_quota/services/quota.service.ts`

```typescript
interface QuotaService {
    // Check if user has remaining full-text translation quota
    // Throws BusinessError(QUOTA_EXCEEDED) if exhausted
    checkFullTextTranslationQuota(uid: string): void;
    
    // Record usage after successful translation
    recordFullTextTranslationUsage(uid: string, charCount: number): void;
    
    // Get current usage summary for a user (for API response)
    getUsageSummary(uid: string): UsageSummary;
}

interface UsageSummary {
    fullTextTranslation: {
        used: number;     // character count consumed today
        limit: number;    // daily character limit
        remaining: number;
    };
}
```

### 3.4 Quota Caching (In-Memory)

To avoid synchronous DB calls on the hot path, quota checks and updates use an **in-memory cache** backed by persistent DB storage.

#### Design

| Component | Role |
|-----------|------|
| **In-memory cache** (e.g., `Map<string, CacheEntry>` or LRU cache) | Hot path: all quota reads and writes go here first |
| **SQLite `daily_usage` table** | Cold/persistent store: source of truth for durability |

New module: `src/6_quota/services/quotaCache.ts`

```typescript
interface QuotaCacheEntry {
    uid: string;
    date: string;          // YYYY-MM-DD (UTC)
    charCount: number;     // current usage
    lastSyncedAt: number;  // timestamp of last DB write
}

interface QuotaCache {
    // Read usage from cache. On miss → read from DB, populate cache, return.
    getUsage(uid: string, date: string): number;
    
    // Increment usage in cache immediately. Async write to DB (fire-and-forget or debounced).
    incrementUsage(uid: string, date: string, charCount: number): number;
}
```

#### Request Flow

1. **Quota check** (middleware): `cache.getUsage(uid, today)` → returns char count from memory
   - Cache hit → return immediately (no DB call)
   - Cache miss → read from DB, populate cache, return
2. **After successful translation** (controller): `cache.incrementUsage(uid, today, charCount)`
   - Update in-memory value immediately
   - Async write to DB (fire-and-forget or debounced batch write)
3. **No synchronous DB call** in the hot path for quota checks

#### Consistency Model

- **Eventual consistency** is acceptable — users may slightly exceed their quota during brief race windows
- The cache is the primary read/write path; DB is for durability only
- On server restart, cache is empty; each user's first request reads from DB

#### Cache Entry Lifecycle

- **TTL**: Auto-expire at end of day (UTC). Alternatively, on each access, check if the cached `date` matches today; if not, treat as miss and reset
- **Eviction**: LRU eviction if memory is a concern (unlikely for moderate user counts)
- **Server restart**: Cache starts empty. First request per user re-populates from DB — slight latency for that single request only

### 3.5 Quota Middleware

New middleware: `src/0_common/middleware/quota.middleware.ts`

A reusable middleware factory for quota enforcement:

```typescript
function createQuotaMiddleware(quotaType: 'fullTextTranslation'): RequestHandler;
```

Applied to `POST /api/v1/translate/full-text-batch` route:
```
verifyJwt → versionCheck → rateLimiter → quotaMiddleware('fullTextTranslation') → controller
```

**Middleware behavior:**
1. Call `quotaService.checkFullTextTranslationQuota(req.user.uid)` — reads from in-memory cache (not DB)
2. If quota exceeded → throw `BusinessError` with code `QUOTA_EXCEEDED` (HTTP 200, `code: 4001`)
3. If quota OK → `next()`

### 3.6 Usage Recording & Quota in Response

After a successful `full-text-batch` translation, record usage and return quota info:

```typescript
// In translation.controller.ts, after successful batch response
const charCount = texts.reduce((sum, t) => sum + t.length, 0);
quotaService.recordFullTextTranslationUsage(req.user.uid, charCount);

// Include quota info in response body
const quota = quotaService.getUsageSummary(req.user.uid);
```

**Important**: Record the actual character count of segments processed, computed as the sum of `text.length` for all segments in the batch.

**Response format** for successful full-text batch translation:

```json
{
    "data": {
        "translations": ["translated text 1", "translated text 2", "..."],
        "quota": {
            "used": 12350,
            "limit": 50000,
            "remaining": 37650
        }
    },
    "code": 0,
    "message": "success"
}
```

The `quota` object is populated from the in-memory cache, so it reflects the latest known usage (eventually consistent). This allows the client to track quota in real-time during translation without extra API calls.

### 3.7 New Error Code

Add to `src/0_common/error/errorCodes.ts`:

```typescript
QUOTA_EXCEEDED: 4001  // Daily free quota exhausted
```

Error response format:
```json
{
    "data": {
        "quotaType": "fullTextTranslation",
        "used": 50000,
        "limit": 50000,
        "resetAt": "2025-07-26T00:00:00Z"
    },
    "code": 4001,
    "message": "Daily free quota exceeded for full-text translation"
}
```

**Key**: The `data` field contains structured quota info for the client to display.

### 3.8 Config Endpoint Update

Update `GET /api/v1/config` response to include the new quota:

```json
{
    "quota": {
        "dailyFreeTranslations": 100,
        "dailyFreeSpeech": 300,
        "dailyFreeFullTextTranslationChars": 50000    // ← NEW (character-based)
    },
    "websiteUrl": "...",
    "chromeExtensionVersion": "..."
}
```

### 3.9 Usage Query Endpoint

`GET /api/v1/quota/usage` — returns the current user's daily usage summary.

**Route**: `verifyJwt → controller`

**Response**:
```json
{
    "data": {
        "date": "2025-07-25",
        "fullTextTranslation": {
            "used": 12350,
            "limit": 50000,
            "remaining": 37650
        }
    },
    "code": 0,
    "message": "success"
}
```

**Usage**: Called on popup open and for periodic refresh. The data comes from the in-memory cache for low-latency response. This endpoint complements the per-response quota info in batch translation responses — useful for popup opens and periodic refreshes when no translation is in progress.

### 3.10 Data Retention

- Daily usage records accumulate over time. Implement a scheduled cleanup:
  - **Retention period**: 10 days (configurable)
  - **Method**: Background cron/timer that calls `dailyUsageMapper.deleteOlderThan(cutoffDate)` daily
  - **V1 simple approach**: Run cleanup at server startup + every 24 hours via `setInterval`

---

## 4. Frontend Requirements

### 4.1 Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Full-Text Translation Quota — Frontend Architecture        │
│                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │  Popup   │◄──►│  Background  │◄──►│  Content Script   │  │
│  │  (UI)    │    │  (Service)   │    │  (Full Translate) │  │
│  └──────────┘    └──────────────┘    └───────────────────┘  │
│       ▲               ▲                      ▲              │
│       │               │                      │              │
│  Quota display   Quota check &          Quota exhaustion    │
│  (percentage)    enforcement            feedback UI         │
│                  (before API call)       (banner/toast)      │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Quota Enforcement in Background (Server-Side Primary, Client-Side Cache)

#### Architecture Change

**Current**: Client-only enforcement in `QuotaManager` (easily bypassed via DevTools)  
**New**: Server-side primary enforcement + client-side cache for instant feedback

**Client-side quota cache** (updated via translation responses):
- After each full-text batch response, the server returns quota info in the response body (`quota: { used, limit, remaining }`)
- `FullTranslateBatchHandler` extracts the quota info and updates the local `QuotaManager` cache
- This provides real-time quota tracking during translation without extra API calls
- If local cache says exhausted → skip the API call, show error immediately
- If local cache has remaining → proceed with API call (server enforces actual limit)
- **Key**: Server is the single source of truth. Client cache prevents unnecessary network calls only.

#### `FullTranslateBatchHandler` Changes

```typescript
// BEFORE: No quota check
const response = await post<FullTextBatchApiResponse>(url, requestBody, options);

// AFTER: Handle quota error from server + extract quota info on success
try {
    const response = await post<FullTextBatchApiResponse>(url, requestBody, options);
    // On success, update local quota cache from response body
    if (response.data?.quota) {
        quotaManager.updateFullTextTranslationQuota(response.data.quota);
    }
    return response;
} catch (error) {
    if (isQuotaExceededError(error)) {
        // Propagate structured quota error to content script
        return { success: false, errorType: 'QuotaExceeded', quotaInfo: error.data };
    }
    throw error;
}
```

#### New `QuotaManager` Methods

```typescript
// Add to existing QuotaManager
async checkFullTextTranslationQuota(): Promise<void>;
async updateFullTextTranslationQuota(quota: { used: number; limit: number; remaining: number }): Promise<void>;
async getFullTextTranslationQuotaUsage(): Promise<{ used: number; limit: number; remaining: number }>;
```

### 4.3 Popup UI: Quota Display

#### Design: Percentage-Based Quota Status Card

Add a quota status section in the popup, **between the "Full Translate Action" area and the "Settings" sections**:

```
┌────────────────────────────────────┐
│  TapWord                           │
├────────────────────────────────────┤
│  [📄 Translate Page]  [Toggle]     │
│  ☐ Show floating button            │
├────────────────────────────────────┤
│                                    │
│  Today's Free Quota                │  ← NEW SECTION
│  ┌──────────────────────────────┐  │
│  │  ████████████░░░░  25%       │  │  ← Progress bar + percentage
│  │  Page Translation             │  │  ← Label
│  └──────────────────────────────┘  │
│                                    │
├────────────────────────────────────┤
│  ☑ Enable TapWord                  │
│  ...settings...                    │
└────────────────────────────────────┘
```

**Display format**: Percentage only (e.g., `25%` or `25% used`). The progress bar width reflects the percentage. No raw numbers exposed to the user.

#### Async Loading Strategy

On popup open:
1. **Render immediately** with cached/last-known quota data from `chrome.storage.local` — zero visible delay for repeat opens
2. **Fire async** `QUOTA_USAGE_REQUEST` message to background → server
3. When the fresh response arrives, **update the display** — if the cached value was accurate, no visual change

This ensures the popup is never blocked waiting for a network call.

#### UI States

| State | Threshold | Visual | Interaction |
|-------|-----------|--------|-------------|
| **Normal** | 0–79% used | Green progress bar, `25%` | No action needed |
| **Warning** | 80–99% used | Orange progress bar, `90%` | Tooltip: "Quota running low" |
| **Exhausted** | 100% used | Red progress bar, `100%`, ~~disabled translate button~~ | Translate button grayed out, "Quota exceeded" toast |
| **Loading** | — | Skeleton/shimmer animation | While fetching from server (first open only, if no cache) |
| **Error** | — | `–` with retry icon | If API call fails |

#### Data Flow

```
Popup opens
  → Immediately render from chrome.storage.local cache (if available)
  → sendMessage({ type: 'QUOTA_USAGE_REQUEST' })
    → Background: QuotaService.getUsageSummary(uid)
      → Response: { fullTextTranslation: { used, limit, remaining } }
        → Popup updates display + saves to chrome.storage.local for next open
```

**New message type**: `QUOTA_USAGE_REQUEST` / `QUOTA_USAGE_RESPONSE`

#### Popup Translate Button State

When quota is exhausted:
- The "Translate Page" button should be **visually disabled** (grayed out)
- Clicking it shows a toast/tooltip: "Today's free quota is used up. Come back tomorrow!"
- The disabled state is determined by the quota response, not a hardcoded check

### 4.4 Content Script: Quota Exhaustion During Translation

#### Scenario: Quota Runs Out Mid-Page

A user starts translating a page. After several batches, the server returns `QUOTA_EXCEEDED`:

```
Batch 1 (2,500 chars): ✅ Success → paragraphs 1-10 rendered
Batch 2 (3,200 chars): ✅ Success → paragraphs 11-25 rendered
Batch 3 (4,100 chars): ❌ QUOTA_EXCEEDED → remaining segments not translated
```

#### UX for Mid-Page Quota Exhaustion

1. **Stop further batches**: `PageTranslationManager` stops sending new batches after receiving quota error
2. **Show inline banner**: Insert a non-intrusive banner at the point where translation stopped:

```
┌─────────────────────────────────────────────────────────┐
│  ℹ️  Free translation quota for today has been reached.  │
│     Already translated paragraphs remain visible.        │
│     Quota resets at midnight (UTC).                      │
└─────────────────────────────────────────────────────────┘
```

3. **Preserve existing translations**: Previously rendered translations stay on the page. Do not undo completed work.
4. **Floating button visual state**: Change to a "quota exhausted" state (e.g., dimmed icon with a small badge)
5. **Clicking floating button after exhaustion**: Show tooltip "Today's free quota is used up"

### 4.5 Full Translate Toggle Behavior When Quota Exhausted

| Action | Behavior |
|--------|----------|
| User clicks "Translate Page" in popup (quota exhausted) | Button is disabled. Toast: "Today's free quota is used up. Come back tomorrow!" |
| User clicks floating button (quota exhausted) | Tooltip: "Today's free quota is used up" (no API call) |
| User clicks "Translate Page" — quota OK, runs out mid-page | Translation stops at quota boundary. Inline banner appears. Button toggles to "Stop" state. |
| User reloads page after quota exhaustion | Floating button starts in "quota exhausted" visual state |

### 4.6 Config Update

Update `CloudConfig` / `QuotaConfig` type in `src/5_backend/types/ConfigTypes.ts`:

```typescript
interface QuotaConfig {
    dailyFreeTranslations: number;
    dailyFreeSpeech: number;
    dailyFreeFullTextTranslationChars: number;  // ← NEW (character-based)
}
```

---

## 5. i18n Strings

Add to all 8 locale files:

| Key | en | zh |
|-----|----|----|
| `popup.quota.title` | Today's Free Quota | 今日免费额度 |
| `popup.quota.pageTranslation` | Page Translation | 全文翻译 |
| `popup.quota.exhausted` | Today's free quota is used up. Come back tomorrow! | 今日免费额度已用完，明天再来吧！ |
| `popup.quota.warning` | Quota running low | 额度即将用完 |
| `popup.quota.loading` | Loading... | 加载中... |
| `popup.quota.error` | Failed to load quota | 加载额度失败 |
| `fullTranslate.quotaExhausted.banner` | Free translation quota for today has been reached. Already translated paragraphs remain visible. | 今日免费翻译额度已达上限，已翻译的段落仍然可见。 |
| `fullTranslate.quotaExhausted.tooltip` | Today's free quota is used up | 今日免费额度已用完 |

---

## 6. Implementation Phases

### Phase 1: Backend Core (Priority: P0)

| Task | Description | Files |
|------|-------------|-------|
| 1.1 | Create `daily_usage` table migration | `resources/database/migrations/0002_daily_usage.sql` |
| 1.2 | Add Kysely table type + PO type | `src/3_database/po/DailyUsage.po.ts`, `src/3_database/types.ts` |
| 1.3 | Implement `DailyUsageMapper` | `src/3_database/mapper/dailyUsage.mapper.ts` |
| 1.4 | Implement in-memory quota cache | `src/6_quota/services/quotaCache.ts` |
| 1.5 | Implement `QuotaService` (with cache integration) | `src/6_quota/services/quota.service.ts` |
| 1.6 | Add `QUOTA_EXCEEDED` error code (4001) | `src/0_common/error/errorCodes.ts` |
| 1.7 | Create quota middleware | `src/0_common/middleware/quota.middleware.ts` |
| 1.8 | Apply middleware to `full-text-batch` route | `src/1_translate/routes/index.ts` |
| 1.9 | Record usage + return quota in response | `src/1_translate/controllers/translation.controller.ts` |
| 1.10 | Update config endpoint with new quota field | `src/5_config/services/config.service.ts` |
| 1.11 | Add `GET /api/v1/quota/usage` endpoint | `src/6_quota/` (new module) |
| 1.12 | Implement data retention cleanup | `src/6_quota/services/cleanup.service.ts` |
| 1.13 | Document surrogate PK rule in server `AGENTS.md` | `AGENTS.md` |

### Phase 2: Frontend Enforcement (Priority: P0)

| Task | Description | Files |
|------|-------------|-------|
| 2.1 | Update `QuotaConfig` type with new field | `src/5_backend/types/ConfigTypes.ts` |
| 2.2 | Add full-text quota methods to `QuotaManager` | `src/5_backend/services/QuotaManager.ts` |
| 2.3 | Handle quota error + extract quota from response in `FullTranslateBatchHandler` | `src/2_background/handlers/FullTranslateBatchHandler.ts` |
| 2.4 | Propagate quota error to `PageTranslationManager` | `src/11_full_translate/PageTranslationManager.ts` |
| 2.5 | Stop batching on quota error | `src/11_full_translate/utils/BatchQueue.ts` |
| 2.6 | Add `QUOTA_USAGE_REQUEST` message type | `src/0_common/types/` |
| 2.7 | Add quota usage handler in background | `src/2_background/handlers/QuotaUsageHandler.ts` |

### Phase 3: Frontend UI (Priority: P1)

| Task | Description | Files |
|------|-------------|-------|
| 3.1 | Popup quota display section (HTML + CSS) — percentage format | `src/3_popup/index.html`, `src/3_popup/styles.css` |
| 3.2 | Popup quota data loading logic (async with cache) | `src/3_popup/modules/quotaDisplay.ts` (new) |
| 3.3 | Disable translate button when exhausted | `src/3_popup/index.ts` |
| 3.4 | Inline banner in content script | `src/11_full_translate/dom/quotaBanner.ts` (new) |
| 3.5 | Floating button "exhausted" visual state | `src/12_floating_button/` |
| 3.6 | i18n strings (8 locales) | `src/0_common/locales/*.json` |

### Phase 4: Polish & Edge Cases (Priority: P2)

| Task | Description |
|------|-------------|
| 4.1 | Handle timezone edge case (user's local midnight ≠ UTC midnight) |
| 4.2 | Graceful degradation when quota endpoint is unreachable |
| 4.3 | Auto-refresh quota display in popup after translation completes |
| 4.4 | Community edition: bypass full-text quota (same as existing pattern) |
| 4.5 | Data retention cron job testing |

---

## 7. Edge Cases & Rules

### 7.1 Partial Batch Handling

**Question**: If a batch totaling 8,000 characters would exceed the remaining quota of 5,000 characters, what happens?

**Decision**: **Reject the entire batch. Do not partially process.**

Rationale:
- Partial processing creates complex state: which segments got translated?
- The middleware checks quota *before* the controller processes the request
- Simpler to check `remaining >= batchCharCount`, reject if insufficient
- The error response tells the client how many characters remain, so the client can retry with a smaller batch if desired

### 7.2 Race Condition: Concurrent Batches

**Scenario**: Multiple batches in flight simultaneously, each passing the pre-check but collectively exceeding the limit.

**Mitigation**: The in-memory cache provides atomic in-process updates. For the DB layer, SQLite's atomic `UPSERT` ensures the counter cannot go negative or be double-counted. The middleware check is a *best-effort pre-check* — the actual recording uses `UPDATE ... SET count = count + N`. If the total exceeds the limit due to race conditions, accept the slight overage (max overage ≈ one batch ≈ ~10,000 characters).

### 7.3 Tab Refresh During Translation

- If the user refreshes the page during translation, the content script re-initializes
- `PageTranslationManager` starts fresh — no stale state
- The floating button reads the latest quota from the background on initialization

### 7.4 Multiple Tabs Translating Simultaneously

- Both tabs consume quota from the same server-side counter (same `uid`)
- Each tab's `BatchQueue` operates independently
- When one tab exhausts the quota, the other tab will receive `QUOTA_EXCEEDED` on its next batch
- No inter-tab coordination needed — the server is the source of truth

### 7.5 Community Edition

- Community edition users provide their own API keys → bypass all quota checks (existing pattern in `QuotaManager`)
- In the backend, community edition requests should be identifiable (e.g., via `clientType` or a header), and the quota middleware should skip for them

---

## 8. Future Considerations (Out of Scope for V1)

| Item | Description |
|------|-------------|
| **Paid tier** | `daily_usage` table accommodates future `plan_type` column or separate `subscriptions` table |
| **Migrate word/fragment quota to server** | The existing `translation_count` column in `daily_usage` is ready; requires adding middleware to those routes |
| **Token-based quota** | Instead of character count, use actual LLM token consumption. More accurate but more complex, requiring token counting from LLM responses |
| **Monthly/rolling quotas** | The `date`-based schema supports aggregation for monthly quotas |
| **Usage analytics dashboard** | Per-user usage history for admin monitoring |
| **Quota increase via ads/referrals** | Bonus quota for user engagement actions |

---

## 9. API Documentation Update

After implementation, update the following API docs:
- `other/api文档/7_fragment_translation_api_v1.md` — Add quota error response documentation
- `other/api文档/9_config_api_v1.md` — Add `dailyFreeFullTextTranslationChars` field
- Create `other/api文档/10_quota_api_v1.md` — New quota usage endpoint documentation

---

## 10. Summary

| Dimension | Decision |
|-----------|----------|
| **Counting unit** | Source text character count (sum of `text.length` per batch) |
| **Free daily limit** | 50,000 characters (~5–15 pages) |
| **Enforcement** | Server-side primary (middleware before controller) |
| **Quota check hot path** | In-memory cache (no synchronous DB call) |
| **Storage** | SQLite `daily_usage` table (`id` auto-increment PK, `(uid, date)` UNIQUE) |
| **Reset** | Daily at 00:00 UTC |
| **Partial batch** | Reject entire batch if insufficient quota |
| **Quota in response** | Each successful batch response includes `quota: { used, limit, remaining }` |
| **UI display** | Percentage-based (`25%`) with progress bar, async loading from cache |
| **UI feedback** | Popup progress bar + inline banner + floating button state |
| **Community edition** | Bypassed (users use own API keys) |

---

## Appendix: Estimated Affected File Tree

> **Note**: This is a rough estimate for planning purposes. Implementers have freedom to adjust structure, naming, and boundaries as needed.

### Backend (`translate-api`)

```
translate-api/
├── AGENTS.md                                    [modify] add DB design rule (surrogate PK)
├── resources/database/migrations/
│   └── 0002_daily_usage.sql                     [new]
├── src/
│   ├── 0_common/
│   │   ├── error/errorCodes.ts                  [modify] add QUOTA_EXCEEDED
│   │   └── middleware/
│   │       └── quota.middleware.ts               [new]
│   ├── 1_translate/
│   │   ├── controllers/translation.controller.ts [modify] record usage, return quota in response
│   │   └── routes/index.ts                       [modify] add quota middleware
│   ├── 3_database/
│   │   ├── db/database.client.ts                 [modify] register new table
│   │   ├── mapper/dailyUsage.mapper.ts           [new]
│   │   ├── po/DailyUsage.po.ts                   [new]
│   │   └── types.ts                              [modify] add table type
│   ├── 5_config/
│   │   └── services/config.service.ts            [modify] add new quota field
│   └── 6_quota/                                  [new module]
│       ├── controllers/quota.controller.ts       [new]
│       ├── routes/index.ts                       [new]
│       ├── services/
│       │   ├── quota.service.ts                  [new]
│       │   ├── quotaCache.ts                     [new] in-memory cache
│       │   └── cleanup.service.ts                [new]
│       └── types/quota.types.ts                  [new]
```

### Frontend (`tapword-translator`)

```
tapword-translator/
├── src/
│   ├── 0_common/
│   │   ├── locales/*.json                        [modify] add quota i18n keys (8 files)
│   │   └── types/                                [modify] add message types
│   ├── 1_content/
│   │   └── handlers/FullTranslateHandler.ts      [modify] handle quota error
│   ├── 2_background/
│   │   └── handlers/
│   │       ├── FullTranslateBatchHandler.ts       [modify] extract quota from response
│   │       └── QuotaUsageHandler.ts               [new]
│   ├── 3_popup/
│   │   ├── index.html                            [modify] add quota section
│   │   ├── index.ts                              [modify] quota data loading
│   │   ├── styles.css                            [modify] quota styles
│   │   └── modules/
│   │       └── quotaDisplay.ts                   [new]
│   ├── 5_backend/
│   │   ├── services/QuotaManager.ts              [modify] add full-text quota methods
│   │   └── types/ConfigTypes.ts                  [modify] add quota config field
│   ├── 11_full_translate/
│   │   ├── PageTranslationManager.ts             [modify] stop on quota error
│   │   ├── utils/BatchQueue.ts                   [modify] propagate quota error
│   │   └── dom/quotaBanner.ts                    [new] inline exhaustion banner
│   └── 12_floating_button/
│       └── FloatingButtonManager.ts              [modify] exhausted visual state
```
