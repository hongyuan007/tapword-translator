# Technical Spec: Chat Assistant Settings in Options Page + Conditional Sidepanel Build

**Date**: 2026-04-05  
**Status**: Draft  
**Scope**: Options page new settings section, sidepanel feature gating, internal settings button removal

---

## 1. Current State Analysis

### 1.1 Options Page (`src/4_options/`)

**File structure:**
- `index.html` — Full HTML structure; sections are `<div id="*-settings" class="settings-section">` with sidebar `<a class="nav-item">` links
- `index.ts` — Entry point; calls `i18n`, applies community overrides (`applyCommunityUiOverrides`), sets up nav, initializes `settingsManager`
- `modules/settingsManager.ts` — Centralizes all load/save; auto-binds all `<input data-setting>` / `<select data-setting>` elements; calls `storageManagerModule.updateUserSettings()`

**Storage pattern:**  
User settings live in `chrome.storage.sync` under key `"userSettings"` as a `UserSettings` object (`src/0_common/utils/storageManager.ts`, `STORAGE_KEYS.USER_SETTINGS`). The settings manager's `loadSettings()` reads them and populates DOM via `data-setting` attributes. Changes are immediately saved via `saveSetting(key, value)`.

**Existing settings sections (sidebar nav → section IDs):**
| Nav label (`data-i18n-key`) | Section ID |
|---|---|
| `popup.section.general` | `general-settings` |
| `popup.section.appearance` | `appearance-settings` |
| `popup.section.translate` | `translation-settings` |
| `popup.section.text` | `display-settings` |
| `popup.section.audio` | `audio-settings` |
| `popup.section.advanced` | `advanced-settings` |

**Community vs production gating in options page:**  
`index.ts` calls `applyCommunityUiOverrides()` which checks `APP_EDITION === "community"` (imported from `@/0_common/constants`, sourced from `import.meta.env.VITE_APP_EDITION`). Some UI elements are hidden per edition. The same pattern will be used for the agent panel gate.

**Settings sub-objects pattern (precedent: `customApi`):**  
The `customApi` section in the Advanced tab stores three fields (`baseUrl`, `apiKey`, `model`) as a nested object in `UserSettings`. The HTML uses element IDs + custom JS in `settingsManager.ts` to load/save them (not `data-setting` on the sub-object itself). The same pattern will apply to `agentSettings`.

### 1.2 Sidepanel Feature (`src/13_sidepanel/`)

**Current API config flow:**
- `AnthropicClient.ts`: reads `VITE_AGENT_BASE_URL` from `import.meta.env` at **bundle time** as `baseURL`. The `apiKey` is passed via `createAnthropicClient(apiKey)` at runtime.
- `EmbeddingClient.ts`: reads `VITE_AGENT_EMBEDDING_BASE_URL`, `VITE_AGENT_EMBEDDING_API_KEY`, `VITE_AGENT_EMBEDDING_MODEL` all from `import.meta.env` at **bundle time**.
- `useApiKey.ts` (hook): checks `import.meta.env.VITE_AGENT_API_KEY` first as a dev shortcut, then falls back to `storageService.loadApiKeyFromStorage()`.
- `StorageService.ts`: stores the API key under key `"dashscopeApiKey"` in `chrome.storage.sync`.

**Internal settings button:**
- `ChatHeader.tsx` renders a `<Settings>` icon button (lucide-react) calling `onToggleSettings`. The button is always visible.
- `App.tsx` toggles `showSettings` state and conditionally renders `<SettingsDrawer>` below the header.
- `SettingsDrawer.tsx` provides a password input to configure and save the DashScope API key. **This entire settings UI is to be removed.**

### 1.3 Sidepanel Floating Ball (`src/12_floating_button/sidepanel/` + `src/1_content/index.ts`)

