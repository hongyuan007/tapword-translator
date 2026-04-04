import { useState, useEffect } from "react"
import * as storageService from "../services/StorageService"

interface UseApiKeyResult {
    apiKey: string | null
    isLoaded: boolean
    apiKeyInput: string
    setApiKeyInput: (value: string) => void
    saveKey: () => Promise<void>
}

export function useApiKey(): UseApiKeyResult {
    const [apiKey, setApiKey] = useState<string | null>(null)
    const [isLoaded, setIsLoaded] = useState(false)
    const [apiKeyInput, setApiKeyInput] = useState("")

    useEffect(() => {
        loadApiKey()
    }, [])

    async function loadApiKey() {
        try {
            // Check env variable first (development mode)
            const envKey = import.meta.env.VITE_AGENT_API_KEY
            if (envKey) {
                setApiKey(envKey)
                return
            }
            const storedKey = await storageService.loadApiKeyFromStorage()
            if (storedKey) {
                setApiKey(storedKey)
            }
        } finally {
            setIsLoaded(true)
        }
    }

    async function saveKey() {
        const trimmed = apiKeyInput.trim()
        if (!trimmed) return
        await storageService.saveApiKeyToStorage(trimmed)
        setApiKey(trimmed)
        setApiKeyInput("")
    }

    return { apiKey, isLoaded, apiKeyInput, setApiKeyInput, saveKey }
}
