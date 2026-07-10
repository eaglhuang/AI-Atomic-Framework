export type ValidatorTier = 'focused' | 'batch' | 'milestone' | 'release';
export type ValidatorEvidenceState = 'pass' | 'absent' | 'failed-run' | 'stale' | 'diagnostic-only';
export type EvidenceFreshness = 'fresh' | 'historical-reference' | 'draft';

export const VALIDATOR_GATE_ALIAS_MAP = new Map<string, string>([
  ['typecheck', 'typecheck'],
  ['test', 'test'],
  ['npm test', 'test'],
  ['npm run test', 'test'],
  ['git diff --check', 'git diff --check'],
  ['git-diff-check', 'git diff --check'],
  ['doctor', 'doctor'],
  ['framework-development', 'framework-development'],
  ['tasks-audit', 'tasks-audit'],
  ['git-head-evidence', 'git-head-evidence'],
  ['git-head-backfill', 'git-head-evidence']
]);

export function normalizeValidatorToken(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * 將 task card 裡的 validator 字串正規化成 gate 名稱。
 * 例如 "npm run typecheck" → "typecheck"
 *       "npm run validate:cli" → "validate:cli"
 */
export function normalizeValidatorGateName(raw: string): string {
  if (/^npm(?:\s+run)?\s+test$/i.test(raw.trim())) return 'test';
  // "npm run <gate>" → "<gate>"
  const npmMatch = raw.match(/^npm run (.+)$/);
  if (npmMatch) return npmMatch[1].trim();
  // "node --strip-types scripts/validate-<name>.ts --mode validate" → "validate:<name>"
  const nodeScriptMatch = raw.match(/validate-([a-z0-9-]+)\.ts/);
  if (nodeScriptMatch) return `validate:${nodeScriptMatch[1]}`;
  // 已是 gate 名稱
  return raw;
}

/** 依 gate 名稱歸類 tier */
export function canonicalizeValidatorIdentity(raw: string): string {
  const normalized = normalizeValidatorToken(raw);
  if (!normalized) return normalized;
  const lowered = normalized.toLowerCase();
  const aliased = VALIDATOR_GATE_ALIAS_MAP.get(lowered);
  if (aliased) return aliased;

  const gate = normalizeValidatorGateName(normalized);
  const gatedLower = gate.toLowerCase();
  const gatedAlias = VALIDATOR_GATE_ALIAS_MAP.get(gatedLower);
  if (gatedAlias) return gatedAlias;

  if (/^git diff --check$/i.test(normalized)) return 'git diff --check';
  if (/^node\s+(?:--strip-types\s+)?atm(?:\.dev)?\.mjs\s+doctor\b/i.test(normalized)) return 'doctor';
  if (
    /^node\s+(?:--strip-types\s+)?atm(?:\.dev)?\.mjs\s+next\b/i.test(normalized)
    && /\s--json(?:\s|$)/i.test(` ${normalized} `)
    && !/\s--prompt(?:\s|$)|\s--claim(?:\s|$)|\s--task(?:\s|$)/i.test(` ${normalized} `)
  ) {
    return 'framework-development';
  }
  if (/^node\s+(?:--strip-types\s+)?atm(?:\.dev)?\.mjs\s+tasks\s+audit\b/i.test(normalized)) return 'tasks-audit';
  if (/^node\s+(?:--strip-types\s+)?atm(?:\.dev)?\.mjs\s+evidence\s+git-head-backfill\b/i.test(normalized)) return 'git-head-evidence';

  return gate;
}

export function classifyValidatorTier(gate: string): ValidatorTier {
  // Release gates — 只有 release 類 task 才需要重跑
  if (
    gate === 'validate:integration-adapter' ||
    gate === 'validate:skill-templates' ||
    gate === 'validate:root-drop-release' ||
    gate === 'validate:onefile-release'
  ) {
    return 'release';
  }
  // Focused — 每次任務必須跑的核心 validator
  if (gate === 'typecheck' || gate === 'validate:cli' || gate === 'validate:git-head-evidence') {
    return 'focused';
  }
  // 其他 validate: 前綴 — 視為 focused
  if (gate.startsWith('validate:')) {
    return 'focused';
  }
  // 其餘 framework 健康 gate — 可 batch 重用
  return 'batch';
}

/**
 * TASK-AAO-0017 follow-up：判斷一個 validator 是否為 closure-required（會阻擋 tasks close）。
 * - focused tier：typecheck、validate:cli、validate:* 等每次 task 必須重跑的 gate
 * - release tier：只有 release 變更會出現的 gate（已動態加入 requiredGates）
 * - batch tier：framework 健康類 advisory gate（doctor、framework-development、
 *   tasks-audit、git-head-evidence），不應被 evidence missing 當作 hard block
 * - task card 顯式宣告的 validator 一律視為 closure-required
 */
export function isClosureRequiredValidator(
  gate: string,
  taskDeclaredValidators: readonly string[],
  scopePaths: readonly string[] = []
): boolean {
  if (taskDeclaredValidators.includes(gate)) return true;

  // ATM-BUG-2026-07-09-065: Derive minimal validator set based on scope paths.
  // If the gate is validate:cli, only require it if the task's scopePaths touch cli code.
  if (gate === 'validate:cli') {
    const touchesCli = scopePaths.some((p) => {
      const norm = p.replace(/\\/g, '/').toLowerCase();
      return norm.startsWith('packages/cli/') ||
             norm.includes('scripts/validate-cli') ||
             norm.includes('scripts/run-validators');
    });
    if (!touchesCli) {
      return false;
    }
  }

  const tier = classifyValidatorTier(gate);
  return tier === 'focused' || tier === 'release';
}

/** 依 gate 名稱回傳對應的執行指令（human-readable 提示用） */
export function resolveValidatorExpectedCommand(gate: string): string {
  if (looksLikeLiteralValidatorCommand(gate)) return gate;
  if (gate === 'typecheck') return 'npm run typecheck';
  if (gate === 'git diff --check') return 'git diff --check';
  if (gate.startsWith('validate:')) return `npm run ${gate}`;
  if (gate === 'framework-development') return 'node atm.mjs next --json';
  if (gate === 'tasks-audit') return 'node atm.mjs tasks audit --json';
  if (gate === 'doctor') return 'node atm.mjs doctor --json';
  if (gate === 'git-head-evidence') return 'node atm.mjs evidence git-head-backfill --actor <actor> --json';
  return `node atm.mjs ${gate} --json`;
}

export function looksLikeLiteralValidatorCommand(value: string): boolean {
  const normalized = normalizeValidatorToken(value);
  return /^(?:node|npm|git|npx|pnpm|yarn|powershell(?:\.exe)?|pwsh(?:\.exe)?)\s+/i.test(normalized)
    || normalized.startsWith('./')
    || normalized.startsWith('.\\');
}


export function detectAutoLinkedValidator(command: string): string | null {
  const gate = canonicalizeValidatorIdentity(command);
  if (
    gate === 'typecheck'
    || gate === 'git diff --check'
    || gate === 'doctor'
    || gate === 'framework-development'
    || gate === 'tasks-audit'
    || gate === 'git-head-evidence'
    || gate.startsWith('validate:')
  ) return gate;
  return null;
}
