import * as loggerModule from "@/0_common/utils/logger"
import * as embeddingClient from "../../api/EmbeddingClient"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("storeKnowledge")

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
    execute: async (input, context) => {
        const text = input.text as string
        const title = input.title as string
        const source = (input.source as string) || ""

        logger.info(`Storing knowledge: "${title}"`)

        const embedding = await embeddingClient.getEmbedding(context.apiKey, text)
        const id = crypto.randomUUID()

        await context.knowledgeStore.store({
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
