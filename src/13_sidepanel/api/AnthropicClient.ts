import Anthropic from "@anthropic-ai/sdk"

const DASHSCOPE_ANTHROPIC_BASE_URL = import.meta.env.VITE_AGENT_BASE_URL || "https://dashscope.aliyuncs.com/apps/anthropic"

export function createAnthropicClient(apiKey: string): Anthropic {
    return new Anthropic({
        apiKey,
        baseURL: DASHSCOPE_ANTHROPIC_BASE_URL,
        dangerouslyAllowBrowser: true,
    })
}
