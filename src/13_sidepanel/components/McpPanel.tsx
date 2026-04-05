import { useState } from "react"
import { Plus, Plug, Trash2, RefreshCw, ChevronDown, ChevronUp, Server } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import type { McpServerConfig, McpServerState, McpAuthType } from "../mcp/types"

// --- Props ---

interface McpPanelProps {
    serverStates: McpServerState[]
    onAddServer: (config: McpServerConfig) => void
    onRemoveServer: (serverId: string) => void
    onToggleServer: (serverId: string, enabled: boolean) => void
    onToggleTool: (serverId: string, toolName: string, enabled: boolean) => void
    onReconnectServer: (serverId: string) => void
}

// --- Status helpers ---

const STATUS_DOT_CLASSES: Record<string, string> = {
    connected: "bg-green-500",
    connecting: "bg-yellow-500 animate-pulse",
    error: "bg-red-500",
    disconnected: "bg-stone-300",
}

function statusLabel(status: string): string {
    const keyMap: Record<string, string> = {
        connected: "sidepanel.mcp.status.connected",
        connecting: "sidepanel.mcp.status.connecting",
        error: "sidepanel.mcp.status.error",
        disconnected: "sidepanel.mcp.status.disconnected",
    }
    return i18nModule.translate(keyMap[status] ?? "sidepanel.mcp.status.disconnected")
}

// --- Component ---

export function McpPanel({
    serverStates,
    onAddServer,
    onRemoveServer,
    onToggleServer,
    onToggleTool,
    onReconnectServer,
}: McpPanelProps) {
    const [showForm, setShowForm] = useState(false)
    const [expandedServerId, setExpandedServerId] = useState<string | null>(null)

    function handleSubmit(config: McpServerConfig) {
        onAddServer(config)
        setShowForm(false)
    }

    // --- Empty state ---
    if (serverStates.length === 0 && !showForm) {
        return (
            <div className="flex-1 flex flex-col">
                <div className="p-3 border-b border-stone-200">
                    <button
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-medium transition-colors"
                        onClick={() => setShowForm(true)}
                    >
                        <Plus className="w-3.5 h-3.5" />
                        {i18nModule.translate("sidepanel.mcp.addServer")}
                    </button>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                    <Server className="w-8 h-8 text-stone-300" />
                    <p className="text-xs text-stone-400 max-w-[200px]">
                        {i18nModule.translate("sidepanel.mcp.emptyState")}
                    </p>
                </div>
            </div>
        )
    }

    // --- Server list ---
    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Add Server button / inline form */}
            <div className="p-3 border-b border-stone-200">
                {showForm ? (
                    <AddServerForm onSubmit={handleSubmit} onCancel={() => setShowForm(false)} />
                ) : (
                    <button
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-medium transition-colors"
                        onClick={() => setShowForm(true)}
                    >
                        <Plus className="w-3.5 h-3.5" />
                        {i18nModule.translate("sidepanel.mcp.addServer")}
                    </button>
                )}
            </div>

            {/* Server cards */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {serverStates.map((server) => (
                    <ServerCard
                        key={server.config.id}
                        server={server}
                        isExpanded={expandedServerId === server.config.id}
                        onToggleExpand={() =>
                            setExpandedServerId((prev) => (prev === server.config.id ? null : server.config.id))
                        }
                        onToggleServer={onToggleServer}
                        onToggleTool={onToggleTool}
                        onReconnect={onReconnectServer}
                        onRemove={onRemoveServer}
                    />
                ))}
            </div>
        </div>
    )
}

// --- AddServerForm ---

