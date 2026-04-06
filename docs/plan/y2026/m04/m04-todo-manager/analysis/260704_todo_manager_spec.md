# TODO Task Manager — Technical Specification

**Date**: 2026-07-04  
**Module**: `src/13_sidepanel`  
**Status**: Draft

## 1. Overview

Add a TODO task manager to the TapWord agent sidepanel that allows the LLM to plan multi-step tasks and track its own progress. The agent writes structured todo items via a `manage_todos` tool call, and the user sees real-time progress in a collapsible `TodoPanel` above the chat messages.

Key concepts (adapted from the Python reference `s03_todo_write.py`):

- **TodoManager**: In-memory store with validation logic.
- **`manage_todos` tool**: Replace-all semantics — LLM sends the full list each time.
- **Nag reminder**: If N rounds pass without a todo update, inject a reminder into the system prompt.
- **TodoPanel UI**: Reactive React component rendered in the sidepanel.

---

## 2. Data Model

```typescript
/** Status of a single todo item. */
type TodoStatus = "pending" | "in_progress" | "completed"

/** A single todo item managed by the agent. */
interface TodoItem {
    /** Unique identifier (string, e.g. "1", "2"). */
    id: string
    /** Human-readable task description. */
    text: string
    /** Current status. */
    status: TodoStatus
}
```

### Validation Rules

| Rule | Detail |
|---|---|
| Max items | 20 |
| Max `in_progress` | 1 at a time |
| `text` required | Non-empty after trim |
| `status` enum | Must be `"pending"` \| `"in_progress"` \| `"completed"` |
| `id` required | Non-empty string |

---

## 3. Architecture

### 3.1 Component Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                         App.tsx                              │
│  ┌────────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │  ChatHeader    │  │  TodoPanel   │  │   MessageList    │  │
│  │  (tabs/actions)│  │  (collapsed) │  │   + ChatInputBar │  │
│  └────────────────┘  └──────┬──────┘  └──────────────────┘  │
│                             │ reads                          │
│            ┌────────────────▼───────────────────┐            │
│            │       TodoManager (store)           │            │
│            │  - items: TodoItem[]                │            │
│            │  - update(items): string            │            │
│            │  - render(): string                 │            │
│            │  - getItems(): TodoItem[]           │            │
│            └────────────────▲───────────────────┘            │
│                             │ writes via tool                │
│            ┌────────────────┴───────────────────┐            │
│            │       AgentLoop                     │            │
│            │  - roundsSinceTodoUpdate: number    │            │
│            │  - injects nag reminder             │            │
│            │  - calls manage_todos executor      │            │
│            └────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Integration Points

| Component | How it integrates |
|---|---|
| `AgentLoop` | Tracks `roundsSinceTodoUpdate`. Injects nag reminder into system prompt when threshold is exceeded. Passes `TodoManager` via `ToolContext`. |
| `TOOL_REGISTRY` | New entry: `manage_todos` tool registration. |
| `ToolContext` | Extended with `todoManager: TodoManager` field. |
| `useAgentChat` | Creates and holds the `TodoManager` instance. Exposes `todoItems` reactive state. Listens for todo changes via a callback. |
| `App.tsx` | Renders `<TodoPanel>` between `<ChatHeader>` and `<MessageList>`. |
| `StorageService` | New functions for session persistence of todo items. |

---

## 4. Tool Definition

### 4.1 JSON Schema (Anthropic Tool format)

```typescript
const manageTodosTool: ToolRegistration = {
    definition: {
        name: "manage_todos",
        description:
            "Create or update the task list for tracking multi-step work. " +
            "Send the COMPLETE list of todos each time (replace-all semantics). " +
            "Use this to plan tasks before starting, mark items in_progress when working on them, " +
            "and mark completed when done. Max 1 item can be in_progress at a time. Max 20 items.",
        input_schema: {
            type: "object" as const,
            properties: {
                items: {
                    type: "array",
                    description: "The complete list of todo items. Replaces any existing list.",
                    items: {
                        type: "object",
                        properties: {
                            id: {
                                type: "string",
                                description: "Unique identifier for this item (e.g. '1', '2').",
                            },
                            text: {
                                type: "string",
                                description: "Short description of the task.",
                            },
                            status: {
                                type: "string",
                                enum: ["pending", "in_progress", "completed"],
                                description: "Current status. Only 1 item can be in_progress at a time.",
                            },
                        },
                        required: ["id", "text", "status"],
                    },
                },
            },
            required: ["items"],
        },
    },
    label: "Updating task list...",
    execute: async (input, context) => {
        // Delegates to context.todoManager.update(input.items)
    },
}
```

