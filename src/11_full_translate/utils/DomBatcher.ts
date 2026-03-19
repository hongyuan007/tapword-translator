/**
 * DomBatcher — singleton utility that batches DOM write operations using requestAnimationFrame.
 * Prevents layout thrashing by coalescing multiple DOM mutations into a single animation frame.
 */

import * as loggerModule from '@/0_common/utils/logger';

const logger = loggerModule.createLogger('FullTranslate/DomBatcher');

type DomOperation = () => void;

export class DomBatcher {
    private static instance: DomBatcher | null = null;
    private operations: DomOperation[] = [];
    private scheduled: boolean = false;
    private isProcessing: boolean = false;

    /** Get the singleton instance */
    static getInstance(): DomBatcher {
        if (!DomBatcher.instance) {
            DomBatcher.instance = new DomBatcher();
        }
        return DomBatcher.instance;
    }

    /** Queue a DOM write operation for batched execution */
    queue(operation: DomOperation): void {
        this.operations.push(operation);
        this.scheduleFlush();
    }

    /** Reset: cancel pending frame and clear operations */
    reset(): void {
        this.operations = [];
        this.scheduled = false;
        this.isProcessing = false;
        DomBatcher.instance = null;
        logger.info('Reset');
    }

    // ============================================================
    // Internal helpers
    // ============================================================

    /** Schedule a rAF flush if not already scheduled */
    private scheduleFlush(): void {
        if (this.scheduled || this.isProcessing) return;

        this.scheduled = true;
        requestAnimationFrame(() => {
            this.flush();
        });
    }

    /** Execute all queued operations in order */
    private flush(): void {
        this.scheduled = false;
        if (this.operations.length === 0) return;

        this.isProcessing = true;
        const ops = this.operations.splice(0);

        for (const op of ops) {
            try {
                op();
            } catch (error) {
                logger.error('Error executing batched DOM operation:', error);
            }
        }

        this.isProcessing = false;

        // If new operations were queued during execution, schedule another flush
        if (this.operations.length > 0) {
            this.scheduleFlush();
        }
    }
}
