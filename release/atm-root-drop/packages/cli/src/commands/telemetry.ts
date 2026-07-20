import path from 'node:path';
import { getCommandSpec } from './command-specs.ts';
import { type CommandSpec, makeResult, message, parseArgsForCommand } from './shared.ts';
import { readTelemetryState, setTelemetryEnabled, telemetryConfigRelativePath } from '../telemetry/index.ts';
import { buildGateTelemetryRegistryCoverageReport, buildGateTelemetryTaskSummary, canonicalGateCheckRegistry, emitGateTelemetryEvent, reportGateTelemetry, sealGateTelemetry } from '../../../core/src/telemetry/index.ts';
import { buildSharedWriteGateCoverageReport } from '../../../core/src/telemetry/shared-write-coverage.ts';

export async function runTelemetry(argv: string[]) {
  const spec = getCommandSpec('telemetry') as CommandSpec;
  const parsed = parseArgsForCommand(spec, argv);
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
  const endpoint = typeof parsed.options.endpoint === 'string' ? String(parsed.options.endpoint) : null;
  const requestedOn = parsed.options.on === true;
  const requestedOff = parsed.options.off === true;
  const requestedGateRegistry = parsed.options.gateRegistry === true;
  const requestedCoverageReport = parsed.options.coverageReport === true || parsed.options.m2Preflight === true;
  const requestedSharedWriteCoverage = parsed.options.sharedWriteCoverage === true;
  const requestedTaskSummary = parsed.options.taskSummary === true;
  const requestedEmitFixture = parsed.options.emitFixture === true;
  const requestedSeal = parsed.options.seal === true;
  const requestedReport = parsed.options.report === true;

  if (requestedGateRegistry) {
    return makeResult({
      ok: true,
      command: 'telemetry',
      cwd,
      messages: [message('info', 'ATM_GATE_TELEMETRY_REGISTRY_READY', 'Gate telemetry check registry is ready.')],
      evidence: {
        schemaId: 'atm.gateTelemetryRegistryReport.v1',
        checks: canonicalGateCheckRegistry
      }
    });
  }

  if (requestedCoverageReport) {
    return makeResult({
      ok: true,
      command: 'telemetry',
      cwd,
      messages: [message('info', 'ATM_GATE_TELEMETRY_COVERAGE_READY', 'Gate telemetry registry coverage report is ready.')],
      evidence: buildGateTelemetryRegistryCoverageReport(cwd)
    });
  }

  if (requestedSharedWriteCoverage) {
    return makeResult({
      ok: true,
      command: 'telemetry',
      cwd,
      messages: [message('info', 'ATM_SHARED_WRITE_GATE_COVERAGE_READY', 'Shared-write gate coverage report is ready.')],
      evidence: buildSharedWriteGateCoverageReport(cwd)
    });
  }

  if (requestedTaskSummary) {
    const taskId = typeof parsed.options.task === 'string' ? String(parsed.options.task) : 'UNKNOWN';
    return makeResult({
      ok: true,
      command: 'telemetry',
      cwd,
      messages: [message('info', 'ATM_GATE_TELEMETRY_TASK_SUMMARY_READY', 'Gate telemetry task summary is ready.')],
      evidence: buildGateTelemetryTaskSummary(cwd, {
        taskId,
        role: normalizeTaskSummaryRole(parsed.options.role)
      })
    });
  }

  if (requestedEmitFixture) {
    const emitted = emitGateTelemetryEvent(cwd, {
      gate: String(parsed.options.gate ?? 'next'),
      checkId: String(parsed.options.checkId ?? 'next.route-resolution'),
      result: normalizeGateTelemetryResult(parsed.options.result),
      reasonClass: String(parsed.options.reason ?? 'fixture'),
      durationMs: Number(parsed.options.durationMs ?? 1),
      actorId: String(parsed.options.actor ?? process.env.ATM_ACTOR_ID ?? 'fixture'),
      taskId: typeof parsed.options.task === 'string' ? String(parsed.options.task) : null,
      runId: typeof parsed.options.runId === 'string' ? String(parsed.options.runId) : undefined,
      laneSessionId: typeof parsed.options.laneSessionId === 'string' ? String(parsed.options.laneSessionId) : undefined,
      batchId: typeof parsed.options.batchId === 'string' ? String(parsed.options.batchId) : undefined,
      waveId: typeof parsed.options.waveId === 'string' ? String(parsed.options.waveId) : undefined,
      correlationId: typeof parsed.options.correlationId === 'string' ? String(parsed.options.correlationId) : undefined,
      evidenceReadRef: typeof parsed.options.evidenceReadRef === 'string' ? String(parsed.options.evidenceReadRef) : undefined,
      command: 'telemetry --emit-fixture',
      source: 'fixture'
    });
    return makeResult({
      ok: true,
      command: 'telemetry',
      cwd,
      messages: [message(emitted.ok ? 'info' : 'warn', emitted.ok ? 'ATM_GATE_TELEMETRY_EVENT_WRITTEN' : 'ATM_GATE_TELEMETRY_EVENT_DROPPED', emitted.ok ? 'Gate telemetry fixture event written.' : `Gate telemetry fixture event dropped: ${emitted.warning}`)],
      evidence: emitted
    });
  }

  if (requestedSeal) {
    const taskId = typeof parsed.options.task === 'string' ? String(parsed.options.task) : 'UNKNOWN';
    const digest = sealGateTelemetry(cwd, {
      taskId,
      windowId: typeof parsed.options.window === 'string' ? String(parsed.options.window) : undefined,
      watermark: typeof parsed.options.watermark === 'string' ? String(parsed.options.watermark) : undefined
    });
    return makeResult({
      ok: true,
      command: 'telemetry',
      cwd,
      messages: [message('info', 'ATM_GATE_TELEMETRY_SEALED', 'Gate telemetry runtime events sealed to history.')],
      evidence: digest
    });
  }

  if (requestedReport) {
    const report = reportGateTelemetry(cwd, parsed.options.includeRuntime === true);
    return makeResult({
      ok: true,
      command: 'telemetry',
      cwd,
      messages: [message('info', 'ATM_GATE_TELEMETRY_REPORT_READY', 'Gate telemetry report is ready.')],
      evidence: report
    });
  }

  let state = readTelemetryState(cwd);
  let code = 'ATM_TELEMETRY_STATUS';
  let text = state.enabled
    ? 'Telemetry is enabled for this repository.'
    : 'Telemetry is disabled for this repository.';

  if (requestedOn) {
    state = setTelemetryEnabled(cwd, true, endpoint);
    code = 'ATM_TELEMETRY_ENABLED';
    text = 'Telemetry opt-in saved for this repository.';
  } else if (requestedOff) {
    state = setTelemetryEnabled(cwd, false, endpoint);
    code = 'ATM_TELEMETRY_DISABLED';
    text = 'Telemetry opt-out saved for this repository.';
  }

  return makeResult({
    ok: true,
    command: 'telemetry',
    cwd,
    messages: [message('info', code, text)],
    evidence: {
      enabled: state.enabled,
      endpoint: state.endpoint,
      configPath: telemetryConfigRelativePath,
      allowedFields: state.allowedFields,
      docs: 'docs/TELEMETRY.md'
    }
  });
}

function normalizeGateTelemetryResult(value: unknown): 'pass' | 'block' | 'warn' | 'skip' | 'error' {
  return value === 'block' || value === 'warn' || value === 'skip' || value === 'error' ? value : 'pass';
}

function normalizeTaskSummaryRole(value: unknown): 'baseline' | 'treatment' | 'm2-preflight' | 'unknown' {
  return value === 'baseline' || value === 'treatment' || value === 'm2-preflight' ? value : 'unknown';
}
