# Full-Page Fallback Notice Spec

## Current State Analysis

### 1. Start interception currently blocks fallback instead of surfacing it

- `src/1_content/handlers/FullTranslateHandler.ts` sends `QUOTA_USAGE_REQUEST` before starting full-page translation.
- If the selected full-page provider is `official` and cached `remaining <= 0`, it immediately shows `fullTranslate.quotaExhausted.toast`, emits `quota_exhausted`, and returns early.
- Result: users do get a notice, but the session does not start, so the later `official -> microsoftFree` fallback path never runs.

### 2. Popup currently prevents the user from even triggering fallback

- `src/3_popup/modules/quotaDisplay.ts` disables `#fullTranslateButton` when the selected provider is `official` and quota is exhausted.
- `src/3_popup/index.ts` closes the popup immediately after a successful toggle.
- Result: if the user starts full-page translation from the popup, the most common quota-exhausted case is blocked before content-side fallback logic can help.

### 3. Background already performs the runtime fallback, but content cannot detect it

- `src/2_background/handlers/FullTranslateBatchHandler.ts` routes full-page batches by `settings.fullPageTranslationProvider`.
- For `official`, it already falls back to `microsoftFree` in two cases:
  - the client-side quota pre-check returns `QuotaExceeded`
  - the official API throws `APIErrorCodes.QUOTA_EXCEEDED`
- However, the successful fallback response is returned as a plain `success: true` batch result with no metadata describing that a provider switch happened.
- `src/11_full_translate/utils/BatchQueue.ts` therefore treats fallback success exactly the same as normal official success.
- Result: the page continues translating, but the user does not know that TapWord Cloud was replaced by Microsoft Translate.

### 4. Existing notice surfaces are already sufficient for an MVP

- `src/1_content/ui/toast/toastNotification.ts` already provides `showViewportToast(message, type)`, a branded top-of-page notice with close button and auto-dismiss.
- This surface matches the requirement for a top reminder and is also acceptable as the lightweight "popup" the user requested when starting full-page translation.
- `src/3_popup/modules/toastManager.ts` also exists, but it is not the right primary surface because the popup closes immediately after a successful toggle.

### 5. Existing storage layers suggest the right home for the "once per day" state

- `src/0_common/utils/storageManager.ts` stores durable user preferences in `chrome.storage.sync`.
- `src/5_backend/services/QuotaManager.ts` stores runtime quota/cache state in `chrome.storage.local`, keyed by local calendar date.
- The new reminder suppression state is device-local, ephemeral, and tied to runtime behavior rather than preference.
- Result: `chrome.storage.local` is the correct storage location. This should not be stored in `userSettings` or synced across browsers.

### 6. Current message contracts are too small for user-visible fallback state

- `src/0_common/types/index.ts` defines `FullTranslateBatchResponseMessage` with `success`, `translations`, `errorType`, and `quotaInfo`.
- There is no field that tells content:
  - which provider was requested
  - which provider actually executed
  - whether a fallback happened because of quota exhaustion
- Result: the minimal contract extension is to add one optional fallback metadata object only when fallback actually occurs.

## Proposed Changes (Files & Logic)

### MVP decision summary

- Keep `official` as the user-selected provider.
- Treat `microsoftFree` as a temporary runtime fallback only.
- Reuse the existing content-side branded viewport toast as the only new notice surface.
- Limit the reminder to once per local day per device.
- Do not add a new modal, wizard, banner system, or provider-state synchronization layer.

### 1. Extend the batch response contract so content can perceive fallback

#### File

- `src/0_common/types/index.ts`

#### Change

- Extend `FullTranslateBatchResponseMessage` with an optional `fallbackInfo` field.

#### Recommended shape

```ts
fallbackInfo?: {
    sourceProvider: "official"
    actualProvider: "microsoftFree"
    reason: "quotaExceeded"
}
```

#### Rationale

- This is the smallest possible message change that lets content know a user-visible switch happened.
- Do not add generic provider metadata to every successful response.
- Only populate `fallbackInfo` when the requested provider was `official` and the actual executed provider became `microsoftFree` because of quota exhaustion.

### 2. Preserve current fallback behavior in background, but return fallback metadata

#### File

- `src/2_background/handlers/FullTranslateBatchHandler.ts`

#### Logic

- Keep the existing provider routing and official fallback behavior.
- On any `official -> microsoftFree` quota-driven fallback path, return a normal successful translation response plus `fallbackInfo`.
- Do not mutate `settings.fullPageTranslationProvider`.
- Do not change popup select state.

