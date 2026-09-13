import { createHash } from 'node:crypto';

export type BenchmarkArm = 'atm' | 'baseline';
export type BenchmarkStage = 'pilot' | 'formal' | 'replication' | 'product';

export interface PairedRun {
  readonly pairId: string;
  readonly runId: string;
  readonly arm: BenchmarkArm;
  readonly order: number;
  readonly seed: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string;
  readonly budget: number;
  readonly promptDigest: string;
  readonly repoDigest: string;
  readonly sessionId: string;
  readonly command: string;
  readonly rawRef: string;
  readonly status: 'completed' | 'failed' | 'timeout' | 'cancelled';
}

export interface PairedPacket {
  readonly schemaId: 'atm.pairedBenchmarkPacket.v1';
  readonly stage: BenchmarkStage;
  readonly pairId: string;
  readonly runs: readonly PairedRun[];
  readonly packetDigest: string;
}

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function validatePairedRuns(runs: readonly PairedRun[]): string[] {
  const errors: string[] = [];
  if (runs.length !== 2) errors.push('exactly two arms are required');
  const arms = new Set(runs.map((r) => r.arm));
  if (arms.size !== 2 || !arms.has('atm') || !arms.has('baseline')) errors.push('both atm and baseline arms are required');
  const first = runs[0];
  for (const run of runs) {
    for (const [field, value] of Object.entries(run)) if (['pairId','runId','seed','provider','model','reasoning','promptDigest','repoDigest','sessionId','command','rawRef'].includes(field) && !nonEmpty(value)) errors.push(`${field} is required`);
    if (!SHA256.test(run.promptDigest) || !SHA256.test(run.repoDigest)) errors.push('promptDigest and repoDigest must be sha256 digests');
    if (run.budget <= 0) errors.push('budget must be positive');
    if (first && (run.pairId !== first.pairId || run.provider !== first.provider || run.model !== first.model || run.reasoning !== first.reasoning || run.budget !== first.budget || run.promptDigest !== first.promptDigest || run.repoDigest !== first.repoDigest)) errors.push('paired runs must share model, provider, budget, prompt, and repo');
  }
  if (new Set(runs.map((r) => r.sessionId)).size !== runs.length) errors.push('each arm requires a fresh session');
  if (new Set(runs.map((r) => r.runId)).size !== runs.length) errors.push('run IDs must be unique');
  return [...new Set(errors)];
}

export function createPairedPacket(stage: BenchmarkStage, runs: readonly PairedRun[]): PairedPacket {
  const errors = validatePairedRuns(runs);
  if (errors.length) throw new Error(errors.join('; '));
  const packet = { schemaId: 'atm.pairedBenchmarkPacket.v1' as const, stage, pairId: runs[0].pairId, runs: [...runs] };
  return { ...packet, packetDigest: digest(packet) };
}

export function verifyPacket(packet: unknown, expectedStage?: BenchmarkStage): string[] {
  if (!packet || typeof packet !== 'object') return ['packet must be an object'];
  const value = packet as PairedPacket;
  const errors: string[] = [];
  if (value.schemaId !== 'atm.pairedBenchmarkPacket.v1') errors.push('invalid packet schema');
  if (expectedStage && value.stage !== expectedStage) errors.push('packet stage mismatch');
  errors.push(...validatePairedRuns(value.runs ?? []));
  const { packetDigest: _digest, ...unsigned } = value;
  if (!SHA256.test(value.packetDigest ?? '') || digest(unsigned) !== value.packetDigest) errors.push('packet digest mismatch');
  for (const run of value.runs ?? []) if (!run.rawRef || run.rawRef.startsWith('summary:')) errors.push('raw refs must point outside the summary packet');
  return [...new Set(errors)];
}
