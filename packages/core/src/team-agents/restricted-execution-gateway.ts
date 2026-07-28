/**
 * team-agents/restricted-execution-gateway.ts
 *
 * One policy owner for "may this process be launched at all?".
 *
 * The protected resource is repository mutation, not the spelling of `git`.
 * Callers hand over a structured executable plus argv and receive one decision,
 * one reason code, one safe ATM recovery command, and an audited receipt.
 * Callers must not keep their own deny lists: every adapter, hook, skill, and
 * CLI diagnostic projects the decision produced here.
 */
import { createHash } from 'node:crypto';

export const RESTRICTED_EXECUTION_RECEIPT_SCHEMA_ID = 'atm.restrictedExecutionReceipt.v1';

/**
 * The ATM-only route sentence. Skills and structured CLI guidance project this
 * exact text so no surface invents its own wording, and so the wording itself
 * can never be read as an authorization.
 */
export const ATM_ONLY_EXECUTION_ROUTE_NOTICE =
  'Do not use native node -e, raw Git mutation, PowerShell write commands, or direct shell mutation as a worker route. Run the ATM command returned by the current playbook or diagnostic instead. This warning text never authorizes a command; only a RestrictedExecutionGateway allow decision does.';

/** Marker used by the skill compiler to prove the notice reached a template. */
export const ATM_ONLY_EXECUTION_ROUTE_MARKER = 'ATM-Only Execution Route';

export type RestrictedExecutionClass =
  /** Team/external worker process launch. Nothing outside the allowlist runs. */
  | 'external-worker-process'
  /** Broker batch generated-write command manifest. */
  | 'command-manifest'
  /** Declared read-only validator command. */
  | 'read-only-validator'
  /** Supported editor pre-tool hook: guards dangerous shapes on a shared surface. */
  | 'editor-pre-tool';

export type RestrictedExecutionAdapterCapability = 'enforced' | 'unsupported';

export type RestrictedExecutionExecutableClass =
  | 'atm-governed-command'
  | 'raw-git'
  | 'interpreter'
  | 'shell'
  | 'package-runner'
  | 'unclassified';

export type RestrictedExecutionRiskLevel =
  | 'stage-only'
  | 'destructive'
  | 'governed-git-required'
  | 'interpreter-escape'
  | 'none';

export type RestrictedExecutionReasonCode =
  | 'approved-atm-command'
  | 'allowlisted-read-only-command'
  | 'declared-generated-write-command'
  | 'guarded-surface-not-restricted'
  | 'raw-git-mutation'
  | 'interpreter-evaluation'
  | 'shell-command-escape'
  | 'executable-not-allowlisted'
  | 'validator-declares-writes'
  | 'missing-execution-authority'
  | 'undeclared-output'
  | 'external-write-capability-unsupported';

export interface RestrictedExecutionRequest {
  readonly actor?: string | null;
  readonly taskId?: string | null;
  readonly laneSessionId?: string | null;
  readonly executionClass: RestrictedExecutionClass;
  readonly executable: string;
  readonly argv?: readonly string[];
  readonly cwd?: string | null;
  readonly declaredOutputs?: readonly string[];
  /**
   * Whether the calling adapter can actually stop the process before launch.
   * An adapter that cannot enforce pre-tool policy must pass `unsupported`;
   * it then never receives an external-write allow.
   */
  readonly adapterCapability?: RestrictedExecutionAdapterCapability;
  readonly now?: string;
}