### 4.2 Tool Executor Behavior

1. Extract `items` array from `input`.
2. Call `context.todoManager.update(items)`.
3. On success, return the rendered text (e.g. `"[x] #1: Analyze code\n[>] #2: Write spec\n[ ] #3: Review\n\n(1/3 completed)"`).
4. On validation error, throw with descriptive message so the LLM can self-correct.
5. Invoke `context.onTodoUpdate?.(items)` callback to notify React layer.

---

## 5. TodoManager Class

**File**: `src/13_sidepanel/store/TodoManager.ts`

```
class TodoManager {
    private items: TodoItem[] = []
    private onChange?: (items: TodoItem[]) => void

    constructor(onChange?: (items: TodoItem[]) => void)

    /** Replace-all update. Validates, stores, notifies, returns rendered text. */
    update(rawItems: Array<Record<string, unknown>>): string

    /** Get current items (readonly copy). */
    getItems(): readonly TodoItem[]

    /** Render items as text for LLM context. */
    render(): string

    /** Restore items from persistence (no validation, no callback). */
    restore(items: TodoItem[]): void

    /** Clear all items. */
    clear(): void
}
```

### Render Format

```
[ ] #1: Analyze existing code
[>] #2: Write implementation
[x] #3: Set up project

(1/3 completed)
```

Markers: `[ ]` = pending, `[>]` = in_progress, `[x]` = completed.

---

## 6. Nag Reminder Mechanism

### 6.1 Design

The `AgentLoop` tracks a counter `roundsSinceTodoUpdate`. A "round" is one full LLM turn (one call to `client.messages.create`). After each round:

- If the LLM called `manage_todos` in that round → reset counter to 0.
- Otherwise → increment counter.

### 6.2 Injection Point

When `roundsSinceTodoUpdate >= NAG_THRESHOLD` (constant, default `3`) and there are existing todo items, the reminder is appended to the **system prompt** for the next LLM call:

```
<reminder>You have an active task list. Please update your todos to reflect current progress.</reminder>
```

This is injected dynamically in the `runAgent` method, not permanently modifying `SYSTEM_PROMPT`. The approach:

```typescript
// In AgentLoop.runAgent, before client.messages.create:
let effectiveSystem = SYSTEM_PROMPT
if (this.roundsSinceTodoUpdate >= NAG_THRESHOLD && this.todoManager.getItems().length > 0) {
    effectiveSystem += "\n\n<reminder>You have an active task list. Please update your todos to reflect current progress.</reminder>"
}
```

### 6.3 Why System Prompt (not User Message)

Injecting into the system prompt avoids polluting the user-visible conversation history. The reminder is a background directive to the model, not a user utterance.

---

## 7. UI Design — TodoPanel

### 7.1 Layout Position

`TodoPanel` is rendered as a **collapsible section** between `ChatHeader` and the chat content area (`MessageList`/`KnowledgePanel`). It only appears when there are todo items (items.length > 0).

```
┌─────────────────────────────────┐
│         ChatHeader (tabs)       │
├─────────────────────────────────┤
│  ▼ Tasks (2/4)        [collapse]│  ← TodoPanel (collapsible)
│  [x] Analyze code               │
│  [>] Write implementation  ●    │  ← spinner for in_progress
│  [ ] Add tests                  │
│  [ ] Update docs                │
├─────────────────────────────────┤
│         MessageList             │
│         ...                     │
├─────────────────────────────────┤
│         ChatInputBar            │
└─────────────────────────────────┘
```

### 7.2 Visual Elements

| Status | Icon | Text Style |
|---|---|---|
| `pending` | `○` (Circle outline, gray) | Normal, `text-gray-400` |
| `in_progress` | `●` (Animated pulse/spinner, blue) | Semi-bold, `text-blue-400` |
| `completed` | `✓` (Check, green) | Strikethrough, `text-gray-500` |

### 7.3 Component Props

```typescript
interface TodoPanelProps {
    items: readonly TodoItem[]
}
```

### 7.4 Behavior

- **Auto-show**: Panel appears when first todo items arrive. Hidden when list is empty.
- **Collapsible**: User can toggle collapse via a chevron button. Collapsed state shows only the header line "Tasks (completed/total)".
- **No user editing**: The todo list is agent-controlled. Users observe only. This avoids sync conflicts with the LLM's state.
- **Smooth transitions**: Items animate in/out. Status changes use CSS transitions.