#### Recommended behavior by branch

- Official succeeds normally:
  - return `success: true`
  - no `fallbackInfo`
- Official quota already exhausted locally:
  - execute Microsoft Free
  - return `success: true` with `fallbackInfo`
- Official API throws server-side quota exceeded:
  - execute Microsoft Free
  - return `success: true` with `fallbackInfo`

#### Why not rewrite settings

- The user selected `official` as a preference.
- Fallback is a temporary execution detail for this page/session, not a durable settings change.
- Persisting the fallback as a new provider selection would be surprising and would hide the real reason from the user.

### 3. Promote fallback into a first-class full-page event

#### Files

- `src/11_full_translate/utils/BatchQueue.ts`
- `src/11_full_translate/PageTranslationManager.ts`

#### Logic

- Add `BatchQueue.onProviderFallback?: (fallbackInfo) => void`.
- When a successful batch response contains `fallbackInfo`, invoke the callback before resolving batch entries.
- Add a queue-local boolean such as `hasReportedFallback` so a single full-page session reports at most once even if many batches fall back.
- Add `PageTranslationManager.onProviderFallback?: (fallbackInfo) => void` and wire the batch queue callback through.

#### Rationale

- `QuotaExceeded` and `provider fallback` are different outcomes:
  - `QuotaExceeded` means the session cannot continue on the chosen path.
  - `provider fallback` means the session continues, but the user should be informed.
- Keeping them separate avoids breaking the existing `pause()` behavior that is tied to true quota exhaustion.

### 4. Change start behavior from "hard stop" to "notice and continue"

#### File

- `src/1_content/handlers/FullTranslateHandler.ts`

#### Logic

- Keep the `QUOTA_USAGE_REQUEST` preflight because it is cheap and already available.
- Change the branch where `official` quota is exhausted:
  - do not `return`
  - instead call a new daily-limited notice helper
  - then continue starting `PageTranslationManager`
- Wire `manager.onProviderFallback` to the same notice helper.

#### Why this change is required

- If content keeps returning early, the runtime fallback path never starts.
- The requested UX is user awareness plus continued full-page translation, not a silent block.

### 5. Add a device-local "show once per day" guard

#### File

- `src/1_content/handlers/FullTranslateHandler.ts`

#### Storage location

- `chrome.storage.local`

#### Recommended key

- `fullTranslateOfficialFallbackNotice`

#### Recommended stored value

```json
{
  "date": "2026-05-31",
  "scenario": "officialQuotaFallbackToMicrosoftFree"
}
```

#### Date rule

- Use the local calendar date in `YYYY-MM-DD` format.
- Keep the semantics aligned with existing full-text quota cache behavior in `QuotaManager`.
- Scope is global per device per day, not per tab, not per domain, not per page session.

#### Why this is the right granularity

- The quota itself is daily.
- The user explicitly requested "at most once per day".
- Per-domain or per-tab suppression would create more repeated reminders than requested.

### 6. Adjust popup quota UI so it stops blocking fallback starts

#### File

- `src/3_popup/modules/quotaDisplay.ts`

#### Logic

- Keep the exhausted visual state for the quota section when the selected provider is `official` and quota is empty.
- Stop disabling the full-page translation button in this state.
- Replace the current blocking `title` with an informative fallback hint.

#### Recommended popup behavior

- Selected provider remains `official`.
- Quota card still shows exhausted state.
- Full-page translation button stays enabled.
- Button `title` becomes an explanation such as:
  - "TapWord Cloud quota is used up. Starting page translation will use Microsoft Translate."

#### Why popup should not mirror runtime provider state

- The popup is a settings surface, not a live session monitor.
- The runtime fallback is temporary and page-scoped.
- For MVP, the popup only needs to stop blocking the start and explain what will happen.

### 7. Add dedicated i18n copy rather than dynamic provider interpolation

#### File group

- `src/0_common/locales/*.json`

#### Recommended new keys

- `fullTranslate.providerFallback.toast`
- `popup.quota.fallbackHint`

#### Recommended copy

- Top notice:
  - "Today's TapWord Cloud quota is used up. Full-page translation will continue with Microsoft Translate."
- Popup hint:
  - "TapWord Cloud quota is used up. Starting page translation will use Microsoft Translate."

#### Why dedicated strings are better than interpolation here

- The current i18n utility is key-based and this change does not need new template/interpolation capability.
- Dedicated sentence keys are the smallest implementation.

