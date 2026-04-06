# Content Script Integration Research for PageTranslationManager

> **Date**: 2026-03-15
> **Purpose**: Understand the content script architecture and plan how to integrate `PageTranslationManager` (full-page translation) into the existing content script entry point.

---

## 1. How the Content Script Initializes

**Entry point**: `src/1_content/index.ts`

The `init()` function runs immediately on page load (IIFE-style: `init()` is called at module bottom). The initialization sequence:

1. **Pre-warm background** (fire-and-forget): Sends `{ type: "PAGE_ACTIVATED" }` to the background service worker via `chrome.runtime.sendMessage()`. This wakes up the background and triggers proactive token refresh. Errors are silently caught.

2. **Load user settings**: Calls `storageManager.getUserSettings()` which reads from `chrome.storage.sync`. Settings are cached in a module-level `userSettings` variable. Default settings are applied on failure.

3. **Apply dynamic CSS styles**: Sets CSS custom properties for underline offsets and accent colors on `document.documentElement`.

4. **Register DOM event listeners** (all on `document`):
   - `dblclick` → `inputListener.handleDoubleClick`
   - `click` (capture) → `inputListener.handleSingleClick`
   - `mouseup` → `inputListener.handleTextSelection`
   - `mousedown` → `inputListener.handleDocumentClick`
   - `scroll` (passive) → `iconManager.removeTranslationIcon`

5. **SPA navigation cleanup**: `spaNavigationHandler.setup()` observes `<head>` mutations and `popstate` events to clear translation UI on SPA route changes.

6. **Storage change listener**: `chrome.storage.onChanged` updates `userSettings` and reapplies dynamic styles when settings change externally (e.g., from popup or options page).

**Key export**: `getCachedUserSettings()` — returns the module-level cached `UserSettings` object.

---

## 2. Communication from Content Script → Background

**File**: `src/1_content/services/translationRequest.ts`

Pattern: `chrome.runtime.sendMessage(message, callback)` wrapped in a `sendMessageWithRetry()` helper with 2 retries and 150ms delay. Retry handles the "Receiving end does not exist" race condition during cold start.

**Existing message types sent from content**:
| Message Type | Function | Purpose |
|---|---|---|
| `PAGE_ACTIVATED` | `index.ts init()` | Pre-warm background worker on page load |
| `TRANSLATE_REQUEST` | `requestTranslation()` | Single word translation |
| `FRAGMENT_TRANSLATE_REQUEST` | `requestFragmentTranslation()` | Fragment/sentence translation |
| `AUTO_CANDIDATES_REQUEST` | `requestAutoCandidates()` | Auto-translation candidate detection |

The `FULL_TRANSLATE_BATCH_REQUEST` message type already exists in the types and is handled by `FullTranslateBatchHandler` in the background. This is used by `BatchQueue` inside `11_full_translate`.

---

## 3. Communication from Background/Popup → Content Script

**Critical finding: The content script has NO `chrome.runtime.onMessage` listener.**

Only the background script (`MessageRouter.ts`) and offscreen script (`offscreen.ts`) register `chrome.runtime.onMessage.addListener()`.

**Current approach for settings updates**: The popup uses an **indirect communication pattern** via `chrome.storage.sync`:
1. Popup calls `storageManagerModule.updateUserSettings()` → writes to `chrome.storage.sync`
2. Content script's `chrome.storage.onChanged` listener in `initializeUserSettings()` picks up the change
3. Module-level `userSettings` is updated and styles reapplied

**Implication**: There is currently no mechanism for popup/background to send imperative commands (e.g., "start translating now") to the content script. A new `chrome.runtime.onMessage` listener must be added to the content script.

---

## 4. Current Popup Trigger Flow

**File**: `src/3_popup/index.ts`, `src/3_popup/modules/settingsManager.ts`

The popup communicates exclusively through storage:
1. User toggles a checkbox → `settingsManager.saveSetting()` → `storageManager.updateUserSettings()` → `chrome.storage.sync.set()`
2. Content script detects change via `chrome.storage.onChanged` → updates cached settings

The popup also sends one message to background: `POPUP_BOOTSTRAP_REQUEST` to fetch version/update info.

**No popup → content script direct messaging exists.** The popup does not use `chrome.tabs.sendMessage()` at all.

---

## 5. How User Settings Are Loaded and Applied

**Loading**:
- `storageManager.getUserSettings()` reads from `chrome.storage.sync`
- `normalizeUserSettings()` merges stored values with `DEFAULT_USER_SETTINGS`, handles platform-specific defaults (Mac vs Windows trigger keys), and performs migration logic

**Caching**:
- Module-level `userSettings` variable in `src/1_content/index.ts`
- Exported via `getCachedUserSettings()` for other content script modules to access

**Dynamic updates**:
- `chrome.storage.onChanged` listener updates the cache and reapplies CSS variables
- All event handlers (InputListener, TranslationPipeline) call `contentIndex.getCachedUserSettings()` at invocation time, so they always get the latest cached settings

---

## 6. Existing Message Listener Setup in Content Script

**There is none.** The content script only:
- **Sends** messages to background (via `chrome.runtime.sendMessage`)
- **Listens** to storage changes (via `chrome.storage.onChanged`)
- **Registers** DOM event listeners (click, dblclick, mouseup, etc.)