**`SidepanelButtonManager` init (current):**  
In `src/1_content/index.ts` lines 143–144, the sidepanel button is unconditionally initialized:
```typescript
sidepanelButton = new SidepanelButtonManager()
sidepanelButton.initialize()
```
`SidepanelButtonManager.initialize()` creates a Shadow DOM button in the bottom-right corner that sends `TOGGLE_SIDE_PANEL` to the background script. **There is no visibility check based on user settings or build mode.**

### 1.4 Build Modes & Environment Variables

| npm script | Vite mode | `VITE_APP_EDITION` | `__IS_FIREFOX__` |
|---|---|---|---|
| `npm run dev` | `development` | `official` | `false` |
| `npm run dev:community` | `community` | `community` | `false` |
| `npm run build:prod` | `production` | `official` | `false` |
| `npm run build:community` | `community` | `community` | `false` |
| `npm run build:firefox` | `firefox` | `official` | `true` |

The 6 sidepanel-related env keys are defined **only in `.env.development`**:
```
VITE_AGENT_API_KEY=...
VITE_AGENT_BASE_URL=...
VITE_AGENT_MODEL=...
VITE_AGENT_EMBEDDING_BASE_URL=...
VITE_AGENT_EMBEDDING_API_KEY=...
VITE_AGENT_EMBEDDING_MODEL=...
```
These keys are **absent** from `.env.community`, `.env.production`, and `.env.firefox`.

**Existing feature flag constant:**  
`src/0_common/constants/index.ts` exports `APP_EDITION = import.meta.env.VITE_APP_EDITION || "official"`. A parallel constant will be introduced for the agent panel gate.

---

## 2. Proposed Changes

### 2.1 New Storage Keys

Add a new nested object `agentSettings` to the `UserSettings` interface in `src/0_common/types/index.ts`, plus a new top-level boolean:

```typescript
// New interface for agent/sidepanel configuration
export interface AgentSettings {
    /** Main LLM API key */
    apiKey: string
    /** Main LLM base URL */
    baseUrl: string
    /** Main LLM model name */
    model: string
    /** Embedding service base URL */
    embeddingBaseUrl: string
    /** Embedding service API key */
    embeddingApiKey: string
    /** Embedding model name */
    embeddingModel: string
}

export interface UserSettings {
    // ... all existing fields ...
    /** Whether the Chat Assistant (sidepanel) feature is enabled */
    enableChatAssistant: boolean
    /** Agent (Chat Assistant) LLM and embedding API configuration */
    agentSettings: AgentSettings
}
```

**Default values** to add to `DEFAULT_USER_SETTINGS`:
```typescript
enableChatAssistant: false,
agentSettings: {
    apiKey: "",
    baseUrl: "",
    model: "",
    embeddingBaseUrl: "",
    embeddingApiKey: "",
    embeddingModel: "",
},
```

All stored in `chrome.storage.sync` under the existing `"userSettings"` key.  
The legacy `"dashscopeApiKey"` key in `chrome.storage.sync` (written by `StorageService.ts`) needs a one-time migration: on first load of the options page or sidepanel, if `agentSettings.apiKey` is empty but `dashscopeApiKey` exists, migrate it.

### 2.2 Build-Time Feature Flag

Add `VITE_ENABLE_AGENT_PANEL=true` to `.env.development` and `.env.community` only. Add a new constant in `src/0_common/constants/index.ts`:

```typescript
export const AGENT_PANEL_ENABLED = import.meta.env.VITE_ENABLE_AGENT_PANEL === "true"
```

This constant will be `true` in development and community builds, `false` everywhere else (production, firefox — where the env var is absent and defaults to `undefined`).

**Why not `APP_EDITION === "community"`?** Because the task also requires it to be visible in dev mode (`APP_EDITION=official` + `VITE_ENABLE_AGENT_PANEL=true`). Using a dedicated flag is cleaner and future-proof.

### 2.3 Options Page: New "Chat Assistant" Settings Section

