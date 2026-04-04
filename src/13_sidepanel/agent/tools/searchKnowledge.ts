import * as loggerModule from "@/0_common/utils/logger"
import * as embeddingClient from "../../api/EmbeddingClient"
import type { ScoredItem } from "../../store/KnowledgeStore"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("searchKnowledge")

const MIN_RELEVANCE_SCORE = 0.45

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
    execute: async (input, context) => {
        const query = input.query as string
        const topK = (input.topK as number) || 5

        logger.info(`Searching knowledge base for: "${query}" (topK=${topK})`)

        const queryEmbedding = await embeddingClient.getEmbedding(context.apiKey, query)
        const results: ScoredItem[] = await context.knowledgeStore.search(queryEmbedding, topK)

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
