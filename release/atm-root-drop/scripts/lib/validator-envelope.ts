import crypto from 'node:crypto';

export const VALIDATOR_FAILURE_ENVELOPE_SCHEMA_ID = 'atm.validatorFailureEnvelope.v1' as const;

export interface ValidatorBlockingFinding {
  readonly code: string;
  readonly source: string;
  readonly detail: string;
  readonly file?: string;
  readonly files?: readonly string[];
  readonly requiredCommand?: string | null;
  readonly classification?: 'environment' | 'baseline' | 'current-task' | 'blocking';
  readonly data?: unknown;
}

export interface ValidatorFailureEnvelope {
  readonly schemaId: typeof VALIDATOR_FAILURE_ENVELOPE_SCHEMA_ID;
  readonly ok: boolean;
  readonly validatorName: string;
  readonly command: string;
  readonly entry: string | null;
  readonly mode: string | null;
  readonly exitCode: number;
  readonly durationMs: number | null;
  readonly requiredCommand: string | null;
  readonly blockingFindings: readonly ValidatorBlockingFinding[];
  readonly baselineFailures: readonly ValidatorBlockingFinding[];
  readonly currentTaskFailures: readonly ValidatorBlockingFinding[];
  readonly repairHints: readonly string[];
  readonly diagnostics: {
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
    readonly stdoutTail: string | null;
    readonly stderrTail: string | null;
    readonly spawnError: string | null;
    readonly classificationCodes: readonly string[];
  };
}

export interface ValidatorFailureEnvelopeInput {
  readonly validatorName: string;
  readonly command: string;
  readonly entry?: string | null;
  readonly mode?: string | null;
  readonly ok: boolean;
  readonly exitCode: number;
  readonly durationMs?: number | null;
  readonly stdout?: string | null;
  readonly stderr?: string | null;
  readonly spawnError?: string | null;
}

