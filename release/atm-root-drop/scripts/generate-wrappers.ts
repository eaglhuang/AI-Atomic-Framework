/**
 * generate-wrappers.ts
 *
 * TASK-ASR-0010 — wrappers generator
 *
 * 讀 templates/root-drop/.atm/scripts/wrappers.json（SSoT），
 * 重新生成全部 14 個 wrapper 檔案（7×.sh + 7×.ps1）。
 *
 * 用法：npm run generate:wrappers
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'templates', 'root-drop', '.atm', 'scripts', 'wrappers.json');
const shDir = path.join(root, 'templates', 'root-drop', '.atm', 'scripts', 'sh');
const psDir = path.join(root, 'templates', 'root-drop', '.atm', 'scripts', 'ps');

interface WrapperEntry {
  name: string;
  subcommand: string;
  extraArgs: string[];
  alwaysJson: boolean;
}

interface WrappersManifest {
  wrappers: WrapperEntry[];
}

/** 把 wrappers.json entry 組成完整的 CLI 參數陣列 */
function buildArgs(entry: WrapperEntry): string[] {
  return [
    entry.subcommand,
    ...entry.extraArgs,
    ...(entry.alwaysJson ? ['--json'] : []),
  ];
}

/** 生成 POSIX shell wrapper 內容 */
function generateSh(entry: WrapperEntry): string {
  const argsStr = buildArgs(entry).join(' ');
  return [
    '#!/usr/bin/env sh',
    'set -eu',
    'SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)',
    `exec node "$REPO_ROOT/atm.mjs" ${argsStr} "$@"`,
  ].join('\n');
}

/** 生成 PowerShell wrapper 內容 */
function generatePs1(entry: WrapperEntry): string {
  const argsStr = buildArgs(entry).join(' ');
  return [
    '$ErrorActionPreference = "Stop"',
    '$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path',
    '$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\\..\\..")',
    `& node (Join-Path $RepoRoot "atm.mjs") ${argsStr} @args`,
    'exit $LASTEXITCODE',
  ].join('\n');
}

const manifest: WrappersManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let count = 0;

for (const entry of manifest.wrappers) {
  const shContent = generateSh(entry);
  const ps1Content = generatePs1(entry);
  writeFileSync(path.join(shDir, `${entry.name}.sh`), shContent, { encoding: 'utf8' });
  writeFileSync(path.join(psDir, `${entry.name}.ps1`), ps1Content, { encoding: 'utf8' });
  count++;
}

console.log(
  `[generate-wrappers] ok (${count} POSIX + ${count} PowerShell wrappers generated from wrappers.json)`
);
