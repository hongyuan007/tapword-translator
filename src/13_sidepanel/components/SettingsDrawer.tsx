import { X } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"

interface SettingsDrawerProps {
    apiKeyInput: string
    onApiKeyInputChange: (value: string) => void
    onSave: () => void
    onClose: () => void
    currentKeyPreview: string | null
}

export function SettingsDrawer({ apiKeyInput, onApiKeyInputChange, onSave, onClose, currentKeyPreview }: SettingsDrawerProps) {
    return (
        <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/50">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-400">{i18nModule.translate("sidepanel.apiKeySettings")}</span>
                <button className="p-1 rounded hover:bg-gray-800 text-gray-500" onClick={onClose}>
                    <X className="w-3 h-3" />
                </button>
            </div>
            <div className="flex gap-2">
                <input
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-100 placeholder-gray-500 outline-none focus:border-blue-500"
                    placeholder={i18nModule.translate("sidepanel.apiKey.placeholder")}
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => onApiKeyInputChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onSave()}
                />
                <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-medium" onClick={onSave}>
                    {i18nModule.translate("sidepanel.save")}
                </button>
            </div>
            {currentKeyPreview && (
                <p className="text-xs text-gray-500 mt-1.5">
                    {i18nModule.translate("sidepanel.currentKey")}
                    {currentKeyPreview.slice(0, 6)}...{currentKeyPreview.slice(-4)}
                </p>
            )}
        </div>
    )
}
