/**
 * Type definitions for the floating button module.
 */

/** Available icon variants for the floating button */
export type IconVariant = "v1" | "v2" | "v3" | "v4" | "v5" | "v6"

/** Persistent configuration stored in chrome.storage.local */
export interface FloatingButtonConfig {
    /** Global on/off toggle (default: true) */
    enabled: boolean
    /** Vertical position as 0-1 viewport height ratio (default: 0.66) */
    position: number
    /** Hostnames where the floating button is disabled */
    disabledSites: string[]
    /** Selected icon variant (default: 'v1') */
    iconVariant: IconVariant
    /** Brand color hex for the icon (default: '#ED6D8F') */
    iconColor: string
    /** Auto-hide the floating button when quota is exhausted (default: false) */
    autoHideOnQuotaExhausted: boolean
}

/** Visual states of the floating button */
export type FloatingButtonState = "idle" | "translating" | "active" | "quota_exhausted"

/** Callback signature for config change events */
export type ConfigChangeCallback = (config: FloatingButtonConfig) => void
