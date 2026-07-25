/**
 * Translation Engine Manager
 * Manages provider selectors and AI provider CRUD in Options page.
 */
import type { CustomAiProvider } from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import * as storageManagerModule from "@/0_common/utils/storageManager"
import * as i18nModule from "@/0_common/utils/i18n"

const logger = loggerModule.createLogger("Options/TranslationEngineManager")

const FIXED_PROVIDER_VALUES = ["official", "microsoftFree", "bingTranslate", "googleFree"]
const PROVIDER_TEST_BUTTON_KEY = "options.translationEngine.aiProviders.form.test"
const PROVIDER_TESTING_BUTTON_KEY = "options.translationEngine.aiProviders.form.testing"
const PROVIDER_TEST_SUCCESS_KEY = "options.translationEngine.aiProviders.form.testSuccess"
const PROVIDER_TEST_FAILURE_PREFIX_KEY = "options.translationEngine.aiProviders.form.testFailedPrefix"
const DEFAULT_TEST_BUTTON_LABEL = "Test"
const DEFAULT_TESTING_BUTTON_LABEL = "Testing..."
const DEFAULT_TEST_SUCCESS_MESSAGE = "✓ Connected"
const DEFAULT_TEST_FAILURE_PREFIX = "✗ Failed: "
const TEST_SUCCESS_COLOR = "#22c55e"
const TEST_FAILURE_COLOR = "#ef4444"

/** Exported init function called from index.ts */
export async function initTranslationEngineSection(): Promise<void> {
    const settings = await storageManagerModule.getUserSettings()

    renderProviderList(settings.customProviders ?? [])
    refreshSelectOptions(settings.customProviders ?? [])

    const fullPageSelect = document.getElementById("fullPageTranslationProviderSelect") as HTMLSelectElement | null
    const wordSelect = document.getElementById("wordTranslationProviderSelect") as HTMLSelectElement | null

    if (fullPageSelect) {
        fullPageSelect.value = settings.fullPageTranslationProvider ?? "official"
        fullPageSelect.addEventListener("change", () => {
            handleProviderSelectChange("fullPageTranslationProvider", fullPageSelect.value).catch((err) =>
                logger.error("Failed to save fullPageTranslationProvider", err)
            )
        })
    }

    if (wordSelect) {
        wordSelect.value = settings.wordTranslationProvider ?? "official"
        wordSelect.addEventListener("change", () => {
            handleProviderSelectChange("wordTranslationProvider", wordSelect.value).catch((err) =>
                logger.error("Failed to save wordTranslationProvider", err)
            )
        })
    }

    const addBtn = document.getElementById("addAiProviderBtn")
    addBtn?.addEventListener("click", () => showForm())

    const cancelBtn = document.getElementById("aiProviderFormCancel")
    cancelBtn?.addEventListener("click", () => hideForm())

    const saveBtn = document.getElementById("aiProviderFormSave")
    saveBtn?.addEventListener("click", () => {
        handleFormSave().catch((err) => logger.error("Failed to save AI provider", err))
    })

    const testBtn = document.getElementById("aiProviderFormTest") as HTMLButtonElement | null
    const testResult = document.getElementById("aiProviderFormTestResult") as HTMLSpanElement | null
    if (testBtn && testResult) {
        bindProviderTestAction({
            button: testBtn,
            result: testResult,
            getEndpoint: () => (document.getElementById("aiProviderEndpoint") as HTMLInputElement | null)?.value ?? "",
            getApiKey: () => (document.getElementById("aiProviderApiKey") as HTMLInputElement | null)?.value ?? "",
            getModel: () => (document.getElementById("aiProviderModel") as HTMLInputElement | null)?.value ?? "",
        })
    }
}

