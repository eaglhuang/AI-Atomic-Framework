import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSimulatedDriver, type ArmDriver } from './lib/external-benchmark/arm-driver.ts';
import { executeTrialPlan } from './lib/external-benchmark/executor.ts';
import { verifyPacket, type BenchmarkStage } from './lib/external-benchmark/paired-executor.ts';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

// Only cost-free drivers are registered here. A paid provider driver belongs to
// TASK-PRF-0040 and must arrive with its own budget authorization.
const drivers: Record<string, () => ArmDriver> = { simulated: createSimulatedDriver };

const usage = [
  'usage: --verify-packet --stage <dry-run|pilot|formal|replication|product> --packet <summary.json>',
  '       --execute --plan <trial-plan.json> --driver simulated --workspace-root <dir> --sink <dir>',
].join('\n');

if (args.includes('--verify-packet') && option('--packet') && option('--stage')) {
  const packet = JSON.parse(await readFile(option('--packet')!, 'utf8'));
  const errors = verifyPacket(packet, option('--stage') as BenchmarkStage);
  console.log(JSON.stringify({ ok: errors.length === 0, errors, packetDigest: packet.packetDigest ?? null }));
  process.exitCode = errors.length ? 1 : 0;
} else if (args.includes('--execute') && option('--plan') && option('--driver') && option('--workspace-root') && option('--sink')) {
  const createDriver = drivers[option('--driver')!];
  if (!createDriver) {
    console.error(`unknown driver ${option('--driver')}; registered drivers: ${Object.keys(drivers).join(', ')}. Paid provider runs belong to TASK-PRF-0040.`);
    process.exitCode = 2;
  } else {
    const plan = JSON.parse(await readFile(option('--plan')!, 'utf8'));
    const summary = await executeTrialPlan({
      plan,
      driver: createDriver(),
      workspaceRoot: option('--workspace-root')!,
      sinkDir: option('--sink')!,
      frameworkRoot,
    });
    const { packets: _packets, ...printable } = summary;
    console.log(JSON.stringify({ ok: summary.interrupted === null, ...printable }));
    process.exitCode = summary.interrupted === null ? 0 : 1;
  }
} else {
  console.error(usage);
  process.exitCode = 2;
}
