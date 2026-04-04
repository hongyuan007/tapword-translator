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
        <div className="px-4 py-3 border-b border-stone-200 bg-stone-50">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-stone-500">{i18nModule.translate("sidepanel.apiKeySettings")}</span>
                <button className="p-1 rounded hover:bg-stone-100 text-stone-400" onClick={onClose}>
                    <X className="w-3 h-3" />
                </button>
            </div>
            <div className="flex gap-2">
                <input
                    className="flex-1 bg-white border border-stone-200 rounded-lg px-3 py-1.5 text-xs text-stone-800 placeholder-stone-400 outline-none focus:border-blue-500"
                    placeholder={i18nModule.translate("sidepanel.apiKey.placeholder")}
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => onApiKeyInputChange(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && onSave()}
                />
                <button className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-white rounded-lg text-xs font-medium" onClick={onSave}>
                    {i18nModule.translate("sidepanel.save")}
                </button>
            </div>
            {currentKeyPreview && (
                <p className="text-xs text-stone-400 mt-1.5">
                    {i18nModule.translate("sidepanel.currentKey")}
                    {currentKeyPreview.slice(0, 6)}...{currentKeyPreview.slice(-4)}
                </p>
            )}
        </div>
    )
}
