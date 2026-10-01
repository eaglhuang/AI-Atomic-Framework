import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runInit } from './init.js';
import { message } from './shared.js';
import { renderATMChart, resolveATMChartPath } from './atm-chart/render-verify.js';
const defaultBootstrapTaskTitle = 'Bootstrap ATM in this repository';
export async function runBootstrap(argv) {
    const hasTask = Array.isArray(argv) && argv.includes('--task');
    const effectiveArgs = hasTask ? argv : [...argv, '--task', defaultBootstrapTaskTitle];
    const result = await runInit([...effectiveArgs, '--adopt', 'default']);
    const created = Array.isArray(result.evidence?.created) ? result.evidence.created : [];
    const bootstrapCreated = created.length > 0;
    const atmChart = result.ok && !argv.includes('--dry-run') ? ensureATMChart(result.cwd) : null;
    return {
        ...result,
        command: 'bootstrap',
        evidence: {
            ...result.evidence,
            pinnedRunner: readPinnedRunnerMetadata(result.cwd),
            ...(atmChart ? { atmChart: atmChart.evidence } : {})
        },
        messages: [
            bootstrapCreated
                ? message('info', 'ATM_BOOTSTRAP_CREATED', 'ATM default bootstrap pack created.')
                : message('info', 'ATM_BOOTSTRAP_READY', 'ATM default bootstrap pack already exists; no files were changed.'),
            ...(atmChart?.message ? [atmChart.message] : [])
        ]
    };
}
// `welcome` and `next` expect the rendered ATMChart, and rendering only needs
// the guards bootstrap just wrote. Rendering it here makes a fresh bootstrap
// immediately usable instead of failing the next command with
// ATM_CHART_MISSING. An existing chart is left untouched; a render failure is
// reported but does not undo the bootstrap.
function ensureATMChart(cwd) {
    const chartPath = resolveATMChartPath(cwd, undefined);
    const relativePath = path.relative(cwd, chartPath).replace(/\\/g, '/');
    if (existsSync(chartPath)) {
        return { evidence: { status: 'existing', path: relativePath }, message: null };
    }
    try {
        renderATMChart(cwd, chartPath);
        return {
            evidence: { status: 'rendered', path: relativePath },
            message: message('info', 'ATM_BOOTSTRAP_CHART_RENDERED', `ATMChart rendered at ${relativePath}.`)
        };
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            evidence: { status: 'render-failed', path: relativePath, reason },
            message: message('warning', 'ATM_BOOTSTRAP_CHART_RENDER_FAILED', `Bootstrap completed, but the ATMChart could not be rendered: ${reason}`, {
                requiredCommand: 'node atm.mjs atm-chart render --json'
            })
        };
    }
}
function readPinnedRunnerMetadata(cwd) {
    const metadataPath = path.join(cwd, '.atm', 'runtime', 'pinned-runner.json');
    if (!existsSync(metadataPath)) {
        return null;
    }
    return JSON.parse(readFileSync(metadataPath, 'utf8'));
}
