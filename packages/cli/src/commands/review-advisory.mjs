import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  appendMachineFindings,
  createStubReviewAdvisoryReport,
  createUnavailableAdvisoryReport,
  normalizeProviderPayload
} from '../../../plugin-review-advisory/src/index.ts';
import { CliError, makeResult, message, relativePathFrom } from './shared.mjs';

export function runReviewAdvisory(argv) {
  const { options } = parseReviewAdvisoryOptions(argv);
  const reportId = options.reportId || `review-advisory.${Date.now()}`;
  const target = {
    kind: options.targetKind,
    id: options.targetId || undefined,
    sourcePaths: options.sourcePaths.length > 0 ? options.sourcePaths : undefined
  };

  let report;
  const mode = options.mode;

  if (mode === 'stub') {
    report = createStubReviewAdvisoryReport({
      profile: options.stubProfile,
      reportId,
      target
    });
  } else {
    const providerId = mode === 'agent-bridge' ? 'agent-bridge-provider' : 'external-cli-provider';
    const provider = {
      mode,
      providerId,
      providerVersion: '1.0.0',
      transport: mode === 'agent-bridge' ? 'json-file' : 'child-process'
    };

    const payload = mode === 'agent-bridge'
      ? readProviderPayloadFromFile(options.providerResponse)
      : runExternalProvider(options.providerCommand);

    if (!payload.ok) {
      report = createUnavailableAdvisoryReport({
        reportId,
        provider,
        target,
        reason: payload.reason
      });
    } else {
      const normalized = normalizeProviderPayload(payload.value, {
        reportId,
        provider,
        target
      });
      report = normalized.report;
      if (!normalized.ok) {
        report = {
          ...report,
          unavailableReasons: [...(report.unavailableReasons ?? []), ...normalized.issues],
          advisoryUnavailable: true,
          needsReview: true,
          status: 'advisory-unavailable'
        };
      }
    }
  }

  const machineFindings = options.machineFindings ? readMachineFindings(options.machineFindings) : [];
  if (machineFindings.length > 0) {
    report = appendMachineFindings(report, machineFindings);
  }

  report = attachQueueSupplemental(report, options);

  const outputPath = resolvePath(options.cwd, options.outputPath);
  writeJson(outputPath, report);

  const advisoryCode = report.advisoryUnavailable ? 'ATM_REVIEW_ADVISORY_UNAVAILABLE' : 'ATM_REVIEW_ADVISORY_OK';
  const advisoryText = report.advisoryUnavailable
    ? 'Review advisory unavailable; deterministic gates remain authoritative and queue should proceed with human review.'
    : 'Review advisory completed and emitted supplemental findings.';

  return makeResult({
    ok: true,
    command: 'review-advisory',
    cwd: options.cwd,
    messages: [
      message('info', advisoryCode, advisoryText, {
        status: report.status,
        needsReview: report.needsReview
      })
    ],
    evidence: {
      mode,
      report,
      outputPath: relativePathFrom(options.cwd, outputPath)
    }
  });
}

function parseReviewAdvisoryOptions(argv) {
  const options = {
    cwd: process.cwd(),
    mode: 'stub',
    stubProfile: 'pass',
    outputPath: '.atm/reports/review-advisory.json',
    reportId: '',
    targetKind: 'scope',
    targetId: '',
    sourcePaths: [],
    providerResponse: '',
    providerCommand: '',
    machineFindings: '',
    queuePath: '.atm/reports/upgrade-proposals.json',
    proposalId: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireOptionValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--mode') {
      options.mode = requireOptionValue(argv, index, '--mode');
      index += 1;
      continue;
    }
    if (arg === '--stub-profile') {
      options.stubProfile = requireOptionValue(argv, index, '--stub-profile');
      index += 1;
      continue;
    }
    if (arg === '--out') {
      options.outputPath = requireOptionValue(argv, index, '--out');
      index += 1;
      continue;
    }
    if (arg === '--report-id') {
      options.reportId = requireOptionValue(argv, index, '--report-id');
      index += 1;
      continue;
    }
    if (arg === '--target-kind') {
      options.targetKind = requireOptionValue(argv, index, '--target-kind');
      index += 1;
      continue;
    }
    if (arg === '--target-id') {
      options.targetId = requireOptionValue(argv, index, '--target-id');
      index += 1;
      continue;
    }
    if (arg === '--source-path') {
      options.sourcePaths.push(requireOptionValue(argv, index, '--source-path'));
      index += 1;
      continue;
    }
    if (arg === '--provider-response') {
      options.providerResponse = requireOptionValue(argv, index, '--provider-response');
      index += 1;
      continue;
    }
    if (arg === '--provider-cmd') {
      options.providerCommand = requireOptionValue(argv, index, '--provider-cmd');
      index += 1;
      continue;
    }
    if (arg === '--machine-findings') {
      options.machineFindings = requireOptionValue(argv, index, '--machine-findings');
      index += 1;
      continue;
    }
    if (arg === '--queue') {
      options.queuePath = requireOptionValue(argv, index, '--queue');
      index += 1;
      continue;
    }
    if (arg === '--proposal-id') {
      options.proposalId = requireOptionValue(argv, index, '--proposal-id');
      index += 1;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `review-advisory does not support option ${arg}`, { exitCode: 2 });
    }
  }

  if (!['stub', 'agent-bridge', 'external-cli'].includes(options.mode)) {
    throw new CliError('ATM_CLI_USAGE', `Unsupported review-advisory mode: ${options.mode}`, { exitCode: 2 });
  }
  if (!['pass', 'warn', 'unavailable'].includes(options.stubProfile)) {
    throw new CliError('ATM_CLI_USAGE', `Unsupported stub profile: ${options.stubProfile}`, { exitCode: 2 });
  }
  if (!['atom', 'map', 'proposal', 'diff', 'scope'].includes(options.targetKind)) {
    throw new CliError('ATM_CLI_USAGE', `Unsupported target kind: ${options.targetKind}`, { exitCode: 2 });
  }

  return {
    options: {
      ...options,
      cwd: path.resolve(options.cwd)
    }
  };
}