#### 2.3a Sidebar Navigation Entry

Add a new `<a>` nav item **at the end** of the sidebar nav list (before closing `</nav>`) in `src/4_options/index.html`. The nav item should be conditionally hidden in non-agent-panel builds via a CSS class or inline style set by `index.ts`.

```html
<a href="#chat-assistant-settings" class="nav-item" id="chatAssistantNavItem"
   data-section="chat-assistant-settings"
   data-i18n-key="options.section.chatAssistant"
   style="display: none;">Chat Assistant</a>
```

In `src/4_options/index.ts`, after `applyCommunityUiOverrides()`, add:
```typescript
function applyChatAssistantVisibility(): void {
    if (!AGENT_PANEL_ENABLED) return
    const navItem = document.getElementById("chatAssistantNavItem")
    if (navItem) navItem.style.display = ""
    const section = document.getElementById("chat-assistant-settings")
    if (section) section.style.display = ""
}
```

#### 2.3b HTML Section Structure

Add a new section **after** `<div id="advanced-settings" ...>` and before the closing `</section>`:

```html
<div id="chat-assistant-settings" class="settings-section" style="display: none;">
  <div class="section-header">
    <h2 data-i18n-key="options.section.chatAssistant">Chat Assistant</h2>
  </div>

  <!-- Enable toggle -->
  <div class="card settings-card">
    <div class="setting-item setting-item-master">
      <div class="setting-info">
        <label class="setting-label master-label" for="enableChatAssistant">
          <span data-i18n-key="options.chatAssistant.enable.label">Enable Chat Assistant</span>
        </label>
        <p class="setting-helper" data-i18n-key="options.chatAssistant.enable.helper">
          Show the AI chat assistant floating button on web pages.
        </p>
      </div>
      <label class="toggle-switch toggle-switch-master">
        <input type="checkbox" id="enableChatAssistant" data-setting="enableChatAssistant">
        <span class="toggle-slider"></span>
      </label>
    </div>
  </div>

  <!-- Main LLM config -->
  <h3 class="card-title" style="margin-bottom: 12px; font-size: 16px; font-weight: 600;
     color: var(--text-primary); padding-left: 2px;"
      data-i18n-key="options.chatAssistant.llm.title">LLM Provider</h3>
  <div class="card settings-card" id="agentLlmCard" style="margin-bottom: 32px;">

    <div class="setting-item">
      <div class="setting-info">
        <label class="setting-label" for="agentBaseUrl"
               data-i18n-key="options.chatAssistant.baseUrl.label">API Base URL</label>
        <p class="setting-helper" data-i18n-key="options.chatAssistant.baseUrl.helper">
          Example: https://api.fireworks.ai/inference
        </p>
      </div>
      <div class="setting-control">
        <input type="url" id="agentBaseUrl" class="select-input"
               placeholder="https://api.example.com/v1" />
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <label class="setting-label" for="agentApiKey"
               data-i18n-key="options.chatAssistant.apiKey.label">API Key</label>
        <p class="setting-helper" data-i18n-key="options.chatAssistant.apiKey.helper">
          Stored locally in browser storage.
        </p>
      </div>
      <div class="setting-control">
        <input type="password" id="agentApiKey" class="select-input"
               placeholder="sk-..." autocomplete="new-password" />
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <label class="setting-label" for="agentModel"
               data-i18n-key="options.chatAssistant.model.label">Model</label>
        <p class="setting-helper" data-i18n-key="options.chatAssistant.model.helper">
          Example: accounts/fireworks/routers/kimi-k2p5-turbo
        </p>
      </div>
      <div class="setting-control">
        <input type="text" id="agentModel" class="select-input"
               placeholder="model-name" />
      </div>
    </div>
  </div>

  <!-- Embedding config -->
  <h3 class="card-title" style="margin-bottom: 12px; font-size: 16px; font-weight: 600;
     color: var(--text-primary); padding-left: 2px;"
      data-i18n-key="options.chatAssistant.embedding.title">Embedding Provider</h3>
  <div class="card settings-card" id="agentEmbeddingCard">

    <div class="setting-item">
      <div class="setting-info">
        <label class="setting-label" for="agentEmbeddingBaseUrl"
               data-i18n-key="options.chatAssistant.embeddingBaseUrl.label">Embedding Base URL</label>
        <p class="setting-helper" data-i18n-key="options.chatAssistant.embeddingBaseUrl.helper">
          Example: https://dashscope.aliyuncs.com/compatible-mode/v1
        </p>
      </div>
      <div class="setting-control">
        <input type="url" id="agentEmbeddingBaseUrl" class="select-input"
               placeholder="https://..." />
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <label class="setting-label" for="agentEmbeddingApiKey"
               data-i18n-key="options.chatAssistant.embeddingApiKey.label">Embedding API Key</label>
        <p class="setting-helper" data-i18n-key="options.chatAssistant.embeddingApiKey.helper">
          Stored locally in browser storage.
        </p>
      </div>
      <div class="setting-control">
        <input type="password" id="agentEmbeddingApiKey" class="select-input"
               placeholder="sk-..." autocomplete="new-password" />
      </div>
    </div>

    <div class="setting-item">
      <div class="setting-info">
        <label class="setting-label" for="agentEmbeddingModel"
               data-i18n-key="options.chatAssistant.embeddingModel.label">Embedding Model</label>
        <p class="setting-helper" data-i18n-key="options.chatAssistant.embeddingModel.helper">
          Example: text-embedding-v4
        </p>
      </div>
      <div class="setting-control">
        <input type="text" id="agentEmbeddingModel" class="select-input"
               placeholder="text-embedding-v4" />
      </div>
    </div>
  </div>
</div>
```

