import path from 'node:path';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.ts';
import { getCommandSpec } from './command-specs.ts';
import { renderATMChart, resolveATMChartPath, verifyATMChart } from './atm-chart/render-verify.ts';

export {
  atmChartFrontmatterSchemaVersion,
  atmChartSourceSchemas,
  defaultATMChartRelativePath
} from './atm-chart/constants.ts';
export type {
  ATMChartFrontmatter,
  ATMChartSourceSnapshot,
  ATMChartSummary,
  CompatibilityMatrixBundle,
  CompatibilityMatrixChartVersion,
  CompatibilityMatrixDocument,
  CompatibilityMatrixTemplateVersion,
  CompatibilityMatrixWarning,
  FrameworkDowngradeReport,
  LegacyCompatibilityMatrixChartVersion,
  LegacyCompatibilityMatrixDocument,
  LegacyCompatibilityMatrixTemplateVersion,
  VersionCompatibilityReport,
  VersionLagStatus
} from './atm-chart/types.ts';
export {
  collectATMChartSources,
  collectSchemaDrift,
  createATMChartMarkdown,
  loadATMChartSummary,
  normalizePath,
  readATMChartFrontmatter,
  readDefaultGuards,
  resolveATMChartPath
} from './atm-chart/render-verify.ts';
export {
  createATMVersionSummary,
  createVersionCompatibilityReport,
  loadCompatibilityMatrix,
  loadCompatibilityMatrixBundle,
  readFrameworkPackageVersion
} from './atm-chart/compatibility.ts';
export { compareSemver } from './atm-chart/semver.ts';

export async function runATMChart(argv: string[]) {
  const spec = getCommandSpec('atm-chart');
  if (!spec) {
    throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for atm-chart.', { exitCode: 2 });
  }

  const parsed = parseArgsForCommand(spec, argv);
  const [action = 'render'] = parsed.positional;
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));

  // M19: Mermaid auto-gen from map.spec.json
  if (parsed.options.mermaid === true || action === 'mermaid') {
    const mapId = String(parsed.options.map ?? '');
    if (!mapId) {
      throw new CliError('ATM_CLI_USAGE', 'atm-chart --mermaid requires --map <mapId>', { exitCode: 2 });
    }
    const { generateMermaidFromMapSpec } = await import('../../../core/src/maps/mermaid-gen.ts');
    const result = generateMermaidFromMapSpec(cwd, mapId);
    return makeResult({
      ok: true,
      command: 'atm-chart',
      cwd,
      messages: [
        message('info', 'ATM_CHART_MERMAID_GENERATED',
          `Mermaid diagram generated for map ${mapId}: ${result.nodeCount} nodes, ${result.edgeCount} edges.`,
          { mapId, nodeCount: result.nodeCount, edgeCount: result.edgeCount }
        )
      ],
      evidence: { mermaidSource: result.mermaidSource, result }
    });
  }

  const atmChartAbsolutePath = resolveATMChartPath(cwd, parsed.options.out);
  const versionCheck = parsed.options.versionCheck === true;

  if (action === 'render') {
    return renderATMChart(cwd, atmChartAbsolutePath);
  }

  if (action === 'verify') {
    return verifyATMChart(cwd, atmChartAbsolutePath, { versionCheck });
  }

  throw new CliError('ATM_CLI_USAGE', `atm-chart does not support action ${action}`, {
    exitCode: 2,
    details: {
      supportedActions: ['render', 'verify', 'mermaid']
    }
  });
}
