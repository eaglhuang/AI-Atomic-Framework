import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadManifest, loadOwnerShard, resolveRepoPath, writeProjectionFromShards, loadPathToAtomMap } from '../../atomic_workbench/atomization-coverage/path-to-atom-map-shards/merge.js';

function parseArgs(argv) {
  const options = {
    command: null,
    repo: process.cwd(),
    task: null,
    shard: null,
    pathPattern: null,
    atomId: null,
    capability: null,
    coverageStatus: 'active',
    sourceTask: null,
    mapIds: [],
    validateCommands: ['npm run validate:atomization-coverage'],
    phase: null,
    expectedAtomDelta: null,
    expectedMapDelta: null,
    expectedPathDelta: null
  };

  const args = [...argv];
  options.command = args.shift() ?? null;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--repo') options.repo = args.shift();
    else if (arg === '--task') options.task = args.shift();
    else if (arg === '--shard') options.shard = args.shift();
    else if (arg === '--path-pattern') options.pathPattern = args.shift();
    else if (arg === '--atom-id') options.atomId = args.shift();
    else if (arg === '--capability') options.capability = args.shift();
    else if (arg === '--coverage-status') options.coverageStatus = args.shift();
    else if (arg === '--source-task') options.sourceTask = args.shift();
    else if (arg === '--map-id') options.mapIds.push(args.shift());
    else if (arg === '--validate-command') options.validateCommands.push(args.shift());
    else if (arg === '--no-default-validator') options.validateCommands = [];
    else if (arg === '--phase') options.phase = args.shift();
    else if (arg === '--expected-atom-delta') options.expectedAtomDelta = Number(args.shift());
    else if (arg === '--expected-map-delta') options.expectedMapDelta = Number(args.shift());
    else if (arg === '--expected-path-delta') options.expectedPathDelta = Number(args.shift());
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/src/atomization-register-receipt.js register-path --repo . --task TASK-ID --shard atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json --path-pattern packages/cli/src/commands/foo.ts --atom-id atm.foo-map --capability "..." [--source-task TASK-ID] [--map-id atm.some-map]',
    '  node scripts/src/atomization-register-receipt.js snapshot --repo . --task TASK-ID --phase before|after',
    '  node scripts/src/atomization-register-receipt.js verify-task --repo . --task TASK-ID --expected-atom-delta 0 --expected-map-delta 0 --expected-path-delta 1'
  ].join('\n');
}

function writeJson(filePath, data) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function relativeRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
}

function hashJson(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function collectSnapshot(repoRoot) {
  const projection = loadPathToAtomMap(repoRoot);
  const atomIdToCidPath = path.join(repoRoot, 'atomic_workbench', 'atomization-coverage', 'atom-id-to-cid.json');
  const atomIdToCid = existsSync(atomIdToCidPath) ? JSON.parse(readFileSync(atomIdToCidPath, 'utf8')) : { mappings: [] };
  const mapRoot = path.join(repoRoot, 'atomic_workbench', 'maps');
  const mapSpecs = [];
  if (existsSync(mapRoot)) {
    const stack = [mapRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(absolute);
          continue;
        }
        if (entry.isFile() && entry.name === 'map.spec.json') {
          const raw = JSON.parse(readFileSync(absolute, 'utf8'));
          mapSpecs.push({
            path: relativeRepoPath(repoRoot, absolute),
            mapId: raw.mapId ?? raw.id ?? path.basename(path.dirname(absolute))
          });
        }
      }
    }
  }

  const mappedPaths = (projection.mappings ?? []).map((entry) => ({
    path_pattern: entry.path_pattern,
    atom_id: entry.atom_id,
    capability: entry.capability,
    coverage_status: entry.coverage_status,
    source_task: entry.source_task ?? null
  })).sort((a, b) => a.path_pattern.localeCompare(b.path_pattern));

  const atomIds = (atomIdToCid.mappings ?? [])
    .map((entry) => entry.atom_id)
    .filter((value) => typeof value === 'string' && value.length > 0)
    .sort((a, b) => a.localeCompare(b));

  const normalizedMaps = mapSpecs.sort((a, b) => a.path.localeCompare(b.path));
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      mappedPathCount: mappedPaths.length,
      atomRegistryCount: atomIds.length,
      mapRegistryCount: normalizedMaps.length
    },
    digests: {
      mappedPaths: hashJson(mappedPaths),
      atomRegistry: hashJson(atomIds),
      mapRegistry: hashJson(normalizedMaps)
    },
    projectionSummary: projection.summary ?? null
  };
}

function snapshotPath(repoRoot, taskId, phase) {
  return path.join(repoRoot, 'atomic_workbench', 'atomization-coverage', 'task-snapshots', taskId, `${phase}.json`);
}

function receiptPath(repoRoot, taskId, stem) {
  const safeStem = stem.replace(/[^a-z0-9._-]/gi, '-');
  return path.join(repoRoot, 'atomic_workbench', 'atomization-coverage', 'receipts', taskId, `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeStem}.json`);
}

