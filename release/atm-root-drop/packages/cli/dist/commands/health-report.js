import { generateMapHealthReport } from '../../../core/dist/maps/map-health-report.js';
import { CliError, makeResult, message, parseOptions } from './shared.js';
export function runHealthReport(argv) {
    const { options } = parseOptions(argv, 'health-report');
    if (!options.map) {
        throw new CliError('ATM_CLI_USAGE', 'health-report requires --map <mapId>.', { exitCode: 2 });
    }
    const report = generateMapHealthReport(options.cwd, options.map);
    const highRiskAtoms = report.atoms.filter((a) => a.risk === 'high');
    const ok = highRiskAtoms.length === 0;
    return makeResult({
        ok,
        command: 'health-report',
        cwd: options.cwd,
        messages: [
            message(ok ? 'info' : 'warn', ok ? 'ATM_HEALTH_REPORT_OK' : 'ATM_HEALTH_REPORT_HIGH_RISK', ok
                ? `Map health report generated: ${report.atomCount} atoms, ${report.edgeCount} edges, no high-risk atoms.`
                : `Map health report: ${highRiskAtoms.length} high-risk atom(s) detected out of ${report.atomCount}.`, { mapId: options.map, highRiskCount: highRiskAtoms.length })
        ],
        evidence: {
            mapId: report.mapId,
            generatedAt: report.generatedAt,
            atomCount: report.atomCount,
            edgeCount: report.edgeCount,
            atoms: report.atoms,
            topBottlenecks: report.topBottlenecks,
            topUnstable: report.topUnstable
        }
    });
}
