/**
 * Background Script - Service Worker
 *
 * Main entry point for the extension's background script.
 * Responsible for initialization and setup only.
 *
 * Responsibilities:
 * 1. Initialize backend services (API client, storage, etc.)
 * 2. Setup message listeners for content script communication
 * 3. Register extension lifecycle event handlers
 * 4. Coordinate between different modules
 *
 * Note: Business logic is delegated to specialized handlers and services.
 */

import * as loggerModule from "@/0_common/utils/logger"
import { isLowerVersion } from "@/0_common/utils/version"
import * as backendModule from "@/5_backend"
import * as MessageRouter from "./messaging/MessageRouter"
import * as ServiceInitializer from "./services/ServiceInitializer"

const logger = loggerModule.createLogger("background")

logger.info("Background script loading...")

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize all services required by the extension
 */
async function initialize(): Promise<void> {
    // Register message listener ASAP to avoid first-message race on cold start
    logger.info("[INIT_DEBUG] Registering message listener early")
    MessageRouter.setupMessageListener()

    logger.info("[INIT_DEBUG] Starting critical services initialization")
    const criticalReadyPromise = ServiceInitializer.ensureCriticalServicesReady()

    void criticalReadyPromise
        .then(() => {
            logger.info("[INIT_DEBUG] Critical services initialization finished")
            ServiceInitializer.startBackgroundWarmUp()
            // Proactive warm-up after cold start — complements the PAGE_ACTIVATED path
            return backendModule.getAuthService().getToken()
        })
        .catch((err) => logger.warn("Cold-start token warm-up failed:", err))

    logger.info("Background script loaded successfully")
}

// Start initialization
initialize().catch((error) => {
    logger.error("Failed to initialize background script:", error)
})

// ============================================================================
// Extension Lifecycle Events
// ============================================================================

/**
 * Extension installation/update handler
 */
chrome.runtime.onInstalled.addListener((details) => {
    logger.info("Extension installed or updated", details)

    // Check if we need to show the update page for v0.4.0
    // SCENARIO 1: Update from older version
    if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
        const previousVersion = details.previousVersion
        // Show update page if the user is upgrading from a version lower than 0.4.0
        if (previousVersion && isLowerVersion(previousVersion, "0.4.0")) {
            logger.info(
                `Upgrading from version ${previousVersion} to ${chrome.runtime.getManifest().version}. Showing update page.`
            )
            chrome.tabs.create({
                url: chrome.runtime.getURL("src/10_welcome/update_v0_4_0.html"),
            })
        }
    }

    // SCENARIO 2: First time install
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        logger.info("First time install. Showing welcome page.")
        chrome.tabs.create({
            url: chrome.runtime.getURL("src/10_welcome/update_v0_4_0.html"),
        })
    }
})