/** Render the AI provider list */
function renderProviderList(providers: CustomAiProvider[]): void {
    const list = document.getElementById("aiProviderList")
    if (!list) return

    list.innerHTML = ""

    for (const provider of providers) {
        const row = document.createElement("div")
        row.className = "setting-item"
        row.dataset.id = provider.id

        const info = document.createElement("div")
        info.className = "setting-info"

        const nameEl = document.createElement("div")
        nameEl.className = "setting-label"
        nameEl.textContent = provider.name

        const metaEl = document.createElement("div")
        metaEl.className = "setting-helper"
        const host = (() => { try { return new URL(provider.endpoint).hostname } catch { return provider.endpoint } })()
        metaEl.textContent = `${provider.model} · ${host}`

        info.appendChild(nameEl)
        info.appendChild(metaEl)

        const btnGroup = document.createElement("div")
        btnGroup.className = "setting-control"
        btnGroup.style.cssText = "display:flex;gap:4px;"

        const editSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.333 2a1.414 1.414 0 0 1 2 2L4.667 12.667 2 13.333l.667-2.666L11.333 2z"/></svg>`
        const deleteSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,4 14,4"/><path d="M5.333 4V2.667A.667.667 0 0 1 6 2h4a.667.667 0 0 1 .667.667V4"/><path d="M6.667 7.333v4M9.333 7.333v4"/><path d="M3.333 4l.667 9.333A.667.667 0 0 0 4.667 14h6.666a.667.667 0 0 0 .667-.667L12.667 4"/></svg>`

        const editBtn = document.createElement("button")
        editBtn.className = "ghost-button"
        editBtn.title = i18nModule.translate("options.translationEngine.aiProviders.form.edit") || "Edit"
        editBtn.innerHTML = editSvg
        editBtn.addEventListener("click", () => showFormAfterRow(row, provider))

        const deleteBtn = document.createElement("button")
        deleteBtn.className = "ghost-button ghost-button-danger"
        deleteBtn.title = i18nModule.translate("options.translationEngine.aiProviders.form.delete") || "Delete"
        deleteBtn.innerHTML = deleteSvg
        deleteBtn.addEventListener("click", () => {
            handleDelete(provider.id).catch((err) => logger.error("Failed to delete AI provider", err))
        })

        btnGroup.appendChild(editBtn)
        btnGroup.appendChild(deleteBtn)
        row.appendChild(info)
        row.appendChild(btnGroup)
        list.appendChild(row)
    }
}

/** Inject custom provider options into both selector <select> elements */
function refreshSelectOptions(providers: CustomAiProvider[]): void {
    const selects = [
        document.getElementById("fullPageTranslationProviderSelect") as HTMLSelectElement | null,
        document.getElementById("wordTranslationProviderSelect") as HTMLSelectElement | null,
    ]

    for (const select of selects) {
        if (!select) continue

        // Remove previously injected custom options
        const toRemove = Array.from(select.options).filter((opt) => !FIXED_PROVIDER_VALUES.includes(opt.value))
        for (const opt of toRemove) {
            select.remove(opt.index)
        }

        // Add current custom providers
        for (const provider of providers) {
            const option = document.createElement("option")
            option.value = provider.id
            option.textContent = provider.name
            select.appendChild(option)
        }
    }
}

/** Show the add/edit form after a specific provider row (edit mode) */
function showFormAfterRow(row: HTMLElement, provider: CustomAiProvider): void {
    // Remove any existing inline form
    const existingInline = document.getElementById("aiProviderInlineForm")
    if (existingInline) existingInline.remove()

    // Also hide the bottom Add form if visible
    const bottomForm = document.getElementById("aiProviderForm")
    if (bottomForm) bottomForm.style.display = "none"

    // Clone form from hidden template
    const inlineForm = buildFormElement(provider)
    inlineForm.id = "aiProviderInlineForm"

    // Insert after the row
    row.insertAdjacentElement("afterend", inlineForm)
}

/** Show the add form at bottom of card (add mode) */
function showForm(provider?: CustomAiProvider): void {
    // Remove inline form if visible
    const inlineForm = document.getElementById("aiProviderInlineForm")
    if (inlineForm) inlineForm.remove()

    const form = document.getElementById("aiProviderForm")
    if (!form) return

    const idInput = document.getElementById("aiProviderFormId") as HTMLInputElement
    const nameInput = document.getElementById("aiProviderName") as HTMLInputElement
    const endpointInput = document.getElementById("aiProviderEndpoint") as HTMLInputElement
    const apiKeyInput = document.getElementById("aiProviderApiKey") as HTMLInputElement
    const modelInput = document.getElementById("aiProviderModel") as HTMLInputElement

    idInput.value = provider?.id ?? ""
    nameInput.value = provider?.name ?? ""
    endpointInput.value = provider?.endpoint ?? ""
    apiKeyInput.value = provider?.apiKey ?? ""
    modelInput.value = provider?.model ?? ""
    resetProviderTestUi(
        document.getElementById("aiProviderFormTest") as HTMLButtonElement | null,
        document.getElementById("aiProviderFormTestResult") as HTMLSpanElement | null
    )

    form.style.display = "block"
    nameInput.focus()
}

