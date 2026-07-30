/**
 * ATM-GOV-0276 — atm.task-frontmatter-fidelity
 *
 * Parser Facade / Fidelity Contract for `tasks import`.
 *
 * A task card is a governance contract, so import must either round-trip the
 * machine-readable fields a card declares or refuse the import. The failure this
 * module exists to prevent is the silent one: a card declares `causalGraph`, the
 * parser has no projection for it, and ATM writes a reduced ledger record that
 * still looks successful.
 *
 * The check is declaration-driven rather than schema-driven: it compares what the
 * card actually declared against what the produced record carries, so a field
 * added to the card contract later fails closed here before anyone remembers to
 * teach the parser about it.
 */

export type TaskFrontmatterFidelityFindingKind =
  | 'dropped-governance-field'
  | 'dropped-governance-subfield'
  | 'partial-governance-list'
  | 'unparsed-frontmatter-key';

export interface TaskFrontmatterFidelityFinding {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly kind: TaskFrontmatterFidelityFindingKind;
  /** Dotted declaration path, for example `causalGraph.softRelations`. */
  readonly field: string;
  readonly message: string;
}

export interface TaskFrontmatterFidelityReport {
  readonly schemaId: 'atm.taskFrontmatterFidelity.v1';
  readonly specVersion: '0.1.0';
  readonly ok: boolean;
  readonly checkedFields: readonly string[];
  readonly findings: readonly TaskFrontmatterFidelityFinding[];
}

export const TASK_FRONTMATTER_FIDELITY_LOSS_CODE = 'ATM_TASK_IMPORT_FRONTMATTER_FIDELITY_LOSS';
export const TASK_FRONTMATTER_UNPARSED_KEY_CODE = 'ATM_TASK_IMPORT_FRONTMATTER_KEY_UNPARSED';

interface GovernanceFieldContract {
  /** Frontmatter key plus accepted aliases, first entry is canonical. */
  readonly declarationKeys: readonly string[];
  /** Field on the produced import record that must carry the declaration. */
  readonly recordKey: string;
  /**
   * Sub-keys that must survive individually when the declaration is an object.
   * Each entry maps declaration aliases to the projected contract key.
   */
  readonly subFields?: readonly { readonly declarationKeys: readonly string[]; readonly recordKey: string }[];
}

/**
 * Machine-readable governance declarations `tasks import` promises to preserve.
 * Adding a field to a task card contract means adding it here too; that is the
 * point of the module.
 */
const GOVERNANCE_FIELD_CONTRACTS: readonly GovernanceFieldContract[] = [
  {
    declarationKeys: ['causalGraph', 'causal_graph'],
    recordKey: 'causalGraph',
    subFields: [
      { declarationKeys: ['causalDependencies', 'causal_dependencies'], recordKey: 'causalDependencies' },
      { declarationKeys: ['startConditions', 'start_conditions'], recordKey: 'startConditions' },
      { declarationKeys: ['softRelations', 'soft_relations'], recordKey: 'softRelations' },
      { declarationKeys: ['changedPublicSeams', 'changed_public_seams'], recordKey: 'changedPublicSeams' },
      { declarationKeys: ['causalImpactEdges', 'causal_impact_edges'], recordKey: 'causalImpactEdges' },
      { declarationKeys: ['parallelFrontierInputs', 'parallel_frontier_inputs'], recordKey: 'parallelFrontierInputs' },
      { declarationKeys: ['validatorReferences', 'validator_references'], recordKey: 'validatorReferences' },
      { declarationKeys: ['phaseOwner', 'phase_owner'], recordKey: 'phaseOwner' }
    ]
  },
  { declarationKeys: ['atomizationImpact', 'atomization_impact'], recordKey: 'atomizationImpact' },
  { declarationKeys: ['testContributions', 'test_contributions'], recordKey: 'testContributions' },
  { declarationKeys: ['requiredTestCaseIds', 'required_test_case_ids'], recordKey: 'requiredTestCaseIds' },
  { declarationKeys: ['advisoryTestCaseIds', 'advisory_test_case_ids'], recordKey: 'advisoryTestCaseIds' },
  { declarationKeys: ['phaseTestCaseIds', 'phase_test_case_ids'], recordKey: 'phaseTestCaseIds' }
];

