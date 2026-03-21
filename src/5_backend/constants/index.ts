/**
 * Backend Module Constants
 *
 * Centralized configuration for backend API service
 */

import { PRIVATE_CLOUD_ENABLED } from "@/0_common/constants"

const PRIVATE_API_URL = import.meta.env.VITE_API_BASE_URL || ""
const PRIVATE_API_URL_CHINA = import.meta.env.VITE_API_BASE_URL_CHINA || ""
const PRIVATE_API_URL_GLOBAL = import.meta.env.VITE_API_BASE_URL_GLOBAL || ""

/**
 * API base URL
 */
export const DEFAULT_BASE_URL = PRIVATE_CLOUD_ENABLED ? PRIVATE_API_URL : ""

/**
 * Client version
 * Should match the extension version
 */
export const CLIENT_VERSION = "0.4.5"

/**
 * Token refresh buffer time (in seconds)
 * Tokens will be refreshed this many seconds before expiration
 */
export const TOKEN_REFRESH_BUFFER_SECONDS = 300 // 5 minutes

/**
 * Auto refresh interval (in milliseconds)
 * How often to check and refresh the token automatically
 */
export const AUTO_REFRESH_INTERVAL_MS = 2 * 59 * 1000 // 2 minutes

/**
 * Authentication endpoints
 */
export const AUTH_ENDPOINTS = {
    TOKEN: "/api/v1/auth/extension/token",
} as const

/**
 * Configuration endpoints
 */
export const CONFIG_ENDPOINTS = {
    CONFIG: "/api/v1/config",
} as const

/**
 * Config refresh interval (in milliseconds)
 * How often to fetch fresh config from cloud
 * Default: 1 hours
 */
export const CONFIG_REFRESH_INTERVAL_MS = 1 * 60 * 60 * 1000 // 1 hour

/**
 * API Base URLs for different network regions
 */
export const API_BASE_URL_MAP = {
    auto: DEFAULT_BASE_URL,
    china: PRIVATE_CLOUD_ENABLED ? PRIVATE_API_URL_CHINA : "",
    global: PRIVATE_CLOUD_ENABLED ? PRIVATE_API_URL_GLOBAL : "",
} as const