function hideForm(): void {
    const form = document.getElementById("aiProviderForm")
    if (form) form.style.display = "none"

    resetProviderTestUi(
        document.getElementById("aiProviderFormTest") as HTMLButtonElement | null,
        document.getElementById("aiProviderFormTestResult") as HTMLSpanElement | null
    )
}

/** Build a self-contained inline edit form element */
function buildFormElement(provider: CustomAiProvider): HTMLElement {
    const form = document.createElement("div")
    form.style.cssText = "padding: 16px; border-top: 1px solid rgba(0,0,0,0.06); background: #f9faff;"

    const hiddenId = document.createElement("input")
    hiddenId.type = "hidden"
    hiddenId.className = "inline-form-id"
    hiddenId.value = provider.id

    const grid = document.createElement("div")
    grid.style.cssText = "display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;"

    function makeField(labelKey: string, labelFallback: string, inputType: string, inputClass: string, value: string, isFullWidth: boolean): HTMLElement {
        const wrapper = document.createElement("div")
        wrapper.style.cssText = `display: flex; flex-direction: column; gap: 5px;${isFullWidth ? " grid-column: 1 / -1;" : ""}`
        const label = document.createElement("label")
        label.setAttribute("data-i18n-key", labelKey)
        label.style.cssText = "font-size: 12px; font-weight: 500; color: #555;"
        label.textContent = i18nModule.translate(labelKey) || labelFallback
        const input = document.createElement("input")
        input.type = inputType
        input.className = `text-input ${inputClass}`
        input.value = value
        wrapper.appendChild(label)
        wrapper.appendChild(input)
        return wrapper
    }

    grid.appendChild(makeField("options.translationEngine.aiProviders.form.name", "Name", "text", "inline-form-name", provider.name, false))
    grid.appendChild(makeField("options.translationEngine.aiProviders.form.model", "Model", "text", "inline-form-model", provider.model, false))
    grid.appendChild(makeField("options.translationEngine.aiProviders.form.endpoint", "API Endpoint", "text", "inline-form-endpoint", provider.endpoint, true))
    grid.appendChild(makeField("options.translationEngine.aiProviders.form.apiKey", "API Key", "password", "inline-form-apikey", provider.apiKey, true))

    // Max completion tokens checkbox (for OpenAI gpt-5 / o-series)
    const checkboxRow = document.createElement("div")
    checkboxRow.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 10px;"
    const cb = document.createElement("input")
    cb.type = "checkbox"
    cb.className = "inline-form-use-max-completion"
    cb.checked = provider.useMaxCompletionTokens ?? false
    const cbLabel = document.createElement("label")
    cbLabel.textContent = "Use max_completion_tokens (OpenAI gpt-5 / o-series)"
    cbLabel.style.cssText = "font-size: 12px; color: #666; cursor: pointer;"
    cbLabel.addEventListener("click", () => cb.click())
    checkboxRow.appendChild(cb)
    checkboxRow.appendChild(cbLabel)

    const actions = document.createElement("div")
    actions.style.cssText = "display: flex; justify-content: flex-end; gap: 8px; align-items: center;"

    const testBtn = document.createElement("button")
    testBtn.className = "secondary-button"
    testBtn.textContent = getLocalizedText(PROVIDER_TEST_BUTTON_KEY, DEFAULT_TEST_BUTTON_LABEL)
    testBtn.style.cssText = "margin-right: auto;"

    const testResult = document.createElement("span")
    testResult.style.cssText = "font-size: 12px; margin-right: 4px;"

    bindProviderTestAction({
        button: testBtn,
        result: testResult,
        getEndpoint: () => ((form.querySelector(".inline-form-endpoint") as HTMLInputElement | null)?.value ?? ""),
        getApiKey: () => ((form.querySelector(".inline-form-apikey") as HTMLInputElement | null)?.value ?? ""),
        getModel: () => ((form.querySelector(".inline-form-model") as HTMLInputElement | null)?.value ?? ""),
    })

    const cancelBtn = document.createElement("button")
    cancelBtn.className = "secondary-button"
    cancelBtn.setAttribute("data-i18n-key", "options.translationEngine.aiProviders.form.cancel")
    cancelBtn.textContent = i18nModule.translate("options.translationEngine.aiProviders.form.cancel") || "Cancel"
    cancelBtn.addEventListener("click", () => form.remove())

    const saveBtn = document.createElement("button")
    saveBtn.className = "primary-button"
    saveBtn.setAttribute("data-i18n-key", "options.translationEngine.aiProviders.form.save")
    saveBtn.textContent = i18nModule.translate("options.translationEngine.aiProviders.form.save") || "Save"
    saveBtn.addEventListener("click", () => {
        handleInlineFormSave(form).catch((err) => logger.error("Failed to save inline AI provider", err))
    })

    actions.appendChild(testBtn)
    actions.appendChild(testResult)
    actions.appendChild(cancelBtn)
    actions.appendChild(saveBtn)

    form.appendChild(hiddenId)
    form.appendChild(grid)
    form.appendChild(checkboxRow)
    form.appendChild(actions)
    return form
}

