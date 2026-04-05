import { useState, useEffect } from "react"
import * as storageManagerModule from "@/0_common/utils/storageManager"

interface UseApiKeyResult {
    apiKey: string | null
    isLoaded: boolean
}

export function useApiKey(): UseApiKeyResult {
    const [apiKey, setApiKey] = useState<string | null>(null)
    const [isLoaded, setIsLoaded] = useState(false)

    useEffect(() => {
        loadApiKey()
    }, [])

    async function loadApiKey() {
        try {
            // Development fallback via env var
            const envKey = import.meta.env.VITE_AGENT_API_KEY
            if (envKey) {
                setApiKey(envKey)
                return
            }

            const settings = await storageManagerModule.getUserSettings()
            const storedKey = settings.agentSettings?.apiKey
            if (storedKey) {
                setApiKey(storedKey)
            }
        } finally {
            setIsLoaded(true)
        }
    }

    return { apiKey, isLoaded }
}
