import { createHash } from 'node:crypto';

export type FirstLayerIntent = 'backlog' | 'audit' | 'optimization' | 'create';

export interface FirstLayerRouteMatrixRow {
  readonly intent: FirstLayerIntent;
  readonly promptFixtures: readonly string[];
  readonly matchedTerms: readonly string[];
  readonly route: 'docs-first' | 'create-atom';
  readonly command: string;
  readonly authority: string;
  readonly negativeCase: string;
}

export interface FirstLayerTicketState {
  readonly state: string;
  readonly errorCode: string | null;
  readonly nextAction: string;
  readonly statusCommand: string;
  readonly continuation: string;
}

export const firstLayerRouteMatrix: readonly FirstLayerRouteMatrixRow[] = Object.freeze([
  {
    intent: 'backlog',
    promptFixtures: [
      'record this ATM bug in the backlog',
      'add an optimization backlog item for release retry friction'
    ],
    matchedTerms: ['bug backlog', 'backlog', 'optimization backlog'],
    route: 'docs-first',
    command: 'node atm.mjs guide first-layer --json',
    authority: 'ATM bug backlog router or host project backlog policy; do not use atom birth.',
    negativeCase: 'Must not route to create-atom unless the prompt explicitly asks to create a new atom.'
  },
  {
    intent: 'audit',
    promptFixtures: [
      'audit the task cards and report governance residue',
      'run a governance audit for stale close evidence'
    ],
    matchedTerms: ['audit', 'governance audit', 'task audit'],
    route: 'docs-first',
    command: 'node atm.mjs tasks audit --json',
    authority: 'Read-only task ledger and governance evidence audit.',
    negativeCase: 'Must not route to create-atom; audit work is inspection until a scoped follow-up task exists.'
  },
  {
    intent: 'optimization',
    promptFixtures: [
      'propose an optimization for captain routing friction',
      'optimize first layer orientation output'
    ],
    matchedTerms: ['optimization', 'optimize', 'friction'],
    route: 'docs-first',
    command: 'node atm.mjs guide first-layer --json',
    authority: 'Docs-first optimization proposal, backlog record, or scoped task card before implementation.',
    negativeCase: 'Must not route to create-atom when the prompt asks for governance/product optimization.'
  },
  {
    intent: 'create',
    promptFixtures: [
      'create a new atom for a greenfield capability',
      'birth atom for reusable parser helper'
    ],
    matchedTerms: ['create atom', 'new atom', 'birth atom'],
    route: 'create-atom',
    command: 'node atm.mjs guide create-atom --json',
    authority: 'ATM-CORE-0004 atom generator facade.',
    negativeCase: 'Must stay create-atom only for explicit atom birth, not backlog/audit/optimization prompts.'
  }
]);

export const firstLayerTicketStates: readonly FirstLayerTicketState[] = Object.freeze([
  {
    state: 'execute-now',
    errorCode: null,
    nextAction: 'Run the returned command now.',
    statusCommand: 'node atm.mjs next --json',
    continuation: 'Continue implementation or evidence work in the current lane.'
  },
  {
    state: 'batch/applyStrategy=compose',
    errorCode: null,
    nextAction: 'Claim the original batch prompt, deliver only the queue head, then checkpoint.',
    statusCommand: 'node atm.mjs batch status --json',
    continuation: 'Reads, docs, private evidence, and isolated proposals may continue; dependent code side effects wait for the queue head.'
  },
  {
    state: 'queue(position/head/health/waitedMs/release condition)',
    errorCode: null,
    nextAction: 'Wait for the named queue release condition or run the read-only status command.',
    statusCommand: 'node atm.mjs broker status --json',
    continuation: 'Reads, docs, private evidence, and isolated proposals may continue while shared writes wait.'
  },
  {
    state: 'revalidation-required',
    errorCode: null,
    nextAction: 'Rerun the named validator or evidence command before retrying the shared action.',
    statusCommand: 'node atm.mjs tasks status --task <task-id> --json',
    continuation: 'Continue read-only analysis and private notes; do not perform dependent code side effects until revalidation passes.'
  },
  {
    state: 'reconcile-required',
    errorCode: null,
    nextAction: 'Run the returned reconcile command, then rerun next or claim.',
    statusCommand: 'node atm.mjs taskflow diagnose --task <task-id> --json',
    continuation: 'Continue inspection and planning; avoid shared mutations until reconciliation succeeds.'
  },
  {
    state: 'ATM_LOCK_CONFLICT',
    errorCode: 'ATM_LOCK_CONFLICT',
    nextAction: 'Use the lock/status command to identify owner and wait, release, or request takeover through governance.',
    statusCommand: 'node atm.mjs lock status --json',
    continuation: 'Reads, docs, private evidence, and isolated proposals may continue; only intersecting dependent code side effects are restricted.'
  }
]);

