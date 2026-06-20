import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

type ArgValue = string | true | string[];
type ArgMap = Record<string, ArgValue>;

interface ScenarioConfig {
  scenario: 'B-02' | 'B-08' | 'B-13';
  taskId: string;
  slug: string;
  lane: string;
  verdict: string;
  actorIds: string[];
  requestFiles: string[];
  adapter: string;
  transactionIds: string[];
  commitSha: string;
}

function getArgs(argv: string[]): { command: string; args: ArgMap } {
  const [command = '--help', ...rest] = argv;
  const args: ArgMap = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const next = rest[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args[arg] = true;
      continue;
    }
    const previous = args[arg];
    if (Array.isArray(previous)) {
      previous.push(next);
    } else if (previous === undefined) {
      args[arg] = next;
    } else if (previous === true) {
      args[arg] = [next];
    } else {
      args[arg] = [previous, next];
    }
    index += 1;
  }
  return { command, args };
}

function asString(value: ArgValue | undefined, fallback = ''): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return String(value[0] ?? '').trim();
  }
  return fallback;
}

function asStringList(value: ArgValue | undefined): string[] {
  if (typeof value === 'string') {
    return [value.trim()].filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function printHelp(): void {
  console.log([
    'multi-vendor-broker-bench',
    '',
    'Usage:',
    '  node --strip-types tools/multi-vendor-broker-bench/index.ts run --scenario B-02|B-08|B-13 --output-dir <dir>',
    '  node --strip-types tools/multi-vendor-broker-bench/index.ts capture-field --scenario B-12 --task TASK-... --team-run-dir <dir> --output-dir <dir>',
    ''
  ].join('\n'));
}

function scenarioConfig(scenario: string): ScenarioConfig {
  if (scenario === 'B-02') {
    return {
      scenario,
      taskId: 'TASK-BENCH-B02',
      slug: 'agr-layer2-physical-overlap',
      lane: 'refined',
      verdict: 'applied',
      actorIds: ['codex', 'cursor'],
      requestFiles: ['packages/cli/src/commands/team.ts'],
      adapter: 'synthetic-agr-layer2',
      transactionIds: ['txn-b02-refine-a', 'txn-b02-refine-b'],
      commitSha: 'synthetic-b02-base'
    };
  }
  if (scenario === 'B-08') {
    return {
      scenario,
      taskId: 'TASK-BENCH-B08',
      slug: 'cas-stale-base-replan',
      lane: 'replan',
      verdict: 'queued',
      actorIds: ['codex', 'cursor'],
      requestFiles: ['packages/core/src/broker/conflict-matrix.ts'],
      adapter: 'synthetic-cas',
      transactionIds: ['txn-b08-stale-base'],
      commitSha: 'synthetic-b08-stale-base'
    };
  }
  if (scenario === 'B-13') {
    return {
      scenario,
      taskId: 'TASK-BENCH-B13',
      slug: 'validator-rejection-after-admit',
      lane: 'admitted',
      verdict: 'validator-rejected',
      actorIds: ['codex'],
      requestFiles: ['scripts/validate-team-agents.ts'],
      adapter: 'synthetic-validator',
      transactionIds: ['txn-b13-validator-reject'],
      commitSha: 'synthetic-b13-base'
    };
  }
  throw new Error(`unsupported scenario: ${scenario}`);
}

function writeSyntheticRun(config: ScenarioConfig, outputDir: string): string {
  const runDir = path.join(outputDir, 'runs');
  mkdirSync(runDir, { recursive: true });
  const runId = `bench-${config.scenario.toLowerCase()}-${config.slug}`;
  const requestIdentity = `bench:${config.scenario}:${config.taskId}:${config.slug}`;
  const runPath = path.join(runDir, `${runId}.json`);
  const envelope = {
    schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
    specVersion: '0.1.0',
    runId,
    planId: requestIdentity,
    records: [
      {
        request_identity: [requestIdentity],
        actor_ids: config.actorIds,
        request_files: config.requestFiles,
        applied_files: config.verdict === 'applied' ? config.requestFiles : [],
        adapter_choice: config.adapter,
        lane_decision: config.lane,
        merge_verdict: config.verdict,
        evidence_path: runPath.replace(/\\/g, '/'),
        task_ids: [config.taskId],
        commit_sha: config.commitSha,
        transaction_ids: config.transactionIds
      }
    ]
  };
  writeFileSync(runPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(outputDir, 'bench-manifest.json'), `${JSON.stringify({
    schemaId: 'atm.brokerBenchManifest.v1',
    generatedAt: new Date().toISOString(),
    scenario: config.scenario,
    taskId: config.taskId,
    runId,
    runPath: runPath.replace(/\\/g, '/')
  }, null, 2)}\n`, 'utf8');
  return runPath;
}

function runSynthetic(args: ArgMap): void {
  const scenario = asString(args['--scenario']);
  const outputDir = path.resolve(asString(args['--output-dir'], path.join('.atm-temp', `bench-${scenario.toLowerCase()}`)));
  const config = scenarioConfig(scenario);
  const runPath = writeSyntheticRun(config, outputDir);
  console.log(`[multi-vendor-broker-bench] scenario=${config.scenario} run=${runPath}`);
}

function captureField(args: ArgMap): void {
  const scenario = asString(args['--scenario'], 'B-12');
  const tasks = asStringList(args['--task']);
  const teamRunDir = path.resolve(asString(args['--team-run-dir'], path.join('.atm', 'runtime', 'team-runs')));
  const outputDir = path.resolve(asString(args['--output-dir'], path.join('.atm-temp', `field-${scenario.toLowerCase()}`)));
  const requestedRunDir = path.resolve(asString(args['--run-dir'], path.join('.atm', 'history', 'evidence', 'broker-runs')));
  const runDir = existsSync(requestedRunDir)
    ? requestedRunDir
    : path.join(outputDir, 'empty-broker-runs');
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(outputDir, 'field-capture-manifest.json'), `${JSON.stringify({
    schemaId: 'atm.brokerFieldCaptureManifest.v1',
    generatedAt: new Date().toISOString(),
    scenario,
    tasks,
    teamRunDir: teamRunDir.replace(/\\/g, '/'),
    runDir: runDir.replace(/\\/g, '/'),
    requestedRunDir: requestedRunDir.replace(/\\/g, '/'),
    captureMode: 'post-run'
  }, null, 2)}\n`, 'utf8');

  const command = [
    '--strip-types',
    path.join(process.cwd(), 'scripts', 'collect-broker-evidence.ts'),
    '--run-dir',
    runDir,
    '--team-run-dir',
    teamRunDir,
    '--output-dir',
    outputDir
  ];
  if (tasks.length > 0) {
    command.push('--task-ids', tasks.join(','));
  }
  if (!existsSync(teamRunDir)) {
    throw new Error(`team-run directory does not exist: ${teamRunDir}`);
  }
  const result = spawnSync(process.execPath, command, { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  process.stdout.write(result.stdout);
}

const { command, args } = getArgs(process.argv.slice(2));
if (command === 'run') {
  runSynthetic(args);
} else if (command === 'capture-field') {
  captureField(args);
} else {
  printHelp();
}
