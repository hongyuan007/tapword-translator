import { createRoot } from "react-dom/client"
import "./styles/sidepanel.css"
import App from "./App"

// Notify background that sidepanel is open
chrome.runtime.sendMessage({ type: "SIDE_PANEL_OPENED" }).catch(() => {})

// Notify background when sidepanel closes
window.addEventListener("beforeunload", () => {
    chrome.runtime.sendMessage({ type: "SIDE_PANEL_CLOSED" }).catch(() => {})
})

const container = document.getElementById("root")!
createRoot(container).render(<App />)