function normalizeCommandToken(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function canonicalizeValidatorOrCommand(raw: string): string {
  const normalized = normalizeCommandToken(raw);
  if (!normalized) return normalized;
  const lowered = normalized.toLowerCase();
  if (lowered === 'typecheck') return 'typecheck';
  if (lowered === 'git diff --check' || lowered === 'git-diff-check') return 'git diff --check';
  if (lowered === 'doctor') return 'doctor';
  if (lowered === 'framework-development') return 'framework-development';
  if (lowered === 'tasks-audit') return 'tasks-audit';
  if (lowered === 'git-head-evidence' || lowered === 'git-head-backfill') return 'git-head-evidence';
  const npmMatch = normalized.match(/^npm run (.+)$/i);
  if (npmMatch) return canonicalizeValidatorOrCommand(npmMatch[1].trim());
  const nodeScriptMatch = normalized.match(/(?:^|\s)scripts[\\/]+validate-([a-z0-9-]+)\.ts\b/i);
  if (nodeScriptMatch) return `validate:${nodeScriptMatch[1].toLowerCase()}`;
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
  return normalized;
}

function extractFlagValue(command: string, flag: string): string | null {
  const escapedFlag = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = command.match(new RegExp(`${escapedFlag}\\s+(?:\"([^\"]+)\"|'([^']+)'|([^\\s]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

function canonicalizeRequiredCommandForFingerprint(command: string | null | undefined): string | null {
  if (typeof command !== 'string' || !command.trim()) return null;
  const normalized = normalizeCommandToken(command);
  if (/^node\s+(?:--strip-types\s+)?atm(?:\.dev)?\.mjs\s+evidence\s+run\b/i.test(normalized)) {
    const validatorValue = extractFlagValue(normalized, '--validators');
    if (validatorValue) return `validator:${canonicalizeValidatorOrCommand(validatorValue)}`;
    const commandValue = extractFlagValue(normalized, '--command');
    if (commandValue) return `command:${canonicalizeValidatorOrCommand(commandValue)}`;
  }
  return canonicalizeValidatorOrCommand(normalized);
}

export function findingFingerprint(finding: ValidatorBlockingFinding): string {
  return JSON.stringify({
    code: finding.code,
    source: finding.source,
    detail: finding.detail,
    file: finding.file ?? null,
    files: [...(finding.files ?? [])].sort(),
    requiredCommand: canonicalizeRequiredCommandForFingerprint(finding.requiredCommand)
  });
}

export function collectBaselineFindingFingerprints(summary: unknown): ReadonlySet<string> {
  const fingerprints = new Set<string>();
  collectFindingsFromValue(summary, fingerprints);
  return fingerprints;
}

export function applyBaselineFailureSnapshot(
  envelope: ValidatorFailureEnvelope,
  baselineFingerprints: ReadonlySet<string>
): ValidatorFailureEnvelope {
  if (baselineFingerprints.size === 0 || envelope.blockingFindings.length === 0) return envelope;
  const blockingFindings = envelope.blockingFindings.map((finding) => {
    if (!baselineFingerprints.has(findingFingerprint(finding))) return finding;
    return {
      ...finding,
      classification: 'baseline' as const
    };
  });
  return rebuildEnvelopeClassifications(envelope, blockingFindings);
}

export function createValidatorFailureEnvelope(input: ValidatorFailureEnvelopeInput): ValidatorFailureEnvelope {
  const stdout = input.stdout ?? '';
  const stderr = input.stderr ?? '';
  const spawnError = input.spawnError ?? null;
  const blockingFindings = input.ok
    ? []
    : classifyValidatorFailure({
      ...input,
      stdout,
      stderr,
      spawnError
    });
  const baselineFailures = blockingFindings.filter(isBaselineFinding);
  const currentTaskFailures = blockingFindings.filter((finding) => !isBaselineFinding(finding) && !isEnvironmentFinding(finding));
  const requiredCommand = input.ok
    ? null
    : blockingFindings.find((finding) => finding.requiredCommand)?.requiredCommand ?? input.command;

  return {
    schemaId: VALIDATOR_FAILURE_ENVELOPE_SCHEMA_ID,
    ok: input.ok,
    validatorName: input.validatorName,
    command: input.command,
    entry: input.entry ?? null,
    mode: input.mode ?? null,
    exitCode: input.exitCode,
    durationMs: input.durationMs ?? null,
    requiredCommand,
    blockingFindings,
    baselineFailures,
    currentTaskFailures,
    repairHints: input.ok ? [] : buildRepairHints(blockingFindings, input.command),
    diagnostics: {
      stdoutSha256: sha256Text(stdout),
      stderrSha256: sha256Text(stderr),
      stdoutTail: tailOrNull(stdout),
      stderrTail: tailOrNull(stderr),
      spawnError,
      classificationCodes: blockingFindings.map((finding) => finding.code)
    }
  };
}

function rebuildEnvelopeClassifications(
  envelope: ValidatorFailureEnvelope,
  blockingFindings: readonly ValidatorBlockingFinding[]
): ValidatorFailureEnvelope {
  const baselineFailures = blockingFindings.filter(isBaselineFinding);
  const currentTaskFailures = blockingFindings.filter((finding) => !isBaselineFinding(finding) && !isEnvironmentFinding(finding));
  const actionableFindings = blockingFindings.filter((finding) => !isBaselineFinding(finding));
  const requiredCommand = envelope.ok
    ? null
    : actionableFindings.find((finding) => finding.requiredCommand)?.requiredCommand
      ?? (actionableFindings.length > 0 ? envelope.command : null);

  return {
    ...envelope,
    requiredCommand,
    blockingFindings,
    baselineFailures,
    currentTaskFailures,
    repairHints: buildRepairHints(blockingFindings, envelope.command),
    diagnostics: {
      ...envelope.diagnostics,
      classificationCodes: blockingFindings.map((finding) => finding.code)
    }
  };
}

export function classifyValidatorFailure(input: Required<Pick<ValidatorFailureEnvelopeInput,
  'validatorName' | 'command' | 'ok' | 'exitCode'
>> & {
  readonly entry?: string | null;
  readonly mode?: string | null;
  readonly durationMs?: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly spawnError: string | null;
}): readonly ValidatorBlockingFinding[] {
  const findings: ValidatorBlockingFinding[] = [];
  const payload = [input.stdout, input.stderr, input.spawnError ?? ''].filter(Boolean).join('\n');
  const lowerPayload = payload.toLowerCase();

  if (/atm_env_sandbox_git_eperm/i.test(payload) || isSandboxGitSpawnFailure(payload)) {
    findings.push({
      code: 'ATM_ENV_SANDBOX_GIT_EPERM',
      source: 'environment',
      detail: 'The validator could not spawn or access git in the current sandbox.',
      requiredCommand: input.command,
      classification: 'environment',
      data: {
        exitCode: input.exitCode,
        entry: input.entry ?? null,
        mode: input.mode ?? null,
        environmentDiagnostic: true,
        notTaskEvidenceFailure: true,
        suggestedCommands: sandboxGitRepairCommands(input.command)
      }
    });
  } else if (/spawn(?:sync)?\s+.*(?:eperm|eacces)/i.test(payload)) {
    findings.push({
      code: 'ATM_ENV_PROCESS_SPAWN_EPERM',
      source: 'environment',
      detail: 'The validator runner could not spawn a child process in the current sandbox.',
      requiredCommand: input.command,
      classification: 'environment',
      data: {
        exitCode: input.exitCode,
        entry: input.entry ?? null,
        mode: input.mode ?? null,
        environmentDiagnostic: true,
        notTaskEvidenceFailure: true,
        suggestedCommands: sandboxProcessRepairCommands(input.command)
      }
    });
  } else if (isGitIndexLockPresentFailure(payload, lowerPayload)) {
    findings.push({
      code: 'ATM_GIT_INDEX_LOCK_PRESENT',
      source: 'git-index',
      detail: 'Git reported an existing index.lock while the validator was running.',
      requiredCommand: input.command,
      classification: 'environment',
      data: {
        exitCode: input.exitCode,
        entry: input.entry ?? null,
        mode: input.mode ?? null,
        environmentDiagnostic: true,
        notTaskEvidenceFailure: true,
        suggestedCommands: [
          'Confirm no Git process is active before removing or retrying around .git/index.lock.',
          input.command
        ]
      }
    });
  } else if (isGitIndexPermissionFailure(payload, lowerPayload)) {
    findings.push({
      code: 'ATM_GIT_INDEX_PERMISSION_DENIED',
      source: 'git-index',
      detail: 'Git index access failed while the validator was running. This is an environment diagnostic, not task evidence or a task audit failure.',
      requiredCommand: input.command,
      classification: 'environment',
      data: {
        exitCode: input.exitCode,
        entry: input.entry ?? null,
        mode: input.mode ?? null,
        environmentDiagnostic: true,
        notTaskEvidenceFailure: true,
        suggestedCommands: sandboxGitRepairCommands(input.command)
      }
    });
  }

  findings.push(...extractAtmJsonFindings(input.stdout, input.stderr, input.command));

  if (findings.length === 0) {
    findings.push({
      code: 'ATM_VALIDATOR_FAILED',
      source: 'validator',
      detail: `${input.validatorName} exited with ${input.exitCode}.`,
      requiredCommand: input.command,
      classification: 'current-task',
      data: { exitCode: input.exitCode, entry: input.entry ?? null, mode: input.mode ?? null }
    });
  }

  return dedupeFindings(findings);
}

function isSandboxGitSpawnFailure(payload: string): boolean {
  return /spawnsync\s+git(?:\.exe)?\s+(?:eperm|eacces)/i.test(payload)
    || /error:\s+spawn\s+git(?:\.exe)?\s+(?:eperm|eacces)/i.test(payload);
}

function isGitIndexLockPresentFailure(payload: string, lowerPayload: string): boolean {
  return /(?:^|[\\/])\.git[\\/]+index\.lock/i.test(payload)
    && /file exists|already exists|unable to create/i.test(lowerPayload)
    && !/permission denied|eperm|eacces/i.test(payload);
}

function isGitIndexPermissionFailure(payload: string, lowerPayload: string): boolean {
  return /(?:^|[\\/])?\.?git[\\/]+index\.lock|index\.lock/i.test(payload)
    && /permission denied|eperm|eacces|unable to create/i.test(lowerPayload);
}

export function summarizeBlockingFindings(envelopes: readonly ValidatorFailureEnvelope[]): readonly ValidatorBlockingFinding[] {
  return dedupeFindings(envelopes.flatMap((envelope) => envelope.blockingFindings));
}

export function firstRequiredCommand(envelopes: readonly ValidatorFailureEnvelope[]): string | null {
  return envelopes.find((envelope) => envelope.requiredCommand)?.requiredCommand ?? null;
}

function extractAtmJsonFindings(stdout: string, stderr: string, fallbackCommand: string): readonly ValidatorBlockingFinding[] {
  const findings: ValidatorBlockingFinding[] = [];
  for (const parsed of parseJsonCandidates(stdout, stderr)) {
    findings.push(...extractClassifiedFindings(parsed, 'baselineFailures', 'baseline', fallbackCommand));
    findings.push(...extractClassifiedFindings(parsed, 'currentTaskFailures', 'current-task', fallbackCommand));
    const messages = Array.isArray((parsed as any).messages) ? (parsed as any).messages : [];
    for (const message of messages) {
      const data = typeof message === 'object' && message ? (message as any).data : null;
      const nestedFindings = Array.isArray(data?.blockingFindings) ? data.blockingFindings : [];
      for (const nested of nestedFindings) {
        if (!nested || typeof nested !== 'object') continue;
        findings.push({
          code: String((nested as any).code ?? 'ATM_GATE_BLOCKING_FINDING'),
          source: String((nested as any).source ?? 'atm-gate'),
          detail: String((nested as any).detail ?? 'ATM gate reported a blocking finding.'),
          file: typeof (nested as any).file === 'string' ? (nested as any).file : undefined,
          files: Array.isArray((nested as any).files) ? (nested as any).files.map(String) : undefined,
          requiredCommand: typeof (nested as any).requiredCommand === 'string' ? (nested as any).requiredCommand : null,
          classification: normalizeClassification((nested as any).classification),
          data: nested
        });
      }
      const code = typeof message?.code === 'string' ? message.code : null;
      if (!code || code === 'ATM_HOOK_PRE_COMMIT_FAILED') continue;
      const level = typeof message?.level === 'string' ? message.level : null;
      if (level !== 'error') continue;
      findings.push({
        code,
        source: 'atm-gate',
        detail: typeof message.text === 'string' ? message.text : 'ATM gate returned an error message.',
        requiredCommand: extractRequiredCommand(parsed, data) ?? fallbackCommand,
        classification: normalizeClassification((data as any)?.classification),
        data: message
      });
    }
  }
  return findings;
}

function extractClassifiedFindings(
  parsed: unknown,
  fieldName: 'baselineFailures' | 'currentTaskFailures',
  classification: 'baseline' | 'current-task',
  fallbackCommand: string
): readonly ValidatorBlockingFinding[] {
  const rawFindings = (parsed as any)?.[fieldName];
  if (!Array.isArray(rawFindings)) return [];
  return rawFindings
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      code: String((entry as any).code ?? (classification === 'baseline' ? 'ATM_VALIDATOR_BASELINE_FAILURE' : 'ATM_VALIDATOR_CURRENT_TASK_FAILURE')),
      source: String((entry as any).source ?? (classification === 'baseline' ? 'baseline' : 'validator')),
      detail: String((entry as any).detail ?? (classification === 'baseline' ? 'Unrelated baseline validator failure.' : 'Current task validator failure.')),
      file: typeof (entry as any).file === 'string' ? (entry as any).file : undefined,
      files: Array.isArray((entry as any).files) ? (entry as any).files.map(String) : undefined,
      requiredCommand: typeof (entry as any).requiredCommand === 'string' ? (entry as any).requiredCommand : fallbackCommand,
      classification,
      data: entry
    }));
}

function normalizeClassification(value: unknown): ValidatorBlockingFinding['classification'] | undefined {
  if (value === 'environment' || value === 'baseline' || value === 'current-task' || value === 'blocking') return value;
  return undefined;
}

function isBaselineFinding(finding: ValidatorBlockingFinding): boolean {
  return finding.classification === 'baseline' || finding.source === 'baseline';
}

function isEnvironmentFinding(finding: ValidatorBlockingFinding): boolean {
  return finding.classification === 'environment'
    || finding.source === 'environment'
    || finding.source === 'git-index'
    || finding.code.startsWith('ATM_ENV_')
    || finding.code.startsWith('ATM_GIT_INDEX_');
}

function extractRequiredCommand(parsed: unknown, data: unknown): string | null {
  if (data && typeof data === 'object') {
    const requiredCommand = (data as any).requiredCommand ?? (data as any).nextStep;
    if (typeof requiredCommand === 'string' && requiredCommand.trim()) return requiredCommand;
  }
  const nextAction = (parsed as any)?.evidence?.nextAction;
  if (nextAction && typeof nextAction === 'object') {
    const requiredCommand = (nextAction as any).requiredCommand ?? (nextAction as any).command;
    if (typeof requiredCommand === 'string' && requiredCommand.trim()) return requiredCommand;
  }
  return null;
}

function parseJsonCandidates(stdout: string, stderr: string): readonly unknown[] {
  const values: unknown[] = [];
  for (const text of [stdout, stderr]) {
    const trimmed = text.trim();
    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) continue;
    try {
      values.push(JSON.parse(trimmed));
    } catch {
      // Validator output may be mixed text. Tail hashes still preserve evidence.
    }
  }
  return values;
}

function buildRepairHints(findings: readonly ValidatorBlockingFinding[], command: string): readonly string[] {
  if (findings.length === 0) return [`Rerun ${command}.`];
  if (findings.every(isBaselineFinding)) {
    return [
      'All validator failures match the supplied baseline. Run the focused validator for the current task, or fix the baseline separately before a release gate.'
    ];
  }
  return findings.map((finding) => {
    if (finding.code === 'ATM_ENV_SANDBOX_GIT_EPERM') {
      return `Environment issue, not task evidence: rerun with repository-level permissions, or use PowerShell: $env:ATM_TEMP_ROOT="C:\\tmp"; ${command}`;
    }
    if (finding.code === 'ATM_ENV_PROCESS_SPAWN_EPERM') {
      return `Environment issue, not task evidence: rerun with repository-level permissions so the validator can spawn child processes: ${command}`;
    }
    if (finding.code === 'ATM_GIT_INDEX_LOCK_PRESENT') {
      return 'Confirm no Git process is active, resolve the stale .git/index.lock condition, then rerun the validator.';
    }
    if (finding.code === 'ATM_GIT_INDEX_PERMISSION_DENIED') {
      return `Environment issue, not task evidence: resolve the local Git/index permission problem, or use PowerShell: $env:ATM_TEMP_ROOT="C:\\tmp"; ${command}`;
    }
    if (finding.requiredCommand) {
      return `Run required command: ${finding.requiredCommand}`;
    }
    return `Fix ${finding.source} finding ${finding.code}, then rerun ${command}.`;
  });
}

function sandboxGitRepairCommands(command: string): readonly string[] {
  return [
    'Codex on Windows: set ~/.codex/config.toml [windows] sandbox = "elevated", restart Codex, then rerun.',
    `PowerShell temp-root retry: $env:ATM_TEMP_ROOT="C:\\tmp"; ${command}`,
    `Repository-permission retry: ${command}`
  ];
}

function sandboxProcessRepairCommands(command: string): readonly string[] {
  return [
    'Codex on Windows: set ~/.codex/config.toml [windows] sandbox = "elevated", restart Codex, then rerun.',
    `Repository-permission retry: ${command}`
  ];
}

function collectFindingsFromValue(value: unknown, fingerprints: Set<string>): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) collectFindingsFromValue(entry, fingerprints);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const fieldName of ['blockingFindings', 'baselineFailures', 'currentTaskFailures']) {
    const rawFindings = record[fieldName];
    if (!Array.isArray(rawFindings)) continue;
    for (const raw of rawFindings) {
      const finding = normalizeFindingCandidate(raw);
      if (finding) fingerprints.add(findingFingerprint(finding));
    }
  }
  const validators = record.validators;
  if (Array.isArray(validators)) {
    for (const validator of validators) {
      collectFindingsFromValue((validator as any)?.envelope ?? validator, fingerprints);
    }
  }
}

function normalizeFindingCandidate(value: unknown): ValidatorBlockingFinding | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : null;
  const source = typeof record.source === 'string' ? record.source : null;
  const detail = typeof record.detail === 'string' ? record.detail : null;
  if (!code || !source || !detail) return null;
  return {
    code,
    source,
    detail,
    file: typeof record.file === 'string' ? record.file : undefined,
    files: Array.isArray(record.files) ? record.files.map(String) : undefined,
    requiredCommand: typeof record.requiredCommand === 'string' ? record.requiredCommand : null,
    classification: normalizeClassification(record.classification),
    data: record.data
  };
}

function dedupeFindings(findings: readonly ValidatorBlockingFinding[]): readonly ValidatorBlockingFinding[] {
  const seen = new Set<string>();
  const deduped: ValidatorBlockingFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.code}\0${finding.source}\0${finding.detail}\0${finding.requiredCommand ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

function sha256Text(text: string): string {
  return `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
}

function tailOrNull(text: string, maxLength = 1600): string | null {
  if (!text) return null;
  return text.length <= maxLength ? text : text.slice(text.length - maxLength);
}