export interface RestrictedExecutionReceipt {
  readonly schemaId: typeof RESTRICTED_EXECUTION_RECEIPT_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly decision: 'allow' | 'deny';
  readonly reasonCode: RestrictedExecutionReasonCode;
  readonly executionClass: RestrictedExecutionClass;
  readonly executableClass: RestrictedExecutionExecutableClass;
  readonly normalizedExecutable: string;
  readonly normalizedArgvClass: readonly string[];
  readonly riskLevel: RestrictedExecutionRiskLevel;
  readonly actor: string | null;
  readonly taskId: string | null;
  readonly laneSessionId: string | null;
  readonly cwd: string | null;
  readonly declaredOutputs: readonly string[];
  readonly adapterCapability: RestrictedExecutionAdapterCapability;
  readonly approvedAtmCommand: string;
  readonly atmOnlyRouteNotice: typeof ATM_ONLY_EXECUTION_ROUTE_NOTICE;
  /** Text can never grant permission; recorded so audits can prove it. */
  readonly overridePolicy: { readonly promptTextAccepted: false; readonly environmentVariableAccepted: false };
  readonly requestDigest: `sha256:${string}`;
  readonly evaluatedAt: string;
}

export interface RestrictedExecutionEvaluation {
  readonly decision: 'allow' | 'deny';
  readonly reasonCode: RestrictedExecutionReasonCode;
  readonly approvedAtmCommand: string;
  readonly receipt: RestrictedExecutionReceipt;
}

/**
 * Adapters that own a blocking pre-tool surface. Everything else advertises
 * `unsupported` so dispatch/claim admission cannot hand it external write work.
 */
const preToolEnforcingAdapterIds: readonly string[] = ['copilot', 'claude-code'];

const interpreterEvalFlags: Readonly<Record<string, readonly string[]>> = {
  node: ['-e', '--eval', '-p', '--print', '--experimental-eval'],
  deno: ['eval'],
  bun: ['-e', '--eval'],
  python: ['-c'],
  python3: ['-c'],
  ruby: ['-e'],
  perl: ['-e'],
  php: ['-r'],
  osascript: ['-e']
};

/** Any invocation of these launches an ambient command string; all are denied. */
const shellExecutables: readonly string[] = [
  'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh',
  'cmd', 'command', 'powershell', 'pwsh', 'busybox', 'env', 'xargs', 'eval'
];

const packageRunners: readonly string[] = ['npm', 'pnpm', 'yarn', 'npx', 'bunx'];

const readOnlyGitActions: readonly string[] = [
  'status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'symbolic-ref', 'ls-files',
  'merge-base', 'cat-file', 'config', 'describe', 'blame', 'shortlog', 'ls-tree',
  'name-rev', 'for-each-ref', 'reflog', 'remote', 'ls-remote', 'rev-list', 'grep', 'whatchanged'
];

const guardedGitActions: readonly string[] = [
  'add', 'restore', 'reset', 'checkout', 'switch', 'clean', 'rm', 'mv', 'update-index',
  'read-tree', 'commit', 'push', 'stash', 'merge', 'rebase', 'cherry-pick', 'revert',
  'apply', 'am', 'update-ref', 'commit-tree', 'write-tree', 'filter-branch', 'worktree', 'gc', 'prune'
];

/**
 * Read-only validator scripts must match one of these declared prefixes. A bare
 * `scripts/` prefix is deliberately not enough: most generator scripts write.
 */
const readOnlyScriptRoots: readonly string[] = ['tests/', 'test/', 'scripts/validate-', 'scripts/audit-'];

const readOnlyNpmScriptPattern = /^(?:validate:|test|typecheck|lint|build:check)/;

export function describeRestrictedExecutionAdapterCapability(adapterId: string | null | undefined): RestrictedExecutionAdapterCapability {
  const normalized = String(adapterId ?? '').trim().toLowerCase();
  return preToolEnforcingAdapterIds.includes(normalized) ? 'enforced' : 'unsupported';
}

