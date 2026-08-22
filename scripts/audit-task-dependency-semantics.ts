import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const CENSUS_SCHEMA_ID = 'atm.plan41DependencyCensus.v1' as const;
export const PLAN_4_1_RELATIVE =
  'docs/ai_atomic_framework/governance-optimization/end-to-end-auto-batch-performance-plan-v4-1.md';
export const PRF_SAMPLE_TASK_IDS = ['TASK-PRF-0002', 'TASK-PRF-0003'] as const;
export const CENSUS_OUTPUT_RELATIVE = 'docs/reports/atm-plan-4-1-dependency-census.json';

export type LifecycleType = 'hard-causal' | 'validation' | 'publication' | 'observation' | 'soft-order';

export interface HardCausalFacts {
  producerTaskId: string;
  producerOutputId: string;
  producerOutputAvailable: boolean;
  consumerOperation: string;
  producerChangeAffectsConsumerResult: string;
  noSubstituteExists: string;
  consumerUndefinedWithoutOutput: string;
  negativeControl: {
    blocksBeforeOutput: boolean;
    admitsAfterSealedOutput: boolean;
    command: string;
  };
}

export interface CensusEdge {
  edgeId: string;
  producer: string;
  consumer: string;
  sourceFields: string[];
  declaredAsHard: boolean;
  lifecycleType: LifecycleType;
  hardCausalProven: boolean;
  hardCausalFacts: HardCausalFacts | null;
  missingHardFacts: string[];
  rationale: string;
  planningAuthorityUnchanged: true;
}

export interface Plan41Census {
  schemaId: typeof CENSUS_SCHEMA_ID;
  specVersion: '0.1.0';
  generatedAt: string;
  planSeal: { path: string; digest: string };
  timeWindow: { startedAt: string; endedAt: string; watermark: string };
  sources: Array<{ path: string; digest: string }>;
  commits: { planning: string | null; target: string };
  sampleTaskIds: string[];
  edges: CensusEdge[];
  counts: {
    denominator: number;
    hardCausal: number;
    validation: number;
    publication: number;
    observation: number;
    softOrder: number;
    unclassified: number;
    unprovenHardDeclarations: number;
  };
  hardDependencyRate: {
    numerator: number;
    denominator: number;
    observed: number;
    quotaTargetRejected: true;
  };
  unclassifiedEdgeIds: string[];
  antiGaming: {
    quotaRelabelingDetected: false;
    rule: string;
  };
  digest: string;
}

export function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function digestCanonical(value: unknown): string {
  return digestText(canonicalJson(value));
}

export function sealWithoutDigest<T extends { digest?: string }>(document: T): string {
  const { digest: _ignored, ...rest } = document;
  return digestCanonical(rest);
}

