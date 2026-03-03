import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.join(__dirname, '..', 'src', '0_common', 'locales');
const BASELINE_COMMIT = '1942de592deede13d183f851339b79e343cc011f';
const MTRAN_COMMIT = '8952c5b';

function getFileFromCommit(commit, file) {
    const output = execSync(`git show ${commit}:src/0_common/locales/${file}`, {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf-8'
    });
    return JSON.parse(output);
}

function mergeI18n(baselineEn, baselineLang, currentLang) {
    const baselineEnKeys = Object.keys(baselineEn).sort();
    const baselineLangKeys = Object.keys(baselineLang);
    const currentLangKeys = Object.keys(currentLang);
    
    // 找出当前版本相比基准新增的 key
    const newKeys = currentLangKeys.filter(key => !baselineLangKeys.includes(key));
    
    // 找出基准 en.json 有但当前语言基准版本没有的 key（缺失的翻译）
    const missingKeys = baselineEnKeys.filter(key => !baselineLangKeys.includes(key));
    
    // 以基准语言版本为基础
    const merged = {};
    
    // 首先添加基准语言版本的所有 key（保留原有翻译）
    for (const key of baselineLangKeys) {
        merged[key] = baselineLang[key];
    }
    
    // 添加缺失的 key（从 en.json 基准获取英文原文）
    for (const key of missingKeys) {
        merged[key] = baselineEn[key];
    }
    
    // 然后添加新增的 key（来自 MTranServer 版本）
    for (const key of newKeys) {
        merged[key] = currentLang[key];
    }
    
    // 按 key 排序
    const sorted = {};
    Object.keys(merged).sort().forEach(key => {
        sorted[key] = merged[key];
    });
    
    return { sorted, newKeys, missingKeys };
}

function processAllLocales() {
    const files = fs.readdirSync(LOCALES_DIR).filter(f => f.endsWith('.json')).sort();
    
    console.log('='.repeat(60));
    console.log('i18n 合并脚本');
    console.log('='.repeat(60));
    console.log(`基准提交：${BASELINE_COMMIT.substring(0, 7)}`);
    console.log(`MTran 提交：${MTRAN_COMMIT.substring(0, 7)}`);
    console.log('='.repeat(60));
    console.log();
    
    // 获取 en.json 基准作为完整参考
    const baselineEn = getFileFromCommit(BASELINE_COMMIT, 'en.json');
    console.log(`en.json 基准版本包含 ${Object.keys(baselineEn).length} 个 key\n`);
    
    const results = [];
    
    for (const file of files) {
        console.log(`处理 ${file}...`);
        
        if (file === 'en.json') {
            // en.json 特殊处理：基准 + 新增
            const current = getFileFromCommit(MTRAN_COMMIT, file);
            const baselineKeys = Object.keys(baselineEn);
            const newKeys = Object.keys(current).filter(key => !baselineKeys.includes(key));
            
            const merged = {};
            baselineKeys.forEach(key => { merged[key] = baselineEn[key]; });
            newKeys.forEach(key => { merged[key] = current[key]; });
            
            const sorted = {};
            Object.keys(merged).sort().forEach(key => { sorted[key] = merged[key]; });
            
            fs.writeFileSync(path.join(LOCALES_DIR, file), JSON.stringify(sorted, null, 4) + '\n', 'utf-8');
            console.log(`  新增 ${newKeys.length} 个 key:`);
            newKeys.forEach(key => console.log(`    + ${key}`));
            console.log(`  ✓ 已更新 (${Object.keys(sorted).length} 个 key)\n`);
            
            results.push({ file, keys: Object.keys(sorted).length, newKeys: newKeys.length, missingKeys: 0 });
            continue;
        }
        
        // 其他语言文件
        const baselineLang = getFileFromCommit(BASELINE_COMMIT, file);
        const currentLang = getFileFromCommit(MTRAN_COMMIT, file);
        
        const { sorted, newKeys, missingKeys } = mergeI18n(baselineEn, baselineLang, currentLang);
        
        if (newKeys.length > 0) {
            console.log(`  新增 ${newKeys.length} 个 key:`);
            newKeys.forEach(key => {
                const value = sorted[key].substring(0, 50).replace(/\n/g, ' ');
                console.log(`    + ${key}: "${value}..."`);
            });
        }
        
        if (missingKeys.length > 0) {
            console.log(`  ⚠ 缺失 ${missingKeys.length} 个 key (使用英文占位):`);
            missingKeys.forEach(key => console.log(`    - ${key}`));
        }
        
        fs.writeFileSync(path.join(LOCALES_DIR, file), JSON.stringify(sorted, null, 4) + '\n', 'utf-8');
        console.log(`  ✓ 已更新 (${Object.keys(sorted).length} 个 key)\n`);
        
        results.push({ file, keys: Object.keys(sorted).length, newKeys: newKeys.length, missingKeys: missingKeys.length });
    }
    
    // 打印汇总
    console.log('='.repeat(60));
    console.log('汇总:');
    console.log('='.repeat(60));
    
    results.forEach(({ file, keys, newKeys, missingKeys }) => {
        const diff = `(+${newKeys})`;
        const missing = missingKeys > 0 ? ` [-${missingKeys} 英文占位]` : '';
        console.log(`  ${file.padEnd(10)} ${keys} 个 key ${diff}${missing}`);
    });
    
    console.log('='.repeat(60));
    
    // 检查所有文件的 key 数量是否一致
    const keyCounts = results.map(r => r.keys);
    const allSame = keyCounts.every(count => count === keyCounts[0]);
    
    if (allSame) {
        console.log(`✓ 所有语言文件都有 ${keyCounts[0]} 个 key`);
    } else {
        console.log('⚠ 警告：不同语言文件的 key 数量不一致!');
        results.forEach(({ file, keys }) => {
            console.log(`  ${file}: ${keys}`);
        });
    }
}

processAllLocales();