**Note**: The `enableChatAssistant` checkbox uses `data-setting="enableChatAssistant"` and will be picked up by the existing auto-bind loop in `settingsManager.ts`. The six text/password/URL inputs do **not** use `data-setting` (to avoid polluting the flat `UserSettings`) — they require custom load/save code in `settingsManager.ts` (same pattern as `customApi`/`mtranserver`).

#### 2.3c settingsManager.ts Changes

**Load agent settings** (add to `loadSettings()` after existing custom API loading):
```typescript
const agentSettings = settings.agentSettings
if (agentSettings) {
    setValue("agentBaseUrl", agentSettings.baseUrl)
    setValue("agentApiKey", agentSettings.apiKey)
    setValue("agentModel", agentSettings.model)
    setValue("agentEmbeddingBaseUrl", agentSettings.embeddingBaseUrl)
    setValue("agentEmbeddingApiKey", agentSettings.embeddingApiKey)
    setValue("agentEmbeddingModel", agentSettings.embeddingModel)
}
```

**Save agent settings** (add a new `setupAgentSettingChangeListeners()` function, called from `setupSettingChangeListeners()`):
```typescript
const AGENT_INPUT_IDS = [
    "agentBaseUrl", "agentApiKey", "agentModel",
    "agentEmbeddingBaseUrl", "agentEmbeddingApiKey", "agentEmbeddingModel"
] as const

function setupAgentSettingChangeListeners(): void {
    AGENT_INPUT_IDS.forEach((id) => {
        const input = document.getElementById(id) as HTMLInputElement | null
        if (!input) return
        input.addEventListener("change", async () => {
            const current = await storageManagerModule.getUserSettings()
            await storageManagerModule.updateUserSettings({
                agentSettings: {
                    ...current.agentSettings,
                    [resolveAgentSettingKey(id)]: input.value.trim(),
                },
            })
        })
    })
}

function resolveAgentSettingKey(id: string): keyof AgentSettings {
    const map: Record<string, keyof AgentSettings> = {
        agentBaseUrl: "baseUrl",
        agentApiKey: "apiKey",
        agentModel: "model",
        agentEmbeddingBaseUrl: "embeddingBaseUrl",
        agentEmbeddingApiKey: "embeddingApiKey",
        agentEmbeddingModel: "embeddingModel",
    }
    return map[id]!
}
```

