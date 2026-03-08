/**
 * Translation Modal Templates
 *
 * Loads HTML templates and provides rendering functions.
 * Templates are loaded from separate HTML files for better maintainability.
 */

import type { TranslationDetailData } from "@/1_content/ui/translationModal"
import { APP_EDITION } from "@/0_common/constants"
import * as i18nModule from "@/0_common/utils/i18n"
import { containsMeaningfulWords, isSingleWord } from "@/0_common/utils/textUtils"

// Import HTML templates as raw strings
import errorFragmentTemplate from "@/1_content/resources/modal-error-fragment.html?raw"
import errorTemplate from "@/1_content/resources/modal-error.html?raw"
import loadingFragmentTemplate from "@/1_content/resources/modal-loading-fragment.html?raw"
import loadingTemplate from "@/1_content/resources/modal-loading.html?raw"
import successFragmentTemplate from "@/1_content/resources/modal-success-fragment.html?raw"
import successTemplate from "@/1_content/resources/modal-success.html?raw"
import dictionaryTemplate from "@/1_content/resources/section-dictionary.html?raw"
import sentenceTemplate from "@/1_content/resources/section-original-sentence.html?raw"
import sentenceFragmentTemplate from "@/1_content/resources/section-sentence-fragment.html?raw"

// ============================================================================
// Template Helper Functions
// ============================================================================

/**
 * Get the update label HTML with i18n translation
 */
function getUpdateLabelHtml(): string {
    const text = i18nModule.translate("modal.updateLabel")
    return `<a class="ai-translator-modal-update-label" href="#" data-action="download-update">${text}</a>`
}

/**
 * Escape HTML to prevent XSS attacks
 */
function escapeHtml(text: string): string {
    const div = document.createElement("div")
    div.textContent = text
    return div.innerHTML
}

/**
 * Replace template variables with actual values
 */
function replaceVariables(template: string, variables: Record<string, string>): string {
    let result = template

    // Replace custom variables
    Object.entries(variables).forEach(([key, value]) => {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g")
        result = result.replace(regex, value)
    })

    return result
}

/**
 * Highlight the word in the original sentence
 * Constructs the highlighted sentence using leadingText, word, and trailingText
 */
function highlightWordInSentence(leadingText: string, word: string, trailingText: string): string {
    // Escape HTML for all parts
    const escapedLeading = escapeHtml(leadingText)
    const escapedWord = escapeHtml(word)
    const escapedTrailing = escapeHtml(trailingText)

    // Construct the highlighted sentence
    return `${escapedLeading}<span class="ai-translator-modal-word-highlight">${escapedWord}</span>${escapedTrailing}`
}

/**
 * Create the original sentence section with highlighted word
 */
function createSentenceSection(
    leadingText: string,
    word: string,
    trailingText: string,
    sentenceTranslation?: string,
    showUpdateLabel?: boolean
): string {
    const highlightedSentence = highlightWordInSentence(leadingText, word, trailingText)

    // Create update label if needed
    const updateLabel = showUpdateLabel ? getUpdateLabelHtml() : ""

    // Translate the template and then replace variables
    const translatedTemplate = i18nModule.translateTemplate(sentenceTemplate)
    return replaceVariables(translatedTemplate, {
        ORIGINAL_SENTENCE_WITH_HIGHLIGHT: highlightedSentence,
        SENTENCE_TRANSLATION: escapeHtml(sentenceTranslation || ""),
        UPDATE_LABEL: updateLabel,
    })
}

/**
 * Create the dictionary section
 * Dictionary title varies based on source/target language:
 * - English → Chinese: "英汉词典" (EN-CN Dictionary)
 * - Other combinations: generic "词典" (Dictionary)
 */
