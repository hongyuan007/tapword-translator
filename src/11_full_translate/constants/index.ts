/**
 * Full-page translation constants
 */

// --- Data Attributes (session tracking) ---
export const WALKED_ATTRIBUTE = "data-tapword-walked";
export const PARAGRAPH_ATTRIBUTE = "data-tapword-paragraph";
export const BLOCK_ATTRIBUTE = "data-tapword-block-node";
export const INLINE_ATTRIBUTE = "data-tapword-inline-node";

// --- Data Attributes (wrapper metadata) ---
export const ATTR_TRANSLATION_MODE = "data-tw-mode";
export const ATTR_WALK_ID = "data-tw-walk-id";

export const MARK_ATTRIBUTES = new Set([
    WALKED_ATTRIBUTE,
    PARAGRAPH_ATTRIBUTE,
    BLOCK_ATTRIBUTE,
    INLINE_ATTRIBUTE,
    ATTR_TRANSLATION_MODE,
    ATTR_WALK_ID,
]);

// --- Extension Ownership (re-exported from common) ---
export { EXTENSION_OWNED_ATTRIBUTE } from '@/0_common/constants';

// --- CSS Class Names ---
export const CONTENT_WRAPPER_CLASS = "tapword-translated-content-wrapper";
export const INLINE_CONTENT_CLASS = "tapword-translated-inline-content";
export const BLOCK_CONTENT_CLASS = "tapword-translated-block-content";
export const NOTRANSLATE_CLASS = "notranslate";

// --- Tag Classification Sets ---

// Tags whose subtrees are NEVER walked or translated
export const DONT_WALK_AND_TRANSLATE_TAGS = new Set([
    "HEAD", "TITLE", "HR", "INPUT", "TEXTAREA", "IMG", "VIDEO", "AUDIO",
    "CANVAS", "SOURCE", "TRACK", "META", "SCRIPT", "NOSCRIPT", "STYLE",
    "LINK", "RT", "RP", "PRE", "svg",
    // MathML tags (lowercase)
    "math", "maction", "annotation", "annotation-xml", "menclose", "merror",
    "mfenced", "mfrac", "mi", "mmultiscripts", "mn", "mo", "mover",
    "mpadded", "mphantom", "mprescripts", "mroot", "mrow", "ms", "mspace",
    "msqrt", "mstyle", "msub", "msubsup", "msup", "mtable", "mtd", "mtext",
    "mtr", "munder", "munderover", "semantics",
]);

// Tags not walked into, but their text IS included in parent paragraph
export const DONT_WALK_BUT_TRANSLATE_TAGS = new Set(["CODE", "TIME"]);

// Tags always treated as block-level regardless of CSS
export const FORCE_BLOCK_TAGS = new Set([
    "BODY", "H1", "H2", "H3", "H4", "H5", "H6", "BR", "FORM", "SELECT",
    "BUTTON", "LABEL", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "ARTICLE",
    "SECTION", "FIGURE", "FIGCAPTION", "HEADER", "FOOTER", "MAIN", "NAV",
]);

// Tags where translation is forced as inline even if block by CSS
export const FORCE_INLINE_TRANSLATION_TAGS = new Set([
    "A", "BUTTON", "SELECT", "OPTION", "SPAN",
]);

// Tags to skip when translating only "main" content (not "all")
// Keep this list even though the current entrypoint defaults to "all".
// The "main" range is intentionally preserved for future product use.
export const MAIN_CONTENT_IGNORE_TAGS = new Set([
    "HEADER", "FOOTER", "NAV", "NOSCRIPT",
]);

// --- Batch Queue Defaults ---
export const BATCH_SEPARATOR = "\u27E8\u27E9"; // ⟨⟩
export const DEFAULT_BATCH_DELAY_MS = 100;
export const DEFAULT_MAX_CHARS_PER_BATCH = 1000;
export const DEFAULT_MAX_ITEMS_PER_BATCH = 4;

// --- Site-Specific Dont-Walk Selectors ---
// Hostname → CSS selectors for elements whose subtrees should NOT be walked or translated.
export const CUSTOM_DONT_WALK_SELECTORS: Record<string, string[]> = {
    // ChatGPT — skip editor input area
    'chatgpt.com': [
        '.ProseMirror',
    ],
    // arXiv — skip code listings
    'arxiv.org': [
        '.ltx_listing',
    ],
    // Reddit — skip screen-reader content, header chrome, comment action rows, post flair
    'www.reddit.com': [
        'faceplate-screen-reader-content > *',
        'reddit-header-large *',
        'shreddit-comment-action-row > *',
        'shreddit-post-flair',
    ],
    // YouTube — skip masthead, sidebar, metadata, channel names, badges, subtitles
    'www.youtube.com': [
        '#masthead-container *',
        '#guide-inner-content *',
        '#metadata *',
        '#channel-name',
        '.yt-lockup-metadata-view-model__metadata',
        '.yt-spec-avatar-shape__badge-text',
        '.shortsLockupViewModelHostOutsideMetadataSubhead',
        'ytd-comments-header-renderer',
        '#top-row',
        '#header-author',
        '#reply-button-end',
        '#more-replies',
        '#info',
        '#badges *',
        '.ytp-caption-window-container',
    ],
    // Discord — skip usernames, timestamps, replies, member lists, input areas
    'discord.com': [
        '[id^="message-username"]',
        'span[class*="-timestamp"]',
        'div[class*="-repliedMessage"]',
        'li[class*="-containerDefault"]',
        '[class*="-subtitleContainer"]',
        '[class*="-formWithLoadedChatInput"]',
    ],
    // GitHub — skip file tree, header, repository header, overview content
    'github.com': [
        '[aria-labelledby="folders-and-files"] *',
        'header *',
        '#repository-container-header *',
        '[class*="OverviewContent-module__Box_1--"] *',
    ],
};

// --- Site-Specific Force-Block Selectors ---
// Hostname → CSS selectors that force block-level translation insertion.
export const CUSTOM_FORCE_BLOCK_SELECTORS: Record<string, string[]> = {
    'github.com': [
        'task-lists',
    ],
    'engoo.com': [
        '#windowexercise-2 > div > div > div.css-ep7xq6 > div > div > div.css-19m2fbm *',
    ],
    'www.youtube.com': [
        'yt-attributed-string > span',
    ],
    // Temporarily disabled while validating the generic unwrap/content-container fix.
    // Re-enable only if the generic rule proves insufficient for tweet body rendering.
    // 'x.com': [
    //     '[data-testid="tweetText"] span',
    // ],
    // 'twitter.com': [
    //     '[data-testid="tweetText"] span',
    // ],
};

// --- RTL Languages ---
export const RTL_LANGUAGE_CODES = new Set([
    'ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi', 'ku', 'ug',
]);

// --- Rate Limiter Defaults ---
export const DEFAULT_REQUEST_RATE = 8;       // tokens per second
export const DEFAULT_REQUEST_CAPACITY = 60;  // bucket capacity

// --- Preload Defaults ---
export const DEFAULT_PRELOAD_MARGIN = 600;   // px
export const DEFAULT_PRELOAD_THRESHOLD = 0.1;

// --- Text Filter Defaults ---
export const DEFAULT_MIN_CHARS_PER_NODE = 0;
export const DEFAULT_MIN_WORDS_PER_NODE = 0;
