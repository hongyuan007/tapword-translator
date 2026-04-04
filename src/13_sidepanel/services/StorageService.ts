import type { ChatMessage } from "../types"

// Storage keys
const API_KEY_STORAGE_KEY = "dashscopeApiKey"
const SESSION_MESSAGES_KEY = "agentMessages"

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
