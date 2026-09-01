import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createATMVersionSummary, loadATMChartSummary } from './atm-chart.js';
import { relativePathFrom } from './governance-runtime.js';
import { checkIntegrationHealth, describeIntegrationInstallHint, inspectIntegrationBootstrap } from './integration.js';
import { inspectRuntimeAdapterReadiness } from './runtime-adapter-readiness.js';
import { runNext } from './next.js';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.js';
import { getCommandSpec } from './command-specs.js';
import { readTelemetryState, telemetryAllowedFields } from '../telemetry/index.js';
import { listExperimentalApis } from '../../../agent-pack-sdk/dist/experimental/index.js';
const defaultWelcomeLineageRelativePath = path.join('.atm', 'runtime', 'welcome.lineage.json');
export async function runWelcome(argv) {
    const spec = getCommandSpec('welcome');
    if (!spec) {
        throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for welcome.', { exitCode: 2 });
    }
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
    const integrationBootstrap = inspectIntegrationBootstrap(cwd);
    const integrationInstallHint = describeIntegrationInstallHint(integrationBootstrap);
    const runtimeAdapterReadiness = inspectRuntimeAdapterReadiness(cwd);
    const nextResult = await runNext(['--cwd', cwd]);
    const nextAction = nextResult.evidence?.nextAction ?? null;
    const userNotice = nextResult.evidence?.userNotice ?? null;
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
            ...(integrationInstallHint
                ? [message('warning', 'ATM_WELCOME_INTEGRATION_INSTALL_RECOMMENDED', integrationInstallHint.text, integrationInstallHint.data)]
                : []),
            ...(runtimeAdapterReadiness.needsRuntimeAdapterHint
                ? [message('warning', 'ATM_PYTHON_RUNTIME_ADAPTER_RECOMMENDED', runtimeAdapterReadiness.suggestedAction ?? 'Python entrypoints were detected. Select a Python runtime adapter/plugin before expecting ATM atom birth or apply routes to mutate Python surfaces.', {
                        detectedLanguages: runtimeAdapterReadiness.detectedLanguages,
                        bundledLanguageAdapters: runtimeAdapterReadiness.bundledLanguageAdapters,
                        bundledProjectAdapters: runtimeAdapterReadiness.bundledProjectAdapters,
                        pythonLanguageAdapterAvailable: runtimeAdapterReadiness.pythonLanguageAdapterAvailable,
                        candidateRankingAllowed: runtimeAdapterReadiness.candidateRankingAllowed,
                        atomBirthApplyDeferred: runtimeAdapterReadiness.atomBirthApplyDeferred,
                        missingCapability: runtimeAdapterReadiness.missingCapability
                    })]
                : []),
            message('info', 'ATM_TELEMETRY_NOTICE', 'ATM telemetry is opt-in only. Run `node atm.mjs telemetry --on --json` after reviewing docs/TELEMETRY.md.'),
            message('warning', 'ATM_EXPERIMENTAL_API_NOTICE', 'Experimental APIs are disabled unless a command is invoked with --allow-experimental.')
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
            experimental: {
                channel: 'experimental',
                enabledByDefault: false,
                allowFlag: '--allow-experimental',
                docs: 'docs/EXPERIMENTAL_API.md',
                apis: listExperimentalApis().map((api) => ({
                    id: api.id,
                    stability: api.stability,
                    since: api.since
                }))
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
            integrationBootstrap,
            runtimeAdapterReadiness,
            nextAction,
            userNotice,
            lineagePath: dryRun ? null : relativePathFrom(cwd, lineageAbsolutePath),
            welcomeLineage
        }
    });
}
function readDistTagSelection(cwd) {
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
    }
    catch {
        return {
            requestedTag: 'latest',
            tier: 'unknown',
            source: 'unreadable',
            selectionPath: '.atm/runtime/dist-tag.json'
        };
    }
}
function writeWelcomeLineage(lineageAbsolutePath, input) {
    const existing = readWelcomeLineage(lineageAbsolutePath);
    const record = {
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
function readWelcomeLineage(lineageAbsolutePath) {
    if (!existsSync(lineageAbsolutePath)) {
        return null;
    }
    try {
        return JSON.parse(readFileSync(lineageAbsolutePath, 'utf8'));
    }
    catch {
        return null;
    }
}
