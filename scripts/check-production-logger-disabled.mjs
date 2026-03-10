import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const ENV_PATH = path.resolve(process.cwd(), ".env.production")
const REQUIRED_KEY = "VITE_LOGGER_ENABLED"
const REQUIRED_VALUE = "false"

function parseEnvValue(content, key) {
    const lines = content.split(/\r?\n/)

    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) {
            continue
        }

        const separatorIndex = trimmed.indexOf("=")
        if (separatorIndex === -1) {
            continue
        }

        const currentKey = trimmed.slice(0, separatorIndex).trim()
        if (currentKey !== key) {
            continue
        }

        return trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "")
    }

    return null
}

async function main() {
    let content

    try {
        content = await fs.readFile(ENV_PATH, "utf8")
    } catch (error) {
        console.error(`[check-production-logger-disabled] Failed to read ${ENV_PATH}`)
        console.error(error)
        process.exit(1)
    }

    const actualValue = parseEnvValue(content, REQUIRED_KEY)

    if (actualValue === REQUIRED_VALUE) {
        console.log(`[check-production-logger-disabled] ${REQUIRED_KEY}=${REQUIRED_VALUE} confirmed in .env.production`)
        return
    }

    console.error(
        `[check-production-logger-disabled] Refusing production build/package because ${REQUIRED_KEY} in .env.production is ${actualValue ?? "missing"}, expected ${REQUIRED_VALUE}.`
    )
    process.exit(1)
}

await main()
