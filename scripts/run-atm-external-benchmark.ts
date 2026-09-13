import { readFile } from 'node:fs/promises';
import { verifyPacket, type BenchmarkStage } from './lib/external-benchmark/paired-executor.ts';

const args = process.argv.slice(2);
const packetIndex = args.indexOf('--packet');
const stageIndex = args.indexOf('--stage');
if (args.includes('--verify-packet') && packetIndex >= 0 && stageIndex >= 0) {
  const packet = JSON.parse(await readFile(args[packetIndex + 1], 'utf8'));
  const errors = verifyPacket(packet, args[stageIndex + 1] as BenchmarkStage);
  console.log(JSON.stringify({ ok: errors.length === 0, errors, packetDigest: packet.packetDigest ?? null }));
  process.exitCode = errors.length ? 1 : 0;
} else {
  console.error('usage: --verify-packet --stage <pilot|formal|replication|product> --packet <summary.json>');
  process.exitCode = 2;
}
