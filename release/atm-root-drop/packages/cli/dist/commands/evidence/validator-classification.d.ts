export type ValidatorTier = 'focused' | 'batch' | 'milestone' | 'release';
export type ValidatorEvidenceState = 'pass' | 'absent' | 'failed-run' | 'stale' | 'diagnostic-only';
export type EvidenceFreshness = 'fresh' | 'historical-reference' | 'draft';
export declare const VALIDATOR_GATE_ALIAS_MAP: Map<string, string>;
export declare function normalizeValidatorToken(raw: string): string;
/**
 * 將 task card 裡的 validator 字串正規化成 gate 名稱。
 * 例如 "npm run typecheck" → "typecheck"
 *       "npm run validate:cli" → "validate:cli"
 */
export declare function normalizeValidatorGateName(raw: string): string;
/** 依 gate 名稱歸類 tier */
export declare function canonicalizeValidatorIdentity(raw: string): string;
export declare function classifyValidatorTier(gate: string): ValidatorTier;
/**
 * TASK-AAO-0017 follow-up：判斷一個 validator 是否為 closure-required（會阻擋 tasks close）。
 * - focused tier：typecheck、validate:cli、validate:* 等每次 task 必須重跑的 gate
 * - release tier：只有 release 變更會出現的 gate（已動態加入 requiredGates）
 * - batch tier：framework 健康類 advisory gate（doctor、framework-development、
 *   tasks-audit、git-head-evidence），不應被 evidence missing 當作 hard block
 * - task card 顯式宣告的 validator 一律視為 closure-required
 */
export declare function isClosureRequiredValidator(gate: string, taskDeclaredValidators: readonly string[], scopePaths?: readonly string[]): boolean;
/** 依 gate 名稱回傳對應的執行指令（human-readable 提示用） */
export declare function resolveValidatorExpectedCommand(gate: string): string;
export declare function looksLikeLiteralValidatorCommand(value: string): boolean;
export declare function detectAutoLinkedValidator(command: string): string | null;