async function handleInlineFormSave(formEl: HTMLElement): Promise<void> {
    const id = (formEl.querySelector(".inline-form-id") as HTMLInputElement)?.value ?? ""
    const name = ((formEl.querySelector(".inline-form-name") as HTMLInputElement)?.value ?? "").trim()
    const model = ((formEl.querySelector(".inline-form-model") as HTMLInputElement)?.value ?? "").trim()
    const endpoint = ((formEl.querySelector(".inline-form-endpoint") as HTMLInputElement)?.value ?? "").trim()
    const apiKey = ((formEl.querySelector(".inline-form-apikey") as HTMLInputElement)?.value ?? "").trim()
    const useMaxCompletionTokens = (formEl.querySelector(".inline-form-use-max-completion") as HTMLInputElement)?.checked ?? false

    if (!name || !endpoint || !apiKey || !model) {
        logger.warn("AI provider inline form: all fields are required")
        return
    }

    const settings = await storageManagerModule.getUserSettings()
    const providers: CustomAiProvider[] = [...(settings.customProviders ?? [])]
    const index = providers.findIndex((p) => p.id === id)
    if (index !== -1) {
        providers[index] = { id, name, endpoint, apiKey, model, useMaxCompletionTokens }
    }

    await saveProviders(providers)
    formEl.remove()
    renderProviderList(providers)
    refreshSelectOptions(providers)

    const fullPageSelect = document.getElementById("fullPageTranslationProviderSelect") as HTMLSelectElement | null
    const wordSelect = document.getElementById("wordTranslationProviderSelect") as HTMLSelectElement | null
    const updatedSettings = await storageManagerModule.getUserSettings()
    if (fullPageSelect) fullPageSelect.value = updatedSettings.fullPageTranslationProvider ?? "official"
    if (wordSelect) wordSelect.value = updatedSettings.wordTranslationProvider ?? "official"
}



async function handleFormSave(): Promise<void> {
    const idInput = document.getElementById("aiProviderFormId") as HTMLInputElement
    const nameInput = document.getElementById("aiProviderName") as HTMLInputElement
    const endpointInput = document.getElementById("aiProviderEndpoint") as HTMLInputElement
    const apiKeyInput = document.getElementById("aiProviderApiKey") as HTMLInputElement
    const modelInput = document.getElementById("aiProviderModel") as HTMLInputElement

    const name = nameInput.value.trim()
    const endpoint = endpointInput.value.trim()
    const apiKey = apiKeyInput.value.trim()
    const model = modelInput.value.trim()

    if (!name || !endpoint || !apiKey || !model) {
        logger.warn("AI provider form: all fields are required")
        return
    }

    const settings = await storageManagerModule.getUserSettings()
    const providers: CustomAiProvider[] = [...(settings.customProviders ?? [])]
    const existingId = idInput.value.trim()

    if (existingId) {
        // Edit existing provider
        const index = providers.findIndex((p) => p.id === existingId)
        if (index !== -1) {
            providers[index] = { id: existingId, name, endpoint, apiKey, model }
        }
    } else {
        // Add new provider
        providers.push({ id: generateId(), name, endpoint, apiKey, model })
    }

    await saveProviders(providers)
    renderProviderList(providers)
    refreshSelectOptions(providers)

    // Restore select values after refreshing options
    const fullPageSelect = document.getElementById("fullPageTranslationProviderSelect") as HTMLSelectElement | null
    const wordSelect = document.getElementById("wordTranslationProviderSelect") as HTMLSelectElement | null
    const updatedSettings = await storageManagerModule.getUserSettings()
    if (fullPageSelect) fullPageSelect.value = updatedSettings.fullPageTranslationProvider ?? "official"
    if (wordSelect) wordSelect.value = updatedSettings.wordTranslationProvider ?? "official"

    hideForm()
}