### 2.4 Content Script: Conditional Floating Ball

**File**: `src/1_content/index.ts`

Change the unconditional initialization of the sidepanel button to:
```typescript
// Initialize sidepanel floating button (community/dev builds only, if enabled by user)
if (AGENT_PANEL_ENABLED && userSettings?.enableChatAssistant) {
    sidepanelButton = new SidepanelButtonManager()
    sidepanelButton.initialize()
}
```

Also update the storage change listener to dynamically show/hide the button when `enableChatAssistant` changes:
```typescript
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.userSettings) {
        const newSettings = changes.userSettings.newValue as UserSettings
        // ... existing settings update code ...

        // Sync sidepanel button visibility with enableChatAssistant setting
        if (AGENT_PANEL_ENABLED) {
            if (newSettings.enableChatAssistant && !sidepanelButton) {
                sidepanelButton = new SidepanelButtonManager()
                sidepanelButton.initialize()
            } else if (!newSettings.enableChatAssistant && sidepanelButton) {
                sidepanelButton.destroy()
                sidepanelButton = null
            }
        }
    }
})
```

`AGENT_PANEL_ENABLED` is imported from `@/0_common/constants`.

### 2.5 Vite/Environment Flag

**Files to modify:**  
- `.env.development` — add `VITE_ENABLE_AGENT_PANEL=true`
- `.env.community` — add `VITE_ENABLE_AGENT_PANEL=true`
- `.env.production` — do **not** add (absent = feature gated)
- `.env.firefox` — do **not** add
- `src/0_common/constants/index.ts` — add `export const AGENT_PANEL_ENABLED = import.meta.env.VITE_ENABLE_AGENT_PANEL === "true"`

The `define: { __IS_FIREFOX__ }` in `vite.config.ts` does not need changes; `VITE_ENABLE_AGENT_PANEL` is sufficient to gate both Chrome-production and Firefox builds.

### 2.6 Sidepanel: Remove Internal Settings Button/Drawer

**File**: `src/13_sidepanel/components/ChatHeader.tsx`

Remove the `onToggleSettings` prop, its parameter from the interface, and the settings gear button DOM:
```diff
- import { MessageSquare, BookOpen, Zap, FolderOpen, Plug, Trash2, Settings } from "lucide-react"
+ import { MessageSquare, BookOpen, Zap, FolderOpen, Plug, Trash2 } from "lucide-react"

  interface ChatHeaderProps {
      activeTab: SidePanelTab
      onTabChange: (tab: SidePanelTab) => void
      onClearChat: () => void
-     onToggleSettings: () => void
      showClearButton: boolean
  }

- export function ChatHeader({ activeTab, onTabChange, onClearChat, onToggleSettings, showClearButton }: ...) {
+ export function ChatHeader({ activeTab, onTabChange, onClearChat, showClearButton }: ...) {
      // Remove the <button> with onClick={onToggleSettings} and <Settings> icon
  }
```

**File**: `src/13_sidepanel/App.tsx`

