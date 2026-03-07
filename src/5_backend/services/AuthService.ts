/**
 * Authentication Service
 *
 * Handles JWT token lifecycle management and HMAC-based authentication
 *
 * Features:
 * 1. HMAC-SHA256 signature generation for authentication requests
 * 2. JWT token acquisition and automatic refresh
 * 3. Token storage and retrieval (in-memory with optional persistence)
 * 4. Expiration checking with buffer time
 * 5. Thread-safe token refresh (prevents multiple concurrent refresh requests)
 */

import { createLogger } from "@/0_common/utils/logger"
import * as CryptoJS from "crypto-js"
import { AUTH_ENDPOINTS, AUTO_REFRESH_INTERVAL_MS, TOKEN_REFRESH_BUFFER_SECONDS } from "../constants"
import type { APIResponse } from "../types/APIResponse"
import type { APICredentials, AuthHeaders, AuthRequestBody, AuthResponseData, JWTToken } from "../types/AuthTypes"

const logger = createLogger("AuthService")

/**
 * Authentication Service Class
 */
export class AuthService {
    private credentials: APICredentials | null = null
    private currentToken: JWTToken | null = null
    private uid: string | null = null
    private refreshPromise: Promise<string> | null = null
    private baseURL: string = ""
    private autoRefreshTimer: NodeJS.Timeout | null = null