export function gitRevParse(cwd: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

export function resolvePlanningRoot(): string {
  if (process.env.ATM_PLANNING_REPO_ROOT) {
    return resolve(process.env.ATM_PLANNING_REPO_ROOT);
  }
  return resolve('..', '3KLife');
}

export function hardCausalFactKeys(): Array<keyof HardCausalFacts | 'negativeControl.blocksBeforeOutput' | 'negativeControl.admitsAfterSealedOutput'> {
  return [
    'producerTaskId',
    'producerOutputId',
    'consumerOperation',
    'producerChangeAffectsConsumerResult',
    'noSubstituteExists',
    'consumerUndefinedWithoutOutput',
    'negativeControl.blocksBeforeOutput',
    'negativeControl.admitsAfterSealedOutput'
  ];
}

export function missingHardCausalFacts(facts: HardCausalFacts | null): string[] {
  if (!facts) {
    return [...hardCausalFactKeys()];
  }
  const missing: string[] = [];
  if (!facts.producerTaskId) missing.push('producerTaskId');
  if (!facts.producerOutputId) missing.push('producerOutputId');
  if (!facts.consumerOperation) missing.push('consumerOperation');
  if (!facts.producerChangeAffectsConsumerResult) missing.push('producerChangeAffectsConsumerResult');
  if (!facts.noSubstituteExists) missing.push('noSubstituteExists');
  if (!facts.consumerUndefinedWithoutOutput) missing.push('consumerUndefinedWithoutOutput');
  if (!facts.negativeControl?.command) missing.push('negativeControl.command');
  if (facts.negativeControl?.blocksBeforeOutput !== true) missing.push('negativeControl.blocksBeforeOutput');
  if (facts.negativeControl?.admitsAfterSealedOutput !== true) missing.push('negativeControl.admitsAfterSealedOutput');
  return missing;
}

export function evaluateHardCausalAdmission(facts: HardCausalFacts | null, producerOutputSealed: boolean): {
  claim: 'blocked' | 'allowed';
  code: 'ATM_PARALLEL_PROOF_INPUT_INVALID' | null;
  reason: string;
} {
  const missing = missingHardCausalFacts(facts);
  if (missing.length > 0) {
    return {
      claim: 'allowed',
      code: null,
      reason: 'Incomplete hard-causal declarations have no freeze authority; claim remains nonblocking.'
    };
  }
  if (!producerOutputSealed) {
    return {
      claim: 'blocked',
      code: 'ATM_PARALLEL_PROOF_INPUT_INVALID',
      reason: 'Producer output is unsealed; hard-causal consumer claim is blocked.'
    };
  }
  return {
    claim: 'allowed',
    code: null,
    reason: 'Sealed producer output admits the hard-causal consumer.'
  };
}

interface ParsedCard {
  taskId: string;
  path: string;
  digest: string;
  dependsOn: string[];
  causalDependencies: string[];
  softRelations: string[];
  startConditions: string[];
  parallelFrontierInputs: string[];
  deliverables: string[];
}

function parseYamlList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof raw !== 'string') {
    return [];
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '[]') {
    return [];
  }
  const bracket = /^\[(.*)\]$/.exec(trimmed);
  if (bracket) {
    return bracket[1].split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  return trimmed.split(/\r?\n/).map((line) => line.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
}

function parseFrontmatter(source: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) {
    return {};
  }
  const fields: Record<string, string> = {};
  let current: string | null = null;
  let parent: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (current) {
      fields[current] = buffer.join('\n').trim();
    }
  };
  for (const line of match[1].split(/\r?\n/)) {
    const nested = /^  ([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    const top = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (nested && parent) {
      flush();
      current = `${parent}.${nested[1]}`;
      buffer = [nested[2]];
      continue;
    }
    if (top && !line.startsWith(' ')) {
      flush();
      parent = top[1];
      current = top[1];
      buffer = [top[2]];
      continue;
    }
    if (current) {
      buffer.push(line);
    }
  }
  flush();
  return fields;
}

function readCard(filePath: string): ParsedCard | null {
  if (!existsSync(filePath)) {
    return null;
  }
  const source = readFileSync(filePath, 'utf8');
  const fields = parseFrontmatter(source);
  const taskId = fields.task_id?.trim();
  if (!taskId) {
    return null;
  }
  return {
    taskId,
    path: filePath.replace(/\\/g, '/'),
    digest: digestText(source),
    dependsOn: parseYamlList(fields.depends_on),
    causalDependencies: parseYamlList(fields['causalGraph.causalDependencies'] ?? fields.causalDependencies),
    softRelations: parseYamlList(fields['causalGraph.softRelations'] ?? fields.softRelations),
    startConditions: parseYamlList(fields['causalGraph.startConditions'] ?? fields.startConditions),
    parallelFrontierInputs: parseYamlList(fields['causalGraph.parallelFrontierInputs'] ?? fields.parallelFrontierInputs),
    deliverables: parseYamlList(fields.deliverables)
  };
}

function classifyDeclaredDependency(consumer: ParsedCard, producerId: string): Pick<CensusEdge, 'lifecycleType' | 'rationale'> {
  const deliverableText = consumer.deliverables.join(' ').toLowerCase();
  if (/\.github\/workflows|validate-ci|product-ci|protected-main/.test(deliverableText)) {
    return {
      lifecycleType: 'validation',
      rationale: `Declared dependency on ${producerId} waits at validate/close for a product-check basis; it does not prove the six hard-causal facts, so claim stays nonblocking.`
    };
  }
  if (/npm|package.json|publish/.test(deliverableText)) {
    return {
      lifecycleType: 'publication',
      rationale: `Declared dependency on ${producerId} is a publication-order constraint, not a hard-causal consumer of a named producer output.`
    };
  }
  return {
    lifecycleType: 'validation',
    rationale: `Declared dependency on ${producerId} lacks the six hard-causal facts. Plan 4.1 keeps unproven declarations nonblocking at claim.`
  };
}

function classifyCondition(text: string): Pick<CensusEdge, 'lifecycleType' | 'rationale'> {
  if (/green|matrix|validator|compatib|check/i.test(text)) {
    return {
      lifecycleType: 'validation',
      rationale: 'Start condition names a validator or compatibility basis; it is nonblocking at claim.'
    };
  }
  if (/captur|baseline|evidence|report|digest|frozen|source/i.test(text)) {
    return {
      lifecycleType: 'observation',
      rationale: 'Start condition is an observation or capture requirement, not a hard-causal producer output.'
    };
  }
  return {
    lifecycleType: 'observation',
    rationale: 'Unspecified start condition is treated as observation until six hard-causal facts exist.'
  };
}

function pushEdge(edges: CensusEdge[], partial: Omit<CensusEdge, 'planningAuthorityUnchanged' | 'edgeId'> & { edgeId?: string }): void {
  const edgeId = partial.edgeId ?? digestText(`${partial.producer}|${partial.consumer}|${partial.sourceFields.join(',')}`).slice(7, 23);
  const existing = edges.find((edge) => edge.producer === partial.producer && edge.consumer === partial.consumer && edge.sourceFields.join() === partial.sourceFields.join());
  if (existing) {
    return;
  }
  edges.push({
    ...partial,
    edgeId,
    planningAuthorityUnchanged: true
  });
}

export function auditPrfDependencyCensus(options: {
  planningRoot: string;
  targetRoot: string;
  generatedAt?: string;
}): Plan41Census {
  const planningRoot = resolve(options.planningRoot);
  const targetRoot = resolve(options.targetRoot);
  const tasksDir = resolve(planningRoot, 'docs/ai_atomic_framework/atm-product-proof/tasks');
  const planPath = resolve(planningRoot, PLAN_4_1_RELATIVE);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const files = existsSync(tasksDir)
    ? readdirSync(tasksDir).filter((name) => /^TASK-PRF-000[23]-.*\.task\.md$/.test(name))
    : [];
  const cards = files
    .map((name) => readCard(resolve(tasksDir, name)))
    .filter((card): card is ParsedCard => card !== null && PRF_SAMPLE_TASK_IDS.includes(card.taskId as typeof PRF_SAMPLE_TASK_IDS[number]));
  const byId = new Map(cards.map((card) => [card.taskId, card]));
  const edges: CensusEdge[] = [];

  for (const card of cards) {
    const producers = [...new Set([...card.dependsOn, ...card.causalDependencies])];
    for (const producer of producers) {
      const declaredAsHard = card.causalDependencies.includes(producer);
      const classified = classifyDeclaredDependency(card, producer);
      pushEdge(edges, {
        producer,
        consumer: card.taskId,
        sourceFields: [
          ...(card.dependsOn.includes(producer) ? ['depends_on'] : []),
          ...(card.causalDependencies.includes(producer) ? ['causalGraph.causalDependencies'] : [])
        ],
        declaredAsHard,
        lifecycleType: classified.lifecycleType,
        hardCausalProven: false,
        hardCausalFacts: null,
        missingHardFacts: missingHardCausalFacts(null),
        rationale: classified.rationale
      });
    }
    for (const related of card.softRelations) {
      pushEdge(edges, {
        producer: card.taskId,
        consumer: related,
        sourceFields: ['causalGraph.softRelations'],
        declaredAsHard: false,
        lifecycleType: 'soft-order',
        hardCausalProven: false,
        hardCausalFacts: null,
        missingHardFacts: missingHardCausalFacts(null),
        rationale: 'Soft relation is advisory ordering and remains nonblocking at claim.'
      });
    }
    card.startConditions.forEach((text, index) => {
      const classified = classifyCondition(text);
      pushEdge(edges, {
        producer: `start-condition:${card.taskId}:${index + 1}`,
        consumer: card.taskId,
        sourceFields: ['causalGraph.startConditions'],
        declaredAsHard: false,
        lifecycleType: classified.lifecycleType,
        hardCausalProven: false,
        hardCausalFacts: null,
        missingHardFacts: missingHardCausalFacts(null),
        rationale: `${classified.rationale} Text: ${text}`
      });
    });
    card.parallelFrontierInputs.forEach((input, index) => {
      pushEdge(edges, {
        producer: `frontier:${input}`,
        consumer: card.taskId,
        sourceFields: ['causalGraph.parallelFrontierInputs'],
        declaredAsHard: false,
        lifecycleType: 'observation',
        hardCausalProven: false,
        hardCausalFacts: null,
        missingHardFacts: missingHardCausalFacts(null),
        rationale: `Parallel frontier input ${input} is observational and cannot freeze claim.`
      });
    });
  }

  const counts = {
    denominator: edges.length,
    hardCausal: edges.filter((edge) => edge.lifecycleType === 'hard-causal' && edge.hardCausalProven).length,
    validation: edges.filter((edge) => edge.lifecycleType === 'validation').length,
    publication: edges.filter((edge) => edge.lifecycleType === 'publication').length,
    observation: edges.filter((edge) => edge.lifecycleType === 'observation').length,
    softOrder: edges.filter((edge) => edge.lifecycleType === 'soft-order').length,
    unclassified: 0,
    unprovenHardDeclarations: edges.filter((edge) => edge.declaredAsHard && !edge.hardCausalProven).length
  };
  const unclassifiedEdgeIds: string[] = [];
  let planningCommit: string | null = null;
  try {
    planningCommit = gitRevParse(planningRoot);
  } catch {
    planningCommit = null;
  }
  const census: Plan41Census = {
    schemaId: CENSUS_SCHEMA_ID,
    specVersion: '0.1.0',
    generatedAt,
    planSeal: {
      path: PLAN_4_1_RELATIVE,
      digest: existsSync(planPath) ? digestText(readFileSync(planPath, 'utf8')) : digestText('missing-plan')
    },
    timeWindow: {
      startedAt: generatedAt,
      endedAt: generatedAt,
      watermark: gitRevParse(targetRoot)
    },
    sources: [
      ...cards.map((card) => ({ path: card.path, digest: card.digest })),
      ...(existsSync(planPath) ? [{ path: planPath.replace(/\\/g, '/'), digest: digestText(readFileSync(planPath, 'utf8')) }] : [])
    ],
    commits: {
      planning: planningCommit,
      target: gitRevParse(targetRoot)
    },
    sampleTaskIds: [...PRF_SAMPLE_TASK_IDS],
    edges,
    counts,
    hardDependencyRate: {
      numerator: counts.hardCausal,
      denominator: counts.denominator,
      observed: counts.denominator === 0 ? 0 : counts.hardCausal / counts.denominator,
      quotaTargetRejected: true
    },
    unclassifiedEdgeIds,
    antiGaming: {
      quotaRelabelingDetected: false,
      rule: 'Hard-dependency rate is observed proven six-fact edges over all classified edges. Declared causalDependencies without six facts stay nonblocking and are not relabelled to chase any percentage target.'
    },
    digest: 'sha256:' + '0'.repeat(64)
  };
  census.digest = sealWithoutDigest(census);
  void byId;
  void basename;
  return census;
}

export function writeCensus(census: Plan41Census, targetRoot: string): string {
  const output = resolve(targetRoot, CENSUS_OUTPUT_RELATIVE);
  writeFileSync(output, `${JSON.stringify(census, null, 2)}\n`, 'utf8');
  return output;
}

const invoked = process.argv[1] && /audit-task-dependency-semantics\.ts$/.test(process.argv[1].replace(/\\/g, '/'));
if (invoked && !process.argv.includes('--module')) {
  const targetRoot = resolve(process.cwd());
  const census = auditPrfDependencyCensus({
    planningRoot: resolvePlanningRoot(),
    targetRoot
  });
  const output = writeCensus(census, targetRoot);
  process.stdout.write(`${JSON.stringify({ ok: true, output, digest: census.digest, counts: census.counts }, null, 2)}\n`);
}
