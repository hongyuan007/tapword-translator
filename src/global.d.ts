/**
 * Global Type Declarations
 *
 * Type declarations for non-TypeScript modules and special imports
 */

// Vite Environment Variables
/// <reference types="vite/client" />

// Build-time constants injected by vite.config.ts
declare const __IS_FIREFOX__: boolean

interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string
    // Add more env variables here as needed
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

// Vite raw import for HTML files
declare module "*.html?raw" {
    const content: string
    export default content
}

// Vite raw import for CSS files
declare module "*.css?raw" {
    const content: string
    export default content
}

// Regular HTML import
declare module "*.html" {
    const content: string
    export default content
}

// CSS import
declare module "*.css" {
    const content: string
    export default content
}
