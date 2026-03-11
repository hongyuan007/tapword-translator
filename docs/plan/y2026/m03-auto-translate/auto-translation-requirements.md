# Automatic Word/Phrase Translation Requirements
*Created: 2026-03-06*

## 1. Overview
The "Automatic Word/Phrase Translation" feature aims to enhance the reading experience by automatically identifying and translating potential "unknown" words or phrases within the same context (paragraph/block) when a user manually translates a word. This reduces the need for repetitive manual clicks and helps users understand the text more fluidly.

## 2. User Stories
- **US-001**: As a user, when I manually translate a word, I want the system to automatically identify and translate other difficult words in the same paragraph, so I can read the rest of the text without interruption.
- **US-002**: As a user, I want to be able to set my English proficiency level (e.g., Beginner, Intermediate, Advanced) so that the system correctly identifies words that are likely unknown to me.
- **US-003**: As a user, I want to be able to enable or disable this feature in the settings, as I might not always want screen clutter.
- **US-004**: As a user, I want the automatically translated words to look visually identical to manually translated words (highlight + floating note) for a consistent experience.

## 3. Functional Requirements

### 3.1. Triggering Mechanism
- **Trigger Event**: The auto-translation process is initiated **after** a successful manual translation (via single-click or selection).
- **Condition**: The feature must be enabled in the user settings.
- **Frequency Control**: 
    - The process should run **only once per block element**. 
    - The system must track which block elements have already been "scanned" to prevent redundant API calls and UI updates.

### 3.2. Scoping and Context
- **Scope**: The scanning scope is limited to the **nearest block-level ancestor** of the manually translated element.
    - Logic should follow the existing `findNearestBlockAncestor` utility (used in `lineHeightAdjuster`).
    - Typical elements: `<p>`, `<div>`, `<li>`, etc.
- **Content Extraction**: The system handles the text content within this block scope.

### 3.3. Identification of Unknown Words
- **Method**: Use an LLM (Large Language Model) to identify "unknown" words/phrases.
- **Input to LLM**:
    - The full text of the block.
    - The user's configured **Proficiency Level**.
- **Output from LLM**: A list of identified words/phrases and their translations.

### 3.4. Translation Display
- **Visual Style**: Auto-translated words must use the existing translation UI (highlighted text with a floating tooltip below).
- **Batch Processing**: The system should iterate through the list of identified words, find their occurrences within the block, and apply the translation UI.
    - *Note*: Care must be taken to avoid overlapping with the user's manual translation or other auto-translations.

### 3.5. Settings and Configuration
- **New Settings Required**:
    - `enableAutoTranslate` (Boolean, default: `false`): Toggle to turn the feature on/off.
    - `userLanguageProficiency` (Enum, default: `Intermediate`): Options: `Beginner`, `Intermediate`, `Advanced`.

## 4. Technical Constraints & Considerations
- **Performance**: The "scanning" and LLM request should happen in the background without blocking the user interface.
- **Concurrency**: Multiple words in the same block might be returned. The system needs to handle rendering multiple tooltips simultaneously (or sequentially with low latency).
- **Cost**: To minimize LLM costs, strict caching (per block) is required.

## 5. Future Improvements (Out of Scope for V1)
- Adaptive proficiency learning based on user's translation history.
- "Hide" button for auto-translations that the user actually knows.