function createDictionarySection(
    dictionaryContent: string,
    text: string,
    lemma?: string | null,
    lemmaPhonetic?: string,
    sourceLanguage?: string,
    targetLanguage?: string
): string {
    // Format lemma and phonetic for display
    const lemmaText = lemma || ""
    const phoneticText = lemma ? (lemmaPhonetic ? `/${lemmaPhonetic}/` : "") : ""

    // Determine dictionary title based on source/target language pair
    // Treat "auto" as "en" if target is "zh" AND text is a valid single English word
    const isSourceEnglish = sourceLanguage === "en" || (sourceLanguage === "auto" && isSingleWord(text))
    const isEnglishToChinese = isSourceEnglish && targetLanguage === "zh"
    const dictionaryTitleKey = isEnglishToChinese ? "modal.section.dictionary.enZh" : "modal.section.dictionary"
    const dictionaryTitle = i18nModule.translate(dictionaryTitleKey)

    // Translate the template and then replace variables
    const translatedTemplate = i18nModule.translateTemplate(dictionaryTemplate)
    return replaceVariables(translatedTemplate, {
        DICTIONARY_TITLE: dictionaryTitle,
        LEMMA: escapeHtml(lemmaText),
        LEMMA_PHONETIC: escapeHtml(phoneticText),
        DICTIONARY_CONTENT: escapeHtml(dictionaryContent),
    })
}

/**
 * Highlight the fragment in the full sentence
 * Constructs the highlighted sentence using leadingText, fragment, and trailingText
 */
function highlightFragmentInSentence(leadingText: string, fragment: string, trailingText: string): string {
    // Escape HTML for all parts
    const escapedLeading = escapeHtml(leadingText)
    const escapedFragment = escapeHtml(fragment)
    const escapedTrailing = escapeHtml(trailingText)

    // Construct the highlighted sentence with fragment highlighted
    return `${escapedLeading}<span class="ai-translator-modal-word-highlight">${escapedFragment}</span>${escapedTrailing}`
}

/**
 * Create the full sentence section for fragment translation
 */
function createFragmentSentenceSection(leadingText: string, fragment: string, trailingText: string, sentenceTranslation: string): string {
    const highlightedSentence = highlightFragmentInSentence(leadingText, fragment, trailingText)

    // Translate the template and then replace variables
    const translatedTemplate = i18nModule.translateTemplate(sentenceFragmentTemplate)
    return replaceVariables(translatedTemplate, {
        FULL_SENTENCE_WITH_HIGHLIGHT: highlightedSentence,
        SENTENCE_TRANSLATION: escapeHtml(sentenceTranslation),
    })
}

// ============================================================================
// Template Renderers
// ============================================================================

/**
 * Render error state template
 */
export function renderErrorTemplate(data: TranslationDetailData): string {
    const translatedTemplate = i18nModule.translateTemplate(errorTemplate)
    return replaceVariables(translatedTemplate, {
        ERROR_MESSAGE: escapeHtml(data.errorMessage || i18nModule.translate("modal.error.default")),
        WORD: escapeHtml(data.text),
        APP_EDITION,
    })
}

/**
 * Render loading state template
 */
export function renderLoadingTemplate(data: TranslationDetailData): string {
    const translatedTemplate = i18nModule.translateTemplate(loadingTemplate)
    return replaceVariables(translatedTemplate, {
        WORD: escapeHtml(data.text),
        APP_EDITION,
    })
}

/**
 * Render success state template
 */
export function renderSuccessTemplate(data: TranslationDetailData, showUpdateLabel?: boolean): string {
    // Create original sentence section if available
    let originalSentenceSection = ""

    if (data.leadingText !== undefined && data.trailingText !== undefined) {
        originalSentenceSection = createSentenceSection(data.leadingText, data.text, data.trailingText, data.sentenceTranslation, showUpdateLabel)
    }

    // Create dictionary section based on target language
    // - If target language is Chinese ("zh"), show chineseDefinition
    // - Otherwise, show targetDefinition if available
    let dictionarySection = ""
    const isChinese = data.targetLanguage === "zh"
    const dictionaryContent = isChinese ? data.chineseDefinition : data.targetDefinition

    if (dictionaryContent) {
        dictionarySection = createDictionarySection(
            dictionaryContent,
            data.text,
            data.lemma,
            data.lemmaPhonetic,
            data.sourceLanguage,
            data.targetLanguage
        )
    }

    // Format phonetic text with slashes if available
    let phoneticText = ""
    if (data.phonetic) {
        phoneticText = `/${data.phonetic}/`
    }

    const translatedTemplate = i18nModule.translateTemplate(successTemplate)
    return replaceVariables(translatedTemplate, {
        WORD: escapeHtml(data.text),
        TRANSLATION: escapeHtml(data.translation),
        PHONETIC: escapeHtml(phoneticText),
        ORIGINAL_SENTENCE_SECTION: originalSentenceSection,
        DICTIONARY_SECTION: dictionarySection,
        APP_EDITION,
    })
}

