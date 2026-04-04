// Module augmentation for non-standard HTML input attributes
import "react"

declare module "react" {
    interface InputHTMLAttributes<T> {
        /** Non-standard: enables folder selection in file input. */
        webkitdirectory?: string
        /** Non-standard: alias for webkitdirectory. */
        directory?: string
    }
}
