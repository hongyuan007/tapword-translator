import { Key } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"

interface ApiKeySetupProps {
    apiKeyInput: string
    onApiKeyInputChange: (value: string) => void
    onSave: () => void
}

export function ApiKeySetup({ apiKeyInput, onApiKeyInputChange, onSave }: ApiKeySetupProps) {
    return (
        <div className="flex flex-col items-center justify-center h-screen bg-stone-50 text-stone-800 p-6 gap-4">
            <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 flex flex-col items-center gap-4 max-w-xs w-full">
                <Key className="w-10 h-10 text-stone-400" />
                <h2 className="text-lg font-semibold text-stone-900">{i18nModule.translate("sidepanel.apiKeySetup.title")}</h2>
                <p className="text-xs text-stone-500 text-center">{i18nModule.translate("sidepanel.apiKeySetup.description")}</p>
                <div className="flex gap-2 w-full">
                    <input
                        className="flex-1 bg-stone-100 border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-800 placeholder-stone-400 outline-none focus:border-blue-500"
                        placeholder={i18nModule.translate("sidepanel.apiKey.placeholder")}
                        type="password"
                        value={apiKeyInput}
                        onChange={(e) => onApiKeyInputChange(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && onSave()}
                    />
                    <button className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white rounded-lg text-sm font-medium" onClick={onSave}>
                        {i18nModule.translate("sidepanel.save")}
                    </button>
                </div>
            </div>
        </div>
    )
}
