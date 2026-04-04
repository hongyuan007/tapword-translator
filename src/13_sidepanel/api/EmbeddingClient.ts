import OpenAI from "openai"

const DASHSCOPE_OPENAI_BASE_URL = import.meta.env.VITE_AGENT_EMBEDDING_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
const EMBEDDING_MODEL = import.meta.env.VITE_AGENT_EMBEDDING_MODEL || "text-embedding-v4"
const EMBEDDING_DIMENSIONS = 1024

export async function getEmbedding(apiKey: string, text: string): Promise<Float32Array> {
    const client = new OpenAI({
        apiKey,
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
