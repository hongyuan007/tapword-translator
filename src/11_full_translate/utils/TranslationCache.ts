/**
 * TranslationCache — IndexedDB-based cache for full-page translations.
 * Keys are SHA-256 hashes of (text + sourceLang + targetLang).
 * Uses raw IndexedDB API (no external dependencies).
 */

import * as loggerModule from '@/0_common/utils/logger';

const logger = loggerModule.createLogger('FullTranslate/TranslationCache');

const DB_NAME = 'tapword-translation-cache';
const DB_VERSION = 1;
const STORE_NAME = 'translations';
const KEY_SEPARATOR = '|';

interface CacheEntry {
    hash: string;
    text: string;
    sourceLang: string;
    targetLang: string;
    translatedText: string;
    timestamp: number;
}

export class TranslationCache {
    private dbPromise: Promise<IDBDatabase> | null = null;

    /** Get a cached translation. Returns null if not found. */
    async get(text: string, sourceLang: string, targetLang: string): Promise<string | null> {
        try {
            const db = await this.getDb();
            const key = await this.generateKey(text, sourceLang, targetLang);

            return new Promise<string | null>((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const request = store.get(key);

                request.onsuccess = () => {
                    const entry = request.result as CacheEntry | undefined;
                    resolve(entry?.translatedText ?? null);
                };
                request.onerror = () => {
                    logger.warn('Cache get failed', request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            logger.warn('Cache get error, returning null', error);
            return null;
        }
    }

    /** Store a translation in the cache. */
    async set(text: string, sourceLang: string, targetLang: string, translatedText: string): Promise<void> {
        try {
            const db = await this.getDb();
            const key = await this.generateKey(text, sourceLang, targetLang);

            const entry: CacheEntry = {
                hash: key,
                text,
                sourceLang,
                targetLang,
                translatedText,
                timestamp: Date.now(),
            };

            return new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const request = store.put(entry);

                request.onsuccess = () => resolve();
                request.onerror = () => {
                    logger.warn('Cache set failed', request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            logger.warn('Cache set error, skipping', error);
        }
    }

    /** Clear the entire cache. */
    async clear(): Promise<void> {
        try {
            const db = await this.getDb();

            return new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const request = store.clear();

                request.onsuccess = () => resolve();
                request.onerror = () => {
                    logger.warn('Cache clear failed', request.error);
                    reject(request.error);
                };
            });
        } catch (error) {
            logger.warn('Cache clear error', error);
        }
    }

    /** Generate a cache key from text + language pair using SHA-256. */
    async generateKey(text: string, sourceLang: string, targetLang: string): Promise<string> {
        const raw = text + KEY_SEPARATOR + sourceLang + KEY_SEPARATOR + targetLang;
        const encoder = new TextEncoder();
        const data = encoder.encode(raw);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // --- Private ---

    /** Open (or create) the IndexedDB database. Lazy singleton. */
    private getDb(): Promise<IDBDatabase> {
        if (this.dbPromise !== null) {
            return this.dbPromise;
        }

        this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
                }
            };

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                logger.error('Failed to open IndexedDB', request.error);
                this.dbPromise = null; // Allow retry on next call
                reject(request.error);
            };
        });

        return this.dbPromise;
    }
}
