/**
 * Translation API Types
 *
 * Types for Translation API v1 request and response
 */

/**
 * Translation context information
 */
export interface TranslationContext {
    /** 句子内部单词前的文本 */
    leadingText: string
    /** 句子内部单词后的文本 */
    trailingText: string
    /** 主句子之前的句子数组 (从早到晚排序) */
    previousSentences?: string[]
    /** 主句子之后的句子数组 (从早到晚排序) */
    nextSentences?: string[]
    /** 书名 */
    bookName?: string
    /** 作者 */
    bookAuthor?: string
}

/**
 * Translation API request
 */
export interface TranslationApiRequest {
    /** 要翻译的单词或短语 */
    text: string
    /** 源语言代码 (例如 "en") */
    sourceLanguage?: string
    /** 目标语言代码 (例如 "zh") */
    targetLanguage?: string
    /** 使用升级模型 (可选, 用于刷新请求) */
    upgradeModel?: boolean
    /** 上下文信息 */
    context?: TranslationContext
}

/**
 * Translation API response data
 */
export interface TranslationApiResponse {
    /** 单词翻译 */
    wordTranslation: string
    /** 句子翻译 (仅当提供 context 时存在) */
    sentenceTranslation?: string
    /** 翻译提供商名称 */
    provider: string
    /** 中文词典定义 (仅对单个英文单词存在) */
    chineseDefinition?: string
    /** 英文词典定义 (仅对单个英文单词存在) */
    englishDefinition?: string
    /** 目标语言词典定义 (仅当 FreeDict 词典可用时存在, 如 en-ja, en-es, en-de, en-fr, en-ru, en-zh) */
    targetDefinition?: string
    /** 词形还原后的基本形式 (例如 "running" → "run") */
    lemma?: string | null
    /** IPA 格式的音标 (仅对单个英文单词存在) */
    phonetic?: string
    /** 词形还原后的基本形式的音标 (仅当词形还原时存在) */
    lemmaPhonetic?: string
}

/**
 * Fragment translation context information
 */
export interface FragmentTranslationContext {
    /** 段落中主句子之前的句子数组 (从早到晚排序) */
    previousSentences?: string[]
    /** 段落中主句子之后的句子数组 (从早到晚排序) */
    nextSentences?: string[]
    /** 书名 */
    bookName?: string
    /** 作者 */
    bookAuthor?: string
}

/**
 * Fragment translation API request
 */
export interface FragmentTranslationApiRequest {
    /** 要翻译的片段 */
    text: string
    /** 片段前的文本 (句子内部) */
    leadingText?: string
    /** 片段后的文本 (句子内部) */
    trailingText?: string
    /** 源语言代码 (例如 "en") */
    sourceLanguage?: string
    /** 目标语言代码 (例如 "zh") */
    targetLanguage?: string
    /** 使用升级模型 (可选, 用于刷新请求) */
    upgradeModel?: boolean
    /** 上下文信息 */
    context?: FragmentTranslationContext
}

/**
 * Fragment translation API response data
 */
export interface FragmentTranslationApiResponse {
    /** 片段翻译 */
    translation: string
    /** 完整句子翻译 (可选: 当提供 leadingText 和 trailingText 时返回) */
    sentenceTranslation?: string
}

/**
 * Full-text batch translation API request
 */
export interface FullTextBatchApiRequest {
    /** Array of text segments to translate */
    texts: string[]
    /** Source language code (e.g. "en") */
    sourceLanguage: string
    /** Target language code (e.g. "zh") */
    targetLanguage: string
}

/**
 * Full-text batch translation API response data
 */
export interface FullTextBatchApiResponse {
    /** Array of translated texts, same order and length as input texts */
    translations: string[]
    /** Source language code */
    sourceLanguage: string
    /** Target language code */
    targetLanguage: string
    /** Aggregate token usage for the single LLM call */
    usage?: {
        promptTokens: number
        completionTokens: number
        totalTokens: number
    }
}