/**
 * Reserved namespaces for sealed governance metadata. A top-level card key in one
 * of these namespaces that the parser silently drops is a fidelity failure even
 * when no explicit contract has been written for it yet — Plan 4.0 exam-authority
 * metadata is expected to land here.
 */
const GOVERNANCE_NAMESPACE_PATTERNS: readonly RegExp[] = [
  /^causal[A-Z_]/,
  /^causal_/,
  /^atomization[A-Z_]/,
  /^exam[A-Z_]/,
  /^exam_/,
  /TestCaseIds$/,
  /_test_case_ids$/
];

function isGovernanceNamespaceKey(key: string): boolean {
  return GOVERNANCE_NAMESPACE_PATTERNS.some((pattern) => pattern.test(key));
}

function isDeclared(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function isRepresented(value: unknown): boolean {
  return isDeclared(value);
}

function readAlias(record: Record<string, unknown> | null, keys: readonly string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    if (isDeclared(record[key])) return record[key];
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Declared plain-string list entries that never reached the projected list.
 * Object-shaped entries are skipped because projection deliberately rewrites them
 * into deterministic edge strings.
 */
function findMissingListEntries(declared: unknown, represented: unknown): readonly string[] {
  if (!Array.isArray(declared)) return [];
  const projected = new Set(
    (Array.isArray(represented) ? represented : [])
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
  );
  return declared
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !projected.has(entry));
}

/** Top-level keys physically present in the raw frontmatter block. */
export function collectRawFrontmatterKeys(planText: string): readonly string[] {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(planText);
  if (!match) return [];
  const keys: string[] = [];
  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const keyMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
    if (keyMatch && !keys.includes(keyMatch[1])) keys.push(keyMatch[1]);
  }
  return keys;
}

/**
 * Compare a card's machine-readable declarations against the record `tasks import`
 * is about to emit. `ok === false` means the import must fail closed rather than
 * write a reduced ledger record.
 */
