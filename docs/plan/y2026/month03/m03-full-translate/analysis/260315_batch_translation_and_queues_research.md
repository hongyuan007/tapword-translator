# Batch Translation & Queue System Research

> Date: 2026-03-15  
> Source: Read Frog project (`/Users/hongyuan/project/read-frog`)  
> Target: TapWord Translator (`/Users/hongyuan/project/v2/tapword-translator`)

---

## Table of Contents

1. [Read Frog Batch Queue Architecture](#1-read-frog-batch-queue-architecture)
2. [Read Frog Request Queue (Token Bucket)](#2-read-frog-request-queue-token-bucket)
3. [Read Frog Background Message Handling](#3-read-frog-background-message-handling)
4. [Read Frog Caching (IndexedDB / Dexie)](#4-read-frog-caching-indexeddb--dexie)
5. [TapWord Existing Infrastructure](#5-tapword-existing-infrastructure)
6. [Adaptation Plan for TapWord](#6-adaptation-plan-for-tapword)

---

## 1. Read Frog Batch Queue Architecture

**File:** `src/utils/request/batch-queue.ts`

### 1.1 Full Source

```typescript
import { batchQueueConfigSchema } from "@/types/config/translate"

export class BatchCountMismatchError extends Error {
  constructor(expected: number, got: number, results: unknown[]) {
    super(`Batch result count mismatch: expected ${expected}, got ${got}.\nResults: ["${results.join("\",\n\"")}"]`)
    this.name = "BatchCountMismatchError"
  }
}

const BASE_BACKOFF_DELAY_MS = 1000
const MAX_BACKOFF_DELAY_MS = 8000

interface BatchTask<T, R> {
  data: T
  resolve: (value: R) => void
  reject: (error: Error) => void
}

interface PendingBatch<T, R> {
  id: string
  tasks: BatchTask<T, R>[]
  totalCharacters: number
  createdAt: number
}

export interface BatchOptions<T, R> {
  maxCharactersPerBatch: number
  maxItemsPerBatch: number
  batchDelay: number
  maxRetries?: number
  enableFallbackToIndividual?: boolean
  getBatchKey: (data: T) => string
  getCharacters: (data: T) => number
  executeBatch: (dataList: T[]) => Promise<R[]>
  executeIndividual?: (data: T) => Promise<R>
  onError?: (error: Error, context: { batchKey: string, retryCount: number, isFallback: boolean }) => void
}

export class BatchQueue<T, R> {
  private pendingBatchMap = new Map<string, PendingBatch<T, R>>()
  private nextScheduleTimer: NodeJS.Timeout | null = null
  private maxCharactersPerBatch: number
  private maxItemsPerBatch: number
  private batchDelay: number
  private maxRetries: number
  private enableFallbackToIndividual: boolean
  private getBatchKey: (data: T) => string
  private getCharacters: (data: T) => number
  private executeBatch: (dataList: T[]) => Promise<R[]>
  private executeIndividual?: (data: T) => Promise<R>
  private onError?: (error: Error, context: { batchKey: string, retryCount: number, isFallback: boolean }) => void

  constructor(config: BatchOptions<T, R>) {
    this.maxCharactersPerBatch = config.maxCharactersPerBatch
    this.maxItemsPerBatch = config.maxItemsPerBatch
    this.batchDelay = config.batchDelay
    this.maxRetries = config.maxRetries ?? 3
    this.enableFallbackToIndividual = config.enableFallbackToIndividual ?? true
    this.getBatchKey = config.getBatchKey
    this.getCharacters = config.getCharacters
    this.executeBatch = config.executeBatch
    this.executeIndividual = config.executeIndividual
    this.onError = config.onError
  }

  enqueue(data: T): Promise<R> {
    let resolve!: (value: R) => void
    let reject!: (error: Error) => void
    const promise = new Promise<R>((res, rej) => {
      resolve = res
      reject = rej
    })

    const batchKey = this.getBatchKey(data)
    const task: BatchTask<T, R> = { data, resolve, reject }

    this.addTaskToBatch(task, batchKey)
    this.schedule()

    return promise
  }

  private schedule() {
    if (this.nextScheduleTimer) {
      clearTimeout(this.nextScheduleTimer)
      this.nextScheduleTimer = null
    }

    const now = Date.now()
    const batchesToFlush: string[] = []

    for (const [batchKey, batch] of this.pendingBatchMap.entries()) {
      const shouldFlushNow = this.shouldFlushBatch(batch)
      const isTimedOut = now >= batch.createdAt + this.batchDelay

      if (shouldFlushNow || isTimedOut) {
        batchesToFlush.push(batchKey)
      }
    }

    for (const batchKey of batchesToFlush) {
      this.flushPendingBatchByKey(batchKey)
    }

    if (this.pendingBatchMap.size > 0) {
      this.nextScheduleTimer = setTimeout(() => {
        this.nextScheduleTimer = null
        this.schedule()
      }, this.batchDelay)
    }
  }

  private addTaskToBatch(task: BatchTask<T, R>, batchKey: string) {
    const characters = this.getCharacters(task.data)
    const existingBatch = this.pendingBatchMap.get(batchKey)

    if (existingBatch) {
      if (existingBatch.totalCharacters + characters <= this.maxCharactersPerBatch) {
        existingBatch.tasks.push(task)
        existingBatch.totalCharacters += characters
      } else {
        this.flushPendingBatchByKey(batchKey)
        this.createNewPendingBatch(task, batchKey)
      }
    } else {
      this.createNewPendingBatch(task, batchKey)
    }
  }

  private shouldFlushBatch(batch: PendingBatch<T, R>): boolean {
    return (
      batch.tasks.length >= this.maxItemsPerBatch
      || batch.totalCharacters >= this.maxCharactersPerBatch
    )
  }

  private createNewPendingBatch(task: BatchTask<T, R>, batchKey: string) {
    const batchId = crypto.randomUUID()
    const pendingBatch: PendingBatch<T, R> = {
      id: batchId,
      tasks: [task],
      totalCharacters: this.getCharacters(task.data),
      createdAt: Date.now(),
    }
    this.pendingBatchMap.set(batchKey, pendingBatch)
  }

  private flushPendingBatchByKey(batchKey: string) {
    const pendingBatch = this.pendingBatchMap.get(batchKey)
    if (!pendingBatch) return

    this.pendingBatchMap.delete(batchKey)
    const { tasks } = pendingBatch
    void this.executeBatchWithRetry(tasks, batchKey, 0)
  }

  private async executeBatchWithRetry(tasks: BatchTask<T, R>[], batchKey: string, retryCount: number): Promise<void> {
    try {
      const results = await this.executeBatch(tasks.map(task => task.data))
      if (!results) {
        throw new Error("Batch execution results are undefined")
      }
      if (results.length !== tasks.length) {
        throw new BatchCountMismatchError(tasks.length, results.length, results)
      }
      tasks.forEach((task, index) => task.resolve(results[index]))
    } catch (error) {
      const err = error as Error
      this.onError?.(err, { batchKey, retryCount, isFallback: false })

      // Only retry on count mismatch errors (LLM returned wrong number of results)
      if (retryCount < this.maxRetries && err instanceof BatchCountMismatchError) {
        const delay = this.calculateBackoffDelay(retryCount)
        await this.sleep(delay)
        return this.executeBatchWithRetry(tasks, batchKey, retryCount + 1)
      }

      if (this.enableFallbackToIndividual && this.executeIndividual) {
        return this.executeFallbackIndividual(tasks, batchKey)
      }

      tasks.forEach(task => task.reject(err))
    }
  }

  private async executeFallbackIndividual(tasks: BatchTask<T, R>[], batchKey: string) {
    await Promise.allSettled(
      tasks.map(async (task) => {
        try {
          if (!this.executeIndividual) {
            throw new Error("executeIndividual is not defined")
          }
          const result = await this.executeIndividual(task.data)
          task.resolve(result)
        } catch (error) {
          const err = error as Error
          this.onError?.(err, { batchKey, retryCount: this.maxRetries, isFallback: true })
          task.reject(err)
        }
      }),
    )
  }

  private calculateBackoffDelay(retryCount: number): number {
    return Math.min(BASE_BACKOFF_DELAY_MS * (2 ** retryCount), MAX_BACKOFF_DELAY_MS)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  setBatchConfig(config: Partial<Pick<BatchOptions<T, R>, "maxCharactersPerBatch" | "maxItemsPerBatch">>) {
    const parseConfigStatus = batchQueueConfigSchema.partial().safeParse(config)
    if (parseConfigStatus.error) {
      throw new Error(parseConfigStatus.error.issues[0].message)
    }
    this.maxCharactersPerBatch = config.maxCharactersPerBatch ?? this.maxCharactersPerBatch
    this.maxItemsPerBatch = config.maxItemsPerBatch ?? this.maxItemsPerBatch
  }
}
```

### 1.2 Detailed Explanation

**Core Idea:** The `BatchQueue` collects individual translation items and groups them into batches before sending. This drastically reduces API calls when translating a full page of text nodes.

#### Data Flow

```
enqueue(data) ──► getBatchKey(data) ──► addTaskToBatch()
                                             │
                  ┌──────────────────────────┘
                  ▼
           pendingBatchMap                schedule() timer
           ┌───────────────┐               (batchDelay ms)
           │ key → Batch   │                    │
           │   tasks[]     │◄───────────────────┘
           │   totalChars  │       flushPendingBatchByKey()
           │   createdAt   │                    │
           └───────────────┘                    ▼
                                    executeBatchWithRetry()
                                         │
                             ┌───────────┼──────────────┐
                             ▼           ▼              ▼
                          success    count mismatch   other error
                          resolve    retry (backoff)  fallback individual
                          each task                   or reject all
```

#### Key Design Decisions

1. **Batch Key Grouping:** `getBatchKey(data)` hashes `"{sourceCode}-{targetCode}-{providerId}"`. Texts that target the same language pair + provider end up in the same batch. Different language directions create separate batches.

2. **Text Joining with Separator:** In the `executeBatch` callback, texts are joined with `\n\n%%\n\n` (the `BATCH_SEPARATOR` constant `"%%"`). When the LLM responds, `parseBatchResult()` splits the result by `"%%"` to recover individual translations.

3. **Flush Conditions (Two Triggers):**
   - **Size limit:** `tasks.length >= maxItemsPerBatch` OR `totalCharacters >= maxCharactersPerBatch`
   - **Time limit:** `Date.now() >= batch.createdAt + batchDelay`
   - On every `enqueue()`, `schedule()` is called which checks both conditions and sets a timer for the time-based flush.

4. **Retry Strategy:**
   - Only retries on `BatchCountMismatchError` (LLM returned wrong number of results)
   - Exponential backoff: `min(1000 * 2^retryCount, 8000)` ms
   - Up to `maxRetries` (default: 3)
   - Other errors skip retry entirely

5. **Fallback to Individual:**
   - When `enableFallbackToIndividual = true` (default) and batch fails after retries
   - Each task is executed individually via `executeIndividual()`
   - Uses `Promise.allSettled` so one failure doesn't block others

6. **Promise per Item:** Each `enqueue()` returns a `Promise<R>` that resolves when that specific item's translation is ready, even though the actual API call is batched.

7. **Configurable at Runtime:** `setBatchConfig()` allows adjusting `maxCharactersPerBatch` and `maxItemsPerBatch` dynamically (validated with Zod schema).

#### Configuration (from `translation-queues.ts`)

```typescript
const batchQueue = new BatchQueue<TranslateBatchData, string>({
  maxCharactersPerBatch,  // from config, e.g. 5000
  maxItemsPerBatch,       // from config, e.g. 10
  batchDelay: 100,        // 100ms collection window
  maxRetries: 3,
  enableFallbackToIndividual: true,
  getBatchKey: (data) => Sha256Hex(`${sourceCode}-${targetCode}-${providerId}`),
  getCharacters: data => data.text.length,
  executeBatch: async (dataList) => { /* joins texts, calls executeTranslate() */ },
  executeIndividual: async (data) => { /* calls executeTranslate() for single text */ },
  onError: (error, context) => { /* logs error */ },
})
```

---

## 2. Read Frog Request Queue (Token Bucket)

**File:** `src/utils/request/request-queue.ts`

### 2.1 Full Source

```typescript
import { deepmerge } from "deepmerge-ts"
import { requestQueueConfigSchema } from "@/types/config/translate"
import { BinaryHeapPQ } from "./priority-queue"

export interface RequestTask {
  id: string
  thunk: () => Promise<any>
  promise: Promise<any>
  resolve: (value: any) => void
  reject: (error: any) => void
  scheduleAt: number
  createdAt: number
  retryCount: number
}

export interface QueueOptions {
  rate: number          // tokens per second
  capacity: number      // max bucket size
  timeoutMs: number
  maxRetries: number
  baseRetryDelayMs: number
}

export class RequestQueue {
  private waitingQueue: BinaryHeapPQ<RequestTask & { hash: string }>
  private waitingTasks = new Map<string, RequestTask>()
  private executingTasks = new Map<string, RequestTask>()
  private nextScheduleTimer: NodeJS.Timeout | null = null

  // Token bucket state
  private bucketTokens: number
  private lastRefill: number

  constructor(private options: QueueOptions) {
    this.options = options
    this.bucketTokens = options.capacity
    this.lastRefill = Date.now()
    this.waitingQueue = new BinaryHeapPQ<RequestTask & { hash: string }>()
  }

  enqueue<T>(thunk: () => Promise<T>, scheduleAt: number, hash: string): Promise<T> {
    // Dedup: if same hash is waiting/executing, return existing promise
    const duplicateTask = this.duplicateTask(hash)
    if (duplicateTask) {
      return duplicateTask.promise
    }

    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })

    const task: RequestTask = {
      id: crypto.randomUUID(),
      thunk,
      promise,
      resolve,
      reject,
      scheduleAt,
      createdAt: Date.now(),
      retryCount: 0,
    }

    this.waitingTasks.set(hash, task)
    this.waitingQueue.push({ ...task, hash }, scheduleAt)
    this.schedule()
    return promise
  }

  private schedule() {
    this.refillTokens()

    while (this.bucketTokens >= 1 && this.waitingQueue.size() > 0) {
      const task = this.waitingQueue.peek()
      if (task && task.scheduleAt <= Date.now()) {
        this.waitingQueue.pop()
        this.waitingTasks.delete(task.hash)
        this.executingTasks.set(task.hash, task)
        this.bucketTokens--
        void this.executeTask(task)
      } else {
        break
      }
    }

    // Schedule next check
    if (this.nextScheduleTimer) {
      clearTimeout(this.nextScheduleTimer)
      this.nextScheduleTimer = null
    }

    if (this.waitingQueue.size() > 0) {
      const nextTask = this.waitingQueue.peek()
      if (nextTask) {
        const now = Date.now()
        const delayUntilScheduled = Math.max(0, nextTask.scheduleAt - now)
        const msUntilNextToken = this.bucketTokens >= 1
          ? 0
          : Math.ceil((1 - this.bucketTokens) / this.options.rate * 1000)
        const delay = Math.max(delayUntilScheduled, msUntilNextToken)

        this.nextScheduleTimer = setTimeout(() => {
          this.nextScheduleTimer = null
          this.schedule()
        }, delay)
      }
    }
  }

  private async executeTask(task: RequestTask & { hash: string }) {
    let timeoutId: NodeJS.Timeout | null = null

    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Task ${task.id} timed out after ${this.options.timeoutMs}ms`))
        }, this.options.timeoutMs)
      })

      const result = await Promise.race([task.thunk(), timeoutPromise])

      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }
      task.resolve(result)
    } catch (error) {
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null }

      if (task.retryCount < this.options.maxRetries) {
        task.retryCount++
        const backoffDelayMs = this.options.baseRetryDelayMs * (2 ** (task.retryCount - 1))
        const jitter = Math.random() * 0.1 * backoffDelayMs
        const delayMs = backoffDelayMs + jitter
        const retryAt = Date.now() + delayMs
        task.scheduleAt = retryAt

        this.waitingTasks.set(task.hash, task)
        this.waitingQueue.push(task, retryAt)
        this.schedule()
      } else {
        task.reject(error)
      }
    } finally {
      if (timeoutId) { clearTimeout(timeoutId) }
      this.executingTasks.delete(task.hash)
      this.schedule()
    }
  }

  private duplicateTask(hash: string) {
    return this.waitingTasks.get(hash) ?? this.executingTasks.get(hash) ?? undefined
  }

  private refillTokens() {
    const now = Date.now()
    const timeSinceLastRefill = now - this.lastRefill
    const tokensToAdd = (timeSinceLastRefill / 1000) * this.options.rate
    this.bucketTokens = Math.min(this.bucketTokens + tokensToAdd, this.options.capacity)
    this.lastRefill = now
  }

  setQueueOptions(options: Partial<QueueOptions>) {
    const parseConfigStatus = requestQueueConfigSchema.partial().safeParse(options)
    if (parseConfigStatus.error) {
      throw new Error(parseConfigStatus.error.issues[0].message)
    }
    this.options = deepmerge(this.options, options) as QueueOptions
    if (options.capacity) {
      this.bucketTokens = options.capacity
      this.lastRefill = Date.now()
    }
  }
}
```

### 2.2 Detailed Explanation

#### Token Bucket Algorithm

The `RequestQueue` implements classic **token bucket rate limiting**:

- **Bucket** holds up to `capacity` tokens (e.g. 5).
- Tokens **refill** at `rate` tokens per second (e.g. 2/sec) on every `schedule()` call.
- Each request **consumes 1 token**.
- If bucket is empty, the scheduler calculates when the next token arrives: `ceil((1 - bucketTokens) / rate * 1000)` ms.

```
Time ────────────────────────────────────────────►
Tokens: [5]  [4]  [3]  [2]  [1]  [0]  wait... [0.5]  [1]  execute
         ↑    ↑    ↑    ↑    ↑              refill at rate/sec
       execute execute execute execute
```

#### Priority Queue

Uses a `BinaryHeapPQ` (min-heap by `scheduleAt` timestamp). Tasks with earlier `scheduleAt` are dequeued first. This enables:
- Immediate execution for tasks with `scheduleAt = Date.now()`
- Delayed retry scheduling by pushing the task back with a future `scheduleAt`

#### Deduplication

Before adding a task, checks `waitingTasks` and `executingTasks` by **hash**. If a duplicate hash is found, the existing promise is returned instead of creating a new task. This prevents redundant API calls for the same text.

#### Timeout

Each task races against a `setTimeout(timeoutMs)`. If the thunk doesn't resolve in time, the timeout rejects first. Default: 20,000ms.

#### Retry with Exponential Backoff + Jitter

- Backoff: `baseRetryDelayMs * 2^(retryCount - 1)`
- Jitter: `random() * 0.1 * backoff` (10% jitter to prevent thundering herd)
- Default: `baseRetryDelayMs = 1000`, `maxRetries = 2`
- On retry: task is pushed back to the priority queue with a future `scheduleAt`

#### Configuration (from `translation-queues.ts`)

```typescript
const requestQueue = new RequestQueue({
  rate: 2,         // 2 tokens/sec (from config)
  capacity: 5,     // burst size (from config)
  timeoutMs: 20_000,
  maxRetries: 2,
  baseRetryDelayMs: 1_000,
})
```

---

## 3. Read Frog Background Message Handling

**Files:**
- `src/entrypoints/background/translation-queues.ts`
- `src/entrypoints/background/index.ts`
- `src/utils/message.ts`

### 3.1 Typed Message Protocol

Read Frog uses `@webext-core/messaging` library with `defineExtensionMessaging<ProtocolMap>()`:

```typescript
interface ProtocolMap {
  enqueueTranslateRequest: (data: {
    text: string,
    langConfig: Config["language"],
    providerConfig: ProviderConfig,
    scheduleAt: number,
    hash: string,
    articleTitle?: string | null,
    articleTextContent?: string | null
  }) => Promise<string>

  enqueueSubtitlesTranslateRequest: (data: { ... }) => Promise<string>

  setTranslateRequestQueueConfig: (data: Partial<RequestQueueConfig>) => void
  setTranslateBatchQueueConfig: (data: Partial<BatchQueueConfig>) => void
  // ... more messages
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>()
```

This gives **end-to-end type safety**: `sendMessage("enqueueTranslateRequest", payload)` returns `Promise<string>`, and the background listener receives the typed payload.

### 3.2 Content Script Flow

```
Content Script                         Background Service Worker
─────────────                         ─────────────────────────
translateTextForPage(text)
  │
  ├─ getConfig()
  ├─ prepareTranslationText()
  ├─ buildHashComponents()
  ├─ Sha256Hex(...components)
  │
  └─ sendMessage("enqueueTranslateRequest", {
       text, langConfig, providerConfig,
       scheduleAt: Date.now(), hash,
       articleTitle, articleTextContent
     })
                                       onMessage("enqueueTranslateRequest")
                                         │
                                         ├─ Check cache: db.translationCache.get(hash)
                                         │   └─ if cached → return cached.translation
                                         │
                                         ├─ [LLM Providers] → batchQueue.enqueue(data)
                                         │   └─ BatchQueue collects, flushes as batch
                                         │       └─ executeBatch → RequestQueue.enqueue(thunk)
                                         │           └─ executeTranslate(batchText, ...)
                                         │               └─ aiTranslate() via AI SDK
                                         │
                                         ├─ [Non-LLM: Google/Microsoft] → requestQueue.enqueue(thunk)
                                         │   └─ executeTranslate(text, ...)
                                         │       └─ googleTranslate() / microsoftTranslate()
                                         │
                                         └─ Cache result: db.translationCache.put({key: hash, translation, createdAt})
                                         │
                                         └─ return result (sent back to content script)
```

### 3.3 Key Observations

1. **Hash is computed on the content side**, including text, provider config, language pair, and even the prompt template. This means the content script controls cache identity, and the background just uses it as-is.

2. **LLM providers go through BatchQueue → RequestQueue** (two layers of queuing). Non-LLM providers (Google Translate, Microsoft Translate) skip batching and go directly to RequestQueue.

3. **Background entry point** (`index.ts`) calls `setUpWebPageTranslationQueue()` and `setUpSubtitlesTranslationQueue()` at startup — these create the queue instances and register message listeners.

4. **Two separate queue pairs** exist: one for web page translation, one for subtitles translation. Each has its own `BatchQueue` + `RequestQueue` with potentially different configs.

5. **Article summary** (AI Content Aware): If enabled, the background generates or fetches a cached article summary before translation. This summary is included in the LLM prompt for better context.

### 3.4 Queue Setup Function

```typescript
async function createTranslationQueues(config: TranslationQueueSetupConfig) {
  const requestQueue = new RequestQueue({
    rate, capacity, timeoutMs: 20_000, maxRetries: 2, baseRetryDelayMs: 1_000,
  })

  const batchQueue = new BatchQueue<TranslateBatchData, string>({
    maxCharactersPerBatch, maxItemsPerBatch,
    batchDelay: 100,
    maxRetries: 3,
    enableFallbackToIndividual: true,
    getBatchKey: (data) => Sha256Hex(`${sourceCode}-${targetCode}-${providerId}`),
    getCharacters: data => data.text.length,
    executeBatch: async (dataList) => {
      // Join texts with separator
      const batchText = texts.join(`\n\n%%\n\n`)
      // Execute through RequestQueue
      return requestQueue.enqueue(batchThunk, earliestScheduleAt, hash)
    },
    executeIndividual: async (data) => {
      return requestQueue.enqueue(thunk, scheduleAt, hash)
    },
  })

  return { requestQueue, batchQueue }
}
```

**Important:** The `executeBatch` callback inside `BatchQueue` itself enqueues the combined batch into the `RequestQueue`. So **BatchQueue acts as a collection layer; RequestQueue handles rate limiting and actual execution**.

### 3.5 Message Listener (Background)

```typescript
onMessage("enqueueTranslateRequest", async (message) => {
  const { text, langConfig, providerConfig, scheduleAt, hash, articleTitle, articleTextContent } = message.data

  // 1. Cache check
  if (hash) {
    const cached = await db.translationCache.get(hash)
    if (cached) return cached.translation
  }

  let result = ""

  // 2. Route: LLM → batch queue, others → request queue directly
  if (isLLMProviderConfig(providerConfig)) {
    // Optional: generate article summary for context-aware translation
    const data = { text, langConfig, providerConfig, hash, scheduleAt, content }
    result = await batchQueue.enqueue(data)
  } else {
    const thunk = () => executeTranslate(text, langConfig, providerConfig, getTranslatePrompt)
    result = await requestQueue.enqueue(thunk, scheduleAt, hash)
  }

  // 3. Cache write
  if (result && hash) {
    await db.translationCache.put({ key: hash, translation: result, createdAt: new Date() })
  }

  return result
})
```

---

## 4. Read Frog Caching (IndexedDB / Dexie)

**Files:**
- `src/utils/db/dexie/app-db.ts`
- `src/utils/db/dexie/tables/translation-cache.ts`
- `src/utils/hash.ts`

### 4.1 Cache Schema

```typescript
// Dexie DB definition
class AppDB extends Dexie {
  translationCache!: EntityTable<TranslationCache, "key">
  batchRequestRecord!: EntityTable<BatchRequestRecord, "key">
  articleSummaryCache!: EntityTable<ArticleSummaryCache, "key">
  aiSegmentationCache!: EntityTable<AiSegmentationCache, "key">

  constructor() {
    super(`ReadFrogDB`)
    this.version(1).stores({
      translationCache: `key, translation, createdAt`,
    })
    // ... version migrations up to v4
  }
}

// Table entity
class TranslationCache extends Entity {
  key!: string        // SHA-256 hash
  translation!: string
  createdAt!: Date
}
```

### 4.2 SHA-256 Hash Key Generation

```typescript
import { sha256 } from "js-sha256"

export function Sha256Hex(...texts: string[]): string {
  if (texts.length === 0) {
    throw new Error("At least one text parameter is required")
  }
  // Pipe-separated to prevent boundary ambiguity (e.g. 'a|bc' vs 'ab|c')
  const combined = texts.join("|")
  return sha256(combined)
}
```

Hash components include:
- Prepared text (trimmed/cleaned)
- Serialized provider config JSON
- Source language code
- Target language code
- System prompt + user prompt (for LLM providers)
- AI Content Aware flag
- Article title + content substring (first 1000 chars) when enabled

This means **any change to the prompt template, provider config, or article context** invalidates the cache.

### 4.3 Cache Check / Write Flow

```
Content side:
  hash = Sha256Hex(text, providerConfig, sourceCode, targetCode, prompt, ...)

Background side:
  1. db.translationCache.get(hash)  →  if found, return immediately
  2. Execute translation via batch/request queue
  3. db.translationCache.put({ key: hash, translation: result, createdAt: new Date() })
```

- Cache is checked **before** enqueueing into any queue
- Cache is written **after** successful translation
- Cache key is the full SHA-256 hash, so identical requests with identical configs hit the cache

### 4.4 Additional Caches

- **articleSummaryCache**: Caches article summaries (keyed by text hash + provider config hash)
- **batchRequestRecord**: Tracks batch request metadata for analytics
- **aiSegmentationCache**: Caches AI-powered text segmentation results

---

## 5. TapWord Existing Infrastructure

### 5.1 Current MessageRouter Pattern

**File:** `src/2_background/messaging/MessageRouter.ts`

TapWord uses raw `chrome.runtime.onMessage.addListener()` with a manual switch/case router:

```typescript
export function setupMessageListener(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const messageType = message.type as MessageType

    switch (messageType) {
      case "TRANSLATE_REQUEST":
        TranslationRequestHandler.handleTranslationRequest(message, sendResponse)
        return true

      case "FRAGMENT_TRANSLATE_REQUEST":
        FragmentTranslationRequestHandler.handleFragmentTranslationRequest(message, sendResponse)
        return true

      case "SPEECH_SYNTHESIS_REQUEST": ...
      case "SPEECH_STOP_REQUEST": ...
      case "POPUP_BOOTSTRAP_REQUEST": ...
      case "PAGE_ACTIVATED": ...
      case "AUTO_CANDIDATES_REQUEST": ...
    }
  })
}
```

**Key differences from Read Frog:**
- No type safety on the message channel (manual `MessageType` casting)
- Uses `sendResponse` callback pattern (not promise-based)
- `return true` keeps the channel open for async handlers
- Each handler is a separate module/function

### 5.2 Current Handler Pattern

**File:** `src/2_background/handlers/TranslationRequestHandler.ts`

```typescript
export async function handleTranslationRequest(
    message: TranslateRequestMessage,
    sendResponse: (response: TranslateResponseMessage) => void
): Promise<void> {
    await serviceInitializer.ensureCriticalServicesReady()
    serviceInitializer.startBackgroundWarmUp()

    // Check quota
    const quotaManager = getQuotaManager()
    await quotaManager.checkTranslationQuota()

    // Translate
    const result = await translateModule.translateWord({ ... })

    // Increment quota
    await quotaManager.incrementTranslationCount()

    // Respond
    sendResponse({ type: "TRANSLATE_RESPONSE", success: true, data: { ... } })
}
```

**Pattern: Request → Service Init → Quota Check → Translation → Quota Increment → Response.**

Fragment handler follows the same pattern, calling `translateModule.translateFragment()`.

### 5.3 Current TranslationService APIs

**File:** `src/6_translate/services/TranslationService.ts`

Exports two main functions:
- `translateWord(params: TranslateParams): Promise<TranslationResult>` — Word/phrase translation with rich result (word translation, sentence translation, definitions, lemma, phonetic)
- `translateFragment(params: TranslateFragmentParams): Promise<FragmentTranslationResult>` — Fragment translation, returns `{ translation, sentenceTranslation? }`

Translation routing:
1. **Official Provider** → `post()` to backend API (`/api/v1/translate` or `/api/v1/translate/fragment`)
2. **Custom API (LLM)** → local `8_generate` module (WordTranslationService / FragmentTranslationService)
3. **MTranServer** → local MTranServer API
4. **Bing Translate** → Bing Translate free API

### 5.4 Current 5_backend/APIService Pattern

**File:** `src/5_backend/services/APIService.ts`

A centralized HTTP client with:
- JWT token management and auto-refresh
- Timeout handling
- Rate limiting detection (HTTP 429)
- Fallback base URL on network errors
- Generic `request<T>()` method with response parsing

Convenience functions: `get()`, `post()`, `put()`, `del()` — all delegate to the singleton `APIService`.

### 5.5 Current Message Types

**File:** `src/0_common/types/index.ts`

```typescript
export type MessageType =
  | "TRANSLATE_REQUEST"
  | "FRAGMENT_TRANSLATE_REQUEST"
  | "SPEECH_SYNTHESIS_REQUEST"
  | "SPEECH_STOP_REQUEST"
  | "POPUP_BOOTSTRAP_REQUEST"
  | "PAGE_ACTIVATED"
  | "AUTO_CANDIDATES_REQUEST"
```

Request/Response interfaces exist for each type. Fragment translation:
```typescript
interface FragmentTranslateRequestMessage {
  type: "FRAGMENT_TRANSLATE_REQUEST"
  data: FragmentTranslationContextData
}

interface FragmentTranslationContextData {
  fragment: string
  bookName?: string
  leadingText?: string
  trailingText?: string
  previousSentences?: string[]
  nextSentences?: string[]
  sourceLanguage?: string
  targetLanguage?: string
  upgradeModel?: boolean
}
```

### 5.6 Existing Fragment Translation API

**File:** `other/api文档/7_fragment_translation_api_v1.md`

Backend endpoint: `POST /api/v1/translate/fragment`

Request:
```json
{
  "text": "fragment text",
  "leadingText": "before",
  "trailingText": "after",
  "sourceLanguage": "en",
  "targetLanguage": "zh",
  "context": { "previousSentences": [], "nextSentences": [], "bookName": "" }
}
```

Response:
```json
{
  "data": { "translation": "翻译结果", "sentenceTranslation": "完整句子翻译" },
  "code": 0,
  "message": "success"
}
```

Rate Limit: 30 requests / 30 seconds per user.

---

## 6. Adaptation Plan for TapWord

### 6.1 New Message Type: `FULL_TRANSLATE_BATCH_REQUEST`

Add to `MessageType`:

```typescript
export type MessageType =
  | "TRANSLATE_REQUEST"
  | "FRAGMENT_TRANSLATE_REQUEST"
  | "FULL_TRANSLATE_BATCH_REQUEST"   // ← NEW
  | ...
```

Request/Response interfaces:

```typescript
interface FullTranslateBatchRequestData {
  /** The text to translate (a single text node's content) */
  text: string
  /** Source language code */
  sourceLanguage: string
  /** Target language code */
  targetLanguage: string
  /** SHA-256 hash for cache key */
  hash: string
  /** Schedule timestamp for priority ordering */
  scheduleAt: number
}

interface FullTranslateBatchRequestMessage {
  type: "FULL_TRANSLATE_BATCH_REQUEST"
  data: FullTranslateBatchRequestData
}

interface FullTranslateBatchResponseSuccessMessage {
  type: "FULL_TRANSLATE_BATCH_RESPONSE"
  success: true
  data: { translation: string }
}

interface FullTranslateBatchResponseErrorMessage {
  type: "FULL_TRANSLATE_BATCH_RESPONSE"
  success: false
  error: string
  errorType?: "TranslationError" | "QuotaExceeded" | "GenericError"
}
```

### 6.2 New Handler: `FullTranslateBatchHandler`

Location: `src/2_background/handlers/FullTranslateBatchHandler.ts`

Responsibilities:
1. Receive individual text node translation requests
2. Check IndexedDB cache first
3. Enqueue into a BatchQueue
4. Return the result (or error) to the content script
5. Write successful translations to cache

The handler will follow TapWord's existing handler pattern (async function with `sendResponse` callback), but internally use the batch queue.

### 6.3 Service Method: Reuse `translateFragment` or Create New Endpoint?

**Analysis:**

| Approach | Pros | Cons |
|----------|------|------|
| Reuse existing `translateFragment` API | No backend changes needed; API already handles context-less fragments | Not optimized for batch; each request is individual |
| New backend batch endpoint | Single request for N texts; lower latency; backend can optimize | Requires backend development; new API versioning |
| Client-side batching with existing `translateFragment` | No backend changes; batch N texts locally, join with separator, send as one fragment | Hackish; fragment API prompt isn't designed for batch separator |
| Client-side batching with Custom API / LLM | Like Read Frog — join texts with separator, send to LLM | Only works for Custom API provider; official API doesn't support this |

**Recommendation:** 

- **For Official Provider:** Create a new backend batch endpoint (`POST /api/v1/translate/batch-fragment`) that accepts an array of texts and returns an array of translations. The backend can internally optimize (parallelize, use batch LLM calls). This is the cleanest approach but requires backend work.
  
- **For Custom API (LLM):** Use Read Frog's approach — join texts with `%%` separator in the prompt, split on response. The `BatchQueue` handles this client-side without backend changes.

- **For MTranServer / Bing Translate:** These non-LLM providers should skip batching and go through a rate-limited `RequestQueue` directly (same pattern as Read Frog's non-LLM path).

- **Interim approach (no backend changes):** Use the existing `translateFragment` for each text, but wrap calls in a `RequestQueue` for rate limiting. Skip `BatchQueue` entirely for the official provider until a backend batch endpoint is built.

### 6.4 Where to Build BatchQueue / RateLimiter

**Background service worker**, same as Read Frog.

Rationale:
- The background service worker is the single long-lived context in the extension
- Multiple content scripts (tabs) can share the same queue
- Rate limiting is centralized
- Cache access (IndexedDB) is most efficient in the background
- Content scripts can be multiple, each sending individual requests

Architecture:
```
Content Script (Tab 1) ──┐
Content Script (Tab 2) ──┼─── chrome.runtime.sendMessage("FULL_TRANSLATE_BATCH_REQUEST")
Content Script (Tab 3) ──┘                     │
                                               ▼
                              Background Service Worker
                              ┌─────────────────────────┐
                              │ FullTranslateBatchHandler │
                              │   │                       │
                              │   ├─ Cache check (IDB)    │
                              │   ├─ BatchQueue           │
                              │   │   └─ RequestQueue     │
                              │   │       └─ API call     │
                              │   └─ Cache write (IDB)    │
                              └─────────────────────────┘
```

### 6.5 IndexedDB Approach: Raw API vs. Dexie

**Recommendation: Raw IndexedDB API (no Dexie dependency)**

Rationale:
- TapWord currently has no Dexie dependency; adding it increases bundle size (~30KB minified)
- The cache schema is extremely simple (key-value with timestamp)
- Read Frog uses Dexie for convenience but the underlying operations are straightforward
- A thin wrapper around raw IndexedDB is sufficient and keeps the project lean

Proposed schema:

```
Database: "TapWordTranslatorCache"
Object Store: "translationCache"
  keyPath: "key"
  Indexes: "createdAt"
  Record: { key: string, translation: string, createdAt: number }
```

Minimal wrapper API:

```typescript
interface TranslationCacheEntry {
  key: string           // SHA-256 hash
  translation: string
  createdAt: number     // Date.now()
}

class TranslationCacheDB {
  getTranslation(hash: string): Promise<string | null>
  putTranslation(hash: string, translation: string): Promise<void>
  clearAll(): Promise<void>
  clearOlderThan(ageMs: number): Promise<void>
}
```

### 6.6 API Requirements

**Does the backend need a new batch endpoint?**

**Short-term: No.** Use existing `translateFragment` with client-side rate limiting (`RequestQueue`). For Custom API (LLM), batch client-side with separator.

**Medium-term: Yes.** A dedicated `POST /api/v1/translate/batch-fragment` endpoint would:
- Accept: `{ texts: string[], sourceLanguage, targetLanguage }`
- Return: `{ translations: string[] }`
- Allow backend to optimize (parallel processing, single LLM call with separator, caching)
- Reduce HTTP overhead (1 request instead of N)

The client-side `BatchQueue` would collect texts and send them to this batch endpoint, exactly mirroring Read Frog's architecture.

### 6.7 Summary: Component Mapping

| Read Frog Component | TapWord Equivalent (Proposed) |
|---------------------|-------------------------------|
| `BatchQueue` class | New `BatchQueue` in `src/11_full_translate/` or shared utils |
| `RequestQueue` class | New `RequestQueue` in `src/11_full_translate/` or shared utils |
| `BinaryHeapPQ` | New `PriorityQueue` utility |
| Dexie `translationCache` | Raw IndexedDB `TranslationCacheDB` |
| `Sha256Hex()` hash | New hash utility (use `crypto.subtle.digest` for async SHA-256, or `js-sha256` for sync) |
| `onMessage("enqueueTranslateRequest")` | `case "FULL_TRANSLATE_BATCH_REQUEST"` in `MessageRouter` |
| `translateTextCore()` in content script | New content-side function that builds hash + sends message |
| `executeTranslate()` dispatch | Provider routing in the new handler |
| `BATCH_SEPARATOR` (`%%`) | Same pattern for LLM-based batching |

### 6.8 Risk Assessment

| Risk | Mitigation |
|------|------------|
| LLM batch count mismatch (Read Frog's biggest pain point) | Retry with backoff + fallback to individual; don't batch for official API |
| Service worker idle shutdown (MV3) | Keep-alive pings from content script during active translation; queue state is lost on shutdown but cache survives |
| IndexedDB storage limits | Periodic cleanup of old entries (e.g. > 7 days); store only text translations, not full responses |
| Rate limiting from backend API | `RequestQueue` token bucket matches server rate limits; dedup prevents redundant calls |
| Mixed provider support | Route LLM providers → BatchQueue → RequestQueue; route non-LLM → RequestQueue only; route official → RequestQueue with per-request API calls |
