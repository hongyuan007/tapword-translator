import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const CURRENT_FILE_PATH = fileURLToPath(import.meta.url);
const CURRENT_DIRECTORY = path.dirname(CURRENT_FILE_PATH);
const TESTS_DIRECTORY = path.resolve(CURRENT_DIRECTORY, '../specs');
const OUTPUT_DIRECTORY = path.resolve(CURRENT_DIRECTORY, '../output');

export default defineConfig({
    testDir: TESTS_DIRECTORY,
    outputDir: OUTPUT_DIRECTORY,
    timeout: 120_000,
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    // Prevent Playwright from wiping output dir between test files
    // so screenshots from earlier tests survive for AI visual review.
    use: {
        trace: 'retain-on-failure',
        screenshot: 'off',
        video: 'retain-on-failure',
        ignoreHTTPSErrors: true,
    },
});
