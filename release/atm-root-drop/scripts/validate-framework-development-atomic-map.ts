import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function fail(message: string): never {
  console.error(`[validate-framework-development-atomic-map] ${message}`);
  process.exit(1);
}

function read(relativePath: string): string {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) fail(`missing ${relativePath}`);
  return readFileSync(absolutePath, 'utf8');
}

const facadePath = 'packages/cli/src/commands/framework-development.ts';
const facade = read(facadePath);
const facadeLines = facade.split(/\r?\n/).length;
if (facadeLines > 900) fail(`${facadePath} has ${facadeLines} lines; expected <= 900`);

const modules = [
  'closure-packet-schema',
  'critical-path-gate',
  'historical-delivery-provenance',
  'sha256-normalization',
  'temp-claim'
];

for (const moduleName of modules) {
  const modulePath = `packages/cli/src/commands/framework-development/${moduleName}.ts`;
  read(modulePath);
  if (!facade.includes(`./framework-development/${moduleName}.ts`)) {
    fail(`${facadePath} does not re-export ${modulePath}`);
  }
}

for (const specName of [
  'closure-packet-schema',
  'critical-path-gate',
  'historical-delivery-provenance',
  'sha256-normalization',
  'temp-claim'
]) {
  read(`packages/cli/src/commands/framework-development/__tests__/${specName}.spec.ts`);
}

const closurePacketSchema = read('packages/cli/src/commands/framework-development/closure-packet-schema.ts');
for (const symbolName of [
  'ClosurePacket',
  'ClosurePacketCommandRun',
  'ClosurePacketTargetCommitDelta',
  'ClosurePacketRequiredGatesSnapshot',
  'ClosurePacketReconcileAttestation',
  'ClosurePacketRepairMetadata',
  'HistoricalDeliveryProvenance',
  'FrameworkCloseWorktreeReport',
  'validateClosurePacket',
  'createClosurePacket',
  'writeClosurePacket',
  'repairClosurePacketForTask',
  'requiredValidationPassesForClosure',
  'normalizeUpstreamEvidenceForTask'
]) {
  if (!closurePacketSchema.includes(symbolName)) {
    fail(`closure-packet-schema.ts does not expose ${symbolName}`);
  }
}

const report = read('docs/reports/framework-development-atomic-map.md');
for (const moduleName of modules) {
  if (!report.includes(moduleName)) {
    fail(`atomic map report does not mention ${moduleName}`);
  }
}

console.log(`[validate-framework-development-atomic-map] ok (${facadeLines} facade lines, ${modules.length} modules)`);
