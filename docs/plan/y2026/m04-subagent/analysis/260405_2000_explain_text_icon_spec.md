# Explain Text Icon — Technical Spec

**Date**: 2026-04-05  
**Status**: Draft  
**Author**: AI-assisted

---

## 1. Feature Overview

A new "explain" icon appears next to the existing translation icon when the user selects text on a webpage. Clicking the explain icon:

1. Captures the selected text, sentence context, and block context
2. Opens the sidepanel (if not already open)
3. Sends a pre-defined prompt to the agent asking it to explain the text
4. The agent translates to Chinese (if English) and explains the meaning in context

**Value Proposition**: Chinese users reading English documents can quickly get contextual explanations of text they don't understand — going beyond simple translation to provide nuance, idiom breakdowns, and contextual meaning.

---

## 2. Architecture Decisions

### 2.1 Icon System (Content Script)

- Add a new explain icon (lightbulb or question-mark SVG) displayed **alongside** the translation icon.
- **Position**: to the right of the existing translation icon, with a small gap (`4px`).
- **Color**: use a distinct color (e.g., blue `#4A90D9`) to differentiate from the translation icon.
- **Display behavior**: shown/hidden together with the translation icon — same lifecycle, same trigger conditions.
- Reuse the `iconManager.ts` pattern — add new functions: `createExplainIcon()`, `showExplainIcon()`, `removeExplainIcon()`.
- **Feature gate**: the explain icon is only rendered when the sidepanel (agent panel) feature is enabled. Check the `AGENT_PANEL_ENABLED` flag before creating the icon.

### 2.2 Messaging (Content → Sidepanel)

- Content script sends:
  ```ts
  chrome.runtime.sendMessage({
    type: "EXPLAIN_TEXT_REQUEST",
    data: { text, contextText, blockText }
  })
  ```
- Since the sidepanel is an extension page, it can receive this directly via `chrome.runtime.onMessage` — **no background relay needed**.
- Before sending the explain request, also send a message to ensure the sidepanel is open:
  ```ts
  chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" })
  ```
  The background service worker handles this by calling `chrome.sidePanel.open()`.

### 2.3 Sidepanel Reception

- Extend the `App.tsx` message listener to handle `"EXPLAIN_TEXT_REQUEST"`.
- On receipt:
  1. Auto-switch to the chat view if on a different tab.
  2. Construct a pre-defined explanation prompt from the received data.
  3. Call `sendMessage()` to submit the prompt to the agent.

### 2.4 Agent Prompt Template

```text
Please explain the following text that I selected from a webpage:

**Selected text**: "{selectedText}"

**Surrounding context**: "{contextText}"

**Full paragraph**: "{blockText}"

Instructions:
- If the text is in English, first provide a Chinese translation
- Then explain what this text means in the given context
- Focus on the meaning, nuance, and any idiomatic expressions
- If you need more context about the page, use the get_current_page tool
- Keep the explanation concise and helpful
```

The template is stored as a constant (e.g., `EXPLAIN_PROMPT_TEMPLATE`) and populated via simple string interpolation at send time.

### 2.5 Queue / Waiting Behavior When Agent is Busy

- Add a `pendingMessage` ref in `useAgentChat`.
- When `sendMessage()` is called while `isLoading === true`, store the message in `pendingMessage`.
- When the current agent run completes (`isLoading` transitions `true → false`), auto-send the pending message.
- **Latest wins**: if another message arrives while one is already pending, replace the pending message.
- **UI**: show a "waiting" indicator — a queued message bubble with a pulsing / dimmed style in `ChatInputBar`.
- User can cancel the pending message (click ✕ on the pending indicator).

### 2.6 Sidepanel Open Guarantee

- The explain icon click handler first ensures the sidepanel is open.
- Flow:
  1. Send `{ type: "OPEN_SIDE_PANEL" }` → background calls `chrome.sidePanel.open()`.
  2. Wait `300ms` to let the React app initialize.
  3. Send `{ type: "EXPLAIN_TEXT_REQUEST", data }`.
- The `300ms` delay is a pragmatic choice; a more robust alternative is a ready-handshake (sidepanel sends `"SIDE_PANEL_READY"` on mount), but the delay is simpler for v1.

---

## 3. Data Flow Diagram

