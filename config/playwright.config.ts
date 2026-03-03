import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const CURRENT_FILE_PATH = fileURLToPath(import.meta.url);
const CURRENT_DIRECTORY = path.dirname(CURRENT_FILE_PATH);
const TESTS_DIRECTORY = path.resolve(CURRENT_DIRECTORY, '../tests/e2e/specs');
const OUTPUT_DIRECTORY = path.resolve(CURRENT_DIRECTORY, '../tests/e2e/test-results');

export default defineConfig({
    testDir: TESTS_DIRECTORY,
    outputDir: OUTPUT_DIRECTORY,
    timeout: 60_000,
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    use: {
        trace: 'on-first-retry',
        screenshot: 'on',
        video: 'retain-on-failure',
        ignoreHTTPSErrors: true,
    },
});
