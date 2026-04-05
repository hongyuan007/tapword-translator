/**
 * Detects synthetic text injected by LLM proxy layers (e.g. litellm).
 *
 * When the upstream model returns only non-text content blocks (e.g. a single
 * thinking block), some proxies synthesize a text block containing a serialized
 * copy of the raw API response. This helper identifies such artifacts so the
 * streaming layer can suppress them before they reach the UI.
 *
 * Pattern matched:
 *   `(Empty response: {'content': [...], 'stop_reason': '...', ...})`
 */

/** Prefix emitted by litellm when it fabricates a text block. */
const PROXY_EMPTY_RESPONSE_PREFIX = "(Empty response: {"

/**
 * Returns `true` when `text` looks like a proxy-synthesized artifact
 * rather than genuine model output.
 *
 * The check is intentionally strict — it requires both the known prefix
 * AND a trailing structure that resembles a serialized response object —
 * so legitimate user-facing text is never suppressed.
 */
export function isProxyArtifact(text: string): boolean {
    if (!text.startsWith(PROXY_EMPTY_RESPONSE_PREFIX)) return false

    // Extra guard: the suffix must close with ")" and contain typical
    // response-object keys to avoid false positives on coincidental text.
    return text.endsWith(")") && text.includes("'stop_reason':")
}
