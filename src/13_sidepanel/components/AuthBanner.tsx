import { AlertTriangle } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"

interface AuthBannerProps {
    onOpenSettings: () => void
}

export function AuthBanner({ onOpenSettings }: AuthBannerProps) {
    return (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-red-200 bg-red-50 text-red-700">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-xs flex-1">{i18nModule.translate("sidepanel.authBanner.message")}</span>
            <button className="text-xs px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 text-red-700" onClick={onOpenSettings}>
                {i18nModule.translate("sidepanel.settings")}
            </button>
        </div>
    )
}
