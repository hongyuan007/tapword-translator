# m08-multi-block-cards Progress

## Task
Redesign assistant message rendering: display multiple cards (thinking, text, tool-call) per agent loop, stacked vertically.

## Status: Phase 2 Complete

## Phases
- [x] Phase 1: Research & Spec
- [x] Phase 2: Implementation
- [ ] Phase 3: Verification

## Phase 2 — Implementation Summary (2026-07-15)

### Modified Files
| # | File | Action |
|---|------|--------|
| 1 | `src/13_sidepanel/types.ts` | Added `ThinkingBlock`, `TextBlock`, `ToolCallBlock`, `ContentBlock` types. Added `blocks?: ContentBlock[]` to `ChatMessage`. Replaced `onToolUse` with `onToolCallStart`/`onToolCallComplete` in `AgentCallbacks`. Deprecated old flat fields. |
| 2 | `src/13_sidepanel/agent/AgentLoop.ts` | Removed `onToolUse` from `contentBlock` stream handler. Replaced `onToolUse` in execution loop with `onToolCallStart` (before) and `onToolCallComplete` (after). |
| 3 | `src/13_sidepanel/components/ToolCallCard.tsx` | **New file.** Renders tool name, status indicator (spinner/check/error), collapsible result preview with truncation. |
| 4 | `src/13_sidepanel/hooks/useAgentChat.ts` | Added `phaseRef` for stream phase tracking. Block-aware callbacks (`appendBlock`, `updateLastBlock`, `updateToolBlock`). Post-loop content denormalization. Removed `activeTool` state. |
| 5 | `src/13_sidepanel/components/MessageBubble.tsx` | Block-based rendering path for new messages. Legacy fallback for old messages without `blocks`. |
| 6 | `src/13_sidepanel/components/MessageList.tsx` | Removed `activeTool` prop and bottom-of-list spinner. |
| 7 | `src/13_sidepanel/App.tsx` | Removed `activeTool` from destructured `useAgentChat` result and `MessageList` prop. |

### Backward Compatibility
- Old messages without `blocks` still render via legacy path in `MessageBubble`
- Deprecated fields (`thinkingContent`, `isThinking`, `toolCalls`) kept on `ChatMessage`
- No storage migration required
