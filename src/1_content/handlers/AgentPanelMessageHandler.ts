/**
 * AgentPanelMessageHandler — handles messages from the agent sidepanel
 * for page content extraction and selected text retrieval.
 */

import * as loggerModule from '@/0_common/utils/logger';
import * as currentPageMarkdown from '@/1_content/utils/currentPageMarkdown';
import * as rangeAdjusterModule from '@/1_content/handlers/utils/rangeAdjuster';
import * as contextExtractorModule from '@/1_content/utils/contextExtractorV2';
import * as domSanitizer from '@/1_content/utils/domSanitizer';

const logger = loggerModule.createLogger('AgentPanelMessageHandler');

export interface IAgentPanelMessageHandler {
    handleGetPageContent(sendResponse: (response: unknown) => void): void;
    handleGetSelectedText(sendResponse: (response: unknown) => void): void;
}

class AgentPanelMessageHandler implements IAgentPanelMessageHandler {
    handleGetPageContent(sendResponse: (response: unknown) => void): void {
        const content = currentPageMarkdown.extractCurrentPageMarkdown();
        logger.info('Extracted page content length:', content.length);
        sendResponse({ success: true, content });
    }

    handleGetSelectedText(sendResponse: (response: unknown) => void): void {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            sendResponse({ success: true, text: '', contextText: '', blockText: '' });
            return;
        }
        const range = selection.getRangeAt(0);
        const { range: adjustedRange } = rangeAdjusterModule.adjustSelectionRange(range);
        const expandedText = adjustedRange.toString();
        if (!expandedText) {
            sendResponse({ success: true, text: '', contextText: '', blockText: '' });
            return;
        }
        const context = contextExtractorModule.extractContextV2(adjustedRange);

        // Find containing block element
        const startBlock = domSanitizer.getClosestBlockAncestor(adjustedRange.startContainer);
        const endBlock = domSanitizer.getClosestBlockAncestor(adjustedRange.endContainer);
        const blockElement = startBlock === endBlock
            ? startBlock
            : domSanitizer.getClosestBlockAncestor(adjustedRange.commonAncestorContainer);
        const blockText = (blockElement.textContent?.trim() || '').replace(/\s+/g, ' ').trim();

        sendResponse({ success: true, text: expandedText, contextText: context.currentSentence, blockText });
    }
}

export const agentPanelMessageHandler = new AgentPanelMessageHandler();