function runValidators(repoRoot, commands) {
  return commands.map((command) => {
    try {
      execSync(command, { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8', shell: true });
      return { command, ok: true };
    } catch (error) {
      return {
        command,
        ok: false,
        exitCode: typeof error?.status === 'number' ? error.status : 1,
        stderr: typeof error?.stderr === 'string' ? error.stderr.slice(-1200) : null
      };
    }
  });
}

function requireOption(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing required option ${name}`);
  }
  return value.trim();
}

function runRegisterPath(options) {
  const repoRoot = path.resolve(options.repo);
  const taskId = requireOption(options.task, '--task');
  const shardRelativePath = requireOption(options.shard, '--shard');
  const pathPattern = requireOption(options.pathPattern, '--path-pattern');
  const atomId = requireOption(options.atomId, '--atom-id');
  const capability = requireOption(options.capability, '--capability');
  const manifest = loadManifest(repoRoot);
  if (!manifest) throw new Error('Owner shard manifest is missing.');
  if (!manifest.shardPaths.includes(shardRelativePath)) {
    throw new Error(`Shard is not listed in manifest: ${shardRelativePath}`);
  }

  const before = collectSnapshot(repoRoot);
  const shard = loadOwnerShard(repoRoot, shardRelativePath);
  const existing = shard.mappings.find((entry) => entry.path_pattern === pathPattern);
  const nextRow = {
    path_pattern: pathPattern,
    atom_id: atomId,
    capability,
    coverage_status: options.coverageStatus ?? 'active',
    ...(options.sourceTask ? { source_task: options.sourceTask } : {})
  };
  let mutation = 'created';
  if (existing) {
    existing.atom_id = nextRow.atom_id;
    existing.capability = nextRow.capability;
    existing.coverage_status = nextRow.coverage_status;
    if (nextRow.source_task) existing.source_task = nextRow.source_task;
    else delete existing.source_task;
    mutation = 'updated';
  } else {
    shard.mappings.push(nextRow);
  }
  shard.mappings.sort((a, b) => String(a.path_pattern).localeCompare(String(b.path_pattern)));
  writeJson(resolveRepoPath(repoRoot, shardRelativePath), shard);
  const projectionWrite = writeProjectionFromShards(repoRoot, manifest);
  const validatorRuns = runValidators(repoRoot, options.validateCommands);
  const allHealthy = validatorRuns.every((entry) => entry.ok);
  const after = collectSnapshot(repoRoot);
  const receipt = {
    schemaId: 'atm.atomizationRegistrationReceipt.v1',
    generatedAt: new Date().toISOString(),
    repoRoot,
    taskId,
    command: 'register-path',
    mutation,
    shard: shardRelativePath,
    registeredEntry: nextRow,
    referencedMapIds: options.mapIds,
    projectionWrite: {
      path: relativeRepoPath(repoRoot, projectionWrite.projectionPath),
      mappingCount: projectionWrite.mappingCount
    },
    validatorRuns,
    validatorHealthy: allHealthy,
    before,
    after
  };
  const outputPath = receiptPath(repoRoot, taskId, `${path.basename(pathPattern)}-registration`);
  writeJson(outputPath, receipt);
  return { ok: allHealthy, receiptPath: relativeRepoPath(repoRoot, outputPath), receipt };
}

function runSnapshot(options) {
  const repoRoot = path.resolve(options.repo);
  const taskId = requireOption(options.task, '--task');
  const phase = requireOption(options.phase, '--phase');
  if (phase !== 'before' && phase !== 'after') throw new Error('--phase must be before or after');
  const snapshot = {
    schemaId: 'atm.atomizationTaskSnapshot.v1',
    taskId,
    phase,
    ...collectSnapshot(repoRoot)
  };
  const outputPath = snapshotPath(repoRoot, taskId, phase);
  writeJson(outputPath, snapshot);
  return { ok: true, snapshotPath: relativeRepoPath(repoRoot, outputPath), snapshot };
}

function runVerifyTask(options) {
  const repoRoot = path.resolve(options.repo);
  const taskId = requireOption(options.task, '--task');
  const beforePath = snapshotPath(repoRoot, taskId, 'before');
  const afterPath = snapshotPath(repoRoot, taskId, 'after');
  if (!existsSync(beforePath) || !existsSync(afterPath)) {
    throw new Error(`Missing before/after snapshot for ${taskId}. Run snapshot --phase before and --phase after first.`);
  }
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf8'));
  const deltas = {
    atomRegistryDelta: after.counts.atomRegistryCount - before.counts.atomRegistryCount,
    mapRegistryDelta: after.counts.mapRegistryCount - before.counts.mapRegistryCount,
    mappedPathDelta: after.counts.mappedPathCount - before.counts.mappedPathCount
  };
  const checks = [
    { name: 'atomRegistryDelta', expected: options.expectedAtomDelta, actual: deltas.atomRegistryDelta },
    { name: 'mapRegistryDelta', expected: options.expectedMapDelta, actual: deltas.mapRegistryDelta },
    { name: 'mappedPathDelta', expected: options.expectedPathDelta, actual: deltas.mappedPathDelta }
  ].filter((entry) => entry.expected !== null);
  const failures = checks.filter((entry) => entry.expected !== entry.actual);
  const report = {
    schemaId: 'atm.atomizationTaskSnapshotVerification.v1',
    generatedAt: new Date().toISOString(),
    taskId,
    beforePath: relativeRepoPath(repoRoot, beforePath),
    afterPath: relativeRepoPath(repoRoot, afterPath),
    deltas,
    checks,
    ok: failures.length === 0,
    failures
  };
  const outputPath = receiptPath(repoRoot, taskId, 'snapshot-verification');
  writeJson(outputPath, report);
  return { ok: report.ok, receiptPath: relativeRepoPath(repoRoot, outputPath), report };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.command) {
    console.error(usage());
    process.exit(2);
  }
  let result;
  if (options.command === 'register-path') result = runRegisterPath(options);
  else if (options.command === 'snapshot') result = runSnapshot(options);
  else if (options.command === 'verify-task') result = runVerifyTask(options);
  else throw new Error(`Unknown command: ${options.command}`);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    usage: usage()
  }, null, 2));
  process.exit(1);
}
