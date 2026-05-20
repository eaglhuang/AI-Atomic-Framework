/**
 * split-command-specs.ts
 *
 * TASK-ASR-0011 — command-specs per-file split 自動化腳本
 *
 * 讀取 packages/cli/src/commands/command-specs.ts，
 * 把 38 個 defineCommandSpec(...) 逐一拆到各自的 .spec.ts 檔案，
 * 並重新生成精簡版的 command-specs.ts（import + assemble + accessors）。
 *
 * 用法：node --experimental-strip-types scripts/split-command-specs.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commandSpecsPath = path.join(
  root,
  'packages',
  'cli',
  'src',
  'commands',
  'command-specs.ts'
);
const specDir = path.join(root, 'packages', 'cli', 'src', 'commands', 'command-specs');

const COMMON_IMPORTS = [
  'commonCwdOption',
  'commonHelpOption',
  'commonJsonOption',
  'commonPrettyOption',
];

/** 找到每個 spec 的起始行 index 和 key 名稱 */
function findSpecStarts(lines: string[]): Array<{ key: string; lineIndex: number }> {
  const result: Array<{ key: string; lineIndex: number }> = [];
  // 允許 2+ 個空格（原始文件中 migrate 有 4 個空格縮排，是格式不一致導致的）
  const specPattern = /^ {2,}'?([a-zA-Z][a-zA-Z0-9-]*)'?: defineCommandSpec\(\{/;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(specPattern);
    if (match) {
      result.push({ key: match[1], lineIndex: i });
    }
  }
  return result;
}

/**
 * 從 startLine 往後計算括號深度，找到 defineCommandSpec({...}) 的結束位置。
 * 返回最後一行的 index（即含有 `}),` 或 `})` 的行）。
 */
function findSpecEnd(lines: string[], startLineIndex: number): number {
  // 第一行含 defineCommandSpec({，depth 從 0 開始，遇到 { 增加
  let depth = 0;
  for (let i = startLineIndex; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '{' || ch === '(') depth++;
      if (ch === '}' || ch === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  throw new Error(`Cannot find end of spec starting at line ${startLineIndex + 1}`);
}

/** 從 spec 內容中偵測使用了哪些 _common 選項 */
function detectCommonUsage(specLines: string[]): string[] {
  const text = specLines.join('\n');
  return COMMON_IMPORTS.filter((name) => text.includes(name));
}

/** 把 key 轉成合法的 import 識別符（'agent-pack' → agentPackSpec）*/
function keyToIdentifier(key: string): string {
  return (
    key
      .split('-')
      .map((part, i) => (i === 0 ? part : part[0].toUpperCase() + part.slice(1)))
      .join('') + 'Spec'
  );
}

/** 把 key 轉成檔名（'agent-pack' → agent-pack.spec.ts）*/
function keyToFilename(key: string): string {
  return `${key}.spec.ts`;
}

// ─── 主程式 ────────────────────────────────────────────────────────────────

const content = readFileSync(commandSpecsPath, 'utf8');
const lines = content.split('\n');

const specStarts = findSpecStarts(lines);
console.log(`[split-command-specs] Found ${specStarts.length} specs`);

mkdirSync(specDir, { recursive: true });

const specEntries: Array<{ key: string; identifier: string; filename: string }> = [];

for (const { key, lineIndex } of specStarts) {
  const endLineIndex = findSpecEnd(lines, lineIndex);

  // spec 的主體（去掉 key 前綴，只保留 defineCommandSpec({...})）
  const specLines = lines.slice(lineIndex, endLineIndex + 1);

  // 找到第一行的 defineCommandSpec 起始位置（去掉 "  key: " 前綴）
  const firstLine = specLines[0];
  const defStart = firstLine.indexOf('defineCommandSpec(');
  const specBodyFirstLine = firstLine.slice(defStart);

  // 組合 spec 內容（移除最後的逗號 `}),` → `})`）
  const bodyLines = [specBodyFirstLine, ...specLines.slice(1)];
  // 最後一行可能是 `  }),` 需要變成 `});`（export default 的結尾）
  const lastLine = bodyLines[bodyLines.length - 1];
  bodyLines[bodyLines.length - 1] = lastLine.replace(/\s*\}\),?\s*$/, '});');

  // 去掉每行最前面多餘的兩格縮排（因為原來的是物件 property，多縮排了 2 格）
  const dedented = bodyLines.map((line) => (line.startsWith('  ') ? line.slice(2) : line));

  // 偵測用了哪些 _common 選項
  const usedCommon = detectCommonUsage(dedented);

  // 組合 import 區段
  const importLines: string[] = ["import { defineCommandSpec } from '../shared.ts';"];
  if (usedCommon.length > 0) {
    importLines.push('import {');
    for (const name of usedCommon) {
      importLines.push(`  ${name},`);
    }
    importLines.push("} from './_common.ts';");
  }

  const fileContent = [
    ...importLines,
    '',
    'export default ' + dedented.join('\n').trimStart(),
    '',
  ].join('\n');

  const filename = keyToFilename(key);
  writeFileSync(path.join(specDir, filename), fileContent, { encoding: 'utf8' });

  const identifier = keyToIdentifier(key);
  specEntries.push({ key, identifier, filename });
  console.log(`  [split] ${filename} (${usedCommon.length > 0 ? usedCommon.join(', ') : 'no _common'})`);
}

// ─── 生成新的 command-specs.ts ─────────────────────────────────────────────

const importBlock = specEntries
  .map(({ identifier, filename }) => `import ${identifier} from './command-specs/${filename}';`)
  .join('\n');

const assemblyBlock = specEntries
  .map(({ key, identifier }) => {
    // 含連字號的 key 需要引號
    const needsQuotes = key.includes('-');
    const keyStr = needsQuotes ? `'${key}'` : key;
    return `  ${keyStr}: ${identifier},`;
  })
  .join('\n');

const newCommandSpecs = `import { defineCommandSpec } from './shared.ts';
import {
  commonCwdOption,
  commonHelpOption,
  commonJsonOption,
  commonPrettyOption
} from './command-specs/_common.ts';

${importBlock}

export const commandSpecs = Object.freeze({
${assemblyBlock}
});

export function getCommandSpec(commandName: string) {
  return commandName in commandSpecs
    ? commandSpecs[commandName as keyof typeof commandSpecs]
    : null;
}

export function listCommandSpecs() {
  return Object.values(commandSpecs);
}
`;

writeFileSync(commandSpecsPath, newCommandSpecs, { encoding: 'utf8' });
console.log(`[split-command-specs] Wrote new command-specs.ts (${newCommandSpecs.split('\n').length} lines)`);
console.log(`[split-command-specs] ok — ${specEntries.length} spec files created`);