### 7.5 Component File

**File**: `src/13_sidepanel/components/TodoPanel.tsx`

Uses Lucide icons: `Circle`, `CheckCircle2`, `Loader2`, `ChevronDown`, `ChevronRight`.

---

## 8. State Flow

### 8.1 LLM → TodoManager → React

```
LLM response (tool_use: manage_todos)
    │
    ▼
AgentLoop.executeTool("manage_todos", input)
    │
    ▼
manageTodosTool.execute(input, context)
    │  calls context.todoManager.update(items)
    ▼
TodoManager.update(items)
    │  validates, stores, calls onChange callback
    ▼
onChange callback (in useAgentChat)
    │  calls setTodoItems(newItems)
    ▼
React re-renders TodoPanel with new items
```

### 8.2 Hook Changes (`useAgentChat`)

The hook gains:
- A `TodoManager` instance (created once via `useRef`, or received as prop).
- `todoItems` state: `useState<readonly TodoItem[]>([])`.
- The `onChange` callback passed to `TodoManager` sets `todoItems`.
- `todoItems` is included in the return value for `App.tsx` to pass to `<TodoPanel>`.
- On `clearChat()`, also call `todoManager.clear()` and reset `todoItems` to `[]`.

### 8.3 ToolContext Extension

```typescript
export interface ToolContext {
    apiKey: string
    knowledgeStore: KnowledgeStore
    todoManager: TodoManager   // NEW
}
```

`AgentLoop.executeTool` passes the `todoManager` from its constructor/field.

### 8.4 AgentLoop Changes

```typescript
export class AgentLoop {
    private todoManager: TodoManager         // NEW
    private roundsSinceTodoUpdate: number = 0 // NEW

    constructor(apiKey: string, knowledgeStore: KnowledgeStore, todoManager: TodoManager) {
        // ... existing + store todoManager
    }
}
```

In the `runAgent` while-loop, after processing tool calls:
- Check if any tool call was `manage_todos` → reset counter.
- Otherwise increment counter.
- Before calling `client.messages.create`, compute `effectiveSystem` with potential nag reminder.

---

## 9. Persistence (chrome.storage.session)

### 9.1 Storage Key

```typescript
const SESSION_TODOS_KEY = "agentTodos"
```

### 9.2 StorageService Additions

```typescript
// New functions in StorageService.ts

export async function loadSessionTodos(): Promise<TodoItem[]> {
    const result = await chrome.storage.session.get(SESSION_TODOS_KEY)
    return (result[SESSION_TODOS_KEY] as TodoItem[] | undefined) ?? []
}

export async function saveSessionTodos(items: readonly TodoItem[]): Promise<void> {
    await chrome.storage.session.set({ [SESSION_TODOS_KEY]: [...items] })
}

export async function clearSessionTodos(): Promise<void> {
    await chrome.storage.session.remove(SESSION_TODOS_KEY)
}
```

### 9.3 Save Triggers

- After every successful `TodoManager.update()`, persist to session storage.
- On `clearChat()`, call `clearSessionTodos()`.

### 9.4 Restore Flow

In `useAgentChat`, on mount (alongside `loadPersistedMessages`):

1. `const savedTodos = await storageService.loadSessionTodos()`
2. If non-empty, call `todoManager.restore(savedTodos)` and `setTodoItems(savedTodos)`.

This ensures todos survive panel close/reopen within the same browser session.

---

## 10. System Prompt Update

Add todo instructions to `SYSTEM_PROMPT` in `agent/prompts.ts`:

```typescript
export const SYSTEM_PROMPT = `# Role
You are TapWord Agent, a helpful AI assistant.

# Environment
You are embedded in the TapWord browser extension. The user is browsing a webpage and may ask questions or request tasks.

# Language
- Always reply in the same language the user is using.

# Task Management
- Use the manage_todos tool to plan multi-step tasks.
- Create a todo list before starting complex work.
- Mark items as in_progress before working on them, and completed when done.
- Keep the todo list updated as you make progress.

# Instructions
- Use the provided tools as needed to complete user requests.
- Be concise and helpful.`
```

---

## 11. i18n Keys

### English (`en.json`)

