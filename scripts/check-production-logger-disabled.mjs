import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const REQUIRED_KEY = "VITE_LOGGER_ENABLED"
const REQUIRED_VALUE = "false"
const MODE = process.argv[2] || "production"

const MODE_ENV_FILE_MAP = {
    production: ".env.production",
    firefox: ".env.firefox",
}

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

function resolveEnvPath(mode) {
    const envFile = MODE_ENV_FILE_MAP[mode]

    if (!envFile) {
        console.error(`[check-production-logger-disabled] Unsupported mode: ${mode}`)
        process.exit(1)
    }

    return path.resolve(process.cwd(), envFile)
}

async function main() {
    const envPath = resolveEnvPath(MODE)
    let content

    try {
        content = await fs.readFile(envPath, "utf8")
    } catch (error) {
        console.error(`[check-production-logger-disabled] Failed to read ${envPath}`)
        console.error(error)
        process.exit(1)
    }

    const actualValue = parseEnvValue(content, REQUIRED_KEY)

    if (actualValue === REQUIRED_VALUE) {
        console.log(`[check-production-logger-disabled] ${REQUIRED_KEY}=${REQUIRED_VALUE} confirmed in ${path.basename(envPath)}`)
        return
    }

    console.error(
        `[check-production-logger-disabled] Refusing ${MODE} package because ${REQUIRED_KEY} in ${path.basename(envPath)} is ${actualValue ?? "missing"}, expected ${REQUIRED_VALUE}.`
    )
    process.exit(1)
}

await main()
