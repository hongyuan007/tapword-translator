import { memo, useState, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"
import "@/13_sidepanel/styles/markdown.css"

interface MarkdownBlockProps {
    content: string
    isStreaming?: boolean
}

/** Code block wrapper with copy button and feedback. */
function CodeBlockWrapper({ children }: { children: React.ReactNode }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = () => {
        const text = extractTextFromChildren(children)
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    return (
        <div className="markdown-code-block">
            <pre>{children}</pre>
            <button className="code-copy-btn" onClick={handleCopy} type="button">
                {copied ? "Copied!" : "Copy"}
            </button>
        </div>
    )
}

/** Custom component overrides for ReactMarkdown rendering. */
const markdownComponents: Components = {
    // Open links in new tab
    a: ({ href, children, ...props }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
        </a>
    ),

    // Wrap tables in a scrollable container
    table: ({ children, ...props }) => (
        <div className="markdown-table-wrapper">
            <table {...props}>{children}</table>
        </div>
    ),

    // Constrain image width
    img: ({ alt, ...props }) => <img alt={alt ?? ""} {...props} style={{ maxWidth: "100%" }} />,

    // Code block wrapper with copy button
    pre: ({ children }) => <CodeBlockWrapper>{children}</CodeBlockWrapper>,
}

/** Extract text content from React children for clipboard copy. */
function extractTextFromChildren(children: React.ReactNode): string {
    if (typeof children === "string") return children
    if (typeof children === "number") return String(children)
    if (children == null || typeof children === "boolean") return ""
    if (Array.isArray(children)) return children.map(extractTextFromChildren).join("")
    if (typeof children === "object" && "props" in children) {
        const element = children as React.ReactElement<{ children?: React.ReactNode }>
        return extractTextFromChildren(element.props.children)
    }
    return ""
}

const REMARK_PLUGINS = [remarkGfm]

/** Renders Markdown content from LLM output with GFM support. */
export const MarkdownBlock = memo(function MarkdownBlock({ content, isStreaming }: MarkdownBlockProps) {
    const renderContent = useCallback(() => {
        return (
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
                {content}
            </ReactMarkdown>
        )
    }, [content])

    return (
        <div className={`markdown-body ${isStreaming ? "streaming-cursor" : ""}`}>
            {renderContent()}
        </div>
    )
})