```json
{
    "sidepanel.todo.header": "Tasks",
    "sidepanel.todo.progress": "{completed}/{total} completed",
    "sidepanel.todo.collapse": "Collapse task list",
    "sidepanel.todo.expand": "Expand task list",
    "sidepanel.todo.empty": "No active tasks",
    "sidepanel.todo.status.pending": "Pending",
    "sidepanel.todo.status.inProgress": "In Progress",
    "sidepanel.todo.status.completed": "Completed"
}
```

### Chinese (`zh.json`)

```json
{
    "sidepanel.todo.header": "任务",
    "sidepanel.todo.progress": "已完成 {completed}/{total}",
    "sidepanel.todo.collapse": "收起任务列表",
    "sidepanel.todo.expand": "展开任务列表",
    "sidepanel.todo.empty": "暂无任务",
    "sidepanel.todo.status.pending": "待处理",
    "sidepanel.todo.status.inProgress": "进行中",
    "sidepanel.todo.status.completed": "已完成"
}
```

---

## 12. Files to Create / Modify

### New Files

| File | Description |
|---|---|
| `src/13_sidepanel/store/TodoManager.ts` | `TodoManager` class: in-memory store, validation, render, change notification. |
| `src/13_sidepanel/agent/tools/manageTodos.ts` | `manage_todos` tool registration: definition, label, executor that delegates to `TodoManager`. |
| `src/13_sidepanel/components/TodoPanel.tsx` | React component: collapsible todo list with status icons and progress header. |

### Modified Files

| File | Changes |
|---|---|
| `src/13_sidepanel/agent/tools/types.ts` | Add `todoManager: TodoManager` to `ToolContext`. |
| `src/13_sidepanel/agent/tools/index.ts` | Import and register `manageTodosTool` in `TOOL_REGISTRY`. |
| `src/13_sidepanel/agent/AgentLoop.ts` | Accept `TodoManager` in constructor. Track `roundsSinceTodoUpdate`. Inject nag reminder into system prompt. Pass `todoManager` in `ToolContext`. |
| `src/13_sidepanel/agent/prompts.ts` | Add "Task Management" section to `SYSTEM_PROMPT`. |
| `src/13_sidepanel/hooks/useAgentChat.ts` | Create/hold `TodoManager`, expose `todoItems` state, persist/restore todos, clear todos on chat clear. Pass `todoManager` to `AgentLoop` constructor. |
| `src/13_sidepanel/types.ts` | Export `TodoItem` and `TodoStatus` types (or re-export from `TodoManager`). |
| `src/13_sidepanel/services/StorageService.ts` | Add `loadSessionTodos`, `saveSessionTodos`, `clearSessionTodos`. |
| `src/13_sidepanel/App.tsx` | Receive `todoItems` from `useAgentChat`. Render `<TodoPanel>` between header and message list. |
| `src/0_common/locales/en.json` | Add `sidepanel.todo.*` keys. |
| `src/0_common/locales/zh.json` | Add `sidepanel.todo.*` keys. |

---

## 13. Constants

Define in a suitable location (e.g. top of `AgentLoop.ts` or a shared constants file):

```typescript
/** Max rounds without a todo update before injecting a nag reminder. */
const TODO_NAG_THRESHOLD = 3

/** Maximum number of todo items allowed. */
const MAX_TODO_ITEMS = 20

/** Maximum number of in_progress items allowed simultaneously. */
const MAX_IN_PROGRESS_ITEMS = 1
```

---

## 14. Edge Cases & Error Handling

| Scenario | Handling |
|---|---|
| LLM sends > 20 items | `TodoManager.update` throws validation error → tool returns error to LLM. |
| LLM sends 2+ `in_progress` items | Same: validation error returned to LLM for self-correction. |
| LLM sends empty `text` | Validation error. |
| LLM sends invalid `status` | Validation error. |
| Panel closed during agent run | Todos persist via `chrome.storage.session`. Restored on reopen. |
| `clearChat()` called | Clears todo items, resets `roundsSinceTodoUpdate`, clears session storage. |
| No todo items exist | TodoPanel hidden. Nag reminder not injected (nothing to remind about). |
| History restore | `roundsSinceTodoUpdate` resets to 0 on history restore. Todos restored from session storage independently. |

---

## 15. Testing Strategy (Informational)

> Tests are not part of this implementation spec, but for reference:

- **Unit tests for `TodoManager`**: Validation rules, render output, edge cases.
- **Unit tests for `manageTodosTool`**: Executor delegates correctly, error propagation.
- **Integration test for nag reminder**: Counter increments, reminder injected at threshold.
- **Component test for `TodoPanel`**: Renders items, collapse/expand, empty state.
