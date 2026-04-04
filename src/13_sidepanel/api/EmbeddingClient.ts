import OpenAI from "openai"

const DASHSCOPE_OPENAI_BASE_URL = import.meta.env.VITE_AGENT_EMBEDDING_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
const EMBEDDING_MODEL = import.meta.env.VITE_AGENT_EMBEDDING_MODEL || "text-embedding-v4"
const EMBEDDING_API_KEY = import.meta.env.VITE_AGENT_EMBEDDING_API_KEY || ""
const EMBEDDING_DIMENSIONS = 1024

/** Runtime API key set by the application layer. */
let runtimeApiKey = ""

/** Set the API key used for embedding requests. */
export function setApiKey(key: string): void {
    runtimeApiKey = key
}

export async function getEmbedding(text: string): Promise<Float32Array> {
    const effectiveKey = EMBEDDING_API_KEY || runtimeApiKey
    if (!effectiveKey) {
        throw new Error("Embedding API key not configured. Call setApiKey() first.")
    }
    const client = new OpenAI({
        apiKey: effectiveKey,
        baseURL: DASHSCOPE_OPENAI_BASE_URL,
        dangerouslyAllowBrowser: true,
    })
    const res = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text,
        dimensions: EMBEDDING_DIMENSIONS,
    })
    return new Float32Array(res.data[0]!.embedding)
}
