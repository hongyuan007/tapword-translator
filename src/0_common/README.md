Last updated on: 2026-03-11

# 0_common: Shared Utilities and Types

## Module Overview

The `0_common` module serves as the foundational layer of the TapWord Translator extension. It contains shared utilities, core TypeScript type definitions, internationalization (i18n) locales, and application-wide constants that are consumed by all other modules. Its primary purpose is to centralize cross-cutting concerns like logging, storage, i18n, and data model definitions to ensure consistency and avoid code duplication.

## File Structure

```
0_common/
├── README.md
├── index.ts
├── constants/
│   ├── customApi.ts                # Fixed parameters for custom OpenAI-compatible APIs
│   ├── errorMessages.ts            # User-facing error message map
│   ├── index.ts                    # Re-exports and app-level constants (feature flags, visual styling)
│   └── translationFontSize.ts      # Font size preset map and helpers
├── locales/
│   ├── en.json
│   ├── zh.json
│   └── ... (other languages)
├── types/
│   ├── index.ts
│   └── QuotaExceededError.ts
└── utils/
    ├── audioUtils.ts               # Audio MIME type detection from Base64 data
    ├── colorUtils.ts               # Hex color manipulation (opacity, shorthand expansion)
    ├── i18n.ts                     # Internationalization: locale loading and DOM translation
    ├── languageDisplay.ts          # Human-readable language names via Intl.DisplayNames
    ├── logger.ts                   # Prefixed, level-controlled logger (disabled in production)
    ├── platformDetector.ts         # OS detection via Chrome API / navigator fallback
    ├── regionDetector.ts           # Heuristic region detection (e.g., Mainland China)
    ├── storageManager.ts           # chrome.storage abstraction for UserSettings CRUD
    ├── textTruncator.ts            # Pixel-width string truncation via canvas measurement
    ├── textUtils.ts                # Text helpers (single-word detection, etc.)
    ├── translationManager.ts       # Translation history and caching logic
    └── version.ts                  # Semantic version comparison helpers
```

## Core Components

### 1. Constants (`constants/`)

This directory centralizes all static, unchanging values used across the application.

-   **`constants/index.ts`**: Exports application-level constants including cache expiry times, environment-driven feature flags (`APP_EDITION`, `PRIVATE_CLOUD_ENABLED`, `ADVANCED_FEATURES_ENABLED`, `UPGRADE_MODEL_ENABLED`), and visual styling constants (`UNDERLINE_OPACITY`, `UNDERLINE_OFFSET_INTERNAL_SHIFT_PX`).
-   **`constants/errorMessages.ts`**: Contains a map of user-facing error messages for a consistent user experience.
-   **`constants/customApi.ts`**: Defines fixed parameters (e.g., `temperature`, `maxTokens`) for requests made to custom OpenAI-compatible APIs.
-   **`constants/translationFontSize.ts`**: Provides a map and helper functions for managing translation font size presets (e.g., "small", "medium").

### 2. Locales (`locales/`)

This directory contains the translation files for the extension's user interface. Each JSON file corresponds to a supported language (e.g., `en.json`, `zh.json`) and contains a key-value map of translation strings.

### 3. Type Definitions (`types/`)

This directory contains the core TypeScript interfaces and types that define the data structures for the entire application, ensuring type safety and clear contracts between modules.

-   **`types/index.ts`**: Exports all major data structures, including:
    -   `TranslationContextData` & `FragmentTranslationContextData`: The shape of data sent for a translation request.
    -   `SpeechSynthesisRequestData`: The shape of data for a text-to-speech request.
    -   Message Types (`TranslateRequestMessage`, `SpeechSynthesisResponseMessage`, etc.): Defines the communication protocol between content scripts and the background service worker.
    -   `UserSettings`: The comprehensive structure for all user-configurable settings, including defaults in `DEFAULT_USER_SETTINGS`. Includes V3 tooltip spacing fields (`tooltipUnderlineOffsetPxV3`, `tooltipTextOffsetPxV3`, `tooltipBottomSpacingPxV3`).
-   **`types/QuotaExceededError.ts`**: A custom error class thrown specifically when a translation or speech synthesis quota has been met.

### 4. Shared Utilities (`utils/`)

This directory provides a collection of reusable services and helper functions that encapsulate common functionalities.

-   **`utils/audioUtils.ts`**: Detects the MIME type of audio data from its Base64 representation (supports WAV and MP3 signatures).
-   **`utils/colorUtils.ts`**: Hex color manipulation — adds alpha/opacity to hex strings, expands shorthand notation.
-   **`utils/i18n.ts`**: A powerful internationalization utility that handles all UI translations. It automatically detects the browser's language, loads the appropriate locale from the `locales/` directory, and provides functions to translate strings. It can apply translations declaratively to the DOM by finding elements with a `data-i18n-key` attribute.
-   **`utils/languageDisplay.ts`**: Resolves human-readable language names using `Intl.DisplayNames` with a static fallback map.
-   **`utils/logger.ts`**: A singleton logger that provides prefixed, level-controlled logging (`debug`, `info`, `warn`, `error`) and can be disabled in production environments via Vite environment variables. Use `createLogger('module-name')` for module-specific logging.
-   **`utils/platformDetector.ts`**: Reliably detects the user's OS via `chrome.runtime.getPlatformInfo()` with `navigator.userAgent` fallback.
-   **`utils/regionDetector.ts`**: Heuristic detection of user region (e.g., Mainland China) based on browser language and timezone.
-   **`utils/storageManager.ts`**: An abstraction layer over the `chrome.storage` API. It handles CRUD operations for `UserSettings`, provides default settings for new users (detecting their browser language), and normalizes the settings object to ensure data integrity.
-   **`utils/textTruncator.ts`**: A utility for truncating strings to fit a specific pixel width, useful for dynamically rendering text in constrained UI elements.
-   **`utils/textUtils.ts`**: Text classification helpers such as `isSingleWord()` for distinguishing single words from phrases.
-   **`utils/translationManager.ts`**: A placeholder for managing translation history and caching logic.
-   **`utils/version.ts`**: Provides helper functions (`compareSemver`, `isLowerVersion`) for comparing semantic version strings.