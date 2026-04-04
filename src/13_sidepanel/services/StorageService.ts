import type { ChatMessage, TodoItem } from "../types"

// ─── Public Interface ──────────────────────────────────────────

/** Public API for StorageService. */
export interface IStorageService {
    loadApiKeyFromStorage(): Promise<string | null>
    saveApiKeyToStorage(key: string): Promise<void>
    loadSessionMessages(): Promise<ChatMessage[]>
    saveSessionMessages(messages: ChatMessage[]): Promise<void>
    clearSessionMessages(): Promise<void>
    loadSessionTodos(): Promise<{ items: TodoItem[]; isTaskCompleted: boolean }>
    saveSessionTodos(items: readonly TodoItem[], isTaskCompleted: boolean): Promise<void>
    clearSessionTodos(): Promise<void>
}

// Storage keys
const API_KEY_STORAGE_KEY = "dashscopeApiKey"
const SESSION_MESSAGES_KEY = "agentMessages"
const SESSION_TODOS_KEY = "agentTodos"

// --- API Key Storage (chrome.storage.sync) ---

export async function loadApiKeyFromStorage(): Promise<string | null> {
    try {
        const result = await chrome.storage.sync.get(API_KEY_STORAGE_KEY)
        return result[API_KEY_STORAGE_KEY] ?? null
    } catch {
        // chrome.storage may not be available in all contexts
        return null
    }
}

export async function saveApiKeyToStorage(key: string): Promise<void> {
    try {
        await chrome.storage.sync.set({ [API_KEY_STORAGE_KEY]: key })
    } catch {
        // Fallback: caller should handle in-memory fallback
    }
}

// --- Session Messages Storage (chrome.storage.session) ---

export async function loadSessionMessages(): Promise<ChatMessage[]> {
    try {
        const result = await chrome.storage.session.get(SESSION_MESSAGES_KEY)
        const saved = result[SESSION_MESSAGES_KEY] as ChatMessage[] | undefined
        return saved && saved.length > 0 ? saved : []
    } catch {
        // chrome.storage.session may not be available
        return []
    }
}

export async function saveSessionMessages(messages: ChatMessage[]): Promise<void> {
    try {
        await chrome.storage.session.set({ [SESSION_MESSAGES_KEY]: messages })
    } catch {
        // Session storage may not be available
    }
}

export async function clearSessionMessages(): Promise<void> {
    try {
        await chrome.storage.session.remove(SESSION_MESSAGES_KEY)
    } catch {
        // Session storage may not be available
    }
}

// --- Session Todos Storage (chrome.storage.session) ---

interface TodoStorageData {
    items: TodoItem[]
    isTaskCompleted: boolean
}

export async function loadSessionTodos(): Promise<TodoStorageData> {
    try {
        const result = await chrome.storage.session.get(SESSION_TODOS_KEY)
        const saved = result[SESSION_TODOS_KEY] as TodoStorageData | undefined
        if (saved && saved.items && saved.items.length > 0) {
            return { items: saved.items, isTaskCompleted: saved.isTaskCompleted ?? false }
        }
        return { items: [], isTaskCompleted: false }
    } catch {
        return { items: [], isTaskCompleted: false }
    }
}

export async function saveSessionTodos(items: readonly TodoItem[], isTaskCompleted: boolean): Promise<void> {
    try {
        const data: TodoStorageData = { items: [...items], isTaskCompleted }
        await chrome.storage.session.set({ [SESSION_TODOS_KEY]: data })
    } catch {
        // Session storage may not be available
    }
}

export async function clearSessionTodos(): Promise<void> {
    try {
        await chrome.storage.session.remove(SESSION_TODOS_KEY)
    } catch {
        // Session storage may not be available
    }
}