## Recommended UX Behavior

- If the selected full-page provider is `official` and daily quota is already exhausted when the user starts full-page translation, the page should still start translating and immediately show one branded top notice explaining that Microsoft Translate is being used as fallback.
- If quota is exhausted during an active full-page session and the background switches from `official` to `microsoftFree`, the page should show the same branded top notice and continue translating without pausing the session.
- The notice should appear at most once per local day per device, regardless of how many pages or tabs hit the same fallback on that day.
- The popup should keep showing `official` as the selected provider and should not rewrite user settings to `microsoftFree`.
- The popup quota card should remain visible in exhausted state, but it should no longer disable the full-page translation button; instead it should explain that start will use Microsoft Translate.

## Risks / Edge Cases

### 1. Duplicate notice race across tabs

- Two tabs could read the daily key before either writes it and both briefly show the notice.
- This is acceptable for MVP because the requirement is about limiting repeated reminders, not providing strict cross-tab atomicity.
- A queue-local `hasReportedFallback` flag still removes repeated notices within one session.

### 2. Cached quota may be stale

- The startup preflight uses cached quota state.
- If the cache is stale and still shows remaining quota, the start notice may not appear until the first real fallback batch returns.
- This is acceptable because the runtime callback will still surface the switch.

### 3. Runtime fallback may happen after some paragraphs were translated by Official

- In a long page, early paragraphs may come from TapWord Cloud and later ones from Microsoft Translate.
- The notice copy should therefore say the session "will continue with" or "is now using" Microsoft Translate, not that the whole page used only Microsoft.

### 4. Non-official providers should remain unchanged

- If the selected provider is already `microsoftFree`, `googleFree`, `bingTranslate`, or a custom provider, no new notice should appear.
- The once-per-day key must only be used for the `official -> microsoftFree` quota scenario.

### 5. Existing `quota_exhausted` event semantics should not be overloaded

- The current `quota_exhausted` event is tied to stopping or pausing the session.
- Reusing it for successful fallback would create confusing state transitions in listeners such as the floating button integration.
- Fallback should use a separate callback/event path.

### 6. Popup wording should not imply a permanent provider change

- The popup hint must describe a temporary runtime fallback, not a new saved provider.
- Wording such as "switched to Microsoft Translate" is acceptable only if it is clear that this is for the current full-page run, not the stored setting.

## Verification Plan

### Manual verification

1. `official` selected, quota available:
   - Start full-page translation from popup.
   - Expect normal start, no fallback notice, no provider-change metadata.

2. `official` selected, cached quota already exhausted before start:
   - Popup quota card remains exhausted.
   - Full-page button stays enabled.
   - Click start.
   - Popup closes.
   - Page shows one top fallback notice.
   - Full-page translation continues using Microsoft Translate.

3. `official` selected, quota becomes exhausted during active page translation:
   - Start with quota available.
   - Force a later batch into quota exhaustion.
   - Expect translation to continue.
   - Expect one top fallback notice.
   - Expect no session pause and no `quota_exhausted` stop behavior.

4. Same day repeated triggers:
   - Trigger the same fallback again on another page or after restart.
   - Expect no second notice that day.

5. Next day reset:
   - Advance local date or clear the daily key.
   - Trigger the fallback again.
   - Expect the notice to show once again.

6. Non-official providers:
   - Select `microsoftFree` directly.
   - Start full-page translation.
   - Expect no quota-fallback notice and no popup exhausted-state dependency.

### Implementation validation checkpoints

- `FullTranslateBatchResponseMessage` only includes `fallbackInfo` when a real fallback happened.
- `BatchQueue` reports provider fallback once per queue instance.
- `FullTranslateHandler` no longer returns early on exhausted official quota.
- `quotaDisplay.ts` no longer disables the full-page button for exhausted official quota.
- The once-per-day key is stored in `chrome.storage.local`, not `chrome.storage.sync`.

## Final Recommendation

The smallest complete solution is:

1. keep the existing `official -> microsoftFree` runtime fallback,
2. expose that fallback through one optional batch-response metadata field,
3. reuse the existing content-side branded viewport toast as the only user-visible notice,
4. suppress the notice with one `chrome.storage.local` key per local day,
5. stop the popup from disabling the full-page translation button when official quota is exhausted.

This satisfies the user-perception requirement without introducing a new modal system, without mutating provider settings, and without expanding scope beyond the full-page translation flow.