function AddServerForm({ onSubmit, onCancel }: { onSubmit: (cfg: McpServerConfig) => void; onCancel: () => void }) {
    const [name, setName] = useState("")
    const [url, setUrl] = useState("")
    const [authType, setAuthType] = useState<McpAuthType>("none")
    const [token, setToken] = useState("")

    function handleFormSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!name.trim() || !url.trim()) return

        const config: McpServerConfig = {
            id: crypto.randomUUID(),
            name: name.trim(),
            url: url.trim(),
            authType,
            authToken: authType === "bearer" ? token.trim() : undefined,
            enabled: true,
        }
        onSubmit(config)
    }

    const inputClasses = "w-full px-2 py-1.5 text-xs rounded-md border border-stone-200 bg-white text-stone-800 focus:outline-none focus:ring-1 focus:ring-stone-400"

    return (
        <form onSubmit={handleFormSubmit} className="space-y-2">
            <input
                className={inputClasses}
                type="text"
                placeholder={i18nModule.translate("sidepanel.mcp.form.name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
            />
            <input
                className={inputClasses}
                type="url"
                placeholder={i18nModule.translate("sidepanel.mcp.form.url")}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
            />
            <select
                className={inputClasses}
                value={authType}
                onChange={(e) => setAuthType(e.target.value as McpAuthType)}
            >
                <option value="none">{i18nModule.translate("sidepanel.mcp.form.authNone")}</option>
                <option value="bearer">{i18nModule.translate("sidepanel.mcp.form.authBearer")}</option>
            </select>
            {authType === "bearer" && (
                <input
                    className={inputClasses}
                    type="password"
                    placeholder={i18nModule.translate("sidepanel.mcp.form.token")}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                />
            )}
            <div className="flex gap-2">
                <button
                    type="submit"
                    disabled={!name.trim() || !url.trim()}
                    className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-xs font-medium transition-colors"
                >
                    {i18nModule.translate("sidepanel.mcp.form.submit")}
                </button>
                <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-medium transition-colors"
                    onClick={onCancel}
                >
                    {i18nModule.translate("sidepanel.mcp.form.cancel")}
                </button>
            </div>
        </form>
    )
}

// --- ServerCard ---

interface ServerCardProps {
    server: McpServerState
    isExpanded: boolean
    onToggleExpand: () => void
    onToggleServer: (serverId: string, enabled: boolean) => void
    onToggleTool: (serverId: string, toolName: string, enabled: boolean) => void
    onReconnect: (serverId: string) => void
    onRemove: (serverId: string) => void
}

function ServerCard({
    server,
    isExpanded,
    onToggleExpand,
    onToggleServer,
    onToggleTool,
    onReconnect,
    onRemove,
}: ServerCardProps) {
    const { config, status, tools, errorMessage } = server
    const enabledToolCount = tools.filter((t) => t.enabled).length

    return (
        <div className="group bg-white rounded-lg border border-stone-200 hover:border-stone-300 transition-colors">
            <div className="px-3 pt-3 pb-2 space-y-1.5">
                {/* Row 1: Name + status dot + action buttons */}
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT_CLASSES[status] ?? "bg-stone-300"}`} />
                        <span className={`text-xs font-medium truncate ${config.enabled ? "text-stone-800" : "text-stone-400"}`}>
                            {config.name}
                        </span>
                        <span className="text-[10px] text-stone-400">{statusLabel(status)}</span>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                        <button
                            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-opacity"
                            onClick={() => onReconnect(config.id)}
                            title={i18nModule.translate("sidepanel.mcp.reconnect")}
                        >
                            <RefreshCw className="w-3 h-3" />
                        </button>
                        <button
                            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-stone-100 text-stone-400 hover:text-red-500 transition-opacity"
                            onClick={() => onRemove(config.id)}
                            title={i18nModule.translate("sidepanel.mcp.delete")}
                        >
                            <Trash2 className="w-3 h-3" />
                        </button>
                    </div>
                </div>

                {/* Error message */}
                {status === "error" && errorMessage && (
                    <p className="text-[11px] text-red-500 leading-snug line-clamp-2">{errorMessage}</p>
                )}

                {/* Row 2: Tool count badge + Toggle switch */}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="inline-flex items-center gap-1 text-[10px] text-stone-400">
                        <Plug className="w-3 h-3" />
                        <span>
                            {enabledToolCount}/{tools.length} {i18nModule.translate("sidepanel.mcp.tools")}
                        </span>
                    </span>

                    <button
                        role="switch"
                        aria-checked={config.enabled}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                            config.enabled ? "bg-blue-500" : "bg-stone-300"
                        }`}
                        onClick={() => onToggleServer(config.id, !config.enabled)}
                    >
                        <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                config.enabled ? "translate-x-4" : "translate-x-0"
                            }`}
                        />
                    </button>
                </div>

                {/* Row 3: Expand/collapse tools */}
                {tools.length > 0 && (
                    <button
                        className="flex items-center gap-0.5 text-[10px] text-stone-400 hover:text-stone-600 transition-colors"
                        onClick={onToggleExpand}
                    >
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        {i18nModule.translate("sidepanel.mcp.tools")}
                    </button>
                )}
            </div>

            {/* Tool list */}
            {isExpanded && tools.length > 0 && (
                <div className="border-t border-stone-100 px-3 py-2 space-y-1.5">
                    {tools.map((tool) => (
                        <div key={tool.name} className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <p className={`text-[11px] font-medium truncate ${tool.enabled ? "text-stone-700" : "text-stone-400"}`}>
                                    {tool.name}
                                </p>
                                <p className="text-[10px] text-stone-400 truncate">{tool.description}</p>
                            </div>
                            <button
                                role="switch"
                                aria-checked={tool.enabled}
                                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                    tool.enabled ? "bg-blue-500" : "bg-stone-300"
                                }`}
                                onClick={() => onToggleTool(config.id, tool.name, !tool.enabled)}
                            >
                                <span
                                    className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                        tool.enabled ? "translate-x-3" : "translate-x-0"
                                    }`}
                                />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