```
User selects text on webpage
        │
        ▼
┌─────────────────────┐
│  Translation icon +  │   (Content Script)
│  Explain icon appear │
└────────┬────────────┘
         │  click explain icon
         ▼
┌─────────────────────────────────────┐
│  1. sendMessage("OPEN_SIDE_PANEL")  │  → Background
│  2. wait 300ms                      │
│  3. capture text + context          │
│  4. sendMessage("EXPLAIN_TEXT_REQUEST", data) │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Background: MessageRouter       │
│  handles OPEN_SIDE_PANEL →       │
│  chrome.sidePanel.open()         │
└──────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Sidepanel: App.tsx listener     │
│  receives EXPLAIN_TEXT_REQUEST   │
│  → switch to chat tab            │
│  → build prompt from template    │
│  → sendMessage(prompt)           │
│  (if busy → queue as pending)    │
└──────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Agent processes prompt          │
│  → translates + explains         │
│  → streams response to UI        │
└──────────────────────────────────┘
```

---

## 4. Files to Create / Modify

| File | Action | Description |
|------|--------|-------------|
| `src/0_common/types/index.ts` | Modify | Add `"EXPLAIN_TEXT_REQUEST"` and `"OPEN_SIDE_PANEL"` to `MessageType` union |
| `src/1_content/ui/iconManager.ts` | Modify | Add `createExplainIcon()`, `showExplainIcon()`, `removeExplainIcon()` functions |
| `src/1_content/constants/cssClasses.ts` | Modify | Add CSS class constant for the explain icon |
| `src/1_content/handlers/InputListener.ts` | Modify | Wire up explain icon click handler, include debounce |
| `src/1_content/handlers/AgentPanelMessageHandler.ts` | Modify | Build the text-capture payload (`text`, `contextText`, `blockText`) for the explain flow |
| `src/2_background/messaging/MessageRouter.ts` | Modify | Handle `OPEN_SIDE_PANEL` message → call `chrome.sidePanel.open()` |
| `src/13_sidepanel/App.tsx` | Modify | Handle `EXPLAIN_TEXT_REQUEST` in message listener; switch to chat tab; construct prompt; call `sendMessage()` |
| `src/13_sidepanel/hooks/useAgentChat.ts` | Modify | Add `pendingMessage` ref; queue mechanism on `isLoading`; auto-send on completion |
| `src/13_sidepanel/components/ChatInputBar.tsx` | Maybe | Show pending-message indicator with cancel button |

---

## 5. Message Type Definitions

```ts
// Added to MessageType union in src/0_common/types/index.ts

"EXPLAIN_TEXT_REQUEST"   // Content → Sidepanel
"OPEN_SIDE_PANEL"        // Content → Background

// Payload for EXPLAIN_TEXT_REQUEST
interface ExplainTextRequestData {
  text: string;        // The selected text
  contextText: string; // Surrounding sentence context
  blockText: string;   // Full paragraph / block context
}
```

---

## 6. Risk Considerations

| Risk | Mitigation |
|------|-----------|
| **Race condition**: sidepanel not ready when explain request arrives | Use `300ms` delay after `OPEN_SIDE_PANEL`; future enhancement: ready-handshake |
| **Multiple rapid clicks** on explain icon | Debounce the click handler (e.g., `300ms`) |
| **Agent already busy** processing a previous request | Pending message queue in `useAgentChat` handles this gracefully |
| **Selected text lost** when icon appears | Use `preventDefault` on `mousedown` event (same strategy as translation icon) |
| **Sidepanel disabled** but icon somehow appears | Feature-gate the icon creation behind `AGENT_PANEL_ENABLED` check |
| **Very long selected text** overflows prompt | Consider truncating `blockText` (e.g., max 2000 chars) with an ellipsis note |

---

## 7. Open Questions

1. **Icon design**: Lightbulb vs question-mark? Needs UX review.
2. **Keyboard shortcut**: Should there be an optional hotkey (e.g., `Ctrl+Shift+E`) as an alternative to clicking?
3. **Ready-handshake**: For v2, replace the `300ms` delay with a `SIDE_PANEL_READY` handshake for reliability.
4. **Prompt customization**: Should advanced users be able to edit the explanation prompt template in settings?

---

## 8. Implementation Order

1. **Phase 1 — Messaging infrastructure**: Add message types, `OPEN_SIDE_PANEL` handler in background.
2. **Phase 2 — Icon**: Create explain icon in `iconManager.ts`, wire click handler in `InputListener.ts`.
3. **Phase 3 — Sidepanel reception**: Handle `EXPLAIN_TEXT_REQUEST` in `App.tsx`, construct prompt, call `sendMessage()`.
4. **Phase 4 — Pending queue**: Implement `pendingMessage` in `useAgentChat`, add UI indicator.
5. **Phase 5 — Polish**: Debounce, error handling, truncation, feature-gate verification.
