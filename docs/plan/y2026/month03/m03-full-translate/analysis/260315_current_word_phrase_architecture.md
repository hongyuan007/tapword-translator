# Architecture of Word & Phrase Translation

This document outlines the architecture for the existing "word/phrase" (and "fragment") translation feature in the TapWord Translator extension, alongside its new auto-translation capability. It describes the end-to-end flow from user interaction to UI rendering, focusing on the roles of the core extension modules.

## 1. Core Flow: From User Action to Translation

The lifecycle of a translation request involves several steps across different execution contexts:

1. **User Interaction (`1_content`)**: The user selects text, single-clicks, or double-clicks. `InputListener.ts` captures the DOM `Range` and validates the selection (e.g., ensuring it's not inside an editable input field).
2. **Pipeline Processing (`1_content`)**: `TranslationPipeline.ts` sanitizes the text and detects the source language. It classifies the selection as a "word" or "fragment", optionally expanding the boundaries to complete words. It then extracts surrounding sentences (`extractContextV2`) to provide rich context to the AI.
3. **Message Routing (`2_background`)**: The content script serializes the request and sends it to the background service worker. The `MessageRouter` intercepts `TRANSLATE_REQUEST` or `FRAGMENT_TRANSLATE_REQUEST` and dispatches it to the appropriate handler.
4. **Translation Execution (`6_translate`)**: The background handler delegates to `TranslationService.ts`. Depending on the user's configuration, this service either makes an HTTP request to the TapWord Cloud API or routes the request to the local LLM generation module.
5. **Local LLM Execution (`8_generate` - Optional)**: If the user configured a local LLM, `WordTranslationService` or `FragmentTranslationService` loads the appropriate prompt templates, injects the context, and calls an OpenAI-compatible API directly.
6. **UI Rendering (`1_content`)**: Once the background worker returns the translation result, `translationDisplayV2.ts` renders a floating tooltip and an underline overlay directly onto the host page.
7. **Auto Translation Trigger (`1_content`)**: Upon a successful manual translation, the pipeline asynchronously triggers the `autoTranslationService` to speculatively translate other difficult words in the same paragraph.

## 2. Key Modules Breakdown

### `src/1_content/` (Content Script)
Injected into every web page, this module is responsible for all DOM interactions. 
- **Intent Capture**: Detects clicks and selections, validating them against UI constraints.
- **Context Extraction**: Traverses the DOM to grab surrounding text blocks for context-aware translations.
- **UI Management**: Renders the trigger icon, floating tooltips, toast notifications, and the detailed translation modal.

### `src/2_background/` (Service Worker)
Acts as the central orchestrator and proxy.
- **Routing**: Safely passes messages between the isolated content scripts, popup, and options pages.
- **API Coordination**: Prevents CORS issues by handling all external network requests (to the Cloud API or local LLMs) from the background context.

### `src/6_translate/` (Business Logic)
Encapsulates the core translation domain logic.
- **Abstraction**: Exposes clean `translateWord` and `translateFragment` interfaces.
- **Routing**: Abstracts away the complexity of choosing between cloud endpoints and local LLMs based on user preferences.

### `src/8_generate/` (Local AI Generation)
Provides direct LLM integration without relying on the extension's cloud backend.
- **Prompt Management**: Manages system prompts, user templates, and few-shot examples for words, fragments, and auto-candidates.
- **Client Implementation**: Contains an `OpenAICompatibleClient` to standardize communication with various local/custom LLM providers (e.g., LM Studio, Ollama, custom OpenAI endpoints).

## 3. UI Rendering (`translationDisplayV2`)

The extension uses a modern, non-destructive rendering approach to display translations:

- **Range-Based Rendering**: Instead of modifying the page's original DOM text nodes (which frequently breaks Single Page Applications like React or Vue), V2 uses `Range.getClientRects()` to calculate exact coordinates. It then overlays absolute-positioned underlines and tooltips on top of the text.
- **Hit Testing**: Instead of attaching event listeners to individual DOM elements injected into the page, `hitTesting.ts` uses a single global document-level click listener. It compares mouse coordinates against the tracked `Range` bounding boxes to detect clicks on translated text (which opens the detailed modal).
- **Tooltip Layout**: Pure functions in `tooltipLayout.ts` calculate optimal tooltip positions, intelligently splitting and aligning tooltips across multiple visual lines if a user's selection wraps across a line break.

## 4. Auto Translation (`autoTranslationService`)

The auto-translation feature acts as a "smart reading assistant" that anticipates the user's needs:

- **Trigger**: It is a fire-and-forget process triggered silently by `TranslationPipeline.ts` after a successful manual translation.
- **Extraction**: It extracts the text of the parent block element (e.g., the current paragraph).
- **Generation**: It sends this block text to the backend (or the local `AutoCandidatesGenerationService`) along with the user's language proficiency level. The AI returns a list of difficult words ("candidates") and their contextual translations.
- **Mapping & Rendering**: `candidateDomMapper.ts` finds these candidates in the original DOM and converts them back to `Ranges`. Finally, they are rendered using the existing `translationDisplayV2` system, appearing as subtle underlines without interrupting the user's reading flow.
