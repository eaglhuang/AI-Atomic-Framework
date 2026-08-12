import { createHash } from 'node:crypto';

export type NextWarmLatencyWorkload = {
  readonly args: readonly string[];
  readonly digest: string;
  readonly description: string;
};

export function createNextWarmLatencyWorkload(planningRoot: string): NextWarmLatencyWorkload {
  const prompt = 'Inspect repository orientation for a deterministic latency sample.';
  const args = ['next', '--prompt', prompt, '--planning-root', planningRoot, '--json'] as const;
  return {
    args,
    digest: `sha256:${createHash('sha256').update(JSON.stringify(args)).digest('hex')}`,
    description: 'Frozen onefile next routing with a fixed prompt and explicit canonical planning root.'
  };
}