export function evaluateRestrictedExecution(request: RestrictedExecutionRequest): RestrictedExecutionEvaluation {
  const executable = normalizeExecutable(request.executable);
  const argv = (request.argv ?? []).map((entry) => String(entry ?? ''));
  const actor = normalizeIdentity(request.actor);
  const taskId = normalizeIdentity(request.taskId);
  const laneSessionId = normalizeIdentity(request.laneSessionId);
  const cwd = normalizeIdentity(request.cwd);
  const declaredOutputs = [...new Set((request.declaredOutputs ?? []).map(normalizeRepoPath).filter(Boolean))].sort();
  const adapterCapability = request.adapterCapability
    ?? (request.executionClass === 'editor-pre-tool' ? 'unsupported' : 'enforced');
  const classification = classifyExecutable(executable, argv);
  const strictness = strictnessFor(request.executionClass);

  const deny = (reasonCode: RestrictedExecutionReasonCode, riskLevel: RestrictedExecutionRiskLevel) =>
    finalize('deny', reasonCode, riskLevel);
  const allow = (reasonCode: RestrictedExecutionReasonCode) => finalize('allow', reasonCode, 'none');

  function finalize(
    decision: 'allow' | 'deny',
    reasonCode: RestrictedExecutionReasonCode,
    riskLevel: RestrictedExecutionRiskLevel
  ): RestrictedExecutionEvaluation {
    const approvedAtmCommand = resolveApprovedAtmCommand(reasonCode, classification, { actor, taskId });
    const receipt: RestrictedExecutionReceipt = {
      schemaId: RESTRICTED_EXECUTION_RECEIPT_SCHEMA_ID,
      specVersion: '0.1.0',
      decision,
      reasonCode,
      executionClass: request.executionClass,
      executableClass: classification.executableClass,
      normalizedExecutable: executable,
      normalizedArgvClass: classification.argvClass,
      riskLevel,
      actor,
      taskId,
      laneSessionId,
      cwd,
      declaredOutputs,
      adapterCapability,
      approvedAtmCommand,
      atmOnlyRouteNotice: ATM_ONLY_EXECUTION_ROUTE_NOTICE,
      overridePolicy: { promptTextAccepted: false, environmentVariableAccepted: false },
      requestDigest: digestRequest({
        executionClass: request.executionClass,
        executable,
        argvClass: classification.argvClass,
        actor,
        taskId,
        laneSessionId,
        declaredOutputs
      }),
      evaluatedAt: request.now ?? new Date().toISOString()
    };
    return { decision, reasonCode, approvedAtmCommand, receipt };
  }

  // 1. Absolute command-shape denials. No actor, lane, phrase, or environment
  //    variable can reach past this point.
  if (classification.executableClass === 'shell') {
    return deny('shell-command-escape', 'interpreter-escape');
  }
  if (classification.interpreterEvaluation) {
    return deny('interpreter-evaluation', 'interpreter-escape');
  }
  if (classification.executableClass === 'raw-git' && classification.gitRisk !== 'none') {
    return deny('raw-git-mutation', classification.gitRisk);
  }

  // 2. Approved ATM commands are the only normal mutation route.
  if (classification.executableClass === 'atm-governed-command') {
    if (requiresExecutionAuthority(request.executionClass)) {
      if (adapterCapability !== 'enforced') return deny('external-write-capability-unsupported', 'none');
      if (!actor || !taskId || !laneSessionId) return deny('missing-execution-authority', 'none');
    }
    if (request.executionClass === 'command-manifest' && declaredOutputs.length === 0) {
      return deny('undeclared-output', 'none');
    }
    return allow('approved-atm-command');
  }

  // 3. Narrow read-only allowlist. A validator that declares writes is not a
  //    read-only validator; it must become an ATM-governed command class.
  if (classification.readOnly) {
    if (request.executionClass === 'read-only-validator') {
      if (declaredOutputs.length > 0) return deny('validator-declares-writes', 'none');
      if (!cwd) return deny('missing-execution-authority', 'none');
    }
    return allow('allowlisted-read-only-command');
  }

  // 4. Declared generated writes (build/projection manifests). These mutate, so
  //    they need full authority plus an observable output contract. They are
  //    never a generic interpreter or shell escape: those already denied above.
  if (request.executionClass === 'command-manifest' && classification.declaredWriteCandidate) {
    if (adapterCapability !== 'enforced') return deny('external-write-capability-unsupported', 'none');
    if (!actor || !taskId || !laneSessionId) return deny('missing-execution-authority', 'none');
    if (declaredOutputs.length === 0) return deny('undeclared-output', 'none');
    return allow('declared-generated-write-command');
  }

  // 5. Everything else. Strict surfaces fail closed; the shared editor surface
  //    reports "not restricted" and leaves the remaining hook gates in charge.
  if (strictness === 'default-deny') {
    return deny('executable-not-allowlisted', 'none');
  }
  return allow('guarded-surface-not-restricted');
}

