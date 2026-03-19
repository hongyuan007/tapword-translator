/**
 * ViewportObserver — wraps IntersectionObserver for lazy translation triggering.
 * Calls a callback when paragraph elements enter the viewport (with configurable preload margin).
 */

import * as loggerModule from '@/0_common/utils/logger';
import { DEFAULT_PRELOAD_MARGIN, DEFAULT_PRELOAD_THRESHOLD } from '../constants';

const logger = loggerModule.createLogger('FullTranslate/ViewportObserver');

// Callback type: called when a paragraph element enters viewport
export type OnEnterViewportCallback = (element: HTMLElement) => void;

export class ViewportObserver {
    private observer: IntersectionObserver | null = null;
    private onEnterViewport: OnEnterViewportCallback;
    private margin: number;
    private threshold: number;

    constructor(
        onEnterViewport: OnEnterViewportCallback,
        margin: number = DEFAULT_PRELOAD_MARGIN,
        threshold: number = DEFAULT_PRELOAD_THRESHOLD,
    ) {
        this.onEnterViewport = onEnterViewport;
        this.margin = margin;
        this.threshold = threshold;
    }

    /** Create and start the observer */
    start(): void {
        if (this.observer) {
            logger.warn('Observer already started');
            return;
        }

        this.observer = new IntersectionObserver(
            (entries, observer) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        observer.unobserve(entry.target);
                        this.onEnterViewport(entry.target as HTMLElement);
                    }
                }
            },
            {
                root: null,
                rootMargin: `${this.margin}px`,
                threshold: this.threshold,
            },
        );

        logger.info('Started with margin:', this.margin, 'threshold:', this.threshold);
    }

    /** Observe a paragraph element */
    observe(element: HTMLElement): void {
        if (!this.observer) {
            logger.warn('Observer not started — call start() first');
            return;
        }
        this.observer.observe(element);
    }

    /** Stop observing a specific element */
    unobserve(element: HTMLElement): void {
        if (!this.observer) return;
        this.observer.unobserve(element);
    }

    /** Disconnect and cleanup */
    stop(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
            logger.info('Stopped');
        }
    }
}
