/**
 * API Error Types
 *
 * Centralized error handling for all API requests
 * Using discriminated union pattern (similar to Swift enum with associated values)
 */

export type APIErrorType =
    | "businessError"
    | "requestError"
    | "rateLimited"
    | "serverAlert"
    | "timeout"
    | "unexpectedError"
    | "tokenExpired"
    | "reAttestationRequired"

export interface APIErrorParams {
    type: APIErrorType
    code?: number
    message?: string
    originalError?: Error
}

/**
 * API Error - Custom error class to enable instanceof checks
 */
export class APIError extends Error {
    type: APIErrorType
    code?: number
    originalError?: Error

    constructor(params: APIErrorParams) {
        super(params.message ?? "")
        this.name = "APIError"
        this.type = params.type
        this.code = params.code
        this.originalError = params.originalError
    }
}

/**
 * Get user-friendly error message
 */
//TODO: integrate with i18n
export function getUserMessage(error: APIError): string {
    switch (error.type) {
        case "businessError":
            return error.message || "服务异常, 请稍后重试"
        case "requestError":
            return error.message || "网络错误, 请稍后重试"
        case "rateLimited":
            return "请求频繁, 请稍后重试"
        case "tokenExpired":
            return "登录已过期, 请重试"
        case "reAttestationRequired":
            return "验证失败, 请重试"
        case "serverAlert":
            return error.message || "服务异常, 请稍后重试"
        case "timeout":
            return "请求超时, 请稍后重试"
        case "unexpectedError":
            return error.message || error.originalError?.message || "出错, 请稍后重试"
    }
}

/**
 * Get debug message for logging
 */
export function getDebugMessage(error: APIError): string {
    switch (error.type) {
        case "businessError":
            return `APIError.businessError: [Code: ${error.code}] - ${error.message}`
        case "requestError":
            return `APIError.requestError: [Code: ${error.code}] - ${error.message || "No additional message"}`
        case "rateLimited":
            return `APIError.rateLimited: ${error.message}`
        case "tokenExpired":
            return "APIError.tokenExpired"
        case "reAttestationRequired":
            return "APIError.reAttestationRequired"
        case "serverAlert":
            return `APIError.serverAlert: ${error.message}`
        case "timeout":
            return "APIError.timeout"
        case "unexpectedError":
            return `APIError.unexpectedError: ${error.originalError?.message ?? "Unknown"}`
    }
}

/**
 * API Error Codes (matching backend conventions)
 */
export const APIErrorCodes = {
    SUCCESS: 0,
    TOKEN_EXPIRED: 419,
    RATE_LIMITED: 429,
    SERVER_ALERT: 998,
    CLIENT_VERSION_OUTDATED: 999,
    QUOTA_EXCEEDED: 4001,
    RE_ATTESTATION_REQUIRED: 10001,
} as const
