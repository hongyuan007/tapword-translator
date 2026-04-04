import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("KnowledgeStore")

const DB_NAME = "tapword-knowledge"
const STORE_NAME = "items"
const DB_VERSION = 1

// --- Public types ---

export interface KnowledgeItem {
    id: string
    text: string
    embedding: Float32Array
    source: string
    title: string
    createdAt: number
}

export interface ScoredItem {
    item: KnowledgeItem
    score: number
}

// --- Serialization helpers (IndexedDB cannot store Float32Array directly in all browsers) ---

interface StoredItem {
    id: string
    text: string
    embedding: number[]
    source: string
    title: string
    createdAt: number
}

function toStoredItem(item: KnowledgeItem): StoredItem {
    return {
        id: item.id,
        text: item.text,
        embedding: Array.from(item.embedding),
        source: item.source,
        title: item.title,
        createdAt: item.createdAt,
    }
}

function fromStoredItem(stored: StoredItem): KnowledgeItem {
    return {
        id: stored.id,
        text: stored.text,
        embedding: new Float32Array(stored.embedding),
        source: stored.source,
        title: stored.title,
        createdAt: stored.createdAt,
    }
}

// --- Cosine similarity ---

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
        const ai = a[i]!
        const bi = b[i]!
        dot += ai * bi
        normA += ai * ai
        normB += bi * bi
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    if (denom === 0) return 0
    return dot / denom
}

// --- KnowledgeStore class ---

export class KnowledgeStore {
    private dbPromise: Promise<IDBDatabase>

    constructor() {
        this.dbPromise = this.openDB()
    }

    private openDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION)

            request.onupgradeneeded = () => {
                const db = request.result
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: "id" })
                }
            }

            request.onsuccess = () => {
                resolve(request.result)
            }

            request.onerror = () => {
                logger.error("Failed to open IndexedDB", request.error)
                reject(request.error)
            }
        })
    }

    async store(item: KnowledgeItem): Promise<void> {
        const db = await this.dbPromise
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite")
            const store = tx.objectStore(STORE_NAME)
            store.put(toStoredItem(item))

            tx.oncomplete = () => {
                logger.info(`Stored knowledge item: ${item.id}`)
                resolve()
            }
            tx.onerror = () => {
                logger.error("Failed to store item", tx.error)
                reject(tx.error)
            }
        })
    }

    async search(queryEmbedding: Float32Array, topK = 5): Promise<ScoredItem[]> {
        const allItems = await this.list()
        const scored: ScoredItem[] = allItems.map((item) => ({
            item,
            score: cosineSimilarity(queryEmbedding, item.embedding),
        }))
        scored.sort((a, b) => b.score - a.score)
        return scored.slice(0, topK)
    }

    async delete(id: string): Promise<void> {
        const db = await this.dbPromise
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite")
            const store = tx.objectStore(STORE_NAME)
            store.delete(id)

            tx.oncomplete = () => {
                logger.info(`Deleted knowledge item: ${id}`)
                resolve()
            }
            tx.onerror = () => {
                logger.error("Failed to delete item", tx.error)
                reject(tx.error)
            }
        })
    }

    async list(): Promise<KnowledgeItem[]> {
        const db = await this.dbPromise
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly")
            const store = tx.objectStore(STORE_NAME)
            const request = store.getAll()

            request.onsuccess = () => {
                const stored = request.result as StoredItem[]
                resolve(stored.map(fromStoredItem))
            }
            request.onerror = () => {
                logger.error("Failed to list items", request.error)
                reject(request.error)
            }
        })
    }
}
