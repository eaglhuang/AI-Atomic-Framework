import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GuidanceNextAction } from '../../../core/src/guidance/guidance-packet.ts';
import { createATMVersionSummary, loadATMChartSummary } from './atm-chart.ts';
import { relativePathFrom } from './governance-runtime.ts';
import { checkIntegrationHealth } from './integration.ts';
import { runNext } from './next.ts';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.ts';
import { getCommandSpec } from './command-specs.ts';
import { readTelemetryState, telemetryAllowedFields } from '../telemetry/index.ts';

const defaultWelcomeLineageRelativePath = path.join('.atm', 'runtime', 'welcome.lineage.json');

interface WelcomeLineageRecord {
  readonly schemaId: 'atm.welcomeLineage';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none';
    readonly fromVersion: null;
    readonly notes: string;
  };
  readonly firstWelcomedAt: string;
  readonly lastWelcomedAt: string;
  readonly welcomeCount: number;
  readonly atmChartPath: string;
  readonly sourceGuardsSha256: string;
  readonly installedIntegrations: readonly string[];
  readonly integrationHealthOk: boolean;
  readonly lastNextAction: GuidanceNextAction | null;
}

export async function runWelcome(argv: string[]) {
  const spec = getCommandSpec('welcome');
  const parsed = parseArgsForCommand(spec, argv);
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
  const dryRun = parsed.options.dryRun === true;
  const atmChart = loadATMChartSummary(cwd);
  const versionSummary = createATMVersionSummary(cwd);
  const distTag = readDistTagSelection(cwd);
  const telemetry = readTelemetryState(cwd);
  if (!versionSummary.compatibility.ok && !dryRun) {
    throw new CliError('ATM_WELCOME_READ_ONLY_DIAGNOSTIC', 'ATMChart version is unsupported or unknown; run `node atm.mjs welcome --dry-run --json` or `node atm.mjs upgrade plan --json` before writing lineage.', {
      exitCode: 2,
      details: versionSummary
    });
  }
  const integrationHealth = await checkIntegrationHealth(cwd);
  const nextResult = await runNext(['--cwd', cwd]);
  const nextAction = nextResult.evidence?.nextAction ?? null;
  const lineageAbsolutePath = path.join(cwd, defaultWelcomeLineageRelativePath);
  const welcomeLineage = dryRun
    ? null
    : writeWelcomeLineage(lineageAbsolutePath, {
      now: new Date().toISOString(),
      atmChartPath: atmChart.atmChartPath,
      sourceGuardsSha256: atmChart.frontmatter.source_guards_sha256,
      installedIntegrations: integrationHealth.installed,
      integrationHealthOk: integrationHealth.ok,
      nextAction
    });

  return makeResult({
    ok: true,
    command: 'welcome',
    cwd,
    messages: [
      message('info', dryRun ? 'ATM_WELCOME_DRY_RUN' : 'ATM_WELCOME_READY', dryRun
        ? 'Welcome summary generated without writing lifecycle lineage.'
        : 'Welcome summary generated and lifecycle lineage recorded.'),
      message('info', 'ATM_TELEMETRY_NOTICE', 'ATM telemetry is opt-in only. Run `node atm.mjs telemetry --on --json` after reviewing docs/TELEMETRY.md.')
    ],
    evidence: {
      dryRun,
      atmChart: {
        path: atmChart.atmChartPath,
        version: versionSummary.chartVersion,
        sourceGuardsSha256: atmChart.frontmatter.source_guards_sha256,
        guardSummary: atmChart.guardSummary
      },
      versions: versionSummary,
      distTag,
      telemetry: {
        enabled: telemetry.enabled,
        docs: 'docs/TELEMETRY.md',
        allowedFields: telemetryAllowedFields,
        prompt: 'Telemetry is disabled until you explicitly opt in with `node atm.mjs telemetry --on`.'
      },
      integrations: {
        ok: integrationHealth.ok,
        manifestDir: integrationHealth.manifestDir,
        installed: integrationHealth.installed,
        failed: integrationHealth.failed.map((report) => ({
          adapterId: report.adapterId ?? null,
          driftedFiles: report.driftedFiles
        }))
      },
      nextAction,
      lineagePath: dryRun ? null : relativePathFrom(cwd, lineageAbsolutePath),
      welcomeLineage
    }
  });
}

function readDistTagSelection(cwd: string) {
  const selectionPath = path.join(cwd, '.atm', 'runtime', 'dist-tag.json');
  if (!existsSync(selectionPath)) {
    return {
      requestedTag: 'latest',
      tier: 'stable',
      source: 'default',
      selectionPath: null
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(selectionPath, 'utf8'));
    return {
      requestedTag: parsed.requestedTag ?? 'latest',
      tier: parsed.tier ?? 'stable',
      source: parsed.source ?? 'create-atm',
      selectionPath: '.atm/runtime/dist-tag.json'
    };
  } catch {
    return {
      requestedTag: 'latest',
      tier: 'unknown',
      source: 'unreadable',
      selectionPath: '.atm/runtime/dist-tag.json'
    };
  }
}

function writeWelcomeLineage(lineageAbsolutePath: string, input: {
  readonly now: string;
  readonly atmChartPath: string;
  readonly sourceGuardsSha256: string;
  readonly installedIntegrations: readonly string[];
  readonly integrationHealthOk: boolean;
  readonly nextAction: GuidanceNextAction | null;
}): WelcomeLineageRecord {
  const existing = readWelcomeLineage(lineageAbsolutePath);
  const record: WelcomeLineageRecord = {
    schemaId: 'atm.welcomeLineage',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Tracks first-touch welcome lifecycle events for ATM onboarding.'
    },
    firstWelcomedAt: existing?.firstWelcomedAt ?? input.now,
    lastWelcomedAt: input.now,
    welcomeCount: (existing?.welcomeCount ?? 0) + 1,
    atmChartPath: input.atmChartPath,
    sourceGuardsSha256: input.sourceGuardsSha256,
    installedIntegrations: [...input.installedIntegrations],
    integrationHealthOk: input.integrationHealthOk,
    lastNextAction: input.nextAction
  };

  mkdirSync(path.dirname(lineageAbsolutePath), { recursive: true });
  writeFileSync(lineageAbsolutePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

function readWelcomeLineage(lineageAbsolutePath: string): WelcomeLineageRecord | null {
  if (!existsSync(lineageAbsolutePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(lineageAbsolutePath, 'utf8')) as WelcomeLineageRecord;
  } catch {
    return null;
  }
}