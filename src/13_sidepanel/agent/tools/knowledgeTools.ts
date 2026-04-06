import * as loggerModule from "@/0_common/utils/logger"
import * as embeddingClient from "../../api/EmbeddingClient"
import { knowledgeStore } from "../../services/KnowledgeStore"
import type { ScoredItem } from "../../services/KnowledgeStore"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("knowledgeTools")

const MIN_RELEVANCE_SCORE = 0.45

// ── Search Knowledge ────────────────────────────────────────────────

export const searchKnowledgeTool: ToolRegistration = {
    definition: {
        name: "search_knowledge",
        description: "Search the local knowledge base for relevant saved information. Returns the most similar items by semantic similarity.",
        input_schema: {
            type: "object" as const,
            properties: {
                query: {
                    type: "string",
                    description: "The search query to find relevant knowledge",
                },
                topK: {
                    type: "number",
                    description: "Maximum number of results to return (default: 5)",
                },
            },
            required: ["query"],
        },
    },
    label: "Searching knowledge...",
    execute: async (input) => {
        const query = input.query as string
        const topK = (input.topK as number) || 5

        logger.info(`Searching knowledge base for: "${query}" (topK=${topK})`)

        const queryEmbedding = await embeddingClient.getEmbedding(query)
        const results: ScoredItem[] = await knowledgeStore.search(queryEmbedding, topK)

        const relevant = results.filter((r) => r.score >= MIN_RELEVANCE_SCORE)

        if (relevant.length === 0) {
            logger.info("No relevant results found")
            return "No relevant knowledge found."
        }

        logger.info(`Found ${relevant.length} relevant results`)
        return relevant
            .map((r, i) => `[${i + 1}] (score: ${r.score.toFixed(3)}) **${r.item.title}**\n${r.item.text}\n_Source: ${r.item.source}_`)
            .join("\n\n")
    },
}

// ── Store Knowledge ─────────────────────────────────────────────────

export const storeKnowledgeTool: ToolRegistration = {
    definition: {
        name: "store_knowledge",
        description: "Save a piece of text to the local knowledge base for later retrieval. Include a meaningful title.",
        input_schema: {
            type: "object" as const,
            properties: {
                text: {
                    type: "string",
                    description: "The text content to save",
                },
                title: {
                    type: "string",
                    description: "A short, descriptive title for this knowledge item",
                },
                source: {
                    type: "string",
                    description: "The source URL or description (optional)",
                },
            },
            required: ["text", "title"],
        },
    },
    label: "Saving knowledge...",
    execute: async (input) => {
        const text = input.text as string
        const title = input.title as string
        const source = (input.source as string) || ""

        logger.info(`Storing knowledge: "${title}"`)

        const embedding = await embeddingClient.getEmbedding(text)
        const id = crypto.randomUUID()

        await knowledgeStore.store({
            id,
            text,
            embedding,
            source,
            title,
            createdAt: Date.now(),
        })

        logger.info(`Knowledge stored with id: ${id}`)
        return `Successfully saved "${title}" to knowledge base (id: ${id}).`
    },
}

// Self-register with the global tool registry
import { toolRegistry } from "./ToolRegistry"
toolRegistry.add(searchKnowledgeTool)
toolRegistry.add(storeKnowledgeTool)