/**
 * Render error state template for fragments
 */
export function renderErrorFragmentTemplate(data: TranslationDetailData): string {
    const translatedTemplate = i18nModule.translateTemplate(errorFragmentTemplate)
    return replaceVariables(translatedTemplate, {
        FRAGMENT_TEXT: escapeHtml(data.text),
        ERROR_MESSAGE: escapeHtml(data.errorMessage || i18nModule.translate("modal.error.default")),
        APP_EDITION,
    })
}

/**
 * Render loading state template for fragments
 */
export function renderLoadingFragmentTemplate(data: TranslationDetailData): string {
    const translatedTemplate = i18nModule.translateTemplate(loadingFragmentTemplate)
    return replaceVariables(translatedTemplate, {
        FRAGMENT_TEXT: escapeHtml(data.text),
        APP_EDITION,
    })
}

/**
 * Render success state template for fragments
 */
export function renderSuccessFragmentTemplate(data: TranslationDetailData, showUpdateLabel?: boolean): string {
    // Create full sentence section only if:
    // 1. leadingText and trailingText are defined
    // 2. sentenceTranslation is provided by backend
    // 3. At least one of leadingText or trailingText contains meaningful words
    //    (otherwise the fragment itself is already a complete sentence)
    let sentenceSection = ""

    if (
        data.leadingText !== undefined &&
        data.trailingText !== undefined &&
        data.sentenceTranslation &&
        (containsMeaningfulWords(data.leadingText) || containsMeaningfulWords(data.trailingText))
    ) {
        sentenceSection = createFragmentSentenceSection(data.leadingText, data.text, data.trailingText, data.sentenceTranslation)
    }

    // Create update label for the fragment section header if needed
    const fragmentUpdateLabel = showUpdateLabel ? getUpdateLabelHtml() : ""

    const translatedTemplate = i18nModule.translateTemplate(successFragmentTemplate)
    return replaceVariables(translatedTemplate, {
        FRAGMENT_TEXT: escapeHtml(data.text),
        FRAGMENT_TRANSLATION: escapeHtml(data.translation),
        SENTENCE_SECTION: sentenceSection,
        UPDATE_LABEL: fragmentUpdateLabel,
        APP_EDITION,
    })
}

/**
 * Main template renderer - selects appropriate template based on status and translationType
 */
export function renderModalContentTemplate(data: TranslationDetailData, showUpdateLabel?: boolean): string {
    // Use fragment templates for fragment translations
    if (data.translationType === "fragment") {
        switch (data.status) {
            case "error":
                return renderErrorFragmentTemplate(data)
            case "loading":
                return renderLoadingFragmentTemplate(data)
            case "success":
                return renderSuccessFragmentTemplate(data, showUpdateLabel)
            default:
                return renderErrorFragmentTemplate({
                    ...data,
                    status: "error",
                    errorMessage: "Unknown status",
                })
        }
    }

    // Use word templates for word translations
    switch (data.status) {
        case "error":
            return renderErrorTemplate(data)
        case "loading":
            return renderLoadingTemplate(data)
        case "success":
            return renderSuccessTemplate(data, showUpdateLabel)
        default:
            return renderErrorTemplate({
                ...data,
                status: "error",
                errorMessage: "Unknown status",
            })
    }
}