export function inspectTaskFrontmatterFidelity(input: {
  readonly frontmatter: Record<string, unknown> | null;
  readonly record: Record<string, unknown>;
  /** Raw card text, used to detect keys the frontmatter parser never produced. */
  readonly planText?: string | null;
}): TaskFrontmatterFidelityReport {
  const frontmatter = input.frontmatter;
  const findings: TaskFrontmatterFidelityFinding[] = [];
  const checkedFields: string[] = [];

  for (const contract of GOVERNANCE_FIELD_CONTRACTS) {
    const declared = readAlias(frontmatter, contract.declarationKeys);
    if (!isDeclared(declared)) continue;
    const canonical = contract.declarationKeys[0];
    checkedFields.push(canonical);
    const represented = input.record[contract.recordKey];
    if (!isRepresented(represented)) {
      findings.push({
        code: TASK_FRONTMATTER_FIDELITY_LOSS_CODE,
        severity: 'error',
        kind: 'dropped-governance-field',
        field: canonical,
        message: `Task card declares machine-readable field \`${canonical}\`, but tasks import produced no \`${contract.recordKey}\` on the task record. Import fails closed instead of writing a reduced ledger record.`
      });
      continue;
    }
    const declaredRecord = asRecord(declared);
    const representedRecord = asRecord(represented);
    for (const subField of contract.subFields ?? []) {
      const declaredSub = readAlias(declaredRecord, subField.declarationKeys);
      if (!isDeclared(declaredSub)) continue;
      const canonicalSub = `${canonical}.${subField.declarationKeys[0]}`;
      checkedFields.push(canonicalSub);
      const representedSub = representedRecord ? representedRecord[subField.recordKey] : undefined;
      if (!isRepresented(representedSub)) {
        findings.push({
          code: TASK_FRONTMATTER_FIDELITY_LOSS_CODE,
          severity: 'error',
          kind: 'dropped-governance-subfield',
          field: canonicalSub,
          message: `Task card declares \`${canonicalSub}\`, but tasks import produced no matching \`${subField.recordKey}\` value.`
        });
        continue;
      }
      const missing = findMissingListEntries(declaredSub, representedSub);
      if (missing.length > 0) {
        findings.push({
          code: TASK_FRONTMATTER_FIDELITY_LOSS_CODE,
          severity: 'error',
          kind: 'partial-governance-list',
          field: canonicalSub,
          message: `Task card declares ${missing.length} entry/entries under \`${canonicalSub}\` that tasks import did not project: ${missing.join(', ')}.`
        });
      }
    }
    if (!contract.subFields) {
      const missing = findMissingListEntries(declared, represented);
      if (missing.length > 0) {
        findings.push({
          code: TASK_FRONTMATTER_FIDELITY_LOSS_CODE,
          severity: 'error',
          kind: 'partial-governance-list',
          field: canonical,
          message: `Task card declares ${missing.length} entry/entries under \`${canonical}\` that tasks import did not project: ${missing.join(', ')}.`
        });
      }
    }
  }

  // A reserved-namespace key that no contract covers has nowhere to land on the
  // record. Failing closed here is what forces the parser and the contract table
  // to be extended together instead of the card being silently thinned.
  const contractedKeys = new Set(GOVERNANCE_FIELD_CONTRACTS.flatMap((contract) => contract.declarationKeys));
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    if (contractedKeys.has(key) || !isGovernanceNamespaceKey(key) || !isDeclared(value)) continue;
    checkedFields.push(key);
    if (isRepresented(input.record[key])) continue;
    findings.push({
      code: TASK_FRONTMATTER_FIDELITY_LOSS_CODE,
      severity: 'error',
      kind: 'dropped-governance-field',
      field: key,
      message: `Task card declares reserved governance frontmatter key \`${key}\`, but no tasks import contract represents it. Extend the import fidelity contract instead of writing a reduced ledger record.`
    });
  }

  // A key that the frontmatter parser never produced cannot be compared against
  // the record at all, so raw text is the only place its loss is visible.
  if (input.planText) {
    const parsedKeys = new Set(Object.keys(frontmatter ?? {}));
    for (const key of collectRawFrontmatterKeys(input.planText)) {
      if (parsedKeys.has(key)) continue;
      const governance = isGovernanceNamespaceKey(key);
      findings.push({
        code: TASK_FRONTMATTER_UNPARSED_KEY_CODE,
        severity: governance ? 'error' : 'warning',
        kind: 'unparsed-frontmatter-key',
        field: key,
        message: governance
          ? `Task card declares reserved governance frontmatter key \`${key}\`, but the frontmatter parser produced no value for it. Import fails closed instead of dropping sealed governance metadata.`
          : `Frontmatter key \`${key}\` was not represented by the frontmatter parser and will not reach the task record.`
      });
    }
  }

  return {
    schemaId: 'atm.taskFrontmatterFidelity.v1',
    specVersion: '0.1.0',
    ok: findings.every((finding) => finding.severity !== 'error'),
    checkedFields,
    findings
  };
}

export interface TaskFrontmatterFidelityDiagnostic {
  readonly level: 'error' | 'warning';
  readonly code: string;
  readonly text: string;
  readonly workItemId: string;
}

/**
 * Import-surface projection of {@link inspectTaskFrontmatterFidelity}: the report
 * to attach to the task record, plus the diagnostics that make `tasks import`
 * fail closed on a fidelity loss.
 */
export function buildTaskFrontmatterFidelityDiagnostics(input: {
  readonly frontmatter: Record<string, unknown> | null;
  readonly record: Record<string, unknown>;
  readonly planText?: string | null;
  readonly workItemId: string;
}): {
  readonly report: TaskFrontmatterFidelityReport;
  readonly diagnostics: readonly TaskFrontmatterFidelityDiagnostic[];
} {
  const report = inspectTaskFrontmatterFidelity(input);
  return {
    report,
    diagnostics: report.findings.map((finding) => ({
      level: finding.severity,
      code: finding.code,
      text: finding.message,
      workItemId: input.workItemId
    }))
  };
}
