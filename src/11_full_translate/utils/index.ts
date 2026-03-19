/**
 * Utility classes for full-page translation.
 */

// --- Observer Utilities ---
export { ViewportObserver } from './ViewportObserver';
export type { OnEnterViewportCallback } from './ViewportObserver';
export { DynamicContentObserver } from './DynamicContentObserver';
export type { OnNewContentCallback } from './DynamicContentObserver';

// --- DOM Batching ---
export { DomBatcher } from './DomBatcher';

// --- Translation Queue & Cache ---
export { BatchQueue } from './BatchQueue';
export { TokenBucketRateLimiter } from './TokenBucketRateLimiter';
export { TranslationCache } from './TranslationCache';