export const restrictedExecutionGateway = { evaluate: evaluateRestrictedExecution } as const;

export interface RestrictedExecutionPolicyProjection {
  readonly schemaId: 'atm.restrictedExecutionGuidance.v1';
  readonly specVersion: '0.1.0';
  readonly notice: typeof ATM_ONLY_EXECUTION_ROUTE_NOTICE;
  readonly approvedRoute: string;
  readonly deniedExamples: readonly {
    readonly command: string;
    readonly reasonCode: RestrictedExecutionReasonCode;
    readonly approvedAtmCommand: string;
  }[];
  readonly overridePolicy: { readonly promptTextAccepted: false; readonly environmentVariableAccepted: false };
}

/**
 * Read-only projection for skills, `next`, and hook recovery output. Callers
 * render these entries; they never maintain their own deny list. Each entry is
 * produced by actually running the sample through `evaluate`, so guidance text
 * cannot drift away from enforcement.
 */
export function describeRestrictedExecutionPolicy(now?: string): RestrictedExecutionPolicyProjection {
  const samples: readonly { readonly command: string; readonly executable: string; readonly argv: readonly string[] }[] = [
    { command: 'git commit -m "..."', executable: 'git', argv: ['commit', '-m', '...'] },
    { command: 'git push origin main', executable: 'git', argv: ['push', 'origin', 'main'] },
    { command: 'node -e "require(\'fs\').writeFileSync(...)"', executable: 'node', argv: ['-e', 'require("fs").writeFileSync(...)'] },
    { command: 'powershell -Command Set-Content ...', executable: 'powershell', argv: ['-Command', 'Set-Content'] },
    { command: 'cmd /c ...', executable: 'cmd', argv: ['/c', '...'] },
    { command: 'bash -c "..."', executable: 'bash', argv: ['-c', '...'] }
  ];
  const deniedExamples = samples
    .map((sample) => ({ sample, evaluation: evaluateRestrictedExecution({ executionClass: 'external-worker-process', executable: sample.executable, argv: sample.argv, now }) }))
    .filter((entry) => entry.evaluation.decision === 'deny')
    .map((entry) => ({
      command: entry.sample.command,
      reasonCode: entry.evaluation.reasonCode,
      approvedAtmCommand: entry.evaluation.approvedAtmCommand
    }));
  return {
    schemaId: 'atm.restrictedExecutionGuidance.v1',
    specVersion: '0.1.0',
    notice: ATM_ONLY_EXECUTION_ROUTE_NOTICE,
    approvedRoute: 'Run the ATM command returned by the current playbook, diagnostic, or recovery hint. The exact command is context-specific and must not be invented by prose.',
    deniedExamples,
    overridePolicy: { promptTextAccepted: false, environmentVariableAccepted: false }
  };
}

// ─── Private ───────────────────────────────────────────────────────────────

interface ExecutableClassification {
  readonly executableClass: RestrictedExecutionExecutableClass;
  readonly argvClass: readonly string[];
  readonly interpreterEvaluation: boolean;
  readonly readOnly: boolean;
  /** A structured build/projection command that may write its declared outputs. */
  readonly declaredWriteCandidate: boolean;
  readonly gitRisk: RestrictedExecutionRiskLevel;
  readonly gitAction: string | null;
}

function strictnessFor(executionClass: RestrictedExecutionClass): 'default-deny' | 'guarded-surface' {
  return executionClass === 'editor-pre-tool' ? 'guarded-surface' : 'default-deny';
}