export const firstLayerWindowsSafeExamples = Object.freeze({
  markdownRead: 'node -e "const fs=require(\'node:fs\'); console.log(fs.readFileSync(process.argv[1],\'utf8\').slice(0,4000))" -- <file.md>',
  textSearch: 'rg "pattern" <path>',
  fileSearch: 'rg --files <path>',
  forbiddenPattern: 'Do not recommend PowerShell range indexing or document parsing for Markdown/JSON/text planning docs.'
});

export const firstLayerCommonCommands = Object.freeze({
  release: 'node atm.mjs broker release --task <task-id> --actor <actor> --json',
  checkpoint: 'node atm.mjs batch checkpoint --actor <actor> --json',
  backlog: 'node atm.mjs guide first-layer --json',
  audit: 'node atm.mjs tasks audit --json',
  promptScopedNext: 'node atm.mjs next --prompt "<user prompt>" --json',
  fullNext: 'node atm.mjs next --prompt "<user prompt>" --verbose --json'
});

export function classifyFirstLayerIntent(goal: string): FirstLayerRouteMatrixRow | null {
  const normalized = normalizeFirstLayerText(goal);
  return firstLayerRouteMatrix.find((row) =>
    row.promptFixtures.some((fixture) => normalizeFirstLayerText(fixture) === normalized)
    || row.matchedTerms.some((term) => normalized.includes(normalizeFirstLayerText(term)))
  ) ?? null;
}

export function buildFirstLayerCommandContract() {
  const routeMatrix = firstLayerRouteMatrix;
  const routeMatrixDigest = sha256Json(routeMatrix);
  return {
    schemaId: 'atm.firstLayerCommandContract.v1',
    specVersion: '1.0.0',
    routeMatrix,
    routeMatrixDigest,
    ticketStates: firstLayerTicketStates,
    commonCommands: firstLayerCommonCommands,
    windowsSafeExamples: firstLayerWindowsSafeExamples,
    frameworkAdopterDifference: [
      'Framework repository work uses node atm.mjs next --prompt and framework-mode/taskflow close.',
      'Adopter repositories use their installed AGENTS/skills entry files and host-local task ledger.',
      'Canonical skill templates are the source; Codex/Claude/Cursor/Copilot/Gemini/Antigravity projections are generated from templates.'
    ],
    compactOrientationDefault: [
      'Default next output keeps blocker/status, recommended action, ticket state, queue/revalidation/reconcile hints, and validator summary.',
      'Use --verbose for duplicated full playbook bodies, large file lists, or complete diagnostic arrays.'
    ],
    dataDrivenDecision: {
      consumedSource: 'ATM-GOV-0196 route/usage/config summary',
      liveUsageTelemetryAvailable: false,
      claimScope: 'Deterministic fixture/contract coverage only; no live token-saving claim is made.'
    },
    rollback: [
      'Remove this contract module and rerun integration projection generation.',
      'Restore previous route matrix digest from validator evidence.',
      'Keep --verbose as the full orientation fallback.'
    ]
  };
}

function normalizeFirstLayerText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}#/_ -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sha256Json(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
