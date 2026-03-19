/**
 * BatchQueue — accumulates translation requests and sends them as batches to the background.
 * Each enqueue() returns a Promise<string> that resolves with the translated text.
 * Includes retry logic for batch count mismatches and fallback to individual translation.
 */

import * as loggerModule from '@/0_common/utils/logger';
import type { FullTranslateBatchRequestMessage, FullTranslateBatchResponseMessage } from '@/0_common/types';
import {
    DEFAULT_BATCH_DELAY_MS,
    DEFAULT_MAX_CHARS_PER_BATCH,
    DEFAULT_MAX_ITEMS_PER_BATCH,
} from '../constants';

const logger = loggerModule.createLogger('FullTranslate/BatchQueue');

// --- Retry Constants ---
const MAX_RETRIES = 3;
const BASE_BACKOFF_DELAY_MS = 1000;
const MAX_BACKOFF_DELAY_MS = 8000;

class BatchCountMismatchError extends Error {
    constructor(expected: number, actual: number) {
        super(`Batch count mismatch: expected ${expected}, got ${actual}`);
        this.name = 'BatchCountMismatchError';
    }
}

type BatchResolverEntry = {
    text: string;
    resolve: (translatedText: string) => void;
    reject: (error: Error) => void;
};

export class BatchQueue {
    private queue: BatchResolverEntry[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private maxCharsPerBatch: number;
    private maxItemsPerBatch: number;
    private batchDelayMs: number;
    private sourceLang: string;
    private targetLang: string;

    constructor(config: {
        sourceLang: string;
        targetLang: string;
        maxCharsPerBatch?: number;
        maxItemsPerBatch?: number;
        batchDelayMs?: number;
    }) {
        this.sourceLang = config.sourceLang;
        this.targetLang = config.targetLang;
        this.maxCharsPerBatch = config.maxCharsPerBatch ?? DEFAULT_MAX_CHARS_PER_BATCH;
        this.maxItemsPerBatch = config.maxItemsPerBatch ?? DEFAULT_MAX_ITEMS_PER_BATCH;
        this.batchDelayMs = config.batchDelayMs ?? DEFAULT_BATCH_DELAY_MS;
    }

    /** Enqueue text for translation. Returns a promise that resolves with translated text. */
    enqueue(text: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            this.queue.push({ text, resolve, reject });
            if (this.isBatchFull()) {
                this.flush();
            } else {
                this.scheduleFlush();
            }
        });
    }

    /** Force flush all pending items. */
    flush(): void {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        if (this.queue.length === 0) {
            return;
        }

        const allEntries = this.queue.splice(0);
        const batches = this.splitIntoBatches(allEntries);
        logger.debug('[flush] flushing', { batchCount: batches.length, totalItems: allEntries.length });

        for (const batch of batches) {
            void this.executeBatch(batch);
        }
    }

    /** Clear pending items and cancel timers. */
    clear(): void {
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        const pending = this.queue.splice(0);
        for (const entry of pending) {
            entry.reject(new Error('BatchQueue cleared'));
        }
    }

    // --- Private ---

    private isBatchFull(): boolean {
        const totalChars = this.queue.reduce((sum, entry) => sum + entry.text.length, 0);
        return this.queue.length >= this.maxItemsPerBatch || totalChars >= this.maxCharsPerBatch;
    }

    private scheduleFlush(): void {
        if (this.flushTimer !== null) {
            return; // Already scheduled
        }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flush();
        }, this.batchDelayMs);
    }

    /** Split entries into batches respecting char and item limits. */
    private splitIntoBatches(entries: BatchResolverEntry[]): BatchResolverEntry[][] {
        const batches: BatchResolverEntry[][] = [];
        let currentBatch: BatchResolverEntry[] = [];
        let currentChars = 0;

        for (const entry of entries) {
            const wouldExceedItems = currentBatch.length >= this.maxItemsPerBatch;
            const wouldExceedChars = currentChars + entry.text.length > this.maxCharsPerBatch;

            if (currentBatch.length > 0 && (wouldExceedItems || wouldExceedChars)) {
                batches.push(currentBatch);
                currentBatch = [];
                currentChars = 0;
            }

            currentBatch.push(entry);
            currentChars += entry.text.length;
        }

        if (currentBatch.length > 0) {
            batches.push(currentBatch);
        }

        return batches;
    }

    /** Send a batch to the background for translation and resolve/reject entries. Retries on count mismatch. */
    private async executeBatch(batch: BatchResolverEntry[]): Promise<void> {
        const texts = batch.map(entry => entry.text);

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                const message: FullTranslateBatchRequestMessage = {
                    type: 'FULL_TRANSLATE_BATCH_REQUEST',
                    data: {
                        texts,
                        sourceLang: this.sourceLang,
                        targetLang: this.targetLang,
                    },
                };

                const response = await chrome.runtime.sendMessage(message) as FullTranslateBatchResponseMessage;

                if (!response || !response.success || !response.translations) {
                    const errorMsg = response?.error ?? 'Batch translation failed';
                    throw new Error(errorMsg);
                }

                const translations = response.translations;

                if (translations.length !== texts.length) {
                    throw new BatchCountMismatchError(texts.length, translations.length);
                }

                // Success — resolve all entries
                logger.debug('[executeBatch] success', { batchSize: texts.length });
                batch.forEach((entry, i) => {
                    entry.resolve(translations[i]!);
                });
                return;
            } catch (error) {
                if (attempt < MAX_RETRIES && error instanceof BatchCountMismatchError) {
                    const delay = Math.min(BASE_BACKOFF_DELAY_MS * Math.pow(2, attempt), MAX_BACKOFF_DELAY_MS);
                    logger.warn(`[executeBatch] count mismatch, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                // All retries exhausted or non-retryable error — fall back to individual
                logger.warn('[executeBatch] failed, falling back to individual', error);
                await this.fallbackToIndividual(batch);
                return;
            }
        }
    }

    /** Fall back to sending each entry as an individual translation request */
    private async fallbackToIndividual(batch: BatchResolverEntry[]): Promise<void> {
        logger.warn('[fallbackToIndividual] triggered', { batchSize: batch.length });
        await Promise.allSettled(
            batch.map(async (entry) => {
                try {
                    const translated = await this.sendSingleTranslation(entry.text);
                    entry.resolve(translated);
                } catch (err) {
                    entry.reject(err instanceof Error ? err : new Error(String(err)));
                }
            }),
        );
    }

    /** Send a single text for translation via the background */
    private sendSingleTranslation(text: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const message: FullTranslateBatchRequestMessage = {
                type: 'FULL_TRANSLATE_BATCH_REQUEST',
                data: {
                    texts: [text],
                    sourceLang: this.sourceLang,
                    targetLang: this.targetLang,
                },
            };

            chrome.runtime.sendMessage(message, (response: FullTranslateBatchResponseMessage) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                if (response?.success && response.translations?.[0]) {
                    resolve(response.translations[0]);
                } else {
                    reject(new Error(response?.error ?? 'Translation failed'));
                }
            });
        });
    }
}
