/**
 * DragHandler — manages vertical dragging of the floating button.
 * Distinguishes click from drag using a movement threshold.
 */

import * as loggerModule from '@/0_common/utils/logger';
import { DRAG_THRESHOLD_PX, MIN_TOP_PX, MIN_BOTTOM_PX } from '@/12_floating_button/constants';

const logger = loggerModule.createLogger('DragHandler');

export class DragHandler {
    private hasMoved = false;
    private startClientY = 0;
    private startTop = 0;

    private boundHandleMouseMove: ((e: MouseEvent) => void) | null = null;
    private boundHandleMouseUp: ((e: MouseEvent) => void) | null = null;
    private boundHandleMouseDown: ((e: MouseEvent) => void) | null = null;

    /**
     * @param element — The element to attach mousedown to (main button)
     * @param onDragMove — Called during drag with the current viewport ratio
     * @param onDragEnd — Called when drag ends with the final viewport ratio
     * @param onClick — Called when a click (not drag) is detected
     * @param onDragStart — Called when drag begins (to set visual state)
     */
    constructor(
        private readonly element: HTMLElement,
        private readonly onDragMove: (positionRatio: number) => void,
        private readonly onDragEnd: (positionRatio: number) => void,
        private readonly onClick: () => void,
        private readonly onDragStart?: () => void,
    ) {}

    /** Attach the mousedown listener to the target element */
    attach(): void {
        this.boundHandleMouseDown = this.handleMouseDown.bind(this);
        this.element.addEventListener('mousedown', this.boundHandleMouseDown);
    }

    /** Remove all listeners and clean up */
    detach(): void {
        if (this.boundHandleMouseDown) {
            this.element.removeEventListener('mousedown', this.boundHandleMouseDown);
            this.boundHandleMouseDown = null;
        }
        this.removeDocumentListeners();
    }

    private handleMouseDown(e: MouseEvent): void {
        // Only handle left click
        if (e.button !== 0) return;

        e.preventDefault();

        this.startClientY = e.clientY;
        this.hasMoved = false;

        // Get the current top position from the element's parent container
        const container = this.element.parentElement;
        if (container) {
            this.startTop = container.getBoundingClientRect().top;
        }

        // Attach document-level listeners for move and up
        this.boundHandleMouseMove = this.handleMouseMove.bind(this);
        this.boundHandleMouseUp = this.handleMouseUp.bind(this);
        document.addEventListener('mousemove', this.boundHandleMouseMove);
        document.addEventListener('mouseup', this.boundHandleMouseUp);
    }

    private handleMouseMove(e: MouseEvent): void {
        const deltaY = e.clientY - this.startClientY;

        if (!this.hasMoved && Math.abs(deltaY) > DRAG_THRESHOLD_PX) {
            this.hasMoved = true;
            // Prevent text selection during drag
            document.body.style.userSelect = 'none';
            this.onDragStart?.();
            logger.info('Drag started');
        }

        if (this.hasMoved) {
            const newTop = this.startTop + deltaY;
            const clampedTop = Math.max(
                MIN_TOP_PX,
                Math.min(window.innerHeight - MIN_BOTTOM_PX, newTop)
            );
            const ratio = clampedTop / window.innerHeight;
            this.onDragMove(ratio);
        }
    }

    private handleMouseUp(_e: MouseEvent): void {
        this.removeDocumentListeners();

        // Restore text selection
        document.body.style.userSelect = '';

        if (this.hasMoved) {
            // Drag ended — compute final position
            const container = this.element.parentElement;
            if (container) {
                const currentTop = container.getBoundingClientRect().top;
                const ratio = currentTop / window.innerHeight;
                this.onDragEnd(ratio);
            }
            logger.info('Drag ended');
        } else {
            // Click (no movement)
            this.onClick();
        }

        this.hasMoved = false;
    }

    private removeDocumentListeners(): void {
        if (this.boundHandleMouseMove) {
            document.removeEventListener('mousemove', this.boundHandleMouseMove);
            this.boundHandleMouseMove = null;
        }
        if (this.boundHandleMouseUp) {
            document.removeEventListener('mouseup', this.boundHandleMouseUp);
            this.boundHandleMouseUp = null;
        }
    }
}
