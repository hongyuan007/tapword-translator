/**
 * TokenBucketRateLimiter — token bucket rate limiter for throttling API requests.
 * Tokens are added at a fixed rate. Each request consumes one token.
 * If no tokens are available, the request waits until a token is available.
 */

import { DEFAULT_REQUEST_CAPACITY, DEFAULT_REQUEST_RATE } from '../constants';

const MILLISECONDS_PER_SECOND = 1000;

export class TokenBucketRateLimiter {
    private tokens: number;
    private capacity: number;
    private rate: number; // tokens per second
    private lastRefill: number; // timestamp (ms)

    constructor(config?: {
        capacity?: number;
        rate?: number;
    }) {
        this.capacity = config?.capacity ?? DEFAULT_REQUEST_CAPACITY;
        this.rate = config?.rate ?? DEFAULT_REQUEST_RATE;
        this.tokens = this.capacity;
        this.lastRefill = Date.now();
    }

    /** Acquire a token. Returns a promise that resolves when a token is available. */
    async acquire(): Promise<void> {
        this.refill();

        if (this.tokens >= 1) {
            this.tokens -= 1;
            return;
        }

        // Calculate wait time until next token is generated
        const deficit = 1 - this.tokens;
        const waitMs = (deficit / this.rate) * MILLISECONDS_PER_SECOND;

        await new Promise<void>(resolve => setTimeout(resolve, waitMs));

        this.refill();
        this.tokens -= 1;
    }

    /** Reset the limiter to full capacity. */
    reset(): void {
        this.tokens = this.capacity;
        this.lastRefill = Date.now();
    }

    // --- Private ---

    /** Add tokens based on elapsed time since last refill. */
    private refill(): void {
        const now = Date.now();
        const elapsedSeconds = (now - this.lastRefill) / MILLISECONDS_PER_SECOND;
        const newTokens = elapsedSeconds * this.rate;

        this.tokens = Math.min(this.capacity, this.tokens + newTokens);
        this.lastRefill = now;
    }
}
