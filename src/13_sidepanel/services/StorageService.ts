import type { ChatMessage, TodoItem } from "@/13_sidepanel/types"

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

// ─── Constants ─────────────────────────────────────────────────

const API_KEY_STORAGE_KEY = "dashscopeApiKey"
const SESSION_MESSAGES_KEY = "agentMessages"
const SESSION_TODOS_KEY = "agentTodos"

// ─── Internal Types ────────────────────────────────────────────

interface TodoStorageData {
    items: TodoItem[]
    isTaskCompleted: boolean
}

// ─── StorageService Class ──────────────────────────────────────

export class StorageService implements IStorageService {

    async loadApiKeyFromStorage(): Promise<string | null> {
        try {
            const result = await chrome.storage.sync.get(API_KEY_STORAGE_KEY)
            return result[API_KEY_STORAGE_KEY] ?? null
        } catch {
            return null
        }
    }

    async saveApiKeyToStorage(key: string): Promise<void> {
        try {
            await chrome.storage.sync.set({ [API_KEY_STORAGE_KEY]: key })
        } catch {
            // Fallback: caller should handle in-memory fallback
        }
    }

    async loadSessionMessages(): Promise<ChatMessage[]> {
        try {
            const result = await chrome.storage.session.get(SESSION_MESSAGES_KEY)
            const saved = result[SESSION_MESSAGES_KEY] as ChatMessage[] | undefined
            return saved && saved.length > 0 ? saved : []
        } catch {
            return []
        }
    }

    async saveSessionMessages(messages: ChatMessage[]): Promise<void> {
        try {
            await chrome.storage.session.set({ [SESSION_MESSAGES_KEY]: messages })
        } catch {
            // Session storage may not be available
        }
    }

    async clearSessionMessages(): Promise<void> {
        try {
            await chrome.storage.session.remove(SESSION_MESSAGES_KEY)
        } catch {
            // Session storage may not be available
        }
    }

    async loadSessionTodos(): Promise<TodoStorageData> {
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

    async saveSessionTodos(items: readonly TodoItem[], isTaskCompleted: boolean): Promise<void> {
        try {
            const data: TodoStorageData = { items: [...items], isTaskCompleted }
            await chrome.storage.session.set({ [SESSION_TODOS_KEY]: data })
        } catch {
            // Session storage may not be available
        }
    }

    async clearSessionTodos(): Promise<void> {
        try {
            await chrome.storage.session.remove(SESSION_TODOS_KEY)
        } catch {
            // Session storage may not be available
        }
    }
}

/** Module-level singleton instance. */
export const storageService = new StorageService()