async function handleDelete(id: string): Promise<void> {
    const settings = await storageManagerModule.getUserSettings()
    const providers = (settings.customProviders ?? []).filter((p) => p.id !== id)

    // Reset selectors if the deleted provider was selected
    let fullPage = settings.fullPageTranslationProvider ?? "official"
    let word = settings.wordTranslationProvider ?? "official"
    if (fullPage === id) fullPage = "official"
    if (word === id) word = "official"

    await storageManagerModule.updateUserSettings({
        customProviders: providers,
        fullPageTranslationProvider: fullPage,
        wordTranslationProvider: word,
    })

    renderProviderList(providers)
    refreshSelectOptions(providers)

    const fullPageSelect = document.getElementById("fullPageTranslationProviderSelect") as HTMLSelectElement | null
    const wordSelect = document.getElementById("wordTranslationProviderSelect") as HTMLSelectElement | null
    if (fullPageSelect) fullPageSelect.value = fullPage
    if (wordSelect) wordSelect.value = word
}

async function handleProviderSelectChange(key: "fullPageTranslationProvider" | "wordTranslationProvider", value: string): Promise<void> {
    await storageManagerModule.updateUserSettings({ [key]: value })
}

/** Save customProviders array to storage, merging with existing settings */
async function saveProviders(providers: CustomAiProvider[]): Promise<void> {
    await storageManagerModule.updateUserSettings({ customProviders: providers })
}

/** Generate a simple unique ID */
function generateId(): string {
    return "custom_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

type ProviderTestActionOptions = {
    button: HTMLButtonElement
    result: HTMLSpanElement
    getEndpoint: () => string
    getApiKey: () => string
    getModel: () => string
}

function bindProviderTestAction(options: ProviderTestActionOptions): void {
    options.button.addEventListener("click", () => {
        void runProviderConnectionTest(options)
    })
}

async function runProviderConnectionTest(options: ProviderTestActionOptions): Promise<void> {
    const endpoint = options.getEndpoint().trim()
    const apiKey = options.getApiKey().trim()
    const model = options.getModel().trim()

    options.button.disabled = true
    options.button.textContent = getLocalizedText(PROVIDER_TESTING_BUTTON_KEY, DEFAULT_TESTING_BUTTON_LABEL)
    options.result.textContent = ""

    const url = endpoint.endsWith("/chat/completions") ? endpoint : endpoint.replace(/\/$/, "") + "/chat/completions"

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 10 }),
        })

        if (response.ok) {
            options.result.style.color = TEST_SUCCESS_COLOR
            options.result.textContent = getLocalizedText(PROVIDER_TEST_SUCCESS_KEY, DEFAULT_TEST_SUCCESS_MESSAGE)
            return
        }

        const text = await response.text()
        setProviderTestFailure(options.result, text || `HTTP ${response.status}`)
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        setProviderTestFailure(options.result, message)
    } finally {
        options.button.disabled = false
        options.button.textContent = getLocalizedText(PROVIDER_TEST_BUTTON_KEY, DEFAULT_TEST_BUTTON_LABEL)
    }
}

function setProviderTestFailure(result: HTMLSpanElement, message: string): void {
    result.style.color = TEST_FAILURE_COLOR
    const failurePrefix = getLocalizedText(PROVIDER_TEST_FAILURE_PREFIX_KEY, DEFAULT_TEST_FAILURE_PREFIX)
    result.textContent = `${failurePrefix}${message.slice(0, 50)}`
}

function resetProviderTestUi(button: HTMLButtonElement | null, result: HTMLSpanElement | null): void {
    if (button) {
        button.disabled = false
        button.textContent = getLocalizedText(PROVIDER_TEST_BUTTON_KEY, DEFAULT_TEST_BUTTON_LABEL)
    }

    if (result) {
        result.textContent = ""
        result.style.color = ""
    }
}

function getLocalizedText(key: string, fallback: string): string {
    const translated = i18nModule.translate(key)
    return translated === key ? fallback : translated
}
