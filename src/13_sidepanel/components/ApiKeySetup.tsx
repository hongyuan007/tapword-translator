import { Key } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"

interface ApiKeySetupProps {
    apiKeyInput: string
    onApiKeyInputChange: (value: string) => void
    onSave: () => void
}

export function ApiKeySetup({ apiKeyInput, onApiKeyInputChange, onSave }: ApiKeySetupProps) {
    return (
        <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-gray-100 p-6 gap-4">
            <Key className="w-10 h-10 text-gray-500" />
            <h2 className="text-lg font-semibold">{i18nModule.translate("sidepanel.apiKeySetup.title")}</h2>
            <p className="text-xs text-gray-400 text-center max-w-xs">{i18nModule.translate("sidepanel.apiKeySetup.description")}</p>
            <div className="flex gap-2 w-full max-w-xs">
                <input
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500"
                    placeholder={i18nModule.translate("sidepanel.apiKey.placeholder")}
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => onApiKeyInputChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onSave()}
                />
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium" onClick={onSave}>
                    {i18nModule.translate("sidepanel.save")}
                </button>
            </div>
        </div>
    )
}