function requiresExecutionAuthority(executionClass: RestrictedExecutionClass): boolean {
  return executionClass === 'external-worker-process' || executionClass === 'command-manifest';
}

function classifyExecutable(executable: string, argv: readonly string[]): ExecutableClassification {
  const base = {
    argvClass: argv.map(classifyArgvToken),
    interpreterEvaluation: false,
    readOnly: false,
    declaredWriteCandidate: false,
    gitRisk: 'none' as RestrictedExecutionRiskLevel,
    gitAction: null as string | null
  };

  if (shellExecutables.includes(executable)) {
    return { ...base, executableClass: 'shell' };
  }

  if (executable === 'git') {
    const gitArgs = stripGitGlobalOptions(argv);
    const action = String(gitArgs[0] ?? '').toLowerCase();
    if (readOnlyGitActions.includes(action)) {
      return { ...base, executableClass: 'raw-git', readOnly: true, gitAction: action };
    }
    const gitRisk: RestrictedExecutionRiskLevel = guardedGitActions.includes(action)
      ? classifyGitRisk(action, gitArgs.slice(1))
      : action
        ? 'governed-git-required'
        : 'none';
    return { ...base, executableClass: 'raw-git', gitRisk, gitAction: action || null };
  }

  const evalFlags = interpreterEvalFlags[executable];
  if (evalFlags) {
    if (isAtmGovernedInvocation(argv)) {
      return { ...base, executableClass: 'atm-governed-command' };
    }
    const interpreterEvaluation = argv.some((entry) => matchesEvalFlag(entry, evalFlags));
    const scriptPath = interpreterEvaluation ? null : findScriptPathArgument(argv);
    return {
      ...base,
      executableClass: 'interpreter',
      interpreterEvaluation,
      readOnly: Boolean(scriptPath) && isReadOnlyScriptRoot(scriptPath!) && executable === 'node',
      declaredWriteCandidate: Boolean(scriptPath)
    };
  }

  if (executable === 'atm' || isAtmGovernedInvocation([executable, ...argv])) {
    return { ...base, executableClass: 'atm-governed-command' };
  }

  if (packageRunners.includes(executable)) {
    return {
      ...base,
      executableClass: 'package-runner',
      readOnly: isAllowlistedReadOnlyPackageScript(argv),
      declaredWriteCandidate: isStructuredPackageScript(argv)
    };
  }

  if (executable === 'tsc') {
    return { ...base, executableClass: 'unclassified', readOnly: argv.includes('--noEmit') };
  }

  return { ...base, executableClass: 'unclassified' };
}

/**
 * `-e`, `--eval`, `--eval=...`, and bundled short forms such as `-pe` all
 * evaluate an inline program; matching only the exact flag string is the
 * loophole this normalization closes.
 */
function matchesEvalFlag(token: string, evalFlags: readonly string[]): boolean {
  const value = token.trim();
  if (!value) return false;
  for (const flag of evalFlags) {
    if (value === flag) return true;
    if (flag.startsWith('--') && value.startsWith(`${flag}=`)) return true;
    if (!flag.startsWith('--') && flag.startsWith('-') && flag.length === 2 && /^-[A-Za-z]+$/.test(value)) {
      if (value.slice(1).includes(flag.slice(1))) return true;
    }
  }
  return false;
}

function isAtmGovernedInvocation(tokens: readonly string[]): boolean {
  return tokens.some((token) => /(?:^|[\\/])atm(?:\.dev)?\.mjs$/i.test(String(token ?? '').trim()));
}

function findScriptPathArgument(argv: readonly string[]): string | null {
  return argv.map(normalizeRepoPath).find((entry) => /\.(?:ts|mts|cts|js|mjs|cjs)$/i.test(entry)) ?? null;
}

function isReadOnlyScriptRoot(scriptPath: string): boolean {
  return readOnlyScriptRoots.some((root) => scriptPath.toLowerCase().startsWith(root));
}

