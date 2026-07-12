import { promises as fs } from 'fs';
import * as path from 'path';
import type { VerificationResult } from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a Markdown test report and write it to disk.
 *
 * @param outputDir - Directory where the report file will be written.
 * @param results   - Verification results from all scenarios.
 * @param runId     - Unique run identifier (used in filename and content).
 * @returns         - Absolute path to the generated `.md` file.
 */
export async function generateReport(
    outputDir: string,
    results: VerificationResult[],
    runId: string,
): Promise<string> {
    // Ensure the output directory exists.
    await fs.mkdir(outputDir, { recursive: true });

    const total = results.length;
    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = total - passedCount;
    const timestamp = new Date().toISOString();

    const lines: string[] = [
        '# AI E2E 测试验证报告',
        '',
        `- **运行 ID**: ${runId}`,
        `- **时间**: ${timestamp}`,
        `- **模型**: GPT 5.6 (codex/gpt-5.6)`,
        '',
        '## 摘要',
        '',
        '| 指标 | 值 |',
        '|------|------|',
        `| 总场景数 | ${total} |`,
        `| 通过 | ${passedCount} |`,
        `| 失败 | ${failedCount} |`,
        '',
        '## 场景详情',
        '',
    ];

    results.forEach((result, index) => {
        const status = result.passed ? '✅ PASS' : '❌ FAIL';
        const screenshotList = result.screenshots.length > 0
            ? result.screenshots.join(', ')
            : '(无)';

        lines.push(`### ${index + 1}. ${result.scenario}`);
        lines.push(`- **状态**: ${status}`);
        lines.push(`- **判定理由**: ${result.reason}`);
        lines.push(`- **截图**: ${screenshotList}`);
        lines.push('');
    });

    const content = lines.join('\n');
    const filename = `report-${runId}.md`;
    const filepath = path.join(outputDir, filename);

    await fs.writeFile(filepath, content, 'utf-8');

    return filepath;
}