Remove:
- `showSettings` state and its `useState`
- `handleSaveKey()` logic that calls `setShowSettings(false)`
- `<ChatHeader ... onToggleSettings=...>` prop
- The `{showSettings && <SettingsDrawer ... />}` conditional render
- `import { SettingsDrawer }` (only if it's unused elsewhere)

Update `useApiKey` to no longer expose `apiKeyInput` / `setApiKeyInput` / `saveKey` to the main App layer (these are now managed exclusively via the options page). The `ApiKeySetup` screen (pre-key-entry onboarding) can optionally be kept or removed. If kept, it acts as the first-time setup guide pointing users to the options page instead of providing in-sidepanel input.

**File**: `src/13_sidepanel/api/AnthropicClient.ts`

Refactor to read `baseURL` from settings at runtime instead of bundle time:
```typescript
export function createAnthropicClient(apiKey: string, baseUrl: string): Anthropic {
    return new Anthropic({
        apiKey,
        baseURL: baseUrl || import.meta.env.VITE_AGENT_BASE_URL || "https://dashscope.aliyuncs.com/apps/anthropic",
        dangerouslyAllowBrowser: true,
    })
}
```

**File**: `src/13_sidepanel/api/EmbeddingClient.ts`

Expose `configure(config: { apiKey, baseUrl, model })` function. Call it from the sidepanel init when settings load from storage.

**File**: `src/13_sidepanel/hooks/useApiKey.ts`

Rename/extend to `useAgentConfig.ts` that reads the full `agentSettings` from `getUserSettings()` instead of the legacy `"dashscopeApiKey"` key. The env var fallback (`VITE_AGENT_API_KEY`) is kept for development convenience.

**Legacy key migration**: In `useAgentConfig.ts` init, if `agentSettings.apiKey` is empty, check `chrome.storage.sync.get("dashscopeApiKey")` and migrate it to `agentSettings.apiKey`. After migration, remove the legacy key.

---

## 3. i18n Keys Needed

### English (`src/0_common/locales/en.json`)

```json
"options.section.chatAssistant": "Chat Assistant",
"options.chatAssistant.enable.label": "Enable Chat Assistant",
"options.chatAssistant.enable.helper": "Show the AI chat assistant floating button on web pages.",
"options.chatAssistant.llm.title": "LLM Provider",
"options.chatAssistant.baseUrl.label": "API Base URL",
"options.chatAssistant.baseUrl.helper": "Example: https://api.fireworks.ai/inference",
"options.chatAssistant.apiKey.label": "API Key",
"options.chatAssistant.apiKey.helper": "Stored locally in browser storage.",
"options.chatAssistant.model.label": "Model",
"options.chatAssistant.model.helper": "Example: accounts/fireworks/routers/kimi-k2p5-turbo",
"options.chatAssistant.embedding.title": "Embedding Provider",
"options.chatAssistant.embeddingBaseUrl.label": "Embedding Base URL",
"options.chatAssistant.embeddingBaseUrl.helper": "Example: https://dashscope.aliyuncs.com/compatible-mode/v1",
"options.chatAssistant.embeddingApiKey.label": "Embedding API Key",
"options.chatAssistant.embeddingApiKey.helper": "Stored locally in browser storage.",
"options.chatAssistant.embeddingModel.label": "Embedding Model",
"options.chatAssistant.embeddingModel.helper": "Example: text-embedding-v4"
```

### Chinese (`src/_locales/zh_CN/messages.json` or the equivalent locale file)

```json
"options.section.chatAssistant": "对话助手",
"options.chatAssistant.enable.label": "启用对话助手",
"options.chatAssistant.enable.helper": "在网页上显示 AI 对话助手浮动按钮。",
"options.chatAssistant.llm.title": "语言模型配置",
"options.chatAssistant.baseUrl.label": "API Base URL",
"options.chatAssistant.baseUrl.helper": "示例：https://api.fireworks.ai/inference",
"options.chatAssistant.apiKey.label": "API Key",
"options.chatAssistant.apiKey.helper": "存储在本地浏览器 storage 中。",
"options.chatAssistant.model.label": "模型名称",
"options.chatAssistant.model.helper": "示例：accounts/fireworks/routers/kimi-k2p5-turbo",
"options.chatAssistant.embedding.title": "向量嵌入配置",
"options.chatAssistant.embeddingBaseUrl.label": "Embedding Base URL",
"options.chatAssistant.embeddingBaseUrl.helper": "示例：https://dashscope.aliyuncs.com/compatible-mode/v1",
"options.chatAssistant.embeddingApiKey.label": "Embedding API Key",
"options.chatAssistant.embeddingApiKey.helper": "存储在本地浏览器 storage 中。",
"options.chatAssistant.embeddingModel.label": "Embedding 模型",
"options.chatAssistant.embeddingModel.helper": "示例：text-embedding-v4"
```

> The other 7 locale files (`de`, `es`, `fr`, `ja`, `ko`, `ru`) can initially mirror the English values (untranslated fallback).

---

## 4. Files to Modify and Create

### Files to Modify

| File | Change |
|---|---|
| `src/0_common/types/index.ts` | Add `AgentSettings` interface, extend `UserSettings` with `enableChatAssistant: boolean` and `agentSettings: AgentSettings`; update `DEFAULT_USER_SETTINGS` |
| `src/0_common/constants/index.ts` | Add `export const AGENT_PANEL_ENABLED = import.meta.env.VITE_ENABLE_AGENT_PANEL === "true"` |
| `src/0_common/utils/storageManager.ts` | Add `agentSettings` default normalization in `normalizeUserSettings()`; add legacy `dashscopeApiKey` migration |
| `.env.development` | Add `VITE_ENABLE_AGENT_PANEL=true` |
| `.env.community` | Add `VITE_ENABLE_AGENT_PANEL=true` |
| `src/4_options/index.html` | Add Chat Assistant section div + sidebar nav entry (hidden by default) |
| `src/4_options/index.ts` | Add `applyChatAssistantVisibility()` call; initialize agent config inputs via `settingsManager` |
| `src/4_options/modules/settingsManager.ts` | Add agent settings load/save code (`setupAgentSettingChangeListeners`, `resolveAgentSettingKey`, load block in `loadSettings`) |
| `src/1_content/index.ts` | Gate `SidepanelButtonManager` init on `AGENT_PANEL_ENABLED && userSettings?.enableChatAssistant`; add dynamic enable/disable via `storage.onChanged` |
| `src/13_sidepanel/components/ChatHeader.tsx` | Remove `onToggleSettings` prop and `<Settings>` button |
| `src/13_sidepanel/App.tsx` | Remove `showSettings` state, `SettingsDrawer` render, `onToggleSettings` prop pass-through |
| `src/13_sidepanel/api/AnthropicClient.ts` | Accept `baseUrl` parameter; fall back to env var |
| `src/13_sidepanel/api/EmbeddingClient.ts` | Add `configure()` function to accept runtime base URL, API key, and model |
| `src/13_sidepanel/hooks/useApiKey.ts` | Refactor into `useAgentConfig.ts`; read from `UserSettings.agentSettings`; migrate legacy `dashscopeApiKey` |
| `src/0_common/locales/en.json` | Add all 17 new i18n keys |
| `src/_locales/zh_CN/messages.json` | Add Chinese translations for all 17 keys |
| `src/_locales/{de,es,fr,ja,ko,ru}/messages.json` | Add fallback English strings for all 17 keys |

### Files to Create

None. All changes are additive modifications to existing files.

---

## 5. Risks and Edge Cases

### R1: `chrome.storage.sync` quota pressure
`UserSettings` is stored in `chrome.storage.sync`. Adding 6 new string fields (API keys, URLs, model names) could approach the per-item limit of 8,192 bytes. **Mitigation**: The existing `customApi` precedent already includes 3 similar fields. Monitor with `chrome.storage.sync.getBytesInUse()` during testing. If quota becomes a concern, migrate `agentSettings` to `chrome.storage.local` separately; this requires updating `storageManager.ts` and `useAgentConfig.ts`.

### R2: `normalizeUserSettings` missing new fields causes `undefined` for existing users
When a user upgrades from a previous version, their stored `userSettings` will not have `enableChatAssistant` or `agentSettings`. **Mitigation**: The `normalizeUserSettings()` function in `storageManager.ts` must explicitly handle these with defaults (`enableChatAssistant: false`, `agentSettings: { apiKey: "", ... }`).

### R3: `ApiKeySetup` onboarding screen still shows in sidepanel
The current `App.tsx` renders `<ApiKeySetup>` when `apiKey` is null/empty. After removing `useApiKey`/the settings drawer, the sidepanel may present a confusing empty state with no way to enter credentials. **Mitigation**: Update `ApiKeySetup` to show a message directing the user to the options page, or simplify it to a banner rather than a full-screen modal.

### R4: Content script `enableChatAssistant` not respected on initial page load
After modifying `index.ts`, the check `userSettings?.enableChatAssistant` depends on `initializeUserSettings()` completing first. Currently, the button creation already happens inside `init()` after `await initializeUserSettings()`, so ordering is safe. No additional change needed.

### R5: `SettingsDrawer` component has no other consumers
After removing it from `App.tsx`, `SettingsDrawer.tsx` becomes dead code. **Mitigation**: Delete the file and remove its export from any barrel files to avoid confusion.

### R6: Legacy `dashscopeApiKey` migration conflicts
A user with an existing saved API key will have it in `"dashscopeApiKey"` in `chrome.storage.sync`. After the upgrade, both the legacy key and the new `agentSettings.apiKey` exist. **Mitigation**: During migration in `useAgentConfig.ts` init, copy the legacy key to `agentSettings.apiKey`, then delete the legacy key atomically.

### R7: `AGENT_PANEL_ENABLED = false` still ships the sidepanel HTML/JS to Chrome Web Store
The sidepanel panel HTML (`src/13_sidepanel/sidepanel.html`) will still be bundled in production builds because it is in `additionalInputs` in `vite.config.ts`. The feature is only gated at the UI level (floating button not initialized, options section hidden). **Mitigation (out of scope for this ticket)**: As a future improvement, conditionally exclude `13_sidepanel` from `additionalInputs` based on mode. For this iteration, UI-level gating is sufficient since the panel is not accessible to users unless the side panel is opened via chrome API or manifest.

---

## 6. Verification Plan

> Do not run these tests automatically; trigger manually.

### 6.1 Community / Dev Builds

1. Run `npm run dev:community` or `npm run dev`.
2. Open the options page (`chrome-extension://.../src/4_options/index.html`).
3. Verify a "Chat Assistant" section appears at the bottom of the sidebar nav.
4. Toggle "Enable Chat Assistant" ON and confirm the sidepanel floating ball (sparkle icon, bottom-right) appears on any standard web page.
5. Toggle it OFF and confirm the floating ball disappears without a page refresh.
6. Enter values in all 6 config fields and confirm they persist after closing/reopening the options page.
7. Open the sidepanel from the floating ball and confirm no settings gear icon is visible in the header.
8. Confirm the API key entered via options page is used by the sidepanel agent (test by sending a chat message).

### 6.2 Production Build

1. Run `npm run build:prod`.
2. Load the `dist/` folder into Chrome as an unpacked extension.
3. Open the options page and confirm there is no "Chat Assistant" section in the sidebar.
4. Open any web page and confirm no sidepanel floating ball is visible.

### 6.3 Firefox Build

1. Run `npm run build:firefox`.
2. Load the extension in Firefox.
3. Confirm no "Chat Assistant" section in options and no floating ball in pages (same as production).

### 6.4 Upgrade / Migration

1. Install a pre-change build with an existing `"dashscopeApiKey"` stored in `chrome.storage.sync`.
2. Upgrade to the new build.
3. Open the sidepanel and confirm the API key was migrated to `UserSettings.agentSettings.apiKey` and the legacy key is deleted.
4. Open the options page Chat Assistant section and confirm the API key field is pre-populated.

### 6.5 Type-check

After all changes, run `npm run type-check` and confirm zero errors.
