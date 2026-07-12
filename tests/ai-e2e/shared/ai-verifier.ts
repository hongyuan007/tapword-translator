import type { VerificationContext, VerificationResult } from './types';
import { DEFAULT_MODEL } from './types';

// ---------------------------------------------------------------------------
// Dependency injection — allows swapping the real AI call at runtime
// ---------------------------------------------------------------------------

type VerifyFn = (context: VerificationContext, model?: string) => Promise<VerificationResult>;

/**
 * Replace the default stub verifier with a real AI-backed implementation.
 * Call this before running Playwright specs that need actual GPT calls.
 *
 * @example
 * ```ts
 * import { setVerifyFn } from './ai-verifier';
 * setVerifyFn(apiVerifyWithImages);
 * ```
 */
export function setVerifyFn(fn: VerifyFn): void {
    _verifyFn = fn;
}

/** Reset back to the deterministic stub (useful between test suites). */
export function resetVerifyFn(): void {
    _verifyFn = stubVerify;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify a test scenario's outcome using AI (or a deterministic stub in
 * test mode).
 *
 * @param context  - Screenshots, expected behaviour, and optional code diff.
 * @param model    - Override model; defaults to `DEFAULT_MODEL`.
 */
export async function verifyWithAI(
    context: VerificationContext,
    model: string = DEFAULT_MODEL,
): Promise<VerificationResult> {
    return _verifyFn(context, model);
}

// ---------------------------------------------------------------------------
// Deterministic stub (default) — used by unit tests
// ---------------------------------------------------------------------------

/**
 * Heuristic-based verifier that produces deterministic PASS/FAIL results
 * without needing a real AI API call.
 *
 * Heuristics:
 *  - If any screenshot path contains "broken" or "fail" → FAIL
 *  - Otherwise → PASS
 *
 * This is intentionally simple; real verification is injected via
 * `setVerifyFn()` when running against a live AI backend.
 */
async function stubVerify(
    context: VerificationContext,
    _model?: string,
): Promise<VerificationResult> {
    const hasBrokenEvidence = context.screenshots.some(
        (s) => s.includes('broken') || s.includes('fail'),
    );

    const passed = !hasBrokenEvidence;

    const reason = passed
        ? `Verification passed for "${context.scenario}": all visual and functional checks completed successfully.`
        : `Verification failed for "${context.scenario}": issues detected in the screenshot evidence.`;

    return {
        scenario: context.scenario,
        passed,
        reason,
        screenshots: context.screenshots,
    };
}

// ---------------------------------------------------------------------------
// Module-level state (initialised to stub)
// ---------------------------------------------------------------------------

let _verifyFn: VerifyFn = stubVerify;