function isStructuredPackageScript(argv: readonly string[]): boolean {
  const tokens = argv.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  return tokens[0]?.toLowerCase() === 'run' && Boolean(tokens[1]);
}

function isAllowlistedReadOnlyPackageScript(argv: readonly string[]): boolean {
  const tokens = argv.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  const head = tokens[0]?.toLowerCase();
  if (head !== 'run' && head !== 'test' && head !== 'exec') return false;
  if (head === 'test') return tokens.length === 1;
  if (head === 'exec') return false;
  const script = tokens[1] ?? '';
  return readOnlyNpmScriptPattern.test(script);
}

function classifyGitRisk(action: string, args: readonly string[]): RestrictedExecutionRiskLevel {
  if (action === 'commit' || action === 'push') return 'governed-git-required';
  if (action === 'add') return 'stage-only';
  if (action === 'restore') return args.includes('--staged') && !args.includes('--worktree') ? 'stage-only' : 'destructive';
  if (action === 'reset') return args.includes('--hard') || args.includes('--merge') || args.includes('--keep') ? 'destructive' : 'stage-only';
  return 'destructive';
}

function stripGitGlobalOptions(args: readonly string[]): readonly string[] {
  const output = args.map((entry) => String(entry ?? '')).filter((entry) => entry.length > 0);
  while (output.length > 0) {
    const head = output[0]!;
    if (head === '-C' || head === '-c' || head === '--git-dir' || head === '--work-tree' || head === '--namespace') {
      output.splice(0, 2);
      continue;
    }
    if (head.startsWith('-c') && head.length > 2) {
      output.shift();
      continue;
    }
    break;
  }
  return output;
}

function resolveApprovedAtmCommand(
  reasonCode: RestrictedExecutionReasonCode,
  classification: ExecutableClassification,
  identity: { readonly actor: string | null; readonly taskId: string | null }
): string {
  const actor = identity.actor ?? '<actor-id>';
  const taskId = identity.taskId ?? '<task-id>';
  if (reasonCode === 'raw-git-mutation') {
    if (classification.gitAction === 'commit') {
      return `node atm.mjs git commit --actor ${actor} --task ${taskId} --message "<message>" --json`;
    }
    if (classification.gitAction === 'push') {
      return `node atm.mjs git push --actor ${actor} --task ${taskId} --branch <branch> --remote <remote> --json`;
    }
    if (classification.gitRisk === 'stage-only') {
      return `node atm.mjs git stage --actor ${actor} --task ${taskId} --paths <paths> --json`;
    }
    return `node atm.mjs git lease destructive-override --actor ${actor} --task ${taskId} --paths <paths> --reason <reason> --json`;
  }
  if (reasonCode === 'missing-execution-authority' || reasonCode === 'external-write-capability-unsupported') {
    return `node atm.mjs next --claim --actor ${actor} --task ${taskId} --json`;
  }
  return 'node atm.mjs next --prompt "<current user prompt>" --json';
}

function classifyArgvToken(token: string): string {
  const value = String(token ?? '').trim();
  if (!value) return 'empty';
  if (value.startsWith('--')) return value.split('=')[0]!;
  if (value.startsWith('-')) return value;
  if (/[\\/]/.test(value) || /\.[A-Za-z0-9]+$/.test(value)) return 'path-like';
  if (value.length > 40 || /[;&|<>$`]/.test(value)) return 'program-text';
  return 'word';
}

function normalizeExecutable(value: string): string {
  const raw = String(value ?? '').trim().replace(/^["']|["']$/g, '');
  if (!raw) return '';
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? raw;
  return base.replace(/\.(?:exe|cmd|bat|ps1)$/i, '').toLowerCase();
}

function normalizeIdentity(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRepoPath(value: string): string {
  return String(value ?? '').replace(/\\/g, '/').trim().replace(/^\.\//, '');
}

function digestRequest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
