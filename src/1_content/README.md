Last updated on: 2026-03-11

# 1_content: Content Script Module

## Module Overview

This module is the core of the extension that runs on web pages. It is responsible for detecting user interactions (text selections, single clicks, double clicks), displaying translation UI elements (icon, floating tooltip, modal, toast notifications), extracting contextual information from the page, and orchestrating the translation workflow.

## File Structure

```
1_content/
├── README.md                       # This document
├── index.ts                        # Main entry point for the content script
├── constants/
│   ├── index.ts                    # Module constants exports
│   ├── cssClasses.ts               # CSS class names for UI elements
│   └── iconColors.ts               # Constants for icon colors
├── handlers/
│   ├── InputListener.ts            # Detects DOM events (clicks, selections)
│   ├── SpaNavigationHandler.ts     # Clears translation UI on SPA page navigations
│   ├── TranslationPipeline.ts      # Core translation logic and routing
│   └── utils/                      # Interaction-specific utilities
│       ├── editableElementDetector.ts # Detects if an element is interactive/editable
│       ├── rangeAdjuster.ts        # Adjusts selection boundaries
│       ├── rangeSplitter.ts        # Splits selection across block elements
│       ├── selectionClassifier.ts  # Classifies selection as word or fragment
│       ├── selectionValidator.ts   # Validates if a selection should trigger translation
│       ├── tapWordDetector.ts      # Resolves word range from a pointer coordinate
│       ├── translationOverlapDetectorV2.ts # Detects overlapping translations (Range-based)
│       └── wordBoundary.ts         # Word boundary detection utilities
├── resources/                      # Static resources (HTML templates, CSS)
├── services/
│   └── translationRequest.ts       # Communicates with the background script
├── ui/
│   ├── iconManager.ts              # Manages the translation icon's lifecycle
│   ├── modalTemplates.ts           # Loads HTML templates for the modal
│   ├── toastNotification.ts        # Displays temporary toast notifications
│   ├── translationDisplayV2.ts     # Manages translation display via Range-based rendering
│   ├── translationDisplayV2/       # Sub-components for translation display
│   │   ├── hitTesting.ts           # Global click/dblclick handler via rect-based hit testing
│   │   ├── tooltipLayout.ts        # Pure functions for splitting tooltip text across visual lines
│   │   ├── tooltipRenderer.ts      # DOM creation and content rendering for tooltip elements
│   │   └── types.ts                # Shared types and named constants for the display module
│   └── translationModal.ts         # Manages the detailed translation modal
└── utils/                          # General utilities
    ├── concurrencyLimiter.ts       # Limits parallel translation requests
    ├── contextExtractorV2.ts       # Extracts sentence-level context around text
    ├── domSanitizer.ts             # Cleans DOM selections from extension UI
    ├── languageDetector.ts         # Detects the source language of the text
    ├── languageValidator.ts        # "Native Speaker Suppression" logic
    ├── lineHeightAdjuster.ts       # Adjusts line-height for tooltip display
    ├── modalPositionerV2.ts        # Calculates optimal modal position (Range-based)
    ├── styleCalculator.ts          # UI positioning and style calculations
    ├── styleCalculator/            # Style calculator sub-components
    │   ├── colors.ts               # Color computation and opacity helpers
    │   ├── dom.ts                  # DOM measurement helpers for style calculation
    │   ├── layout.ts               # Layout math for tooltip positioning
    │   └── types.ts                # Types shared across style calculator sub-modules
    └── versionStatus.ts            # Caches version check results
```

> **Note:** Legacy V1 files (`translationDisplay.ts`, `translationOverlapDetector.ts`, `modalPositioner.ts`, etc.) have been moved to the `archive/` directory for reference.

## Core Components

### 1. Entry Point (`index.ts`)

- **`index.ts`**: Initializes the content script, loads user settings, applies dynamic styles (like customized underline colors and offsets), and registers global DOM event listeners for `dblclick`, `click`, `mouseup`, and `scroll`.

### 2. Event Handling & Translation Pipeline (`handlers/`)

This directory captures user intent and orchestrates the translation sequence.

- **`InputListener.ts`**: The first line of defense. It captures single-clicks, double-clicks, and drag selections. It uses validators to verify if an interaction is valid (e.g., ignoring modifier keys or clicks inside text inputs) before forwarding the request to the pipeline.
- **`SpaNavigationHandler.ts`**: Detects real page navigations in Single Page Applications (e.g., YouTube) by observing `<head>` mutations and `popstate` events, then clears all injected translation UI to prevent stale DOM fragments from leaking into the next page.
- **`TranslationPipeline.ts`**: The core orchestrator. It accepts a validated text range, splits it if crossing block boundaries, detects the language, expands boundaries appropriately for space-delimited vs. CJK languages, and routes the request to either the word or fragment translation path. It also manages request concurrency limits.
- **`handlers/utils/`**: Specific helpers such as `selectionValidator.ts` (checks if a selection meets translation criteria), `editableElementDetector.ts` (prevents translating text inside editable fields or interactive buttons), and `tapWordDetector.ts` (extracts a precise text range from a single point coordinate).

### 3. UI Management (`ui/`)

Manages all DOM modifications and visual feedback injected into the host page.

- **`iconManager.ts`**: Displays the translation trigger icon next to manual selections.
- **`translationDisplayV2.ts`**: Coordinator that renders inline translation results using Range-based highlighting (underline overlays) and manages their various states (loading, success, error). Delegates sub-tasks to the `translationDisplayV2/` sub-modules.
  - **`hitTesting.ts`**: A single pair of document-level click/dblclick listeners that replace V1's per-anchor event model. Uses `Range.getClientRects()` to determine which translation was clicked.
  - **`tooltipLayout.ts`**: Pure, side-effect-free functions for splitting a translation string across the visual lines of a multi-line selection.
  - **`tooltipRenderer.ts`**: Creates and styles individual tooltip DOM elements; resolves font sizes and renders loading/success/error states.
  - **`types.ts`**: Shared type definitions (`TranslationEntry`, `TranslationState`, `DisplayUserSettings`) and named numeric constants for the display module.
- **`translationModal.ts`**: Controls the detailed popup modal containing comprehensive dictionary definitions, original sentences, and text-to-speech functionality.
- **`toastNotification.ts`**: Displays temporary, auto-dismissing notifications (e.g., error alerts or status updates) at the top of the viewport.

### 4. Backend Communication (`services/`)

- **`translationRequest.ts`**: Serializes and sends the extracted text, context, and language metadata to the background service worker (`2_background`), which communicates with the AI APIs.

### 5. Utilities (`utils/`)

General-purpose helpers used across the content script to improve robustness and translation quality.

- **`languageValidator.ts`**: Implements "Native Speaker Suppression". Analyzes selected text and context to determine if it is already in the user's native language, suppressing the translation UI to avoid unnecessary interruptions.
- **`contextExtractorV2.ts`**: A sophisticated DOM traversal utility that extracts the complete surrounding sentences of a text selection, providing the necessary context to the AI for highly accurate translations.
- **`concurrencyLimiter.ts`**: A FIFO queue that restricts the number of parallel translation requests to prevent rate-limiting or overwhelming the background service during bulk actions.
- **`versionStatus.ts`**: Caches extension update status checks to minimize repetitive messaging overhead to the background script.
