/**
 * Builds an explanation prompt from the selected text and its surrounding context.
 *
 * Conditionally includes "Surrounding sentence" and "Full paragraph" sections
 * only when they carry additional information beyond the selected text itself.
 */
export function buildExplainTextPrompt(text: string, contextText: string, blockText: string): string {
    const sections: string[] = [
        "我在网页上选中了一段文本，需要你帮我理解：",
        "",
        `[选中文本]: "${text}"`,
    ]

    const hasContext = contextText.length > 0 && contextText !== text
    const hasBlock = blockText.length > 0 && blockText !== contextText

    if (hasContext) {
        sections.push("")
        sections.push(`[所在句子]: "${contextText}"`)
    }

    if (hasBlock) {
        sections.push("")
        sections.push(`[所在段落]: "${blockText}"`)
    }

    sections.push("")
    sections.push(
        "请帮我理解这段文本：",
        "1. 如果是英文，先翻译成中文",
        "2. 结合上下文，解释这段文本表达的含义，重点关注语义、语气和习惯用法",
        "3. 解释要简洁有用",
        "4. 如果需要更多网页内容作为上下文，可以使用 get_current_page 工具获取完整页面",
    )

    return sections.join("\n")
}
