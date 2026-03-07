import { detectAudioMimeType } from "@/0_common/utils/audioUtils"
import { createLogger } from "@/0_common/utils/logger"

const logger = createLogger("OffscreenManager")

const PLAYBACK_INTENT_KEY = "firefox_direct_audio_playback_intent"
const PLAYBACK_INTENT_MAX_AGE_MS = 3 * 60 * 1000

// ---------------------------------------------------------------------------
// Firefox path: background scripts have full DOM access, play Audio directly
// ---------------------------------------------------------------------------

let currentDirectAudio: HTMLAudioElement | null = null

interface PlaybackIntent {
    base64Audio: string
    createdAt: number
}

function isPlaybackIntentValid(intent: PlaybackIntent): boolean {
    return Date.now() - intent.createdAt <= PLAYBACK_INTENT_MAX_AGE_MS
}

async function setPlaybackIntent(intent: PlaybackIntent): Promise<void> {
    try {
        await chrome.storage.session.set({ [PLAYBACK_INTENT_KEY]: intent })
    } catch {
        await chrome.storage.local.set({ [PLAYBACK_INTENT_KEY]: intent })
    }
}

async function getPlaybackIntent(): Promise<PlaybackIntent | null> {
    try {
        const data = await chrome.storage.session.get(PLAYBACK_INTENT_KEY)
        return (data[PLAYBACK_INTENT_KEY] as PlaybackIntent | undefined) ?? null
    } catch {
        const data = await chrome.storage.local.get(PLAYBACK_INTENT_KEY)
        return (data[PLAYBACK_INTENT_KEY] as PlaybackIntent | undefined) ?? null
    }
}

async function clearPlaybackIntent(): Promise<void> {
    try {
        await chrome.storage.session.remove(PLAYBACK_INTENT_KEY)
    } catch {
        await chrome.storage.local.remove(PLAYBACK_INTENT_KEY)
    }
}

function stopAndCleanupDirectAudio(audio: HTMLAudioElement): void {
    audio.onended = null
    audio.onerror = null
    audio.pause()
    audio.removeAttribute("src")
    audio.load()
}

async function playAudioDirect(base64Audio: string): Promise<void> {
    await setPlaybackIntent({ base64Audio, createdAt: Date.now() })

    if (currentDirectAudio) {
        stopAndCleanupDirectAudio(currentDirectAudio)
        currentDirectAudio = null
    }

    const mimeType = detectAudioMimeType(base64Audio)
    const audioDataUrl = `data:${mimeType};base64,${base64Audio}`
    const audio = new Audio(audioDataUrl)
    currentDirectAudio = audio

    audio.onended = () => {
        if (currentDirectAudio === audio) currentDirectAudio = null
        void clearPlaybackIntent()
    }

    return new Promise<void>((resolve, reject) => {
        audio.onerror = (e) => {
            if (currentDirectAudio === audio) currentDirectAudio = null
            void clearPlaybackIntent()
            reject(new Error(`Audio playback error: ${e}`))
        }
        audio.play().then(resolve).catch(reject)
    })
}

function stopAudioDirect(): void {
    if (currentDirectAudio) {
        stopAndCleanupDirectAudio(currentDirectAudio)
        currentDirectAudio = null
        logger.info("Audio playback stopped (direct)")
    }
    void clearPlaybackIntent()
}

async function recoverInterruptedDirectAudioPlayback(): Promise<void> {
    const intent = await getPlaybackIntent()
    if (!intent) return

    if (!isPlaybackIntentValid(intent)) {
        await clearPlaybackIntent()
        return
    }

    try {
        logger.info("Recovering interrupted direct audio playback")
        await playAudioDirect(intent.base64Audio)
    } catch (error) {
        logger.warn("Failed to recover interrupted direct audio playback", error)
        await clearPlaybackIntent()
    }
}

// ---------------------------------------------------------------------------
// Chrome path: Service Worker has no DOM; delegate to the Offscreen document
// ---------------------------------------------------------------------------

const OFFSCREEN_PATH = "src/9_offscreen/offscreen.html"

type OffscreenApi = typeof chrome.offscreen

function getOffscreenApi(): OffscreenApi | undefined {
    return (chrome as typeof chrome & { offscreen?: OffscreenApi }).offscreen
}

async function ensureOffscreenDocument(): Promise<void> {
    const offscreenApi = getOffscreenApi()
    if (!offscreenApi) {
        throw new Error("Offscreen API is not available")
    }

    const hasDoc = await offscreenApi.hasDocument()
    if (hasDoc) return

    logger.info("Creating offscreen document")
    try {
        await offscreenApi.createDocument({
            url: OFFSCREEN_PATH,
            reasons: [offscreenApi.Reason.AUDIO_PLAYBACK],
            justification: "Playback of translated text speech",
        })
    } catch (error) {
        logger.error("Failed to create offscreen document", error)
        throw error
    }
}

async function playAudioOffscreen(base64Audio: string): Promise<void> {
    await ensureOffscreenDocument()
    const response = await chrome.runtime.sendMessage({
        type: "PLAY_AUDIO",
        data: { audio: base64Audio },
    })
    if (response && !response.success) {
        throw new Error(response.error || "Unknown playback error")
    }
}

async function stopAudioOffscreen(): Promise<void> {
    const offscreenApi = getOffscreenApi()
    if (!offscreenApi) return

    const hasDoc = await offscreenApi.hasDocument()
    if (!hasDoc) return

    try {
        await chrome.runtime.sendMessage({ type: "STOP_AUDIO" })
    } catch (e) {
        logger.warn("Failed to stop audio (maybe document closed)", e)
    }
}

// ---------------------------------------------------------------------------
// Public API — implementation selected at build time via __IS_FIREFOX__
// ---------------------------------------------------------------------------

export async function playAudio(base64Audio: string): Promise<void> {
    if (__IS_FIREFOX__) {
        return playAudioDirect(base64Audio)
    }
    return playAudioOffscreen(base64Audio)
}

export async function stopAudio(): Promise<void> {
    if (__IS_FIREFOX__) {
        stopAudioDirect()
        return
    }
    return stopAudioOffscreen()
}

if (__IS_FIREFOX__) {
    void recoverInterruptedDirectAudioPlayback()
}