    // Decode Base64URL string to JSON string (browser/node compatible)
    private base64UrlDecode(input: string): string {
        try {
            const base64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4)
            // Browser first
            if (typeof atob === "function") {
                // atob returns binary string; assume payload is UTF-8 JSON
                // decodeURIComponent(escape()) pattern is deprecated; avoid double transforms
                return atob(base64)
            }
        } catch {}
        try {
            return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
        } catch {
            return ""
        }
    }

    // Extract exp from JWT; returns unix seconds or null
    private parseJwtExp(token: string): number | null {
        try {
            const parts = token.split(".")
            if (parts.length < 2) return null
            const payloadSegment = parts[1] ?? ""
            const payloadJson = this.base64UrlDecode(payloadSegment)
            const payload = JSON.parse(payloadJson) as { exp?: number }
            if (typeof payload.exp === "number") return payload.exp
            return null
        } catch {
            return null
        }
    }

    /**
     * Initialize the authentication service with credentials
     */
    initialize(credentials: APICredentials, uid: string, baseURL: string): void {
        logger.info("Initializing AuthService...")
        logger.info("API Key length:", credentials.apiKey.length)
        logger.info("UID:", uid)
        logger.info("Base URL:", baseURL)

        // Stop existing auto-refresh timer if any
        this.stopAutoRefresh()

        this.credentials = credentials
        this.uid = uid
        this.baseURL = baseURL
        this.currentToken = null
        this.refreshPromise = null

        // Start auto-refresh timer
        this.startAutoRefresh()

        logger.info("AuthService initialized successfully")
    }

    /**
     * Update Base URL for authentication requests
     */
    updateBaseURL(baseURL: string): void {
        logger.info(`Updating AuthService Base URL to: ${baseURL}`)
        this.baseURL = baseURL
        // Clear token to force re-authentication with new URL
        this.currentToken = null
        this.refreshPromise = null
    }

    /**
     * Check if the service is initialized
     */
    isInitialized(): boolean {
        return this.credentials !== null && this.uid !== null && this.baseURL !== ""
    }

    /**
     * Get a valid JWT token (refresh if needed)
     *
     * @returns Promise with the JWT token string
     * @throws Error if not initialized or authentication fails
     */
    async getToken(): Promise<string> {
        if (!this.isInitialized()) {
            logger.error("AuthService not initialized")
            throw new Error("AuthService not initialized")
        }

        // Check if we have a valid token
        if (this.currentToken && this.isTokenValid(this.currentToken)) {
            logger.debug("Using cached token")
            return this.currentToken.token
        }

        // If a refresh is already in progress, wait for it
        if (this.refreshPromise) {
            logger.info("Token refresh already in progress, waiting...")
            return await this.refreshPromise
        }

        // Start a new token refresh
        logger.info("Token expired or missing, requesting new token...")
        this.refreshPromise = this.fetchNewToken()

        try {
            const token = await this.refreshPromise
            return token
        } finally {
            this.refreshPromise = null
        }
    }

    /**
     * Force refresh the current token
     */
    async refreshToken(): Promise<void> {
        logger.info("Force refreshing token...")
        this.currentToken = null
        await this.getToken()
    }

    /**
     * Clear the current token (e.g., on logout)
     */
    clearToken(): void {
        logger.info("Clearing token")
        this.currentToken = null
        this.refreshPromise = null
        this.stopAutoRefresh()
    }

    /**
     * Start automatic token refresh timer
     */
    private startAutoRefresh(): void {
        // Clear any existing timer
        this.stopAutoRefresh()

        logger.info("Starting auto-refresh timer (interval: 5 minutes)")

        // Set up periodic refresh
        this.autoRefreshTimer = setInterval(async () => {
            if (!this.isInitialized()) {
                logger.warn("AuthService not initialized, skipping auto-refresh")
                return
            }

            try {
                logger.info("Auto-refresh timer triggered, checking token status...")

                // Fetch proactively if token is missing or near expiration
                if (this.currentToken && this.isTokenValid(this.currentToken)) {
                    const now = Date.now()
                    const expiresAt = this.currentToken.obtainedAt + this.currentToken.expiresIn * 1000
                    const timeUntilExpiry = expiresAt - now
                    const minutesUntilExpiry = Math.floor(timeUntilExpiry / 1000 / 60)
                    logger.debug(`Auto-refresh: token still valid, expires in ${minutesUntilExpiry} minutes`)
                } else {
                    // Token is missing or near expiration — fetch proactively
                    logger.info("Auto-refresh: token missing or near expiry, pre-fetching...")
                    await this.getToken()
                    logger.info("Auto-refresh: pre-fetch completed")
                }
            } catch (error) {
                logger.error("Auto-refresh failed:", error)
                // Don't throw - let the next API request trigger a refresh
            }
        }, AUTO_REFRESH_INTERVAL_MS)

        logger.debug("Auto-refresh timer started")
    }

    /**
     * Stop automatic token refresh timer
     */
    private stopAutoRefresh(): void {
        if (this.autoRefreshTimer) {
            clearInterval(this.autoRefreshTimer)
            this.autoRefreshTimer = null
            logger.debug("Auto-refresh timer stopped")
        }
    }

    /**
     * Check if a token is still valid (with buffer time)
     */
    private isTokenValid(token: JWTToken): boolean {
        const now = Date.now()
        const expiresAt = token.obtainedAt + token.expiresIn * 1000
        const bufferTime = TOKEN_REFRESH_BUFFER_SECONDS * 1000

        const isValid = now < expiresAt - bufferTime

        if (!isValid) {
            logger.info("Token expired or near expiration")
            logger.debug("Now:", now, "ExpiresAt:", expiresAt, "Buffer:", bufferTime)
        }

        return isValid
    }

    /**
     * Fetch a new JWT token from the backend
     */
    private async fetchNewToken(): Promise<string> {
        if (!this.credentials || !this.uid) {
            throw new Error("AuthService not initialized")
        }

        logger.info("Requesting new JWT token...")

        // Generate request body
        const nonce = this.generateNonce()
        const requestBody: AuthRequestBody = {
            uid: this.uid,
            nonce,
        }
        const bodyString = JSON.stringify(requestBody)

        logger.debug("Request body:", requestBody)

        // Generate authentication headers
        const method = "POST"
        const uri = AUTH_ENDPOINTS.TOKEN
        const authHeaders = this.generateAuthHeaders(method, uri, bodyString, this.credentials)

        logger.debug("Auth headers generated")

        // Make the request
        const url = `${this.baseURL}${uri}`
        logger.info("Fetching token from:", url)

        try {
            const response = await fetch(url, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    ...authHeaders,
                },
                body: bodyString,
            })

            const responseText = await response.text()
            logger.debug("Response status:", response.status)
            logger.debug("Response body:", responseText.substring(0, 200))

            if (!response.ok) {
                logger.error("Authentication failed:", response.status, responseText)
                throw new Error(`Authentication failed: ${response.status}`)
            }

            // Parse response
            const data = JSON.parse(responseText) as APIResponse<AuthResponseData>

            if (data.code !== 0 || !data.data) {
                logger.error("Invalid authentication response:", data)
                throw new Error(`Authentication failed: ${data.message}`)
            }

            // Determine expiration: backend doesn't return expiresIn; derive from JWT exp
            const rawToken = data.data.token
            const exp = this.parseJwtExp(rawToken)
            const nowSec = Math.floor(Date.now() / 1000)
            let expiresInSec = 3600
            if (typeof exp === "number" && exp > nowSec) {
                expiresInSec = Math.max(1, exp - nowSec)
            }

            // Store the token
            this.currentToken = {
                token: rawToken,
                expiresIn: expiresInSec,
                obtainedAt: Date.now(),
            }

            logger.info("JWT token obtained successfully")
            logger.debug("Token expires in:", expiresInSec, "seconds")

            return this.currentToken.token
        } catch (error) {
            logger.error("Failed to fetch token:", error)
            throw error
        }
    }

    /**
     * Generate authentication headers for HMAC signature
     *
     * @param method - HTTP method (e.g., 'POST')
     * @param uri - Request URI including path and query parameters
     * @param body - JSON string of request body
     * @param credentials - API credentials
     * @returns Authentication headers object
     */
    private generateAuthHeaders(method: string, uri: string, body: string, credentials: APICredentials): AuthHeaders {
        const timestamp = Math.floor(Date.now() / 1000).toString()

        // Construct the String-to-Sign
        // Format: METHOD\nURI\nTIMESTAMP\nBODY
        const stringToSign = `${method}\n${uri}\n${timestamp}\n${body}`

        logger.debug("String-to-Sign:", stringToSign)

        // Calculate HMAC-SHA256 signature
        const signature = CryptoJS.HmacSHA256(stringToSign, credentials.apiSecret).toString(CryptoJS.enc.Hex)

        logger.debug("Signature generated, length:", signature.length)

        return {
            "x-api-key": credentials.apiKey,
            "x-timestamp": timestamp,
            "x-signature": signature,
        }
    }

    /**
     * Generate a random nonce (16-128 characters)
     */
    private generateNonce(): string {
        // Generate a 32-character random hex string
        const randomBytes = CryptoJS.lib.WordArray.random(16)
        return randomBytes.toString(CryptoJS.enc.Hex)
    }
}

/**
 * Default AuthService instance (singleton)
 */
let defaultAuthService: AuthService | null = null

/**
 * Get the default AuthService instance
 */
export function getAuthService(): AuthService {
    if (!defaultAuthService) {
        defaultAuthService = new AuthService()
    }
    return defaultAuthService
}

/**
 * Initialize the default AuthService with credentials
 */
export function initAuthService(credentials: APICredentials, uid: string, baseURL: string): void {
    const service = getAuthService()
    service.initialize(credentials, uid, baseURL)
}