No `chrome.runtime.onMessage.addListener()` exists in any file under `src/1_content/`.

---

## 7. Integration Plan for PageTranslationManager

### 7.1 Where to Instantiate PageTranslationManager

**Location**: `src/1_content/index.ts` — lazy instantiation at module level

```
let pageTranslationManager: PageTranslationManager | null = null;
```

The manager should be created lazily on first toggle request (not eagerly on page load) to avoid unnecessary overhead on pages where the user never triggers full-page translation.

### 7.2 How to Trigger Start/Stop

**Two trigger paths**:

1. **Popup button**: User clicks a "Translate Page" button in the popup.
   - Popup sends a message to the **background** script (since popup cannot reliably get the active tab's content script directly).
   - Background forwards the message to the **active tab's content script** via `chrome.tabs.sendMessage(tabId, message)`.
   - Content script receives and toggles `PageTranslationManager`.

2. **Keyboard shortcut** (optional, future): Defined in `manifest.json` `commands`, handled by background, forwarded to content script.

**Recommended message flow**:
```
Popup → Background (FULL_TRANSLATE_TOGGLE) → Content Script (via chrome.tabs.sendMessage)
```

Alternatively, the popup could call `chrome.tabs.sendMessage()` directly to the active tab. This is simpler and avoids adding a new handler to the background router. However, the popup must first query the active tab ID via `chrome.tabs.query()`.

**Simpler alternative (recommended for MVP)**:
```
Popup → chrome.tabs.query({active: true}) → chrome.tabs.sendMessage(tabId, { type: "FULL_TRANSLATE_TOGGLE" })
Content script receives via new chrome.runtime.onMessage listener
```

### 7.3 New Message Types Needed

| Message Type | Direction | Purpose |
|---|---|---|
| `FULL_TRANSLATE_TOGGLE` | Popup → Content | Toggle full-page translation on/off |
| `FULL_TRANSLATE_STATUS_RESPONSE` | Content → Popup | Report current translation state (running/stopped) |

**Type definitions to add in `src/0_common/types/index.ts`**:

```typescript
export interface FullTranslateToggleMessage {
    type: "FULL_TRANSLATE_TOGGLE"
}

export interface FullTranslateStatusResponse {
    type: "FULL_TRANSLATE_STATUS_RESPONSE"
    isRunning: boolean
}
```

The `MessageType` union should be extended with `"FULL_TRANSLATE_TOGGLE"`.

### 7.4 Content Script Changes Required

1. **Add `chrome.runtime.onMessage` listener** in `init()`:
   ```typescript
   chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
       if (message.type === "FULL_TRANSLATE_TOGGLE") {
           handleFullTranslateToggle(sendResponse);
           return true; // async response
       }
   });
   ```

2. **Implement toggle handler**:
   - If `pageTranslationManager` is running → call `stop()`, respond with `{ isRunning: false }`
   - If not running → create/start manager with config from `userSettings`, respond with `{ isRunning: true }`

3. **Config construction**: Build `FullTranslateConfig` from `userSettings.targetLanguage` and detected page language.

4. **SPA navigation integration**: The existing `SpaNavigationHandler` should also stop `PageTranslationManager` when a real navigation occurs, to prevent stale translations from leaking.

### 7.5 Popup Changes Required

1. Add a "Translate Page" button in popup HTML.
2. On click: `chrome.tabs.query({ active: true, currentWindow: true })` → get `tabId` → `chrome.tabs.sendMessage(tabId, { type: "FULL_TRANSLATE_TOGGLE" })`.
3. Handle the response to update button state (toggle visual: "Translate" ↔ "Stop").

### 7.6 Manifest Changes

No manifest changes required. The content script already matches `<all_urls>` with `all_frames: true`. The `FULL_TRANSLATE_BATCH_REQUEST` message type is already handled by the background router.

### 7.7 Interaction with Existing TapWord Features

The `enableTapWord` master switch controls word/fragment translation. Full-page translation should be **independent** — it should work even when `enableTapWord` is off, since these are separate user intents. However, when full-page translation is active, the tap-to-translate interactions should remain functional (they target different DOM elements and use different underline/tooltip rendering).

---

## 8. Summary of All Existing Message Types (Background Router)

From `MessageRouter.ts`:

| Message Type | Handler | Source |
|---|---|---|
| `TRANSLATE_REQUEST` | `TranslationRequestHandler` | Content script |
| `FRAGMENT_TRANSLATE_REQUEST` | `FragmentTranslationRequestHandler` | Content script |
| `SPEECH_SYNTHESIS_REQUEST` | `SpeechSynthesisRequestHandler` | Content script |
| `SPEECH_STOP_REQUEST` | `SpeechSynthesisRequestHandler` | Content script |
| `POPUP_BOOTSTRAP_REQUEST` | `PopupBootstrapHandler` | Popup |
| `PAGE_ACTIVATED` | `TokenWarmUpHandler` | Content script |
| `AUTO_CANDIDATES_REQUEST` | `AutoCandidatesRequestHandler` | Content script |
| `FULL_TRANSLATE_BATCH_REQUEST` | `FullTranslateBatchHandler` | Content script (11_full_translate BatchQueue) |

**Note**: `FULL_TRANSLATE_BATCH_REQUEST` is already wired — it handles the actual translation API calls for batched paragraph texts. The missing piece is only the **toggle trigger** from popup to content script.