function requireOptionValue(argv, optionIndex, optionName) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `review-advisory requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

function readProviderPayloadFromFile(providerResponsePath) {
  if (!providerResponsePath) {
    return { ok: false, reason: 'agent-bridge-response-missing' };
  }
  const resolved = path.resolve(providerResponsePath);
  if (!existsSync(resolved)) {
    return { ok: false, reason: 'agent-bridge-response-not-found' };
  }
  try {
    return { ok: true, value: JSON.parse(readFileSync(resolved, 'utf8')) };
  } catch {
    return { ok: false, reason: 'agent-bridge-response-invalid-json' };
  }
}

function runExternalProvider(providerCommand) {
  if (!providerCommand) {
    return { ok: false, reason: 'external-cli-command-missing' };
  }

  const output = spawnSync(providerCommand, {
    shell: true,
    encoding: 'utf8'
  });

  if (output.status !== 0) {
    return { ok: false, reason: `external-cli-exit-${String(output.status)}` };
  }

  const stdout = (output.stdout || '').trim();
  if (!stdout) {
    return { ok: false, reason: 'external-cli-empty-output' };
  }

  try {
    return { ok: true, value: JSON.parse(stdout) };
  } catch {
    return { ok: false, reason: 'external-cli-output-invalid-json' };
  }
}

function readMachineFindings(machineFindingsPath) {
  const resolved = path.resolve(machineFindingsPath);
  if (!existsSync(resolved)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(resolved, 'utf8'));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && typeof item === 'object' && typeof item.message === 'string')
      .map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `machine-finding-${index + 1}`,
        severity: typeof item.severity === 'string' ? item.severity : 'low',
        message: item.message,
        routeHint: typeof item.routeHint === 'string' ? item.routeHint : undefined,
        evidenceRef: typeof item.evidenceRef === 'string' ? item.evidenceRef : undefined
      }));
  } catch {
    return [];
  }
}

function attachQueueSupplemental(report, options) {
  if (!options.proposalId) {
    return report;
  }

  const queuePath = resolvePath(options.cwd, options.queuePath);
  if (!existsSync(queuePath)) {
    return {
      ...report,
      supplementalContext: {
        ...(report.supplementalContext ?? {}),
        humanReviewQueue: {
          attachable: false,
          queuePath: relativePathFrom(options.cwd, queuePath),
          proposalId: options.proposalId
        }
      }
    };
  }

  try {
    const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
    const entries = Array.isArray(queue?.entries) ? queue.entries : [];
    const matched = entries.find((entry) => entry && entry.proposalId === options.proposalId);

    return {
      ...report,
      supplementalContext: {
        ...(report.supplementalContext ?? {}),
        humanReviewQueue: {
          attachable: Boolean(matched),
          queuePath: relativePathFrom(options.cwd, queuePath),
          proposalId: options.proposalId,
          queueRecordStatus: matched?.status
        }
      }
    };
  } catch {
    return {
      ...report,
      supplementalContext: {
        ...(report.supplementalContext ?? {}),
        humanReviewQueue: {
          attachable: false,
          queuePath: relativePathFrom(options.cwd, queuePath),
          proposalId: options.proposalId
        }
      }
    };
  }
}

function resolvePath(cwd, maybeRelativePath) {
  return path.isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : path.resolve(cwd, maybeRelativePath);
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
