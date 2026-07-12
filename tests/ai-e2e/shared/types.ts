/**
 * Shared type definitions for the AI E2E testing framework.
 */

// ---------------------------------------------------------------------------
// Literal union types
// ---------------------------------------------------------------------------

export type ScenarioType = 'click-translate' | 'drag-select';

export type VerificationStatus = 'passed' | 'failed' | 'skipped';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ScenarioConfig {
    name: ScenarioType;
    description: string;
    expectedBehavior: string;
    fixturePage?: string;
    fixtureLevel: 'fixture' | 'real';
}

export interface VerificationContext {
    scenario: ScenarioType;
    operation: string;
    expectedBehavior: string;
    screenshots: string[];
    codeChanges?: string;
}

export interface VerificationResult {
    scenario: string;
    passed: boolean;
    reason: string;
    screenshots: string[];
}

export interface ScreenshotOptions {
    fullPage?: boolean;
    clip?: { x: number; y: number; width: number; height: number };
}

export interface E2EReport {
    runId: string;
    timestamp: string;
    summary: {
        total: number;
        passed: number;
        failed: number;
    };
    scenarios: Array<{
        name: string;
        passed: boolean;
        reason: string;
        screenshots: string[];
        duration: number;
    }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = 'codex/gpt-5.6';
