/**
 * ATM CLI: registry diff 命令
 *
 * 用法: atm registry-diff <atomId> --from <v1> --to <v2> [--json] [--registry <path>] [--reason <text>]
 *
 * 產出符合 hash-diff-report.schema.json 的版本 hash 差異報告。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeHashDiffReport,
  findRegistryEntry,
  loadRegistryDocument
} from '../../../core/src/registry/diff.mjs';
import { makeResult, message } from './shared.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');

/**
 * 解析 CLI 參數。
 */
function parseArgs(args) {
  const parsed = {
    atomId: null,
    fromVersion: null,
    toVersion: null,
    registryPath: null,
    driftReason: null,
    json: false
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--from' && i + 1 < args.length) {
      parsed.fromVersion = args[++i];
    } else if (arg === '--to' && i + 1 < args.length) {
      parsed.toVersion = args[++i];
    } else if (arg === '--registry' && i + 1 < args.length) {
      parsed.registryPath = args[++i];
    } else if (arg === '--reason' && i + 1 < args.length) {
      parsed.driftReason = args[++i];
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (!arg.startsWith('-') && !parsed.atomId) {
      parsed.atomId = arg;
    }
    i++;
  }

  return parsed;
}

/**
 * CLI 命令入口。
 */
export function runRegistryDiff(args) {
  const cwd = process.cwd();
  const parsed = parseArgs(args);

  // 驗證必要參數
  if (!parsed.atomId) {
    return makeResult({
      ok: false,
      command: 'registry-diff',
      cwd,
      messages: [message('error', 'ATM_DIFF_MISSING_ATOM_ID', 'Missing required argument: atomId. Usage: atm registry-diff <atomId> --from <v1> --to <v2>')],
      evidence: {}
    });
  }

  if (!parsed.fromVersion || !parsed.toVersion) {
    return makeResult({
      ok: false,
      command: 'registry-diff',
      cwd,
      messages: [message('error', 'ATM_DIFF_MISSING_VERSIONS', 'Missing required flags: --from <version> --to <version>')],
      evidence: {}
    });
  }

  // 載入 registry
  let registryDoc;
  try {
    registryDoc = loadRegistryDocument(parsed.registryPath);
  } catch (error) {
    return makeResult({
      ok: false,
      command: 'registry-diff',
      cwd,
      messages: [message('error', 'ATM_DIFF_REGISTRY_NOT_FOUND', error.message)],
      evidence: {}
    });
  }

  // 找到對應的 entry
  const entry = findRegistryEntry(registryDoc, parsed.atomId);
  if (!entry) {
    return makeResult({
      ok: false,
      command: 'registry-diff',
      cwd,
      messages: [message('error', 'ATM_DIFF_ATOM_NOT_FOUND', `Atom ${parsed.atomId} not found in registry.`)],
      evidence: {}
    });
  }

  // 確認 entry 有 versions[]
  if (!entry.versions || entry.versions.length === 0) {
    return makeResult({
      ok: false,
      command: 'registry-diff',
      cwd,
      messages: [message('error', 'ATM_DIFF_NO_VERSIONS', `Atom ${parsed.atomId} has no version history. Ensure ATM-2-0014 registry version history is populated.`)],
      evidence: {}
    });
  }

  // 計算 diff report
  let report;
  try {
    report = computeHashDiffReport({
      entry,
      fromVersion: parsed.fromVersion,
      toVersion: parsed.toVersion,
      driftReason: parsed.driftReason
    });
  } catch (error) {
    return makeResult({
      ok: false,
      command: 'registry-diff',
      cwd,
      messages: [message('error', 'ATM_DIFF_COMPUTE_FAILED', error.message)],
      evidence: {}
    });
  }

  // 成功：產出報告
  const summaryText = report.driftSummary.totalChanged === 0
    ? `No hash drift between ${parsed.fromVersion} and ${parsed.toVersion}.`
    : `Hash drift detected: ${report.driftSummary.changedFields.join(', ')} changed between ${parsed.fromVersion} and ${parsed.toVersion}.`;

  return makeResult({
    ok: true,
    command: 'registry-diff',
    cwd,
    messages: [message('info', 'ATM_DIFF_OK', summaryText)],
    evidence: {
      report,
      atomId: parsed.atomId,
      fromVersion: parsed.fromVersion,
      toVersion: parsed.toVersion,
      totalChanged: report.driftSummary.totalChanged
    }
  });
}
